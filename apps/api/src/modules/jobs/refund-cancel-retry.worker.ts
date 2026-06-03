import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  payments,
  refunds,
  reservationSeats,
  reservations,
  showtimes,
} from '../../database/schema/index.js';
import {
  calculateExpectedRefundDepositAt,
  getRefundErrorCode,
  getRefundErrorMessage,
  isTossCancelCompleted,
  isTransientRefundCancelFailure,
  REFUND_CANCEL_MAX_RETRIES,
} from '../refund/refund.service.js';
import { TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import { buildFullPaymentCancelRequest } from '../payment/payment-cancel-policy.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type RefundCancelRetryJobPayload,
} from './pgboss.provider.js';

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

const REFUND_CANCEL_RETRY_METADATA_KEY = 'refundCancelRetry';

function getRefundProviderMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

@Injectable()
export class RefundCancelRetryWorker implements OnModuleInit {
  private readonly logger = new Logger(RefundCancelRetryWorker.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly paymentCancellationFinalizer: PaymentCancellationFinalizerService,
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
      | 'retry_schedule_failed'
      | 'failed'
      | 'completed'
      | 'processing'
      | 'status_wait';
  }> {
    const context = await this.loadRetryContext(payload.refundId);
    if (!context) {
      return { status: 'missing_refund' };
    }

    if (context.refund.status === 'completed' || context.refund.status === 'failed') {
      return { status: 'already_terminal' };
    }

    const reason = this.resolveCancelReason(context.refund);
    const retryPolicyExhausted = context.refund.retryCount >= REFUND_CANCEL_MAX_RETRIES;
    const nextRetryCount = Math.min(
      context.refund.retryCount + 1,
      REFUND_CANCEL_MAX_RETRIES,
    );
    const command = buildFullPaymentCancelRequest({
      payment: context.payment,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(context.refund.id),
      cancelRequestIdSeed: context.refund.id,
    });

    try {
      const queried = await this.tossPaymentsClient.queryPayment(command.paymentKey, {
        secretKeyScope: command.options.secretKeyScope,
      });

      if (isTossCancelCompleted(queried)) {
        await this.finalizeFullPaymentCancellation(context, queried, reason);
        return { status: 'completed' };
      }

      if (this.hasMatchingInProgressCancel(queried, command.options.cancelRequestId)) {
        return await this.keepWaitingForMatchingAsyncCancel(
          context,
          queried,
          reason,
          nextRetryCount,
          command.options.cancelRequestId,
          retryPolicyExhausted,
        );
      }

      if (retryPolicyExhausted) {
        await this.markRetryExhausted(context.refund.id, reason);
        return { status: 'failed' };
      }

      const response = await this.tossPaymentsClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );

      if (isTossCancelCompleted(response)) {
        await this.finalizeFullPaymentCancellation(context, response, reason);
        return { status: 'completed' };
      }

      if (this.hasMatchingInProgressCancel(response, command.options.cancelRequestId)) {
        return await this.keepWaitingForMatchingAsyncCancel(
          context,
          response,
          reason,
          nextRetryCount,
          command.options.cancelRequestId,
          nextRetryCount >= REFUND_CANCEL_MAX_RETRIES,
        );
      }

      await this.markRefundProcessing(context.refund.id, response, reason, nextRetryCount);
      const jobId = await this.scheduleRetry(context.refund.id, nextRetryCount);
      await this.recordRetryScheduleState(
        context.refund.id,
        {
          cancelReason: reason,
          paymentStatus: response.status,
        },
        nextRetryCount,
        jobId,
      );
      return { status: jobId ? 'processing' : 'retry_schedule_failed' };
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

        const jobId = await this.scheduleRetry(context.refund.id, nextRetryCount);
        await this.recordRetryScheduleState(
          context.refund.id,
          {
            cancelReason: reason,
            lastTransientError: getRefundErrorMessage(error),
          },
          nextRetryCount,
          jobId,
        );
        return { status: jobId ? 'rescheduled' : 'retry_schedule_failed' };
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

  protected buildRefundCancelIdempotencyKey(refundId: string): string {
    return `refund-cancel:${refundId}`;
  }

  protected hasMatchingInProgressCancel(
    response: TossPaymentResponse,
    cancelRequestId: string | undefined,
  ): boolean {
    if (!cancelRequestId) {
      return false;
    }

    return response.cancels?.some((cancel) =>
      cancel.cancelRequestId === cancelRequestId && cancel.cancelStatus !== 'DONE'
    ) ?? false;
  }

  protected async keepWaitingForMatchingAsyncCancel(
    context: RetryContext,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancelRequestId: string | undefined,
    retryPolicyExhausted: boolean,
  ): Promise<{ status: 'processing' | 'retry_schedule_failed' | 'status_wait' }> {
    await this.markRefundProcessing(
      context.refund.id,
      response,
      reason,
      retryCount,
    );

    const jobId = retryPolicyExhausted
      ? null
      : await this.scheduleRetry(context.refund.id, retryCount);
    await this.recordRetryScheduleState(
      context.refund.id,
      {
        cancelReason: reason,
        paymentStatus: response.status,
        cancelRequestId,
        ...(retryPolicyExhausted ? { manualReviewRequired: true } : {}),
      },
      retryCount,
      jobId,
    );

    if (retryPolicyExhausted) {
      return { status: 'status_wait' };
    }

    return { status: jobId ? 'processing' : 'retry_schedule_failed' };
  }

  protected async finalizeFullPaymentCancellation(
    context: RetryContext,
    response: TossPaymentResponse,
    reason: string,
  ): Promise<void> {
    await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
      source: 'refund_retry',
      refundId: context.refund.id,
      context: {
        reservation: {
          id: context.reservation.id,
          showtimeId: context.reservation.showtimeId,
          reservationNumber: context.reservation.reservationNumber,
        },
        payment: {
          id: context.payment.id,
          paymentKey: context.payment.paymentKey,
          providerMetadata: context.payment.providerMetadata,
        },
        bookingPolicy: context.bookingPolicy,
        seats: context.seats.map((seat) => ({ seatId: seat.seatId })),
      },
      reason,
      providerResponse: response as unknown as Record<string, unknown>,
      actor: { kind: 'system' },
    });
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

  protected async recordRetryScheduleState(
    refundId: string,
    baseMetadata: Record<string, unknown>,
    retryCount: number,
    jobId: string | null,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(refunds)
      .set({
        providerMetadata: {
          ...getRefundProviderMetadata(baseMetadata),
          [REFUND_CANCEL_RETRY_METADATA_KEY]: {
            status: jobId ? 'scheduled' : 'schedule_failed',
            jobId,
            attempt: retryCount + 1,
            scheduledAt: jobId ? now.toISOString() : null,
            failedAt: jobId ? null : now.toISOString(),
          },
        },
        customerServiceCtaVisible: !jobId,
        updatedAt: now,
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

  protected async scheduleRetry(refundId: string, retryCount: number): Promise<string | null> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(`pg-boss unavailable. retry schedule skipped for refundId=${refundId}`);
      return null;
    }

    const delaySeconds = Math.min(600, 60 * Math.max(1, retryCount));
    const startAfter = new Date(Date.now() + delaySeconds * 1000);

    try {
      return await this.pgBoss.send(
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
    } catch (error) {
      this.logger.error(
        `pg-boss refund-cancel-retry enqueue failed for refundId=${refundId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
