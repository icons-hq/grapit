import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { CancellationQuote } from '@grabit/shared';
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
  getRefundErrorCode,
  getRefundErrorMessage,
  isTossCancelCompleted,
  isTransientRefundCancelFailure,
  REFUND_CANCEL_MAX_RETRIES,
} from '../refund/refund.service.js';
import { restoreRejectedRefundRights } from '../cancellation/refund-rights-restoration.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  buildFullPaymentCancelRequest,
  buildFullReservationPaymentCancelRequest,
  readStoredPaymentCancelRequest,
  hasUnchangedCancellationBalance,
  readStoredPaymentCancelReceipt,
} from '../payment/payment-cancel-policy.js';
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

function getStoredCancellationQuote(refund: RefundRecord): CancellationQuote | null {
  const metadata = getRefundProviderMetadata(refund.providerMetadata);
  const quote = metadata.cancellationQuote;
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    return null;
  }

  const candidate = quote as Partial<CancellationQuote>;
  if (
    typeof candidate.originalPaymentAmount !== 'number'
    || typeof candidate.refundableAmount !== 'number'
    || !Array.isArray(candidate.items)
  ) {
    return null;
  }

  return candidate as CancellationQuote;
}

function getRefundCancelRequestAnchor(refund: RefundRecord): Date | null {
  return refund.requestedAt ?? refund.sentToPgAt ?? refund.processingAtPgAt ?? null;
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
    if (!this.pgBoss?.isAvailable || this.pgBoss.processesJobs === false) {
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
    const cancellationQuote = getStoredCancellationQuote(context.refund);
    const retryPolicyExhausted = context.refund.retryCount >= REFUND_CANCEL_MAX_RETRIES;
    const nextRetryCount = Math.min(
      context.refund.retryCount + 1,
      REFUND_CANCEL_MAX_RETRIES,
    );
    const baseCommandInput = {
      payment: context.payment,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(context.refund.id),
      cancelRequestIdSeed: context.refund.id,
    };
    const command = readStoredPaymentCancelRequest(context.refund.providerMetadata) ?? (cancellationQuote
      ? buildFullReservationPaymentCancelRequest({
          ...baseCommandInput,
          cancellationQuote,
        })
      : buildFullPaymentCancelRequest(baseCommandInput));
    const allowPartialStatus =
      cancellationQuote !== null
      && cancellationQuote.refundableAmount < context.payment.amount;

    let cancelAttempted = false;
    let providerAccepted = false;
    let definitePreflightRejection = false;
    const amountSnapshot = getRefundProviderMetadata(context.refund.providerMetadata).providerRefund;
    try {
      let queried: TossPaymentResponse;
      try {
        queried = await this.tossPaymentsClient.queryPayment(command.paymentKey, {
          secretKeyScope: command.options.secretKeyScope,
        });
      } catch {
        throw new TossPaymentError('NETWORK_ERROR', '결제사 환불 잔액을 확인하지 못했습니다');
      }

      if (
        isTossCancelCompleted(queried, command.options.cancelRequestId, {
          allowPartialStatus,
          expectedCancelAmount: command.options.cancelAmount,
          ...readStoredPaymentCancelReceipt(context.refund.providerMetadata),
          allowUnidentifiedPartialCancel: true,
          requestedAt: getRefundCancelRequestAnchor(context.refund),
        })
      ) {
        providerAccepted = true;
        await this.finalizeFullPaymentCancellation(context, queried, reason);
        return { status: 'completed' };
      }

      if (this.hasMatchingInProgressCancel(queried, command.options.cancelRequestId, readStoredPaymentCancelReceipt(context.refund.providerMetadata))) {
        return await this.keepWaitingForMatchingAsyncCancel(
          context,
          queried,
          reason,
          nextRetryCount,
          command.options.cancelRequestId,
          retryPolicyExhausted,
          cancellationQuote,
        );
      }

      if (retryPolicyExhausted) {
        await this.markRetryExhausted(context.refund.id, reason);
        return { status: 'failed' };
      }

      // A receipt can be recovered at any age, but a POST must stay within the provider's
      // idempotency window and must use the exact balance frozen before the first attempt.
      if (Date.now() - context.refund.requestedAt.getTime() >= 15 * 86400000
        || (amountSnapshot && !hasUnchangedCancellationBalance(queried, amountSnapshot))) {
        throw new TossPaymentError('BALANCE_RECONCILIATION_REQUIRED', '취소 요청과 결제사 잔액을 대조해야 합니다');
      }
      if (command.options.cancelAmount !== undefined && queried.isPartialCancelable !== true) {
        definitePreflightRejection = queried.isPartialCancelable === false && Boolean(amountSnapshot && hasUnchangedCancellationBalance(queried, amountSnapshot));
        throw new TossPaymentError('NOT_PARTIAL_CANCELABLE', '결제사에서 부분취소를 허용하지 않습니다');
      }
      cancelAttempted = true;
      const response = await this.tossPaymentsClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );

      providerAccepted = true;
      if (
        isTossCancelCompleted(response, command.options.cancelRequestId, {
          allowPartialStatus,
          expectedCancelAmount: command.options.cancelAmount,
          ...readStoredPaymentCancelReceipt(context.refund.providerMetadata),
          allowUnidentifiedPartialCancel: true,
          requestedAt: getRefundCancelRequestAnchor(context.refund),
        })
      ) {
        await this.finalizeFullPaymentCancellation(context, response, reason);
        return { status: 'completed' };
      }

      if (this.hasMatchingInProgressCancel(response, command.options.cancelRequestId, readStoredPaymentCancelReceipt(context.refund.providerMetadata))) {
        return await this.keepWaitingForMatchingAsyncCancel(
          context,
          response,
          reason,
          nextRetryCount,
          command.options.cancelRequestId,
          nextRetryCount >= REFUND_CANCEL_MAX_RETRIES,
          cancellationQuote,
        );
      }

      await this.markRefundProcessing(
        context.refund.id,
        response,
        reason,
        nextRetryCount,
        cancellationQuote,
      );
      const jobId = await this.scheduleRetry(context.refund.id, nextRetryCount);
      await this.recordRetryScheduleState(
        context.refund.id,
        {
          cancelReason: reason,
          paymentStatus: response.status,
          ...(cancellationQuote ? { cancellationQuote } : {}),
        },
        nextRetryCount,
        jobId,
      );
      return { status: jobId ? 'processing' : 'retry_schedule_failed' };
    } catch (error) {
      if (providerAccepted || isTransientRefundCancelFailure(error)) {
        await this.recordTransientRetryFailure(
          context.refund.id,
          error,
          reason,
          nextRetryCount,
          cancellationQuote,
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
            ...(cancellationQuote ? { cancellationQuote } : {}),
          },
          nextRetryCount,
          jobId,
        );
        return { status: jobId ? 'rescheduled' : 'retry_schedule_failed' };
      }

      let canRestore = definitePreflightRejection;
      if (cancelAttempted && error instanceof TossPaymentError
        && ['INVALID_REQUEST', 'NOT_CANCELABLE_PAYMENT', 'NOT_ENOUGH_CANCELABLE_AMOUNT', 'NOT_CANCELABLE_AMOUNT'].includes(error.code)) {
        try {
          const current = await this.tossPaymentsClient.queryPayment(command.paymentKey, { secretKeyScope: command.options.secretKeyScope });
          canRestore = hasUnchangedCancellationBalance(current, amountSnapshot)
            && !current.cancels?.some((cancel) => cancel.cancelReason === command.reason);
        } catch { canRestore = false; }
      }
      if (canRestore) await restoreRejectedRefundRights(this.db, context.refund,
        { code: getRefundErrorCode(error), message: getRefundErrorMessage(error) });
      else await this.markFinalFailure(context.refund.id, error);
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
    receipt: ReturnType<typeof readStoredPaymentCancelReceipt> = {},
  ): boolean {
    if (!cancelRequestId && !receipt.expectedCancelReason) {
      return false;
    }

    return response.cancels?.some((cancel) =>
      cancel.cancelStatus === 'IN_PROGRESS'
      && (!cancelRequestId || cancel.cancelRequestId === cancelRequestId)
      && (!receipt.expectedCancelReason || cancel.cancelReason === receipt.expectedCancelReason)
      && (receipt.expectedCancelAmount === undefined || cancel.cancelAmount === receipt.expectedCancelAmount)
    ) ?? false;
  }

  protected async keepWaitingForMatchingAsyncCancel(
    context: RetryContext,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancelRequestId: string | undefined,
    retryPolicyExhausted: boolean,
    cancellationQuote: CancellationQuote | null,
  ): Promise<{ status: 'processing' | 'retry_schedule_failed' | 'status_wait' }> {
    await this.markRefundProcessing(
      context.refund.id,
      response,
      reason,
      retryCount,
      cancellationQuote,
    );

    const jobId = await this.scheduleRetry(context.refund.id, retryCount);
    await this.recordRetryScheduleState(
      context.refund.id,
      {
        cancelReason: reason,
        paymentStatus: response.status,
        cancelRequestId,
        ...(cancellationQuote ? { cancellationQuote } : {}),
        ...(retryPolicyExhausted && !jobId ? { manualReviewRequired: true } : {}),
      },
      retryCount,
      jobId,
    );

    if (retryPolicyExhausted) {
      return { status: jobId ? 'processing' : 'status_wait' };
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
      ...(getStoredCancellationQuote(context.refund)
        ? { fullReservationCancellationQuote: getStoredCancellationQuote(context.refund)! }
        : {}),
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
    cancellationQuote: CancellationQuote | null = null,
  ): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'sent_to_pg',
        sentToPgAt: sql`coalesce(${refunds.sentToPgAt}, ${new Date().toISOString()}::timestamptz)`,
        retryCount,
        resultCode: getRefundErrorCode(error),
        resultMessage: getRefundErrorMessage(error),
        failureReason: getRefundErrorMessage(error),
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          cancelReason: reason,
          ...(cancellationQuote ? { cancellationQuote } : {}),
          lastTransientError: getRefundErrorMessage(error),
        })}::jsonb`,
        expectedDepositAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed')));
  }

  protected async markRefundProcessing(
    refundId: string,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancellationQuote: CancellationQuote | null = null,
  ): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: 'processing_at_pg',
        sentToPgAt: sql`coalesce(${refunds.sentToPgAt}, ${new Date().toISOString()}::timestamptz)`,
        processingAtPgAt: sql`coalesce(${refunds.processingAtPgAt}, ${new Date().toISOString()}::timestamptz)`,
        retryCount,
        resultCode: response.status,
        resultMessage: 'PG cancel accepted and is processing',
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          cancelReason: reason,
          paymentStatus: response.status,
          ...(cancellationQuote ? { cancellationQuote } : {}),
        })}::jsonb`,
        expectedDepositAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed')));
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
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          ...getRefundProviderMetadata(baseMetadata),
          [REFUND_CANCEL_RETRY_METADATA_KEY]: {
            status: jobId ? 'scheduled' : 'schedule_failed',
            jobId,
            attempt: retryCount + 1,
            scheduledAt: jobId ? now.toISOString() : null,
            failedAt: jobId ? null : now.toISOString(),
          },
        })}::jsonb`,
        customerServiceCtaVisible: !jobId,
        updatedAt: now,
      })
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed')));
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
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed')));
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
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed')));
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
