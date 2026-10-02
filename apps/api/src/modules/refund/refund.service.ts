import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { restoreRejectedRefundRights } from '../cancellation/refund-rights-restoration.js';
import { toRefundTimeline, hasRestoredRefundRights } from '../cancellation/refund-timeline.js';
export { toRefundTimeline } from '../cancellation/refund-timeline.js';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { normalizeSeatIdentity, TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import type {
  CancellationQuote,
  RefundTimeline,
  TicketItemCancellationPolicyCode,
  CancellationExpectation,
} from '@grabit/shared';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  bookingPolicies,
  payments,
  refunds,
  reservationSeats,
  reservations,
  showtimes,
  ticketScanEvents,
  ticketItems,
  tickets,
  ticketBenefitEntitlements,
} from '../../database/schema/index.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type SeatIdentityPayload,
} from '../jobs/pgboss.provider.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  buildFullReservationPaymentCancelRequest,
  canBuildFullReservationPaymentCancelRequest,
  readStoredPaymentCancelRequest,
  readStoredPaymentCancelReceipt,
  withCompletedRefunds,
  describePaymentCancellation,
  describeLocalOnlyCancellation,
  hasProviderCancelForCommand,
  hasUnchangedCancellationBalance,
  isProviderBalanceAboveSnapshot,
} from '../payment/payment-cancel-policy.js';
import { isTossPaymentCancelCompleted } from '../payment/toss-cancel-matcher.js';

type RefundRecord = typeof refunds.$inferSelect;
type ReservationRecord = typeof reservations.$inferSelect;
type PaymentRecord = typeof payments.$inferSelect;
type ReservationSeatRecord = typeof reservationSeats.$inferSelect;
type ShowtimeRecord = typeof showtimes.$inferSelect;
type BookingPolicyRecord = typeof bookingPolicies.$inferSelect;
type TicketItemRecord = typeof ticketItems.$inferSelect;

type RefundStateMachineStatus =
  | 'requested'
  | 'sent_to_pg'
  | 'processing_at_pg'
  | 'completed'
  | 'failed';

type ReservationRefundContext = {
  reservation: ReservationRecord;
  payment: PaymentRecord;
  showtime: ShowtimeRecord;
  bookingPolicy: BookingPolicyRecord | null;
  seats: ReservationSeatRecord[];
  ticketItems: TicketItemRecord[];
};

type FullReservationCancellationQuote = CancellationQuote;

type RefundRequestActor =
  | { kind: 'user' }
  | { kind: 'admin'; operatorUserId: string };

export type AdminRefundRequestOptions = Partial<CancellationExpectation> & {
  fullRefundOverride?: boolean;
  enteredTicketOverride?: boolean;
};

export interface RefundPreviewResponse {
  reservationId: string;
  reservationNumber: string;
  paymentKey: string;
  refundableAmount: number;
  canRequestRefund: boolean;
  cancelledSeatHoldWindowMinutes: {
    min: number;
    max: number;
  };
  refundTimeline: RefundTimeline | null;
  cancellationQuote: FullReservationCancellationQuote | null;
  providerRefund?: { currency: 'KRW' | 'USD'; amountMinor: number; amountDecimal: string } | null;
  blockedReason?: string | null;
}

export interface RefundRequestResponse extends RefundPreviewResponse {
  idempotent: boolean;
  retryEnqueued: boolean;
}

export const REFUND_VISIBLE_STATES: readonly RefundStateMachineStatus[] = [
  'requested',
  'sent_to_pg',
  'processing_at_pg',
  'completed',
  'failed',
] as const;

export const DEFAULT_CANCELLED_SEAT_HOLD_MINUTES = 1;
export const DEFAULT_CANCELLED_SEAT_HOLD_MAX_MINUTES = 10;
/** pg-boss level retries for a crashed handler. Provider retries are scheduled by the worker itself. */
export const REFUND_CANCEL_JOB_RETRY_LIMIT = 3;
/** After this many unresolved provider attempts the refund is surfaced for customer service follow-up. */
export const REFUND_CANCEL_ATTENTION_RETRY_COUNT = 3;
/**
 * Delay before provider attempt N (1-based). Retries continue with a daily cadence until the provider
 * idempotency window closes; ambiguous failures never become terminal after a few minutes.
 */
export const REFUND_CANCEL_RETRY_DELAYS_SECONDS = [
  60, 120, 300, 600, 1800, 3600, 7200, 14400, 28800, 43200, 86400,
] as const;
/** Toss idempotency keys are valid for 15 days. A frozen POST must not be resent after that. */
export const REFUND_CANCEL_POST_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;
/** A claimed attempt that has not finished within this lease (crashed handler) may be claimed again. */
export const REFUND_CANCEL_ATTEMPT_LEASE_MS = 10 * 60 * 1000;
export const SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID = 'JOB_ENQUEUE_FAILED';

export function refundCancelRetryDelaySeconds(attempt: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(attempt) - 1),
    REFUND_CANCEL_RETRY_DELAYS_SECONDS.length - 1,
  );
  return REFUND_CANCEL_RETRY_DELAYS_SECONDS[index]!;
}

/**
 * Provider answers that prove this cancel request was rejected without moving money. Everything else,
 * including 5xx codes, non-JSON gateway pages and unknown codes, is ambiguous and is reconciled by querying
 * the provider and retrying the same frozen command.
 */
const DEFINITE_TOSS_CANCEL_REJECTION_CODES = new Set([
  'INVALID_REQUEST',
  'NOT_CANCELABLE_PAYMENT',
  'NOT_ENOUGH_CANCELABLE_AMOUNT',
  'NOT_CANCELABLE_AMOUNT',
  'INVALID_REFUND_AMOUNT',
  'NOT_MATCHES_REFUNDABLE_AMOUNT',
  'NOT_ALLOWED_PARTIAL_REFUND',
  'NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT',
  'EXCEED_MAX_REFUND_DUE',
  'NOT_SUPPORTED_REFUND',
  'REFUND_REJECTED',
  'FORBIDDEN_REQUEST',
]);

/** Local preflight decisions. They are resolved explicitly, never by the generic retry path. */
export const REFUND_BALANCE_RECONCILIATION_CODE = 'BALANCE_RECONCILIATION_REQUIRED';
export const REFUND_NOT_PARTIAL_CANCELABLE_CODE = 'NOT_PARTIAL_CANCELABLE';
const LOCAL_REFUND_PREFLIGHT_CODES = new Set([
  REFUND_BALANCE_RECONCILIATION_CODE,
  REFUND_NOT_PARTIAL_CANCELABLE_CODE,
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function normalizeReservationSeatIdentity(seatId: string): SeatIdentityPayload {
  const identity = normalizeSeatIdentity({ seatId });
  return {
    floorKey: identity.floorKey,
    seatId: identity.seatId,
    seatKey: identity.seatKey,
  };
}

function isTossPaymentErrorLike(error: unknown): error is { code: string; message: string } {
  if (error instanceof TossPaymentError) return true;
  const candidate = error as { name?: unknown; code?: unknown } | null;
  return Boolean(candidate) && candidate!.name === 'TossPaymentError' && typeof candidate!.code === 'string';
}

/** True only when the provider definitively rejected this cancel request (no money moved for it). */
export function isDefiniteRefundCancelRejection(error: unknown): boolean {
  return isTossPaymentErrorLike(error) && DEFINITE_TOSS_CANCEL_REJECTION_CODES.has(error.code);
}

/**
 * Whether the failure must keep the refund non-terminal and be reconciled later. Unknown and malformed
 * provider answers are ambiguous by design: the frozen command is idempotent, so retrying is safe, while
 * treating them as final would strand revoked QR credentials with no refund.
 */
export function isTransientRefundCancelFailure(error: unknown): boolean {
  if (isTossPaymentErrorLike(error)) {
    return !DEFINITE_TOSS_CANCEL_REJECTION_CODES.has(error.code)
      && !LOCAL_REFUND_PREFLIGHT_CODES.has(error.code);
  }

  return true;
}

export function getRefundErrorCode(error: unknown): string {
  if (isTossPaymentErrorLike(error)) {
    return error.code;
  }

  if (error instanceof SyntaxError) {
    return 'INVALID_PROVIDER_RESPONSE';
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if ([
      'timeout',
      'timed out',
      'network',
      'fetch failed',
      'econnreset',
      'socket hang up',
      'temporar',
      'abort',
    ].some((token) => message.includes(token))) {
      return 'NETWORK_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

export function getRefundErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '알 수 없는 환불 오류';
}

export function isTossCancelCompleted(
  response: TossPaymentResponse,
  cancelRequestId?: string | null,
  options: {
    allowPartialStatus?: boolean;
    expectedCancelAmount?: number;
    expectedCancelReason?: string;
    allowUnidentifiedPartialCancel?: boolean;
    requestedAt?: Date | string | null;
  } = {},
): boolean {
  return isTossPaymentCancelCompleted(response, cancelRequestId, {
    allowPartialStatus: options.allowPartialStatus,
    expectedCancelAmount: options.expectedCancelAmount,
    expectedCancelReason: options.expectedCancelReason,
    allowUnidentifiedPartialCancel: options.allowUnidentifiedPartialCancel,
    requestedAt: options.requestedAt,
  });
}

const REFUND_CANCEL_RETRY_METADATA_KEY = 'refundCancelRetry';

function getRefundProviderMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function getStoredCancellationQuote(
  refund: Pick<RefundRecord, 'providerMetadata'> | null,
): FullReservationCancellationQuote | null {
  if (!refund) {
    return null;
  }

  const metadata = getRefundProviderMetadata(refund.providerMetadata);
  const quote = metadata.cancellationQuote;
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    return null;
  }

  const candidate = quote as Partial<FullReservationCancellationQuote>;
  if (
    typeof candidate.originalPaymentAmount !== 'number'
    || typeof candidate.refundableAmount !== 'number'
    || !Array.isArray(candidate.items)
  ) {
    return null;
  }

  return candidate as FullReservationCancellationQuote;
}

function getRefundCancelRetryJobId(refund: Pick<RefundRecord, 'providerMetadata'>): string | null {
  const metadata = getRefundProviderMetadata(refund.providerMetadata);
  const retryMetadata = metadata[REFUND_CANCEL_RETRY_METADATA_KEY];
  if (
    retryMetadata
    && typeof retryMetadata === 'object'
    && !Array.isArray(retryMetadata)
    && typeof (retryMetadata as { jobId?: unknown }).jobId === 'string'
  ) {
    return (retryMetadata as { jobId: string }).jobId;
  }

  return null;
}

export type RefundCancelRetryScheduleOptions = {
  startAfter?: Date;
  /**
   * The provider accepted this exact cancel and is still processing it (asynchronous cancel). Polling it is
   * the normal path, so repeated polls never raise the customer-service CTA or the manual-review flag; the
   * timeline's own 3-day delay rule still surfaces a slow provider to the buyer.
   */
  awaitingProvider?: boolean;
};

/**
 * Retry bookkeeping shared by the request path, the retry worker and the stale-refund sweep.
 * `nextAttemptAt` lets the sweep detect a lost or never-enqueued job without guessing from update times.
 */
export function buildRefundCancelRetrySchedule(
  jobId: string | null,
  retryCount: number,
  now: Date,
  options: RefundCancelRetryScheduleOptions = {},
): { metadata: Record<string, unknown>; customerServiceCtaVisible: boolean } {
  const attempt = retryCount + 1;
  const nextAttemptAt = options.startAfter
    ?? new Date(now.getTime() + refundCancelRetryDelaySeconds(attempt) * 1000);
  const attentionRequired = !options.awaitingProvider
    && retryCount >= REFUND_CANCEL_ATTENTION_RETRY_COUNT;

  return {
    metadata: {
      [REFUND_CANCEL_RETRY_METADATA_KEY]: {
        status: jobId ? 'scheduled' : 'schedule_failed',
        jobId,
        attempt,
        scheduledAt: jobId ? now.toISOString() : null,
        failedAt: jobId ? null : now.toISOString(),
        nextAttemptAt: nextAttemptAt.toISOString(),
      },
      ...(attentionRequired ? { manualReviewRequired: true } : {}),
      ...(options.awaitingProvider ? { manualReviewRequired: false } : {}),
    },
    customerServiceCtaVisible: !jobId || attentionRequired,
  };
}

export async function sendRefundCancelRetryJob(
  pgBoss: PgBossContract | undefined,
  logger: Pick<Logger, 'warn' | 'error'>,
  refundId: string,
  retryCount: number,
  options: { startAfter?: Date } = {},
): Promise<string | null> {
  if (!pgBoss?.isAvailable) {
    logger.warn(`pg-boss unavailable. refund-cancel-retry job skipped for refundId=${refundId}`);
    return null;
  }

  const attempt = retryCount + 1;
  const startAfter = options.startAfter
    ?? new Date(Date.now() + refundCancelRetryDelaySeconds(attempt) * 1000);

  try {
    return await pgBoss.send(
      PG_BOSS_JOB_NAMES.refundCancelRetry,
      { refundId, attempt },
      {
        startAfter,
        singletonKey: refundId,
        retryLimit: REFUND_CANCEL_JOB_RETRY_LIMIT,
        retryBackoff: true,
        retryDelay: 60,
      },
    );
  } catch (error) {
    logger.error(
      `pg-boss refund-cancel-retry enqueue failed for refundId=${refundId}`,
      error instanceof Error ? error.stack : String(error),
    );
    return null;
  }
}


/** The provider accepted exactly this frozen command and reports it as an asynchronous cancel in progress. */
export function hasMatchingInProgressProviderCancel(
  response: Pick<TossPaymentResponse, 'cancels'>,
  command: { reason: string; options: { cancelRequestId?: string } },
  receipt: { expectedCancelReason?: string; expectedCancelAmount?: number } = {},
): boolean {
  const expectedReason = receipt.expectedCancelReason ?? command.reason;
  return response.cancels?.some((cancel) => cancel.cancelStatus === 'IN_PROGRESS'
    && (!command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId)
    && cancel.cancelReason === expectedReason
    && (receipt.expectedCancelAmount === undefined || cancel.cancelAmount === receipt.expectedCancelAmount)) ?? false;
}

/** Booking day for the Cancellation Fee Schedule: provider approval time, legacy fallback to creation. */
export function resolveBookingConfirmedAt(
  context: { payment: { paidAt?: Date | string | null }; reservation: { createdAt: Date } },
): Date {
  const paidAt = context.payment.paidAt ? new Date(context.payment.paidAt) : null;
  return paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : context.reservation.createdAt;
}

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly paymentCancellationFinalizer: PaymentCancellationFinalizerService,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
  ) {}

  async getRefundPreview(
    reservationId: string,
    userId: string,
  ): Promise<RefundPreviewResponse> {
    const context = await this.preparePreviewContextForQuote(
      await this.loadReservationContext(reservationId, userId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    const preview = this.buildPreview(context, existingRefund);
    if (!preview.canRequestRefund || !preview.cancellationQuote) return preview;
    const providerCheck = await this.checkProviderRefundBalance(context, preview.cancellationQuote, { audience: 'user' });
    return {
      ...preview,
      providerRefund: providerCheck.providerRefund,
      blockedReason: providerCheck.blockedReason,
      canRequestRefund: !providerCheck.blockedReason,
    };
  }

  async requestRefund(
    reservationId: string,
    userId: string,
    reason: string,
    expected?: Partial<CancellationExpectation>,
  ): Promise<RefundRequestResponse> {
    const context = await this.ensureTicketItemsAvailableForQuote(
      await this.loadReservationContext(reservationId, userId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.requestRefundWithContext(context, existingRefund, reason, { kind: 'user' }, expected);
  }

  async requestAdminRefund(
    reservationId: string,
    operatorUserId: string,
    reason: string,
    options: AdminRefundRequestOptions = {},
  ): Promise<RefundRequestResponse> {
    const context = await this.ensureTicketItemsAvailableForQuote(
      await this.loadReservationContextByReservationId(reservationId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.requestRefundWithContext(context, existingRefund, reason, {
      kind: 'admin',
      operatorUserId,
    }, options);
  }

  async getAdminRefundPreview(
    reservationId: string,
    options: AdminRefundRequestOptions = {},
  ): Promise<RefundPreviewResponse> {
    const context = await this.preparePreviewContextForQuote(
      await this.loadReservationContextByReservationId(reservationId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    if (
      context.reservation.status === 'CONFIRMED'
      && (!existingRefund || hasRestoredRefundRights(existingRefund))
    ) {
      const windowBlock = this.resolveCancellationWindowBlock(
        context,
        { kind: 'admin', operatorUserId: 'preview' },
        options,
      );
      if (windowBlock) {
        return {
          reservationId: context.reservation.id,
          reservationNumber: context.reservation.reservationNumber,
          paymentKey: context.payment.paymentKey,
          refundableAmount: 0,
          canRequestRefund: false,
          cancelledSeatHoldWindowMinutes: this.resolveHoldWindowMinutes(context.bookingPolicy),
          refundTimeline: existingRefund ? toRefundTimeline(existingRefund) : null,
          cancellationQuote: null,
          providerRefund: null,
          blockedReason: windowBlock,
        };
      }
    }

    const preview = this.buildPreview(context, existingRefund, options);
    if (!preview.canRequestRefund || !preview.cancellationQuote) return preview;
    const providerCheck = await this.checkProviderRefundBalance(context, preview.cancellationQuote, {
      audience: 'admin',
      tolerateQueryFailure: true,
    });
    return {
      ...preview,
      providerRefund: providerCheck.providerRefund,
      blockedReason: providerCheck.blockedReason,
      canRequestRefund: !providerCheck.blockedReason,
    };
  }

  /**
   * The Cancellation Window binds buyers and default admin cancellation. Only the explicit Administrative
   * Full Refund Override may act after it (show cancellation, company fault, mistaken entry), because the
   * fee schedule defines no show-day rule. Entered Ticket Override alone does not bypass the window.
   */
  protected resolveCancellationWindowBlock(
    context: Pick<ReservationRefundContext, 'reservation' | 'showtime'>,
    actor: RefundRequestActor,
    options: AdminRefundRequestOptions = {},
    now: Date = new Date(),
  ): string | null {
    const windowClosed = new Date(context.reservation.cancelDeadline).getTime() <= now.getTime();
    if (windowClosed && !this.canBypassCancellationWindow(actor, options)) {
      return actor.kind === 'admin'
        ? '취소 마감 이후 관리자 환불은 수수료 없는 전액 환불(override)로만 처리할 수 있습니다'
        : '취소 마감시간이 지났습니다';
    }

    if (actor.kind === 'user' && context.showtime.dateTime.getTime() <= now.getTime()) {
      return '공연 시작 후에는 환불할 수 없습니다';
    }

    return null;
  }

  protected canBypassCancellationWindow(
    actor: RefundRequestActor,
    options: AdminRefundRequestOptions = {},
  ): boolean {
    return actor.kind === 'admin' && options.fullRefundOverride === true;
  }

  protected async requestRefundWithContext(
    context: ReservationRefundContext,
    existingRefund: RefundRecord | null,
    reason: string,
    actor: RefundRequestActor,
    options: AdminRefundRequestOptions = {},
  ): Promise<RefundRequestResponse> {
    if (existingRefund && !hasRestoredRefundRights(existingRefund)) {
      if (actor.kind !== 'admin' || existingRefund.status === 'completed') {
        return this.respondToExistingRefund(context, existingRefund);
      }

      return this.recoverExistingRefundForAdmin(context, existingRefund, actor);
    }

    if (context.reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('환불 가능한 예매 상태가 아닙니다');
    }

    const windowBlock = this.resolveCancellationWindowBlock(context, actor, options);
    if (windowBlock) {
      throw new ForbiddenException(windowBlock);
    }

    let cancellationQuote = this.buildFullReservationCancellationQuote(context, options);
    const localOnly = cancellationQuote.refundableAmount === 0;
    if (!localOnly && !canBuildFullReservationPaymentCancelRequest({
      payment: context.payment,
      cancellationQuote,
      reason,
    })) {
      throw new BadRequestException(
        '이 결제수단은 수수료가 있는 자동 부분취소를 지원하지 않습니다. 고객센터로 문의해주세요.',
      );
    }

    if (!localOnly) {
      await this.assertProviderBalanceBeforeRevocation(context, cancellationQuote, actor);
    }

    const requestedRefund = await this.insertRequestedRefund(
      context,
      reason,
      actor,
      cancellationQuote,
      options,
    );
    if (requestedRefund.status !== 'requested') {
      return this.respondToExistingRefund(context, requestedRefund);
    }
    cancellationQuote = getStoredCancellationQuote(requestedRefund) ?? cancellationQuote;
    const storedReason = getRefundProviderMetadata(requestedRefund.providerMetadata).cancelReason;
    if (typeof storedReason === 'string') reason = storedReason;

    if (cancellationQuote.refundableAmount === 0) {
      return this.finalizeLocalOnlyRefund(context, requestedRefund, cancellationQuote, reason, actor);
    }

    return this.runProviderCancelAttempt(context, requestedRefund, cancellationQuote, reason, actor);
  }

  protected async respondToExistingRefund(
    context: ReservationRefundContext,
    existingRefund: RefundRecord,
  ): Promise<RefundRequestResponse> {
    const refund = await this.ensureRefundCancelRetryScheduled(existingRefund);

    return this.buildRequestResponse(context, refund, {
      idempotent: true,
      retryEnqueued:
        (refund.status === 'requested' || refund.status === 'sent_to_pg' || refund.status === 'processing_at_pg')
        && Boolean(getRefundCancelRetryJobId(refund)),
    });
  }

  /**
   * Sends (or reconciles) the frozen cancel command of one refund attempt. Rights were already revoked by
   * insertRequestedRefund, so every outcome must converge: completed, rights restored with proof that no
   * money moved, retry scheduled for an ambiguous answer, or failed for manual review when the provider
   * balance shows an unknown cancellation.
   */
  protected async runProviderCancelAttempt(
    context: ReservationRefundContext,
    refund: RefundRecord,
    cancellationQuote: FullReservationCancellationQuote,
    reason: string,
    actor: RefundRequestActor,
  ): Promise<RefundRequestResponse> {
    const storedCommand = readStoredPaymentCancelRequest(refund.providerMetadata);
    const command = storedCommand ?? buildFullReservationPaymentCancelRequest({
      payment: withCompletedRefunds(context.payment, context.ticketItems),
      cancellationQuote,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(refund.id),
      cancelRequestIdSeed: refund.id,
    });
    const expectedIdempotencyKey = storedCommand?.options.idempotencyKey;
    const amountSnapshot = getRefundProviderMetadata(refund.providerMetadata).providerRefund;
    const completionOptions = {
      allowPartialStatus: cancellationQuote.refundableAmount < context.payment.amount,
      expectedCancelAmount: command.options.cancelAmount,
      ...readStoredPaymentCancelReceipt(refund.providerMetadata),
      allowUnidentifiedPartialCancel: true,
      requestedAt: refund.requestedAt,
    };

    let providerAccepted = false;
    let cancelAttempted = false;
    let definitePreflightRejection = false;
    try {
      let cancelResult: TossPaymentResponse | undefined;
      if (amountSnapshot) {
        let current: TossPaymentResponse;
        try {
          current = await this.tossPaymentsClient.queryPayment(command.paymentKey, { secretKeyScope: command.options.secretKeyScope });
        } catch {
          throw new TossPaymentError('NETWORK_ERROR', '결제사 환불 잔액을 확인하지 못했습니다');
        }
        const scale = (amountSnapshot as { currency?: unknown }).currency === 'USD' ? 100 : 1;
        const expectedAmountMinor = (amountSnapshot as { amountMinor?: unknown }).amountMinor;
        const completed = current.cancels?.some((cancel) => cancel.cancelStatus === 'DONE'
          && cancel.cancelReason === command.reason && Math.round(cancel.cancelAmount * scale) === expectedAmountMinor);
        if (completed) cancelResult = current;
        else if (!hasUnchangedCancellationBalance(current, amountSnapshot)) {
          if (isProviderBalanceAboveSnapshot(current, amountSnapshot) && !hasProviderCancelForCommand(current, command)) {
            const restored = await restoreRejectedRefundRights(this.db, refund, {
              code: REFUND_BALANCE_RECONCILIATION_CODE,
              message: '결제사 잔액이 예매 환불 기록과 달라 취소를 요청하지 않았습니다',
            });
            return this.buildRequestResponse(context, restored, { idempotent: false, retryEnqueued: false });
          }
          throw new TossPaymentError(REFUND_BALANCE_RECONCILIATION_CODE, '결제사 환불 잔액을 대조해야 합니다');
        } else if (command.options.cancelAmount !== undefined && current.isPartialCancelable !== true) {
          definitePreflightRejection = current.isPartialCancelable === false
            && !hasProviderCancelForCommand(current, command);
          throw new TossPaymentError(REFUND_NOT_PARTIAL_CANCELABLE_CODE, '결제사에서 부분취소를 허용하지 않습니다');
        }
      }
      if (!cancelResult) {
        cancelAttempted = true;
        cancelResult = await this.tossPaymentsClient.cancelPayment(
          command.paymentKey,
          command.reason,
          command.options,
        );
      }
      providerAccepted = true;

      if (isTossCancelCompleted(cancelResult, command.options.cancelRequestId, completionOptions)) {
        return await this.finalizeProviderCancelledRefund(context, refund, cancellationQuote, reason, cancelResult, actor, 'refund_request');
      }

      const processingRefund = await this.markRefundProcessing(
        refund.id,
        cancelResult,
        reason,
        refund.retryCount,
        cancellationQuote,
        expectedIdempotencyKey,
      );
      if (processingRefund.status === 'completed') return this.buildRequestResponse(context, processingRefund, { idempotent: true, retryEnqueued: false });
      const jobId = await this.scheduleRefundCancelRetry(
        processingRefund.id,
        processingRefund.retryCount,
      );
      // A matching asynchronous cancel still in progress is the normal provider path, not an attention case.
      const scheduledRefund = await this.recordRefundCancelRetrySchedule(
        processingRefund,
        jobId,
        {
          awaitingProvider: hasMatchingInProgressProviderCancel(
            cancelResult,
            command,
            readStoredPaymentCancelReceipt(refund.providerMetadata),
          ),
        },
      );

      return this.buildRequestResponse(context, scheduledRefund, {
        idempotent: false,
        retryEnqueued: Boolean(jobId),
      });
    } catch (error) {
      if (providerAccepted || isTransientRefundCancelFailure(error)) {
        return this.keepRefundRetryable(context, refund, error, reason, cancellationQuote, expectedIdempotencyKey);
      }

      const code = getRefundErrorCode(error);
      if (code === REFUND_NOT_PARTIAL_CANCELABLE_CODE) {
        if (!definitePreflightRejection) {
          return this.keepRefundRetryable(context, refund, error, reason, cancellationQuote, expectedIdempotencyKey);
        }
        const restored = await restoreRejectedRefundRights(this.db, refund, { code, message: getRefundErrorMessage(error) });
        return this.buildRequestResponse(context, restored, { idempotent: false, retryEnqueued: false });
      }

      if (code !== REFUND_BALANCE_RECONCILIATION_CODE && cancelAttempted && isDefiniteRefundCancelRejection(error)) {
        let current: TossPaymentResponse;
        try {
          current = await this.tossPaymentsClient.queryPayment(command.paymentKey, { secretKeyScope: command.options.secretKeyScope });
        } catch {
          // The rejection cannot be proven harmless yet. Keep the frozen command and let the worker reconcile.
          return this.keepRefundRetryable(context, refund, error, reason, cancellationQuote, expectedIdempotencyKey);
        }
        if (isTossCancelCompleted(current, command.options.cancelRequestId, completionOptions)) {
          return this.finalizeProviderCancelledRefund(context, refund, cancellationQuote, reason, current, actor, 'refund_request');
        }
        if (hasUnchangedCancellationBalance(current, amountSnapshot) && !hasProviderCancelForCommand(current, command)) {
          const restored = await restoreRejectedRefundRights(this.db, refund, { code, message: getRefundErrorMessage(error) });
          return this.buildRequestResponse(context, restored, { idempotent: false, retryEnqueued: false });
        }
        if (hasProviderCancelForCommand(current, command)) {
          return this.keepRefundRetryable(context, refund, error, reason, cancellationQuote, expectedIdempotencyKey);
        }
      }

      const failedRefund = await this.markRefundFailed(refund.id, error, expectedIdempotencyKey);
      return this.buildRequestResponse(context, failedRefund, {
        idempotent: false,
        retryEnqueued: false,
      });
    }
  }

  protected async keepRefundRetryable(
    context: ReservationRefundContext,
    refund: RefundRecord,
    error: unknown,
    reason: string,
    cancellationQuote: FullReservationCancellationQuote,
    expectedIdempotencyKey: string | undefined,
  ): Promise<RefundRequestResponse> {
    const retryableRefund = await this.markRefundSentToPg(
      refund.id,
      error,
      reason,
      refund.retryCount,
      cancellationQuote,
      expectedIdempotencyKey,
    );
    if (retryableRefund.status !== 'requested' && retryableRefund.status !== 'sent_to_pg' && retryableRefund.status !== 'processing_at_pg') {
      return this.buildRequestResponse(context, retryableRefund, { idempotent: true, retryEnqueued: false });
    }
    const jobId = await this.scheduleRefundCancelRetry(
      retryableRefund.id,
      retryableRefund.retryCount,
    );
    const scheduledRefund = await this.recordRefundCancelRetrySchedule(
      retryableRefund,
      jobId,
    );

    return this.buildRequestResponse(context, scheduledRefund, {
      idempotent: false,
      retryEnqueued: Boolean(jobId),
    });
  }

  protected async finalizeProviderCancelledRefund(
    context: ReservationRefundContext,
    refund: RefundRecord,
    cancellationQuote: FullReservationCancellationQuote,
    reason: string,
    providerResponse: TossPaymentResponse,
    actor: RefundRequestActor,
    source: 'refund_request' | 'refund_retry',
  ): Promise<RefundRequestResponse> {
    await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
      source,
      refundId: refund.id,
      context: this.toFullPaymentCancellationContext(context),
      fullReservationCancellationQuote: cancellationQuote,
      reason,
      providerResponse: providerResponse as unknown as Record<string, unknown>,
      actor,
    });
    const completedRefund = await this.loadRefundById(refund.id);

    return this.buildRequestResponse(context, completedRefund, {
      idempotent: false,
      retryEnqueued: false,
    });
  }

  /**
   * A quote with nothing refundable (for example a 0 KRW tier after the booking day) is cancelled locally:
   * no provider command can carry a zero amount, and the captured payment is retained as policy revenue.
   */
  protected async finalizeLocalOnlyRefund(
    context: ReservationRefundContext,
    refund: RefundRecord,
    cancellationQuote: FullReservationCancellationQuote,
    reason: string,
    actor: RefundRequestActor,
  ): Promise<RefundRequestResponse> {
    try {
      await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
        source: 'refund_request',
        refundId: refund.id,
        context: this.toFullPaymentCancellationContext(context),
        fullReservationCancellationQuote: cancellationQuote,
        reason,
        actor,
        localOnly: true,
      });
    } catch (error) {
      this.logger.error(
        `Local-only refund finalization failed. refundId=${refund.id}. The retry worker will finalize it again.`,
        error instanceof Error ? error.stack : String(error),
      );
      const jobId = await this.scheduleRefundCancelRetry(refund.id, refund.retryCount);
      const scheduledRefund = await this.recordRefundCancelRetrySchedule(refund, jobId);
      return this.buildRequestResponse(context, scheduledRefund, {
        idempotent: false,
        retryEnqueued: Boolean(jobId),
      });
    }

    return this.buildRequestResponse(context, await this.loadRefundById(refund.id), {
      idempotent: false,
      retryEnqueued: false,
    });
  }

  /**
   * Operator recovery for a refund that is stuck after its rights were revoked. Non-terminal refunds are
   * re-scheduled. A failed refund is reconciled against the provider before anything changes: a matching
   * provider cancel is finalized; a provably untouched balance resumes the same frozen command (the stored
   * quote the admin preview showed) inside the provider idempotency window; an unknown provider cancellation
   * stops for manual reconciliation.
   *
   * When the frozen command can no longer be used (aborted by the provider, or past the idempotency window)
   * the rights are restored and the request stops with 409. A new attempt needs a fresh quote computed at
   * that time, so the operator must review the refreshed preview and request it again; this request never
   * sends a re-quoted amount the operator did not see.
   */
  protected async recoverExistingRefundForAdmin(
    context: ReservationRefundContext,
    refund: RefundRecord,
    actor: Extract<RefundRequestActor, { kind: 'admin' }>,
  ): Promise<RefundRequestResponse> {
    if (refund.status !== 'failed') {
      return this.respondToExistingRefund(context, refund);
    }

    const quote = getStoredCancellationQuote(refund);
    const command = readStoredPaymentCancelRequest(refund.providerMetadata);
    const amountSnapshot = getRefundProviderMetadata(refund.providerMetadata).providerRefund;
    if (!quote || !amountSnapshot) {
      throw new ConflictException('이전 환불 요청의 견적과 금액 기록을 확인할 수 없어 수동 대조가 필요합니다');
    }
    const quotedIds = new Set(quote.items.map((item) => item.ticketItemId));
    const quotedItems = context.ticketItems.filter((item) => quotedIds.has(item.id));
    if (quotedItems.length !== quotedIds.size || quotedItems.some((item) => item.status !== 'cancellation_pending')) {
      throw new ConflictException('환불 요청 이후 티켓 상태가 바뀌어 수동 대조가 필요합니다');
    }
    const storedReason = getRefundProviderMetadata(refund.providerMetadata).cancelReason;
    const reason = typeof storedReason === 'string' ? storedReason : (command?.reason ?? 'Admin refund recovery');

    if (quote.refundableAmount === 0) {
      const reopened = await this.reopenFailedRefund(refund, actor, 'requested');
      return this.finalizeLocalOnlyRefund(context, reopened, quote, reason, actor);
    }
    if (!command) {
      throw new ConflictException('이전 환불 요청의 취소 명령을 확인할 수 없어 수동 대조가 필요합니다');
    }

    let current: TossPaymentResponse;
    try {
      current = await this.tossPaymentsClient.queryPayment(command.paymentKey, { secretKeyScope: command.options.secretKeyScope });
    } catch {
      throw new ServiceUnavailableException('결제사 결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요');
    }

    const receipt = readStoredPaymentCancelReceipt(refund.providerMetadata);
    const completionOptions = {
      allowPartialStatus: quote.refundableAmount < context.payment.amount,
      expectedCancelAmount: command.options.cancelAmount,
      ...receipt,
      allowUnidentifiedPartialCancel: true,
      requestedAt: refund.requestedAt,
    };
    if (isTossCancelCompleted(current, command.options.cancelRequestId, completionOptions)) {
      return this.finalizeProviderCancelledRefund(context, refund, quote, reason, current, actor, 'refund_retry');
    }

    if (hasMatchingInProgressProviderCancel(current, command, receipt)) {
      const reopened = await this.reopenFailedRefund(refund, actor, 'processing_at_pg');
      const jobId = await this.scheduleRefundCancelRetry(reopened.id, reopened.retryCount);
      const scheduled = await this.recordRefundCancelRetrySchedule(reopened, jobId, { awaitingProvider: true });
      return this.buildRequestResponse(context, scheduled, { idempotent: false, retryEnqueued: Boolean(jobId) });
    }

    const aborted = current.cancels?.some((cancel) => cancel.cancelStatus === 'ABORTED'
      && (!command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId)
      && cancel.cancelReason === (receipt.expectedCancelReason ?? command.reason)) ?? false;
    if (aborted && hasUnchangedCancellationBalance(current, amountSnapshot)) {
      // The provider aborted this exact command; replaying its idempotency key cannot create a new cancel.
      return this.restoreRightsForReviewedRetry(context, refund, {
        code: 'PROVIDER_CANCEL_ABORTED',
        message: '결제사가 이전 취소 요청을 중단해 티켓 권리를 복원했습니다',
      });
    }

    const untouched = !hasProviderCancelForCommand(current, command);
    if (untouched && hasUnchangedCancellationBalance(current, amountSnapshot)) {
      if (Date.now() - refund.requestedAt.getTime() < REFUND_CANCEL_POST_WINDOW_MS) {
        const reopened = await this.reopenFailedRefund(refund, actor, 'sent_to_pg');
        return this.runProviderCancelAttempt(context, reopened, quote, reason, actor);
      }

      return this.restoreRightsForReviewedRetry(context, refund, {
        code: 'REFUND_RETRY_WINDOW_EXPIRED',
        message: '이전 취소 명령의 결제사 재전송 기한이 지나 티켓 권리를 복원했습니다',
      });
    }

    if (untouched && isProviderBalanceAboveSnapshot(current, amountSnapshot)) {
      const restored = await restoreRejectedRefundRights(this.db, refund, {
        code: REFUND_BALANCE_RECONCILIATION_CODE,
        message: '결제사 잔액이 예매 환불 기록과 달라 취소를 요청하지 않았습니다',
      });
      return this.buildRequestResponse(context, restored, { idempotent: false, retryEnqueued: false });
    }

    throw new ConflictException('결제사 취소 내역이 이 환불 요청과 일치하지 않아 수동 대조가 필요합니다');
  }

  /**
   * Restores the rights of a failed attempt whose frozen command can no longer be sent, then stops. The
   * stored quote may be stale (fee schedule boundaries passed since the request), so the next attempt must
   * be requested again after the operator reviews the refreshed preview.
   */
  protected async restoreRightsForReviewedRetry(
    context: ReservationRefundContext,
    refund: RefundRecord,
    failure: { code: string; message: string },
  ): Promise<RefundRequestResponse> {
    const restored = await restoreRejectedRefundRights(this.db, refund, failure);
    if (!hasRestoredRefundRights(restored)) {
      // The refund changed concurrently (completed or a different attempt); report its current state.
      return this.respondToExistingRefund(context, restored);
    }

    throw new ConflictException(
      `${failure.message}. 환불 금액이 다시 계산되므로 환불 미리보기를 다시 확인한 뒤 환불을 요청해주세요.`,
    );
  }

  /**
   * Re-opens a failed refund for an inline admin attempt. The inline attempt counts as the next attempt
   * (`retryCount + 1`) so a stray job for the previous attempt is rejected as stale, and `nextAttemptAt` is
   * pushed past the attempt lease so the stale-refund sweep of another instance does not run the same
   * refund concurrently. The attempt records its own schedule when it finishes; if the process dies
   * mid-attempt the sweep picks the refund up after the lease.
   */
  protected async reopenFailedRefund(
    refund: RefundRecord,
    actor: Extract<RefundRequestActor, { kind: 'admin' }>,
    status: 'requested' | 'sent_to_pg' | 'processing_at_pg',
  ): Promise<RefundRecord> {
    const now = new Date();
    const idempotencyKey = readStoredPaymentCancelRequest(refund.providerMetadata)?.options.idempotencyKey;
    const [reopened] = await this.db
      .update(refunds)
      .set({
        status,
        failedAt: null,
        resultCode: 'ADMIN_RECOVERY_REQUESTED',
        resultMessage: 'Refund recovery requested by admin',
        failureReason: null,
        customerServiceCtaVisible: false,
        retryCount: sql`${refunds.retryCount} + 1`,
        updatedAt: now,
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify({
          manualReviewRequired: false,
          [REFUND_CANCEL_RETRY_METADATA_KEY]: {
            status: 'admin_recovery',
            jobId: null,
            attempt: refund.retryCount + 1,
            scheduledAt: now.toISOString(),
            failedAt: null,
            nextAttemptAt: new Date(now.getTime() + REFUND_CANCEL_ATTEMPT_LEASE_MS).toISOString(),
          },
          adminRecovery: {
            operatorUserId: actor.operatorUserId,
            requestedAt: now.toISOString(),
            previousResultCode: refund.resultCode,
            previousFailedAt: refund.failedAt?.toISOString() ?? null,
          },
        })}::jsonb`,
      })
      .where(and(
        eq(refunds.id, refund.id),
        eq(refunds.status, 'failed'),
        eq(refunds.retryCount, refund.retryCount),
        sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
        idempotencyKey
          ? sql`${refunds.providerMetadata}->'cancelRequest'->'options'->>'idempotencyKey' = ${idempotencyKey}`
          : undefined,
      ))
      .returning();

    if (!reopened) {
      throw new ConflictException('환불 상태가 변경되었습니다. 환불 내용을 다시 확인해주세요.');
    }

    return reopened;
  }

  /**
   * Refuses before any right is revoked when the provider balance already disagrees with the local ledger
   * (for example a seat cancelled only in Grabit). A failed provider query does not block: the frozen
   * preflight after revocation re-checks and keeps the refund retryable. Partial-cancel support keeps its
   * existing post-revocation handling (rights are restored when the provider refuses partial cancels).
   */
  protected async assertProviderBalanceBeforeRevocation(
    context: ReservationRefundContext,
    cancellationQuote: FullReservationCancellationQuote,
    actor: RefundRequestActor,
  ): Promise<void> {
    const check = await this.checkProviderRefundBalance(context, cancellationQuote, {
      audience: actor.kind,
      tolerateQueryFailure: true,
      balanceOnly: true,
    });
    if (check.blockedReason) {
      throw new ConflictException(check.blockedReason);
    }
  }

  protected async checkProviderRefundBalance(
    context: ReservationRefundContext,
    cancellationQuote: FullReservationCancellationQuote,
    options: {
      audience: 'user' | 'admin';
      tolerateQueryFailure?: boolean;
      /** Block only on a provider balance that is known and differs from the ledger. */
      balanceOnly?: boolean;
    },
  ): Promise<{ providerRefund: ReturnType<typeof describePaymentCancellation> | null; blockedReason: string | null }> {
    const snapshot = withCompletedRefunds(context.payment, context.ticketItems);
    if (cancellationQuote.refundableAmount === 0) {
      return { providerRefund: describeLocalOnlyCancellation(snapshot), blockedReason: null };
    }

    let command: ReturnType<typeof buildFullReservationPaymentCancelRequest>;
    let providerRefund: ReturnType<typeof describePaymentCancellation>;
    try {
      command = buildFullReservationPaymentCancelRequest({ payment: snapshot,
        cancellationQuote, reason: 'Refund preview', cancelRequestIdSeed: context.payment.id });
      providerRefund = describePaymentCancellation(snapshot, command);
    } catch (error) {
      // The request path validates the command itself; a balance check never adds a new failure mode.
      if (!options.tolerateQueryFailure) throw error;
      return { providerRefund: null, blockedReason: null };
    }
    let provider: TossPaymentResponse;
    try {
      provider = await this.tossPaymentsClient.queryPayment(context.payment.paymentKey,
        { secretKeyScope: command.options.secretKeyScope });
    } catch (error) {
      if (!options.tolerateQueryFailure) throw error;
      this.logger.warn(
        `Provider balance check skipped because the payment query failed. reservationId=${context.reservation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { providerRefund, blockedReason: null };
    }

    const scale = providerRefund.currency === 'USD' ? 100 : 1;
    const partialUnsupported = !options.balanceOnly
      && command.options.cancelAmount !== undefined
      && provider.isPartialCancelable !== true;
    const balanceMismatch = Math.round((provider.balanceAmount ?? -1) * scale) !== providerRefund.balanceBeforeMinor
      || Math.round(provider.totalAmount * scale) !== providerRefund.originalAmountMinor;
    let blockedReason: string | null = null;
    if (partialUnsupported) {
      blockedReason = options.audience === 'admin'
        ? '이 결제수단은 자동 부분취소를 지원하지 않습니다. 전액 환불 override 또는 결제사 수동 처리가 필요합니다.'
        : '이 결제수단은 자동 부분취소를 지원하지 않습니다. 고객센터로 문의해주세요.';
    } else if (balanceMismatch && !(options.balanceOnly && typeof provider.balanceAmount !== 'number')) {
      blockedReason = options.audience === 'admin'
        ? '결제사 환불 잔액이 예매 기록과 다릅니다. 결제사 취소 내역을 대조한 뒤 처리해주세요.'
        : '결제사 환불 잔액을 확인해야 합니다. 고객센터로 문의해주세요.';
    }

    return { providerRefund, blockedReason };
  }

  protected buildPreview(
    context: ReservationRefundContext,
    refund: RefundRecord | null,
    options: AdminRefundRequestOptions = {},
    quoteOverride?: FullReservationCancellationQuote | null,
  ): RefundPreviewResponse {
    const holdWindow = this.resolveHoldWindowMinutes(context.bookingPolicy);
    const cancellationQuote = quoteOverride !== undefined
      ? quoteOverride
      : refund && !hasRestoredRefundRights(refund)
        ? getStoredCancellationQuote(refund)
        : this.buildFullReservationCancellationQuote(context, options);

    return {
      reservationId: context.reservation.id,
      reservationNumber: context.reservation.reservationNumber,
      paymentKey: context.payment.paymentKey,
      refundableAmount: cancellationQuote?.refundableAmount ?? context.payment.amount,
      canRequestRefund: context.reservation.status === 'CONFIRMED' && (!refund || hasRestoredRefundRights(refund)),
      cancelledSeatHoldWindowMinutes: holdWindow,
      refundTimeline: refund ? toRefundTimeline(refund) : null,
      cancellationQuote,
      providerRefund: refund ? getRefundProviderMetadata(refund.providerMetadata).providerRefund as RefundPreviewResponse['providerRefund'] : null,
    };
  }

  protected buildRequestResponse(
    context: ReservationRefundContext,
    refund: RefundRecord,
    options: { idempotent: boolean; retryEnqueued: boolean },
  ): RefundRequestResponse {
    let preview: RefundPreviewResponse;
    try {
      preview = this.buildPreview(context, refund);
    } catch (error) {
      // A response for rights restored during this request may be built from a context loaded while the
      // items were still cancellation-pending; report the attempt's stored quote instead of re-quoting.
      if (!hasRestoredRefundRights(refund)) throw error;
      preview = this.buildPreview(context, refund, {}, getStoredCancellationQuote(refund));
    }

    return {
      ...preview,
      idempotent: options.idempotent,
      retryEnqueued: options.retryEnqueued,
    };
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

  protected buildFullReservationCancellationQuote(
    context: ReservationRefundContext,
    options: AdminRefundRequestOptions = {},
  ): FullReservationCancellationQuote {
    if (context.ticketItems.some((ticketItem) => ticketItem.status === 'cancellation_pending')) {
      throw new ConflictException(
        '이미 취소 처리 중인 티켓이 있어 전체 예매 취소 전에 수동 확인이 필요합니다',
      );
    }

    const activeTicketItems = context.ticketItems.filter(
      (ticketItem) => ticketItem.status === 'active',
    );

    if (activeTicketItems.length === 0) {
      throw new BadRequestException('취소 수수료 계산에 필요한 티켓 정보를 찾을 수 없습니다');
    }

    if (
      !options.enteredTicketOverride
      && activeTicketItems.some((ticketItem) => ticketItem.admissionState === 'entered')
    ) {
      throw new ForbiddenException('입장 처리된 티켓은 관리자 강제 취소로만 취소할 수 있습니다');
    }

    const items = activeTicketItems.map((ticketItem) => {
      const serviceFee = this.normalizeTicketItemServiceFee(ticketItem.serviceFee);
      if (options.fullRefundOverride) {
        return {
          ticketItemId: ticketItem.id,
          ticketPrice: ticketItem.price,
          serviceFee,
          cancellationFee: 0,
          serviceFeeRefund: serviceFee,
          refundableAmount: ticketItem.price + serviceFee,
          policyCode: 'ADMIN_FULL_REFUND_OVERRIDE' as const,
        };
      }

      const quote = this.calculateTicketItemCancellationQuote({
        price: ticketItem.price,
        serviceFee,
        bookedAt: resolveBookingConfirmedAt(context),
        showtimeAt: context.showtime.dateTime,
      });

      return {
        ticketItemId: ticketItem.id,
        ticketPrice: ticketItem.price,
        serviceFee,
        cancellationFee: quote.cancellationFee,
        serviceFeeRefund: quote.serviceFeeRefund,
        refundableAmount: quote.refundableAmount,
        policyCode: quote.policyCode,
      };
    });
    const policyCodes = [...new Set(items.map((item) => item.policyCode))];

    return {
      originalPaymentAmount: context.payment.amount,
      ticketSubtotal: items.reduce((total, item) => total + item.ticketPrice, 0),
      ticketServiceFeeTotal: items.reduce((total, item) => total + item.serviceFee, 0),
      cancellationFeeTotal: items.reduce((total, item) => total + item.cancellationFee, 0),
      serviceFeeRefundTotal: items.reduce((total, item) => total + item.serviceFeeRefund, 0),
      refundableAmount: items.reduce((total, item) => total + item.refundableAmount, 0),
      policyCodes,
      items,
    };
  }

  private normalizeTicketItemServiceFee(value: number): 0 | 2000 {
    return value === TICKET_SERVICE_FEE_KRW ? TICKET_SERVICE_FEE_KRW : 0;
  }

  /**
   * `bookedAt` is the booking confirmation time: the provider approval (`payments.paid_at`), falling back to
   * the reservation creation time only for legacy rows without it. A seat selected before midnight but paid
   * after midnight is booked on the payment day.
   */
  protected calculateTicketItemCancellationQuote(input: {
    price: number;
    serviceFee: number;
    bookedAt: Date;
    showtimeAt: Date;
    now?: Date;
  }): {
    cancellationFee: number;
    serviceFeeRefund: number;
    refundableAmount: number;
    policyCode: TicketItemCancellationPolicyCode;
  } {
    const now = input.now ?? new Date();
    const today = this.getSeoulDayOrdinal(now);
    const bookingDay = this.getSeoulDayOrdinal(input.bookedAt);
    const showDay = this.getSeoulDayOrdinal(input.showtimeAt);
    const daysBeforeShow = showDay - today;

    if (daysBeforeShow <= 0) {
      throw new ForbiddenException('관람일 당일에는 취소할 수 없습니다');
    }

    if (today === bookingDay) {
      return {
        cancellationFee: 0,
        serviceFeeRefund: input.serviceFee,
        refundableAmount: input.price + input.serviceFee,
        policyCode: 'SAME_DAY_BEFORE_MIDNIGHT',
      };
    }

    if (daysBeforeShow <= 2) {
      const cancellationFee = Math.floor(input.price * 0.3);
      return {
        cancellationFee,
        serviceFeeRefund: 0,
        refundableAmount: Math.max(0, input.price - cancellationFee),
        policyCode: 'SHOW_DAY_2_TO_1',
      };
    }

    if (daysBeforeShow <= 6) {
      const cancellationFee = Math.floor(input.price * 0.2);
      return {
        cancellationFee,
        serviceFeeRefund: 0,
        refundableAmount: Math.max(0, input.price - cancellationFee),
        policyCode: 'SHOW_DAY_6_TO_3',
      };
    }

    if (daysBeforeShow <= 9) {
      const cancellationFee = Math.floor(input.price * 0.1);
      return {
        cancellationFee,
        serviceFeeRefund: 0,
        refundableAmount: Math.max(0, input.price - cancellationFee),
        policyCode: 'SHOW_DAY_9_TO_7',
      };
    }

    const daysAfterBooking = Math.max(0, today - bookingDay);
    const cancellationFee =
      daysAfterBooking <= 7
        ? 0
        : Math.min(4000, Math.floor(input.price * 0.1));

    return {
      cancellationFee,
      serviceFeeRefund: 0,
      refundableAmount: Math.max(0, input.price - cancellationFee),
      policyCode:
        daysAfterBooking <= 7
          ? 'WITHIN_7_DAYS_AFTER_BOOKING'
          : 'BOOKING_DAY_8_TO_SHOW_DAY_10',
    };
  }

  private getSeoulDayOrdinal(date: Date): number {
    const parts = seoulDateFormatter.formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);

    return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  }

  protected async ensureTicketItemsAvailableForQuote(
    context: ReservationRefundContext,
  ): Promise<ReservationRefundContext> {
    if (
      context.reservation.status !== 'CONFIRMED'
      || context.seats.length === 0
    ) {
      return context;
    }

    const missingSeats = this.findMissingSeatsForQuote(context);
    if (missingSeats.length === 0) {
      return context;
    }

    await this.backfillMissingTicketItems(context, missingSeats);
    const ticketItemsForReservation = await this.loadTicketItemsForReservation(
      context.reservation.id,
    );
    const refreshedContext = {
      ...context,
      ticketItems: ticketItemsForReservation,
    };
    const stillMissingSeats = this.findMissingSeatsForQuote(refreshedContext);

    if (stillMissingSeats.length > 0) {
      throw new BadRequestException('취소 수수료 계산에 필요한 티켓 정보가 모든 좌석을 포함하지 않습니다');
    }

    return refreshedContext;
  }

  protected async preparePreviewContextForQuote(
    context: ReservationRefundContext,
  ): Promise<ReservationRefundContext> {
    if (
      context.reservation.status !== 'CONFIRMED'
      || context.seats.length === 0
    ) {
      return context;
    }

    const missingSeats = this.findMissingSeatsForQuote(context);
    if (missingSeats.length === 0) {
      return context;
    }

    const previewContext = {
      ...context,
      ticketItems: [
        ...context.ticketItems,
        ...await this.buildVirtualTicketItemsForQuote(context, missingSeats),
      ],
    };
    const stillMissingSeats = this.findMissingSeatsForQuote(previewContext);

    if (stillMissingSeats.length > 0) {
      throw new BadRequestException('취소 수수료 계산에 필요한 티켓 정보가 모든 좌석을 포함하지 않습니다');
    }

    return previewContext;
  }

  private findMissingSeatsForQuote(
    context: ReservationRefundContext,
  ): ReservationSeatRecord[] {
    const coveredSeatKeys = new Set(
      context.ticketItems
        .map((ticketItem) => this.normalizeTicketItemSeatKey(ticketItem))
        .filter((seatKey): seatKey is string => Boolean(seatKey)),
    );

    return context.seats.filter((seat) => {
      const identity = normalizeSeatIdentity({ seatId: seat.seatId });
      return !coveredSeatKeys.has(identity.seatKey);
    });
  }

  private normalizeTicketItemSeatKey(ticketItem: TicketItemRecord): string | null {
    if (ticketItem.seatKey) {
      return ticketItem.seatKey;
    }
    if (ticketItem.seatId) {
      return normalizeSeatIdentity({ seatId: ticketItem.seatId }).seatKey;
    }
    return null;
  }

  private async buildVirtualTicketItemsForQuote(
    context: ReservationRefundContext,
    seats: ReservationSeatRecord[],
  ): Promise<TicketItemRecord[]> {
    const now = new Date();
    const seatTotal = context.seats.reduce((total, seat) => total + seat.price, 0);
    const serviceFeePerTicket =
      context.reservation.totalAmount ===
        seatTotal + context.seats.length * TICKET_SERVICE_FEE_KRW
      && context.payment.amount ===
        seatTotal + context.seats.length * TICKET_SERVICE_FEE_KRW
        ? TICKET_SERVICE_FEE_KRW
        : 0;
    const admissionState: 'entered' | 'not_entered' = await this.hasLegacyEntryEvidence(context)
      ? 'entered'
      : 'not_entered';

    return seats.map((seat) => {
      const identity = normalizeSeatIdentity({ seatId: seat.seatId });

      return {
        id: this.buildVirtualTicketItemId(context.reservation.id, identity.seatKey),
        reservationId: context.reservation.id,
        paymentId: context.payment.id,
        showtimeId: context.reservation.showtimeId,
        seatId: identity.seatId,
        seatKey: identity.seatKey,
        floorKey: identity.floorKey,
        floorLabel: identity.floorLabel,
        tierName: seat.tierName,
        row: seat.row,
        number: seat.number,
        price: seat.price,
        serviceFee: serviceFeePerTicket,
        status: 'active' as const,
        admissionState,
        enteredAt: admissionState === 'entered' ? now : null,
        cancelledAt: null,
        cancelReason: null,
        cancellationFee: 0,
        serviceFeeRefund: 0,
        refundableAmount: 0,
        cancellationCommand: null,
        reopenState: 'not_required' as const,
        reopenHoldUntil: null,
        reopenJobId: null,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  private buildVirtualTicketItemId(reservationId: string, seatKey: string): string {
    const hash = createHash('sha256')
      .update(`${reservationId}:${seatKey}`)
      .digest('hex');

    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      `4${hash.slice(13, 16)}`,
      `8${hash.slice(17, 20)}`,
      hash.slice(20, 32),
    ].join('-');
  }

  protected async backfillMissingTicketItems(
    context: ReservationRefundContext,
    seats: ReservationSeatRecord[] = context.seats,
  ): Promise<void> {
    const now = new Date();
    const seatTotal = context.seats.reduce((total, seat) => total + seat.price, 0);
    const serviceFeePerTicket =
      context.reservation.totalAmount ===
        seatTotal + context.seats.length * TICKET_SERVICE_FEE_KRW
      && context.payment.amount ===
        seatTotal + context.seats.length * TICKET_SERVICE_FEE_KRW
        ? TICKET_SERVICE_FEE_KRW
        : 0;
    const admissionState: 'entered' | 'not_entered' = await this.hasLegacyEntryEvidence(context)
      ? 'entered'
      : 'not_entered';

    await this.db
      .insert(ticketItems)
      .values(seats.map((seat) => {
        const identity = normalizeSeatIdentity({ seatId: seat.seatId });

        return {
          reservationId: context.reservation.id,
          paymentId: context.payment.id,
          showtimeId: context.reservation.showtimeId,
          seatId: identity.seatId,
          seatKey: identity.seatKey,
          floorKey: identity.floorKey,
          floorLabel: identity.floorLabel,
          tierName: seat.tierName,
          row: seat.row,
          number: seat.number,
          price: seat.price,
          serviceFee: serviceFeePerTicket,
          status: 'active' as const,
          admissionState,
          enteredAt: admissionState === 'entered' ? now : null,
          createdAt: now,
          updatedAt: now,
        };
      }))
      .onConflictDoNothing({ target: [ticketItems.reservationId, ticketItems.seatKey] });
  }

  protected async hasLegacyEntryEvidence(
    context: ReservationRefundContext,
  ): Promise<boolean> {
    const legacyTickets = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.reservationId, context.reservation.id),
          eq(tickets.paymentId, context.payment.id),
          eq(tickets.showtimeId, context.reservation.showtimeId),
          isNull(tickets.ticketItemId),
          or(eq(tickets.status, 'used'), sql`${tickets.usedAt} IS NOT NULL`),
        ),
      );

    if (legacyTickets.length > 0) {
      return true;
    }

    const scanEvents = await this.db
      .select({ id: ticketScanEvents.id })
      .from(ticketScanEvents)
      .where(
        and(
          eq(ticketScanEvents.reservationId, context.reservation.id),
          eq(ticketScanEvents.showtimeId, context.reservation.showtimeId),
          inArray(ticketScanEvents.result, ['success', 'offline_synced', 'already_used']),
        ),
      );

    return scanEvents.length > 0;
  }

  protected async loadTicketItemsForReservation(
    reservationId: string,
  ): Promise<TicketItemRecord[]> {
    return this.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.reservationId, reservationId));
  }

  protected async loadReservationContext(
    reservationId: string,
    userId: string,
  ): Promise<ReservationRefundContext> {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.userId, userId)));

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다');
    }

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));

    if (!payment) {
      throw new BadRequestException('환불할 결제 정보가 없습니다');
    }

    const [showtime] = await this.db
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차 정보를 찾을 수 없습니다');
    }

    const [bookingPolicy] = await this.db
      .select()
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));
    const reservationTicketItems = await this.loadTicketItemsForReservation(reservation.id);

    return {
      reservation,
      payment,
      showtime,
      bookingPolicy: bookingPolicy ?? null,
      seats,
      ticketItems: reservationTicketItems,
    };
  }

  protected async loadReservationContextByReservationId(
    reservationId: string,
  ): Promise<ReservationRefundContext> {
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId));

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다');
    }

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));

    if (!payment) {
      throw new BadRequestException('환불할 결제 정보가 없습니다');
    }

    const [showtime] = await this.db
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      throw new NotFoundException('회차 정보를 찾을 수 없습니다');
    }

    const [bookingPolicy] = await this.db
      .select()
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const seats = await this.db
      .select()
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));
    const reservationTicketItems = await this.loadTicketItemsForReservation(reservation.id);

    return {
      reservation,
      payment,
      showtime,
      bookingPolicy: bookingPolicy ?? null,
      seats,
      ticketItems: reservationTicketItems,
    };
  }

  protected async findExistingRefund(
    reservationId: string,
  ): Promise<RefundRecord | null> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.reservationId, reservationId));

    return refund ?? null;
  }

  protected async loadRefundById(refundId: string): Promise<RefundRecord> {
    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.id, refundId));

    if (!refund) {
      throw new NotFoundException('환불 상태를 찾을 수 없습니다');
    }

    return refund;
  }

  protected buildRefundCancelIdempotencyKey(refundId: string): string {
    return `refund-cancel:${refundId}`;
  }

  protected toFullPaymentCancellationContext(context: ReservationRefundContext) {
    return {
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
    };
  }

  protected async insertRequestedRefund(
    context: ReservationRefundContext,
    reason: string,
    actor: RefundRequestActor = { kind: 'user' },
    cancellationQuote?: FullReservationCancellationQuote,
    options: AdminRefundRequestOptions = {},
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT r.id FROM reservations r JOIN payments p ON p.reservation_id = r.id
      WHERE r.id = ${context.reservation.id} FOR UPDATE OF r, p`);
    const [existing] = await tx.select().from(refunds).where(eq(refunds.reservationId, context.reservation.id));
    if (existing && !hasRestoredRefundRights(existing)) return existing;
    const [currentReservation] = await tx.select().from(reservations).where(eq(reservations.id, context.reservation.id));
    const currentItems = await tx.select().from(ticketItems).where(eq(ticketItems.reservationId, context.reservation.id)).for('update');
    if (!currentReservation || currentReservation.status !== 'CONFIRMED'
      || (currentReservation.cancelDeadline <= now && !this.canBypassCancellationWindow(actor, options))
      || currentItems.some((item) => item.status === 'cancellation_pending')) {
      throw new ConflictException('예매 상태가 변경되었습니다. 환불 내용을 다시 확인해주세요.');
    }
    const currentQuote = this.buildFullReservationCancellationQuote({ ...context,
      reservation: currentReservation, ticketItems: currentItems }, options);
    const quoteIds = (cancellationQuote?.items ?? []).map((item) => item.ticketItemId).sort().join(',');
    if (cancellationQuote && (quoteIds !== currentQuote.items.map((item) => item.ticketItemId).sort().join(',')
      || cancellationQuote.refundableAmount !== currentQuote.refundableAmount)) {
      throw new ConflictException('환불 견적이 변경되었습니다. 다시 확인해주세요.');
    }
    cancellationQuote = currentQuote;
    const selectedIds = currentQuote.items.map((item) => item.ticketItemId);
    const benefits = await tx.select().from(ticketBenefitEntitlements)
      .where(inArray(ticketBenefitEntitlements.ticketItemId, selectedIds)).for('update');
    if (benefits.some((benefit) => benefit.state === 'redeemed')) throw new ForbiddenException('특전을 수령한 티켓은 취소할 수 없습니다');
    const refundId = existing?.id ?? randomUUID();
    const attemptId = existing ? randomUUID() : refundId;
    const credentialStates = await tx.select({ id: tickets.id, status: tickets.status }).from(tickets)
      .where(and(eq(tickets.reservationId, context.reservation.id), inArray(tickets.status, ['active', 'used']))).for('update');
    const ledgerPayment = withCompletedRefunds(context.payment, currentItems);
    // Nothing refundable means no provider command: a zero amount cannot be sent and the retained balance stays captured.
    const cancelRequest = currentQuote.refundableAmount === 0 ? null : buildFullReservationPaymentCancelRequest({
      payment: ledgerPayment, cancellationQuote: currentQuote,
      reason: `${Array.from(reason).slice(0, 150).join('')} [${attemptId}]`,
      idempotencyKey: existing ? `refund-cancel:${refundId}:${attemptId}` : this.buildRefundCancelIdempotencyKey(refundId), cancelRequestIdSeed: attemptId,
    });
    const providerRefund = cancelRequest
      ? describePaymentCancellation(ledgerPayment, cancelRequest)
      : describeLocalOnlyCancellation(ledgerPayment);
    if ((options.expectedRefundableAmount !== undefined && options.expectedRefundableAmount !== currentQuote.refundableAmount)
      || (options.expectedProviderRefundAmountMinor !== undefined && options.expectedProviderRefundAmountMinor !== providerRefund.amountMinor)) {
      throw new ConflictException('환불 금액이 변경되었습니다. 견적을 다시 확인해주세요.');
    }
    const priorMetadata = getRefundProviderMetadata(existing?.providerMetadata);
    const values: typeof refunds.$inferInsert = {
        id: refundId,
        reservationId: context.reservation.id,
        paymentId: context.payment.id,
        status: 'requested',
        provider: 'toss_payments',
        resultCode: 'REQUESTED',
        resultMessage:
          actor.kind === 'admin' ? 'Refund requested by admin' : 'Refund requested by user',
        providerMetadata: {
          cancelReason: reason,
          reservationNumber: context.reservation.reservationNumber,
          paymentKey: context.payment.paymentKey,
          requestedBy: actor.kind,
          overrideOptions: options,
          ...(cancelRequest ? { cancelRequest } : { localOnlyCancellation: true }),
          providerRefund,
          credentialStates,
          ...(existing ? { previousAttempts: [
            ...(Array.isArray(priorMetadata.previousAttempts) ? priorMetadata.previousAttempts : []),
            { requestedAt: existing.requestedAt.toISOString(), failedAt: existing.failedAt?.toISOString(), resultCode: existing.resultCode,
              cancelRequest: priorMetadata.cancelRequest, cancellationQuote: priorMetadata.cancellationQuote,
              rightsRestoredAt: priorMetadata.rightsRestoredAt },
          ] } : {}),
          ...(cancellationQuote ? { cancellationQuote } : {}),
          ...(actor.kind === 'admin' ? { operatorUserId: actor.operatorUserId } : {}),
        },
        requestedAt: now,
        expectedDepositAt: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        retryCount: 0, sentToPgAt: null, processingAtPgAt: null, completedAt: null, failedAt: null,
        failureReason: null, customerServiceCtaVisible: false,
      };
    const [created] = existing
      ? await tx.update(refunds).set(values).where(eq(refunds.id, existing.id)).returning()
      : await tx.insert(refunds).values(values).onConflictDoNothing({ target: refunds.reservationId }).returning();

    if (created) {
      for (const item of currentQuote.items) {
        await tx.update(ticketItems).set({ status: 'cancellation_pending', cancelledAt: now,
          cancelReason: reason, cancellationFee: item.cancellationFee, serviceFeeRefund: item.serviceFeeRefund,
          refundableAmount: item.refundableAmount, updatedAt: now }).where(eq(ticketItems.id, item.ticketItemId));
      }
      await tx.update(tickets).set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(tickets.reservationId, context.reservation.id), inArray(tickets.status, ['active', 'used'])));
      await tx.update(ticketBenefitEntitlements).set({ state: 'inactive', inactiveReason: 'cancellation_pending', updatedAt: now })
        .where(and(inArray(ticketBenefitEntitlements.ticketItemId, selectedIds), eq(ticketBenefitEntitlements.state, 'active')));
      return created;
    }

    const existingRefund = await this.findExistingRefund(context.reservation.id);
    if (existingRefund) {
      return existingRefund;
    }

    throw new BadRequestException('환불 상태를 초기화하지 못했습니다');
    });
  }

  protected async markRefundSentToPg(
    refundId: string,
    error: unknown,
    reason: string,
    retryCount: number,
    cancellationQuote?: FullReservationCancellationQuote,
    expectedIdempotencyKey?: string,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'sent_to_pg',
      sentToPgAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      retryCount,
      expectedDepositAt: null,
      providerMetadata: {
        cancelReason: reason,
        ...(cancellationQuote ? { cancellationQuote } : {}),
        lastTransientError: getRefundErrorMessage(error),
      },
      updatedAt: now,
    }, expectedIdempotencyKey);
  }

  protected async markRefundProcessing(
    refundId: string,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancellationQuote?: FullReservationCancellationQuote,
    expectedIdempotencyKey?: string,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'processing_at_pg',
      sentToPgAt: now,
      processingAtPgAt: now,
      resultCode: response.status,
      resultMessage: 'PG cancel accepted and is processing',
      retryCount,
      expectedDepositAt: null,
      providerMetadata: {
        cancelReason: reason,
        ...(cancellationQuote ? { cancellationQuote } : {}),
        paymentStatus: response.status,
      },
      updatedAt: now,
    }, expectedIdempotencyKey);
  }

  /** Terminal failure without restoring rights: only when provider evidence needs a human to reconcile it. */
  protected async markRefundFailed(
    refundId: string,
    error: unknown,
    expectedIdempotencyKey?: string,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'failed',
      failedAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      customerServiceCtaVisible: true,
      providerMetadata: {
        manualReviewRequired: true,
        manualReviewReason: getRefundErrorCode(error),
      },
      updatedAt: now,
    }, expectedIdempotencyKey);
  }

  protected async updateRefund(
    refundId: string,
    values: Partial<typeof refunds.$inferInsert>,
    expectedIdempotencyKey?: string,
  ): Promise<RefundRecord> {
    const [updated] = await this.db
      .update(refunds)
      .set({ ...values,
        ...(values.sentToPgAt ? { sentToPgAt: sql`coalesce(${refunds.sentToPgAt}, ${values.sentToPgAt.toISOString()}::timestamptz)` } : {}),
        ...(values.processingAtPgAt ? { processingAtPgAt: sql`coalesce(${refunds.processingAtPgAt}, ${values.processingAtPgAt.toISOString()}::timestamptz)` } : {}),
        ...(values.providerMetadata ? {
        providerMetadata: sql`coalesce(${refunds.providerMetadata}, '{}'::jsonb) || ${JSON.stringify(values.providerMetadata)}::jsonb`,
      } : {}) })
      .where(and(eq(refunds.id, refundId), ne(refunds.status, 'completed'),
        sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
        expectedIdempotencyKey ? sql`${refunds.providerMetadata}->'cancelRequest'->'options'->>'idempotencyKey' = ${expectedIdempotencyKey}` : undefined))
      .returning();

    if (!updated) {
      return this.loadRefundById(refundId);
    }

    return updated;
  }

  protected async ensureRefundCancelRetryScheduled(
    refund: RefundRecord,
  ): Promise<RefundRecord> {
    if (
      (refund.status !== 'requested' && refund.status !== 'sent_to_pg' && refund.status !== 'processing_at_pg')
      || getRefundCancelRetryJobId(refund)
    ) {
      return refund;
    }

    const jobId = await this.scheduleRefundCancelRetry(refund.id, refund.retryCount);
    return this.recordRefundCancelRetrySchedule(refund, jobId);
  }

  protected async recordRefundCancelRetrySchedule(
    refund: RefundRecord,
    jobId: string | null,
    options: RefundCancelRetryScheduleOptions = {},
  ): Promise<RefundRecord> {
    if (refund.status === 'completed' || hasRestoredRefundRights(refund)) return refund;
    const now = new Date();
    const schedule = buildRefundCancelRetrySchedule(jobId, refund.retryCount, now, options);

    return this.updateRefund(refund.id, {
      providerMetadata: schedule.metadata,
      customerServiceCtaVisible: schedule.customerServiceCtaVisible,
      updatedAt: now,
    }, readStoredPaymentCancelRequest(refund.providerMetadata)?.options.idempotencyKey);
  }

  protected async scheduleRefundCancelRetry(
    refundId: string,
    retryCount: number,
  ): Promise<string | null> {
    return sendRefundCancelRetryJob(this.pgBoss, this.logger, refundId, retryCount);
  }
}
