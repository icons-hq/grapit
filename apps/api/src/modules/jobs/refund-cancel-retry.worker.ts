import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  payments,
  refunds,
  reservationSeats,
  reservations,
  seatInventories,
  showtimes,
  tickets,
} from '../../database/schema/index.js';
import {
  calculateExpectedRefundDepositAt,
  DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES,
  DEFAULT_CANCELLED_SEAT_HOLD_MINUTES,
  getRefundErrorCode,
  getRefundErrorMessage,
  isTossCancelCompleted,
  isTransientRefundCancelFailure,
  normalizeReservationSeatIdentity,
  REFUND_CANCEL_MAX_RETRIES,
  SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
} from '../refund/refund.service.js';
import { TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type RefundCancelRetryJobPayload,
  type ReleaseCancelledSeatJobPayload,
  type SeatIdentityPayload,
} from './pgboss.provider.js';
import { pickCancelledSeatReleaseDelaySeconds } from './cancelled-seat-release.worker.js';

type RefundRecord = typeof refunds.$inferSelect;
type ReservationRecord = typeof reservations.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;
type ReservationSeatRecord = typeof reservationSeats.$inferSelect;
type ShowtimeRecord = typeof showtimes.$inferSelect;
type BookingPolicyRecord = typeof bookingPolicies.$inferSelect;

type RetryContext = {
  refund: RefundRecord;
  reservation: ReservationRecord;
  payment: PaymentRecord;
  showtime: ShowtimeRecord;
  bookingPolicy: BookingPolicyRecord | null;
  seats: ReservationSeatRecord[];
};

@Injectable()
export class RefundCancelRetryWorker implements OnModuleInit {
  private readonly logger = new Logger(RefundCancelRetryWorker.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.pgBoss?.isAvailable) {
      return;
    }

    await this.pgBoss.work<RefundCancelRetryJobPayload>(
      PG_BOSS_JOB_NAMES.refundCancelRetry,
      async ([job]) => {
        if (!job) {
          return;
        }

        await this.handleJob(job.data);
      },
    );
  }

  async handleJob(payload: RefundCancelRetryJobPayload): Promise<{
    status:
      | 'missing_refund'
      | 'already_terminal'
      | 'rescheduled'
      | 'failed'
      | 'completed'
      | 'processing';
  }> {
    const context = await this.loadRetryContext(payload.refundId);
    if (!context) {
      return { status: 'missing_refund' };
    }

    if (context.refund.status === 'completed' || context.refund.status === 'failed') {
      return { status: 'already_terminal' };
    }

    if (context.refund.retryCount >= REFUND_CANCEL_MAX_RETRIES) {
      const reason = this.resolveCancelReason(context.refund);
      await this.markRetryExhausted(context.refund.id, reason);
      return { status: 'failed' };
    }

    const reason = this.resolveCancelReason(context.refund);
    const nextRetryCount = context.refund.retryCount + 1;

    try {
      const response = await this.tossPaymentsClient.cancelPayment(
        context.payment.paymentKey,
        reason,
      );

      if (isTossCancelCompleted(response)) {
        await this.finalizeSuccessfulRetry(context, response, reason);
        return { status: 'completed' };
      }

      await this.markRefundProcessing(context.refund.id, response, reason, nextRetryCount);
      await this.scheduleRetry(context.refund.id, nextRetryCount);
      return { status: 'processing' };
    } catch (error) {
      if (isTransientRefundCancelFailure(error)) {
        await this.recordTransientRetryFailure(
          context.refund.id,
          error,
          reason,
          nextRetryCount,
        );
        if (nextRetryCount >= REFUND_CANCEL_MAX_RETRIES) {
          await this.markRetryExhausted(context.refund.id, reason);
          return { status: 'failed' };
        }

        await this.scheduleRetry(context.refund.id, nextRetryCount);
        return { status: 'rescheduled' };
      }

      await this.markFinalFailure(context.refund.id, error);
      return { status: 'failed' };
    }
  }

  protected resolveCancelReason(refund: RefundRecord): string {
    const metadata =
      refund.providerMetadata &&
      typeof refund.providerMetadata === 'object' &&
      !Array.isArray(refund.providerMetadata)
        ? (refund.providerMetadata as Record<string, unknown>)
        : null;
    return typeof metadata?.cancelReason === 'string'
      ? metadata.cancelReason
      : refund.failureReason ?? '사용자 환불 요청';
  }

  protected async loadRetryContext(refundId: string): Promise<RetryContext | null> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId));

    if (!refund) {
      return null;
    }

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, refund.reservationId));
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.id, refund.paymentId));

    if (!reservation || !payment) {
      return null;
    }

    const [showtime] = await this.db
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));
    if (!showtime) {
      return null;
    }

    const [bookingPolicy] = await this.db
      .select()
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));

    return {
      refund,
      reservation,
      payment,
      showtime,
      bookingPolicy: bookingPolicy ?? null,
      seats,
    };
  }

  protected async recordTransientRetryFailure(
    refundId: string,
    error: unknown,
    reason: string,
    retryCount: number,
  ): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'sent_to_pg',
        sentToPgAt: new Date(),
        retryCount,
        resultCode: getRefundErrorCode(error),
        resultMessage: getRefundErrorMessage(error),
        failureReason: getRefundErrorMessage(error),
        providerMetadata: {
          cancelReason: reason,
          lastTransientError: getRefundErrorMessage(error),
        },
        expectedDepositAt: calculateExpectedRefundDepositAt(),
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }

  protected async markRefundProcessing(
    refundId: string,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
  ): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'processing_at_pg',
        sentToPgAt: new Date(),
        processingAtPgAt: new Date(),
        retryCount,
        resultCode: response.status,
        resultMessage: 'PG cancel accepted and is processing',
        providerMetadata: {
          cancelReason: reason,
          paymentStatus: response.status,
        },
        expectedDepositAt: calculateExpectedRefundDepositAt(),
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }

  protected async markRetryExhausted(refundId: string, reason: string): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'failed',
        failedAt: new Date(),
        retryCount: REFUND_CANCEL_MAX_RETRIES,
        resultCode: 'RETRY_EXHAUSTED',
        resultMessage: 'Refund cancel retry exhausted',
        failureReason: reason,
        customerServiceCtaVisible: true,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }

  protected async markFinalFailure(refundId: string, error: unknown): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'failed',
        failedAt: new Date(),
        resultCode: getRefundErrorCode(error),
        resultMessage: getRefundErrorMessage(error),
        failureReason: getRefundErrorMessage(error),
        customerServiceCtaVisible: true,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }

  protected resolveHoldWindowMinutes(bookingPolicy: BookingPolicyRecord | null) {
    return {
      min:
        bookingPolicy?.cancelledSeatHoldMinMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MINUTES,
      max:
        bookingPolicy?.cancelledSeatHoldMaxMinutes ??
        DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES,
    };
  }

  protected async finalizeSuccessfulRetry(
    context: RetryContext,
    response: TossPaymentResponse,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const holdWindow = this.resolveHoldWindowMinutes(context.bookingPolicy);
    const delaySeconds = pickCancelledSeatReleaseDelaySeconds(
      holdWindow.min,
      holdWindow.max,
    );
    const releaseAt = new Date(now.getTime() + delaySeconds * 1000);
    const seatIdentities = context.seats.map((seat) =>
      normalizeReservationSeatIdentity(seat.seatId),
    );
    const releaseJobId = randomUUID();
    const releaseEnqueued = await this.scheduleReleaseJob(
      context,
      seatIdentities,
      releaseAt,
      releaseJobId,
    );
    const persistedReleaseJobId = releaseEnqueued
      ? releaseJobId
      : SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID;

    await this.db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({
          status: 'completed',
          sentToPgAt: now,
          completedAt: now,
          retryCount: context.refund.retryCount + 1,
          resultCode: response.status,
          resultMessage: 'PG cancel completed after retry',
          failureReason: null,
          expectedDepositAt: calculateExpectedRefundDepositAt(now),
          customerServiceCtaVisible: false,
          providerMetadata: {
            cancelReason: reason,
            paymentStatus: response.status,
          },
          updatedAt: now,
        })
        .where(eq(refunds.id, context.refund.id));

      await tx
        .update(reservations)
        .set({
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: reason,
          updatedAt: now,
        })
        .where(eq(reservations.id, context.reservation.id));

      await tx
        .update(payments)
        .set({
          status: 'CANCELED',
          cancelledAt: now,
          cancelReason: reason,
          providerMetadata: {
            ...(context.payment.providerMetadata as Record<string, unknown> | null),
            refundCompletedAt: now.toISOString(),
          },
        })
        .where(eq(payments.id, context.payment.id));

      await tx
        .update(tickets)
        .set({
          status: 'revoked',
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(tickets.reservationId, context.reservation.id));

      for (const seatIdentity of seatIdentities) {
        await tx
          .update(seatInventories)
          .set({
            status: 'held_cancelled',
            lockedBy: null,
            lockedUntil: null,
            heldCancelledAt: now,
            reopenHoldUntil: releaseAt,
            reopenJobId: persistedReleaseJobId,
            soldAt: null,
          })
          .where(
            and(
              eq(seatInventories.showtimeId, context.reservation.showtimeId),
              eq(seatInventories.floorKey, seatIdentity.floorKey),
              eq(seatInventories.seatKey, seatIdentity.seatKey),
            ),
          );
      }
    });

  }

  protected async scheduleReleaseJob(
    context: RetryContext,
    seatIdentities: SeatIdentityPayload[],
    releaseAt: Date,
    releaseJobId: string,
  ): Promise<boolean> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(
        `pg-boss unavailable. delayed seat release skipped for refundId=${context.refund.id}`,
      );
      return false;
    }

    const payload: ReleaseCancelledSeatJobPayload = {
      reservationId: context.reservation.id,
      showtimeId: context.reservation.showtimeId,
      releaseAt: releaseAt.toISOString(),
      seatIdentities,
    };

    try {
      const jobId = await this.pgBoss.send(PG_BOSS_JOB_NAMES.releaseCancelledSeat, payload, {
        id: releaseJobId,
        startAfter: releaseAt,
        singletonKey: context.reservation.id,
        retryLimit: 3,
        retryBackoff: true,
        retryDelay: 30,
      });
      return jobId === releaseJobId;
    } catch (error) {
      this.logger.error(
        `pg-boss release-cancelled-seat enqueue failed for refundId=${context.refund.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  protected async scheduleRetry(refundId: string, retryCount: number): Promise<string | null> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(`pg-boss unavailable. retry schedule skipped for refundId=${refundId}`);
      return null;
    }

    const delaySeconds = Math.min(600, 60 * Math.max(1, retryCount));
    const startAfter = new Date(Date.now() + delaySeconds * 1000);

    return this.pgBoss.send(
      PG_BOSS_JOB_NAMES.refundCancelRetry,
      { refundId, attempt: retryCount + 1 },
      {
        startAfter,
        singletonKey: refundId,
        retryLimit: REFUND_CANCEL_MAX_RETRIES,
        retryBackoff: true,
        retryDelay: 60,
      },
    );
  }
}
