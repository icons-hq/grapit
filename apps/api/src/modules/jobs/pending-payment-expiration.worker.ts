import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { BookingService } from '../booking/booking.service.js';
import { AbandonedPaymentHandoffService } from '../payment/abandoned-payment-handoff.service.js';
import { PaymentService } from '../payment/payment.service.js';
import { boundedByRunDeadline } from '../../common/run-deadline.js';
import { isBackgroundProcessingEnabled } from './pgboss.provider.js';

export const PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS = 60_000;
export const ASYNC_PAYMENT_HANDOFF_STATUSES = ['IN_PROGRESS', 'DONE', 'PARTIAL_CANCELED'] as const;

interface ExpiredPendingReservationRow {
  id: string;
  userId: string;
  showtimeId: string;
  tossOrderId: string | null;
}

export interface PendingPaymentExpirationSweepResult {
  expiredReservations: number;
  unlockedSeats: number;
}

function mapExpiredPendingReservationRow(
  row: Record<string, unknown>,
): ExpiredPendingReservationRow {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    showtimeId: String(row['showtime_id']),
    tossOrderId: typeof row['toss_order_id'] === 'string'
      ? row['toss_order_id']
      : null,
  };
}

function resolveSweepIntervalMs(configService?: ConfigService): number {
  const configured = configService?.get<string>('PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS');
  if (!configured) {
    return PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS;
  }

  const intervalMs = Number(configured);
  return Number.isFinite(intervalMs)
    ? intervalMs
    : PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS;
}

@Injectable()
export class PendingPaymentExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingPaymentExpirationWorker.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    _bookingService: BookingService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly abandonedHandoffs?: AbandonedPaymentHandoffService,
    @Optional() private readonly paymentService?: PaymentService,
  ) {}

  onModuleInit(): void {
    if (
      this.configService
      && !isBackgroundProcessingEnabled(this.configService)
    ) {
      return;
    }

    const intervalMs = resolveSweepIntervalMs(this.configService);
    if (intervalMs <= 0) {
      return;
    }

    this.sweepInterval = setInterval(() => {
      void this.sweepExpiredPendingPayments().catch((error: unknown) => {
        this.logger.error(
          'Pending payment expiration sweep failed',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, intervalMs);
    this.sweepInterval.unref?.();
  }

  onModuleDestroy(): void {
    if (!this.sweepInterval) {
      return;
    }

    clearInterval(this.sweepInterval);
    this.sweepInterval = null;
  }

  async sweepExpiredPendingPayments(
    now: Date = new Date(),
  ): Promise<PendingPaymentExpirationSweepResult> {
    const asyncHandoffStatuses = sql.join(
      ASYNC_PAYMENT_HANDOFF_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    );
    const result = await this.db.execute(sql`
      WITH expired AS (
        UPDATE reservations r
        SET
          status = 'FAILED',
          updated_at = ${now}
        WHERE r.status = 'PENDING_PAYMENT'
          AND r.payment_deadline_at IS NOT NULL
          AND r.payment_deadline_at < ${now}
          AND (
            r.checkout_started_at IS NULL
            OR EXISTS (
              SELECT 1 FROM payments p
              WHERE p.reservation_id = r.id
                AND p.status IN ('ABORTED', 'EXPIRED', 'CANCELED')
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.reservation_id = r.id
              AND p.status IN (${asyncHandoffStatuses})
          )
        RETURNING r.id, r.user_id, r.showtime_id, r.toss_order_id
      ),
      released_deposits AS (
        UPDATE seat_inventories seat SET status = 'available', locked_by = NULL, locked_until = NULL
        FROM expired WHERE seat.showtime_id = expired.showtime_id AND seat.locked_by = expired.id
          AND seat.status = 'locked'
      ),
      diagnostics AS (
        INSERT INTO reservation_payment_failure_diagnostics (
          reservation_id,
          toss_order_id,
          diagnostic_kind,
          diagnostic_code,
          diagnostic_message,
          diagnostic_source,
          recorded_at,
          updated_at
        )
        SELECT
          expired.id,
          expired.toss_order_id,
          'payment_expired',
          'PAYMENT_DEADLINE_EXPIRED',
          '결제 제한 시간이 만료되었습니다.',
          'pending_payment_expiration_worker',
          ${now},
          ${now}
        FROM expired
        ON CONFLICT (reservation_id) DO UPDATE SET
          toss_order_id = excluded.toss_order_id,
          diagnostic_kind = excluded.diagnostic_kind,
          diagnostic_code = excluded.diagnostic_code,
          diagnostic_message = excluded.diagnostic_message,
          diagnostic_source = excluded.diagnostic_source,
          recorded_at = excluded.recorded_at,
          updated_at = now()
        RETURNING reservation_id
      )
      SELECT id, user_id, showtime_id, toss_order_id
      FROM expired
    `);
    const expiredReservations = result.rows.map((row) =>
      mapExpiredPendingReservationRow(row as Record<string, unknown>)
    );
    const abandonedHandoffs = await this.sweepAbandonedPaymentHandoffs(now);
    const closedDeposits = this.paymentService ? await this.sweepVirtualAccounts(now, this.paymentService) : 0;
    const unlockedSeats = 0;

    // Redis TTL owns lock expiration. A delayed sweep cannot distinguish this
    // reservation's locks from a newer attempt by the same user, even on the
    // same seat. Never unlock user-scoped locks from historical reservations.

    if (expiredReservations.length > 0) {
      this.logger.log(
        `Expired pending payments. reservations=${expiredReservations.length}, unlockedSeats=${unlockedSeats}`,
      );
    }

    return {
      expiredReservations: expiredReservations.length + abandonedHandoffs + closedDeposits,
      unlockedSeats,
    };
  }

  private async sweepVirtualAccounts(now: Date, service: PaymentService) {
    const deadlineMs = Date.now() + boundedByRunDeadline(35_000, { reserveMs: 15_000 });
    const due = await this.db.execute(sql`SELECT r.toss_order_id FROM reservations r
      JOIN payments p ON p.reservation_id = r.id
      WHERE r.status = 'PENDING_PAYMENT' AND r.payment_deadline_at <= ${now}
        AND p.method = 'VIRTUAL_ACCOUNT' AND p.status = 'IN_PROGRESS'
      ORDER BY r.updated_at, r.id LIMIT 32`);
    let closed = 0;
    for (let i = 0; i < due.rows.length; i += 4) {
      if (Date.now() >= deadlineMs) break;
      const results = await Promise.all(due.rows.slice(i, i + 4).map(async row => {
        const orderId = String(row['toss_order_id']);
        try {
          return await service.syncVirtualAccount({ orderId, deadlineMs });
        } catch {
          this.logger.warn('가상계좌 기한 경과 주문의 PG 상태 재확인 필요. orderId=' + orderId);
          await this.db.execute(sql`UPDATE reservations SET updated_at = now()
            WHERE toss_order_id = ${orderId} AND status = 'PENDING_PAYMENT'`);
          return null;
        }
      }));
      closed += results.filter(status => status === 'EXPIRED' || status === 'CANCELED' || status === 'ABORTED').length;
    }
    return closed;
  }

  /** Handoffs with no payment require provider evidence before they can be closed. */
  private async sweepAbandonedPaymentHandoffs(now: Date): Promise<number> {
    if (
      !this.abandonedHandoffs
      || this.configService?.get<string>('PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED') === 'false'
    ) {
      return 0;
    }

    try {
      const result = await this.abandonedHandoffs.sweepAbandonedPaymentHandoffs(now);
      return result.failedReservations;
    } catch (error) {
      this.logger.error(
        'Abandoned payment handoff sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
