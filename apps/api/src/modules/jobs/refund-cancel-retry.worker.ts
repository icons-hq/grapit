import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
  buildRefundCancelRetrySchedule,
  getRefundErrorCode,
  getRefundErrorMessage,
  isDefiniteRefundCancelRejection,
  isTossCancelCompleted,
  isTransientRefundCancelFailure,
  REFUND_BALANCE_RECONCILIATION_CODE,
  REFUND_CANCEL_ATTEMPT_LEASE_MS,
  REFUND_CANCEL_POST_WINDOW_MS,
  REFUND_NOT_PARTIAL_CANCELABLE_CODE,
  sendRefundCancelRetryJob,
  type RefundCancelRetryScheduleOptions,
} from '../refund/refund.service.js';
import { restoreRejectedRefundRights } from '../cancellation/refund-rights-restoration.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  buildFullPaymentCancelRequest,
  buildFullReservationPaymentCancelRequest,
  readStoredPaymentCancelRequest,
  hasProviderCancelForCommand,
  hasUnchangedCancellationBalance,
  isProviderBalanceAboveSnapshot,
  readStoredPaymentCancelReceipt,
} from '../payment/payment-cancel-policy.js';
import {
  isBackgroundProcessingEnabled,
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type RefundCancelRetryJobPayload,
} from './pgboss.provider.js';
import { waitWithinRunDeadline } from '../../common/run-deadline.js';

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

export type RefundCancelRetryJobResult = {
  status:
    | 'missing_refund'
    | 'already_terminal'
    | 'stale_job'
    | 'rescheduled'
    | 'retry_schedule_failed'
    | 'failed'
    | 'completed'
    | 'processing';
};

const NON_TERMINAL_REFUND_STATUSES = ['requested', 'sent_to_pg', 'processing_at_pg'] as const;
const REFUND_CANCEL_RETRY_CLAIM_METADATA_KEY = 'refundCancelRetryClaim';
export { REFUND_CANCEL_ATTEMPT_LEASE_MS };
export const REFUND_RECOVERY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** Grace after a scheduled attempt time before the sweep treats the job as lost. */
export const REFUND_RECOVERY_OVERDUE_GRACE_MS = 10 * 60 * 1000;
/** Rows without a recorded next attempt (crash right after revocation, legacy schedule) wait longer. */
export const REFUND_RECOVERY_UNSCHEDULED_GRACE_MS = 20 * 60 * 1000;
/**
 * Before running a stale refund, the sweep pushes its `nextAttemptAt` this far ahead. An attempt that
 * reschedules overwrites it; a row the attempt cannot move (missing context, a crash, a held claim) is
 * retried after this backoff instead of staying first in line and starving the other stale refunds.
 */
export const REFUND_RECOVERY_RETRY_BACKOFF_MS = 30 * 60 * 1000;
export const REFUND_RECOVERY_BATCH_SIZE = 20;
/** Bounded wait for an in-flight sweep on shutdown, so a bounded worker run does not cut an attempt short. */
export const REFUND_RECOVERY_SHUTDOWN_WAIT_MS = 60 * 1000;
export const REFUND_CANCEL_COMMAND_UNAVAILABLE_CODE = 'CANCEL_COMMAND_UNAVAILABLE';

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

function isLocalOnlyRefund(refund: RefundRecord, quote: CancellationQuote | null): boolean {
  return getRefundProviderMetadata(refund.providerMetadata).localOnlyCancellation === true
    || (quote !== null && quote.refundableAmount === 0);
}

@Injectable()
export class RefundCancelRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundCancelRetryWorker.name);
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;
  private recoveryRunning = false;
  private recoveryRun: Promise<unknown> | null = null;
  private stopping = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly paymentCancellationFinalizer: PaymentCancellationFinalizerService,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.startRecoverySweep();

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

  /**
   * Stops starting new sweep rows and waits (bounded) for the row in flight. The bounded worker closes the
   * application before the database, so an attempt is not cut off between the provider call and its
   * bookkeeping; a row left unfinished after the bounded wait converges through the attempt lease.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }

    const inFlight = this.recoveryRun;
    if (!inFlight) {
      return;
    }

    // The bounded worker shortens the wait to its run deadline (common/run-deadline.ts).
    const timedOut = await waitWithinRunDeadline(inFlight, REFUND_RECOVERY_SHUTDOWN_WAIT_MS);
    if (timedOut) {
      this.logger.warn(
        'Stale refund recovery sweep was still running at shutdown. The unfinished attempt is retried after its lease.',
      );
    }
  }

  /**
   * Background-processing instances (and the bounded worker, once per run) re-drive refunds whose retry job
   * was lost, never enqueued (pg-boss unavailable) or left behind by a crash. The sweep runs the attempt
   * inline so it does not depend on pg-boss being healthy.
   */
  private startRecoverySweep(): void {
    if (!this.configService || !isBackgroundProcessingEnabled(this.configService) || this.recoveryInterval) {
      return;
    }

    const run = () => {
      if (this.stopping || this.recoveryRun) {
        return;
      }
      const sweep = this.recoverStaleRefunds()
        .catch((error: unknown) => {
          this.logger.error(
            'Stale refund recovery sweep failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (this.recoveryRun === sweep) {
            this.recoveryRun = null;
          }
        });
      this.recoveryRun = sweep;
    };
    run();
    this.recoveryInterval = setInterval(run, REFUND_RECOVERY_SWEEP_INTERVAL_MS);
    this.recoveryInterval.unref?.();
  }

  async recoverStaleRefunds(now: Date = new Date()): Promise<{ found: number; attempted: number }> {
    if (this.recoveryRunning) {
      return { found: 0, attempted: 0 };
    }
    this.recoveryRunning = true;

    try {
      const overdueCutoff = new Date(now.getTime() - REFUND_RECOVERY_OVERDUE_GRACE_MS).toISOString();
      const unscheduledCutoff = new Date(now.getTime() - REFUND_RECOVERY_UNSCHEDULED_GRACE_MS).toISOString();
      const staleRefunds = await this.db
        .select({ id: refunds.id, retryCount: refunds.retryCount })
        .from(refunds)
        .where(this.staleRefundCondition(overdueCutoff, unscheduledCutoff))
        .orderBy(sql`coalesce((${refunds.providerMetadata}->'refundCancelRetry'->>'nextAttemptAt')::timestamptz, ${refunds.updatedAt}) asc`)
        .limit(REFUND_RECOVERY_BATCH_SIZE);

      let found = 0;
      let attempted = 0;
      for (const staleRefund of staleRefunds) {
        if (this.stopping) {
          break;
        }
        // Claim the row for this sweep run and back it off, so a row the attempt cannot move does not stay
        // first in line, and a concurrent sweep on another instance skips it.
        if (!(await this.deferStaleRefund(staleRefund.id, now, overdueCutoff, unscheduledCutoff))) {
          continue;
        }
        found += 1;
        try {
          const result = await this.handleJob({
            refundId: staleRefund.id,
            attempt: staleRefund.retryCount + 1,
          });
          if (result.status !== 'stale_job' && result.status !== 'missing_refund') {
            attempted += 1;
          }
        } catch (error) {
          this.logger.error(
            `Stale refund recovery attempt failed for refundId=${staleRefund.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (found > 0) {
        this.logger.warn(
          `Recovered stale refunds without a live retry job. found=${found}, attempted=${attempted}`,
        );
      }

      return { found, attempted };
    } finally {
      this.recoveryRunning = false;
    }
  }

  private staleRefundCondition(overdueCutoff: string, unscheduledCutoff: string) {
    return and(
      inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES]),
      sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
      sql`(case
        when ${refunds.providerMetadata}->'refundCancelRetry'->>'nextAttemptAt' is not null
          then (${refunds.providerMetadata}->'refundCancelRetry'->>'nextAttemptAt')::timestamptz < ${overdueCutoff}::timestamptz
        else ${refunds.updatedAt} < ${unscheduledCutoff}::timestamptz
      end)`,
    );
  }

  /** Conditional per-row claim: only a row that is still stale is pushed back and handed to this sweep. */
  protected async deferStaleRefund(
    refundId: string,
    now: Date,
    overdueCutoff: string,
    unscheduledCutoff: string,
  ): Promise<boolean> {
    const deferredUntil = new Date(now.getTime() + REFUND_RECOVERY_RETRY_BACKOFF_MS).toISOString();
    const [deferred] = await this.db
      .update(refunds)
      .set({
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || jsonb_build_object(
          'refundCancelRetry',
          coalesce(${refunds.providerMetadata}->'refundCancelRetry', '{}'::jsonb)
            || jsonb_build_object('nextAttemptAt', ${deferredUntil}::text, 'sweptAt', ${now.toISOString()}::text)
        )`,
      })
      .where(and(eq(refunds.id, refundId), this.staleRefundCondition(overdueCutoff, unscheduledCutoff)))
      .returning({ id: refunds.id });

    return Boolean(deferred);
  }

  async handleJob(payload: RefundCancelRetryJobPayload): Promise<RefundCancelRetryJobResult> {
    const context = await this.loadRetryContext(payload.refundId);
    if (!context) {
      return { status: 'missing_refund' };
    }

    if (context.refund.status === 'completed' || context.refund.status === 'failed') {
      return { status: 'already_terminal' };
    }

    if (!(await this.claimRetryAttempt(context.refund, payload.attempt))) {
      return { status: 'stale_job' };
    }

    const reason = this.resolveCancelReason(context.refund);
    const cancellationQuote = getStoredCancellationQuote(context.refund);
    const nextRetryCount = context.refund.retryCount + 1;

    if (isLocalOnlyRefund(context.refund, cancellationQuote)) {
      return this.finalizeLocalOnlyRefund(context, reason, nextRetryCount, cancellationQuote);
    }

    const baseCommandInput = {
      payment: context.payment,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(context.refund.id),
      cancelRequestIdSeed: context.refund.id,
    };
    let command: ReturnType<typeof buildFullPaymentCancelRequest>;
    try {
      command = readStoredPaymentCancelRequest(context.refund.providerMetadata) ?? (cancellationQuote
        ? buildFullReservationPaymentCancelRequest({
            ...baseCommandInput,
            cancellationQuote,
          })
        : buildFullPaymentCancelRequest(baseCommandInput));
    } catch (error) {
      // A legacy refund without a frozen command whose command cannot be rebuilt never succeeds by retrying.
      // Whether an earlier POST moved money is unknown, so rights stay revoked for manual reconciliation.
      await this.markFinalFailure(context.refund.id, new TossPaymentError(
        REFUND_CANCEL_COMMAND_UNAVAILABLE_CODE,
        `환불 취소 명령을 만들 수 없어 수동 대조가 필요합니다: ${getRefundErrorMessage(error)}`,
      ));
      return { status: 'failed' };
    }
    const completionOptions = {
      allowPartialStatus:
        cancellationQuote !== null
        && cancellationQuote.refundableAmount < context.payment.amount,
      expectedCancelAmount: command.options.cancelAmount,
      ...readStoredPaymentCancelReceipt(context.refund.providerMetadata),
      allowUnidentifiedPartialCancel: true,
      requestedAt: getRefundCancelRequestAnchor(context.refund),
    };

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

      // A receipt can be recovered at any age.
      if (isTossCancelCompleted(queried, command.options.cancelRequestId, completionOptions)) {
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
          cancellationQuote,
        );
      }

      // The provider aborted this command (asynchronous foreign cancel). Replaying the same idempotency key
      // returns the same answer, so prove the balance is untouched and restore rights instead of looping.
      if (this.hasMatchingAbortedCancel(queried, command.options.cancelRequestId, readStoredPaymentCancelReceipt(context.refund.providerMetadata))) {
        if (amountSnapshot && hasUnchangedCancellationBalance(queried, amountSnapshot)) {
          await this.restoreRejectedRights(context.refund, {
            code: 'PROVIDER_CANCEL_ABORTED',
            message: '결제사가 취소 요청을 중단해 티켓 권리를 복원했습니다',
          });
          return { status: 'failed' };
        }
        throw new TossPaymentError(REFUND_BALANCE_RECONCILIATION_CODE, '결제사가 중단한 취소 요청의 잔액을 대조해야 합니다');
      }

      // A POST must use the exact balance frozen before the first attempt and stay within the provider's
      // idempotency window. A higher provider balance proves this command never applied.
      if (amountSnapshot && !hasUnchangedCancellationBalance(queried, amountSnapshot)) {
        if (isProviderBalanceAboveSnapshot(queried, amountSnapshot) && !hasProviderCancelForCommand(queried, command)) {
          await this.restoreRejectedRights(context.refund, {
            code: REFUND_BALANCE_RECONCILIATION_CODE,
            message: '결제사 잔액이 예매 환불 기록과 달라 취소를 요청하지 않았습니다',
          });
          return { status: 'failed' };
        }
        throw new TossPaymentError(REFUND_BALANCE_RECONCILIATION_CODE, '취소 요청과 결제사 잔액을 대조해야 합니다');
      }
      if (Date.now() - context.refund.requestedAt.getTime() >= REFUND_CANCEL_POST_WINDOW_MS) {
        throw new TossPaymentError(REFUND_BALANCE_RECONCILIATION_CODE, '취소 요청의 결제사 재전송 기한이 지나 대조가 필요합니다');
      }
      if (command.options.cancelAmount !== undefined && queried.isPartialCancelable !== true) {
        definitePreflightRejection = queried.isPartialCancelable === false
          && Boolean(amountSnapshot && hasUnchangedCancellationBalance(queried, amountSnapshot))
          && !hasProviderCancelForCommand(queried, command);
        throw new TossPaymentError(REFUND_NOT_PARTIAL_CANCELABLE_CODE, '결제사에서 부분취소를 허용하지 않습니다');
      }
      cancelAttempted = true;
      const response = await this.tossPaymentsClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );

      providerAccepted = true;
      if (isTossCancelCompleted(response, command.options.cancelRequestId, completionOptions)) {
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
        return this.rescheduleAfterTransientFailure(context, error, reason, nextRetryCount, cancellationQuote);
      }

      const code = getRefundErrorCode(error);
      if (code === REFUND_NOT_PARTIAL_CANCELABLE_CODE) {
        if (!definitePreflightRejection) {
          return this.rescheduleAfterTransientFailure(context, error, reason, nextRetryCount, cancellationQuote);
        }
        await this.restoreRejectedRights(context.refund, { code, message: getRefundErrorMessage(error) });
        return { status: 'failed' };
      }

      if (code !== REFUND_BALANCE_RECONCILIATION_CODE && cancelAttempted && isDefiniteRefundCancelRejection(error)) {
        let current: TossPaymentResponse;
        try {
          current = await this.tossPaymentsClient.queryPayment(command.paymentKey, { secretKeyScope: command.options.secretKeyScope });
        } catch {
          return this.rescheduleAfterTransientFailure(context, error, reason, nextRetryCount, cancellationQuote);
        }
        if (isTossCancelCompleted(current, command.options.cancelRequestId, completionOptions)) {
          await this.finalizeFullPaymentCancellation(context, current, reason);
          return { status: 'completed' };
        }
        if (hasUnchangedCancellationBalance(current, amountSnapshot) && !hasProviderCancelForCommand(current, command)) {
          await this.restoreRejectedRights(context.refund, { code, message: getRefundErrorMessage(error) });
          return { status: 'failed' };
        }
        if (hasProviderCancelForCommand(current, command)) {
          return this.rescheduleAfterTransientFailure(context, error, reason, nextRetryCount, cancellationQuote);
        }
      }

      await this.markFinalFailure(context.refund.id, error);
      return { status: 'failed' };
    }
  }

  /**
   * One handler run per attempt. A duplicated job (lost-job recovery, pg-boss handler retry, a second
   * instance) for an attempt that already ran or is running is ignored, so retries never fork into parallel
   * chains. A crashed attempt becomes claimable again after the lease.
   */
  protected async claimRetryAttempt(refund: RefundRecord, attempt: number): Promise<boolean> {
    if (!Number.isSafeInteger(attempt) || attempt !== refund.retryCount + 1) {
      return false;
    }

    const now = new Date();
    const leaseCutoff = new Date(now.getTime() - REFUND_CANCEL_ATTEMPT_LEASE_MS).toISOString();
    const [claimed] = await this.db
      .update(refunds)
      .set({
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          [REFUND_CANCEL_RETRY_CLAIM_METADATA_KEY]: { attempt, claimedAt: now.toISOString() },
        })}::jsonb`,
      })
      .where(and(
        eq(refunds.id, refund.id),
        eq(refunds.retryCount, refund.retryCount),
        inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES]),
        sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
        sql`(
          coalesce(${refunds.providerMetadata}->'refundCancelRetryClaim'->'attempt', '0'::jsonb) < to_jsonb(${attempt}::int)
          or coalesce(${refunds.providerMetadata}->'refundCancelRetryClaim'->>'claimedAt', '') < ${leaseCutoff}
        )`,
      ))
      .returning({ id: refunds.id });

    return Boolean(claimed);
  }

  protected async finalizeLocalOnlyRefund(
    context: RetryContext,
    reason: string,
    nextRetryCount: number,
    cancellationQuote: CancellationQuote | null,
  ): Promise<RefundCancelRetryJobResult> {
    try {
      await this.finalizeFullPaymentCancellation(context, undefined, reason, { localOnly: true });
      return { status: 'completed' };
    } catch (error) {
      return this.rescheduleAfterTransientFailure(context, error, reason, nextRetryCount, cancellationQuote);
    }
  }

  protected async rescheduleAfterTransientFailure(
    context: RetryContext,
    error: unknown,
    reason: string,
    nextRetryCount: number,
    cancellationQuote: CancellationQuote | null,
  ): Promise<RefundCancelRetryJobResult> {
    await this.recordTransientRetryFailure(
      context.refund.id,
      error,
      reason,
      nextRetryCount,
      cancellationQuote,
    );

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

  protected async restoreRejectedRights(
    refund: RefundRecord,
    failure: { code: string; message: string },
  ): Promise<void> {
    await restoreRejectedRefundRights(this.db, refund, failure);
  }

  protected hasMatchingAbortedCancel(
    response: TossPaymentResponse,
    cancelRequestId: string | undefined,
    receipt: ReturnType<typeof readStoredPaymentCancelReceipt> = {},
  ): boolean {
    if (!cancelRequestId && !receipt.expectedCancelReason) {
      return false;
    }

    return response.cancels?.some((cancel) =>
      cancel.cancelStatus === 'ABORTED'
      && (!cancelRequestId || cancel.cancelRequestId === cancelRequestId)
      && (!receipt.expectedCancelReason || cancel.cancelReason === receipt.expectedCancelReason)
    ) ?? false;
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

  /** An accepted asynchronous cancel is never declared failed; it is polled with the long backoff. */
  protected async keepWaitingForMatchingAsyncCancel(
    context: RetryContext,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancelRequestId: string | undefined,
    cancellationQuote: CancellationQuote | null,
  ): Promise<RefundCancelRetryJobResult> {
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
      },
      retryCount,
      jobId,
      { awaitingProvider: true },
    );

    return { status: jobId ? 'processing' : 'retry_schedule_failed' };
  }

  protected async finalizeFullPaymentCancellation(
    context: RetryContext,
    response: TossPaymentResponse | undefined,
    reason: string,
    options: { localOnly?: boolean } = {},
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
      ...(response ? { providerResponse: response as unknown as Record<string, unknown> } : {}),
      ...(options.localOnly ? { localOnly: true } : {}),
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
      .where(and(eq(refunds.id, refundId), inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES])));
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
      .where(and(eq(refunds.id, refundId), inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES])));
  }

  protected async recordRetryScheduleState(
    refundId: string,
    baseMetadata: Record<string, unknown>,
    retryCount: number,
    jobId: string | null,
    options: RefundCancelRetryScheduleOptions = {},
  ): Promise<void> {
    const now = new Date();
    const schedule = buildRefundCancelRetrySchedule(jobId, retryCount, now, options);
    await this.db
      .update(refunds)
      .set({
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          ...getRefundProviderMetadata(baseMetadata),
          ...schedule.metadata,
        })}::jsonb`,
        customerServiceCtaVisible: schedule.customerServiceCtaVisible,
        updatedAt: now,
      })
      .where(and(eq(refunds.id, refundId), inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES])));
  }

  /** Terminal without restoring rights: provider evidence (balance or expired command) needs a human. */
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
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          manualReviewRequired: true,
          manualReviewReason: getRefundErrorCode(error),
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(refunds.id, refundId), inArray(refunds.status, [...NON_TERMINAL_REFUND_STATUSES])));
  }

  protected async scheduleRetry(refundId: string, retryCount: number): Promise<string | null> {
    return sendRefundCancelRetryJob(this.pgBoss, this.logger, refundId, retryCount);
  }
}
