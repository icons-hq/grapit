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
import { isBackgroundProcessingEnabled } from './pgboss.provider.js';

export const PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS = 60_000;
export const ASYNC_PAYMENT_HANDOFF_STATUSES = ['IN_PROGRESS', 'DONE'] as const;

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
    private readonly bookingService: BookingService,
    @Optional() private readonly configService?: ConfigService,
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
          AND NOT EXISTS (
            SELECT 1
            FROM payments p
            WHERE p.reservation_id = r.id
              AND p.status IN (${asyncHandoffStatuses})
          )
        RETURNING r.id, r.user_id, r.showtime_id, r.toss_order_id
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
    let unlockedSeats = 0;

    for (const reservation of expiredReservations) {
      const unlockResult = await this.bookingService.unlockAllSeats(
        reservation.userId,
        reservation.showtimeId,
      );
      unlockedSeats += unlockResult.unlockedSeats.length;
    }

    if (expiredReservations.length > 0) {
      this.logger.log(
        `Expired pending payments. reservations=${expiredReservations.length}, unlockedSeats=${unlockedSeats}`,
      );
    }

    return {
      expiredReservations: expiredReservations.length,
      unlockedSeats,
    };
  }
}
