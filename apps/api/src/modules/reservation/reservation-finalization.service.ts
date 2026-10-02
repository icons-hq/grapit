import { getTicketLimitSnapshot, lockTicketLimitScope } from '../../database/ticket-limit.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../../database/included-benefit-entitlements.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  toFloorAwareSeatSelection,
  type ConfirmPaymentRequest,
  type FloorAwareSeatSelection,
  type PaymentMethod,
} from '@grabit/shared';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { isActiveSeatUniqueViolation } from '../../database/seat-ownership.js';
import {
  isConnectionLossDatabaseError,
  isTransientDatabaseError,
} from '../../database/transient-db-error.js';
import {
  payments,
  reservationSeats,
  reservations,
  seatInventories,
  showtimes,
  ticketItems,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import {
  SHOWTIME_STARTED_MESSAGE,
  isShowtimeSalesClosed as isShowtimeSalesClosedAt,
} from '../booking/showtime-sales-cutoff.js';
import {
  BookingService,
  PAYMENT_CONFIRM_LOCK_TTL,
  buildMaxTicketsPerUserExceededMessage,
} from '../booking/booking.service.js';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';
import { PG_BOSS, type PgBossContract } from '../jobs/pgboss.provider.js';
import {
  TossPaymentError,
  TossPaymentsClient,
  isTossConfirmOutcomeUnknown,
  parseTossPaymentResponse,
  type TossPaymentResponse,
} from '../payment/toss-payments.client.js';
import { ProviderChargeQuoteService } from '../payment/provider-charge-quote.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import { buildFullPaymentCancelRequest } from '../payment/payment-cancel-policy.js';
import {
  CONFIRM_APPROVAL_COMPENSATED_DIAGNOSTIC_CODE,
  paymentTerminalFailureDiagnostic,
  recordReservationPaymentFailureDiagnostic,
} from '../payment/payment-failure-diagnostic.js';

type ApprovedPaymentSnapshot = {
  existingPaymentId?: string;
  paymentKey: string;
  orderId: string;
  method: string;
  provider: string;
  currency: string;
  totalAmount: number;
  approvedAt: string;
  asyncStatus?: string | null;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
  providerChargeRate?: string | null;
  providerChargeQuotedAt?: Date | null;
  providerMetadata?: Record<string, unknown> | null;
  /** Set for an approval made by this order's confirm; feeds the reconcile job. */
  reconcileContext?: ConfirmReconcileContext;
};
/** The order and payment a confirm request names. */
type ConfirmPaymentIdentity = { paymentKey: string; orderId: string };
type PaypalConfirmPaymentRequest = Extract<ConfirmPaymentRequest, { provider: 'PAYPAL' }>;
type OverseasCardConfirmPaymentRequest = Extract<ConfirmPaymentRequest, { provider: 'OVERSEAS_CARD' }>;
type OverseasCardAmountConfirmPaymentRequest = Extract<
  ConfirmPaymentRequest,
  { provider: 'OVERSEAS_CARD'; amount: number }
>;
type PaypalResolvedProviderCharge = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: Date;
};

/**
 * How the provider must have approved this order. KRW routes compare won;
 * USD provider-charge routes compare cents against the stored quote.
 */
export type ProviderConfirmRoute = 'DOMESTIC' | 'OVERSEAS_CARD_KRW' | 'OVERSEAS_CARD_USD' | 'PAYPAL';
export interface ProviderApprovalExpectation {
  route: ProviderConfirmRoute;
  currency: 'KRW' | 'USD';
  amountMinor: number;
  secretKeyScope?: 'overseas-card';
}
type ProviderApprovalMismatch = 'identity' | 'status' | 'currency' | 'amount' | 'method';
type FinalizationState =
  | { kind: 'committed'; paymentId: string; paymentKey: string }
  | { kind: 'cancelled' }
  | { kind: 'not_committed' }
  | { kind: 'unknown' };
type ConfirmLeaseState = 'owned' | 'reacquired' | 'lost' | 'unknown';
/**
 * What a provider lookup of the requested paymentKey proves about this order.
 * `not_approved` carries this order's payment when the provider returned it.
 */
type ProviderPaymentLookup =
  | { kind: 'approved'; payment: TossPaymentResponse }
  | { kind: 'not_approved'; payment: TossPaymentResponse | null }
  | { kind: 'unknown' };
/** Deterministic rejections taken before the provider confirm call. */
type PreApprovalGate = 'admission_window' | 'ticket_limit' | 'seat_hold';
/** What the reconcile job needs to look up and compensate an approval. */
interface ConfirmReconcileContext {
  identity: ConfirmPaymentIdentity;
  expectation: ProviderApprovalExpectation;
  providerCharge: PaypalResolvedProviderCharge | null;
}
type ReconcileReservation = {
  id: string;
  status: string;
  totalAmount: number;
  admissionActiveUntilAt: Date | null;
  paymentDeadlineAt: Date | null;
};
type ReconcileRetry = (reason: string, retryAt?: Date) => PaymentConfirmReconcileOutcome;
/** What every reconcile step needs while it holds the order's confirm lease. */
interface ReconcileLockedInput {
  context: ConfirmReconcileContext;
  leaseStillOwned: () => Promise<boolean>;
  now: Date;
  retry: ReconcileRetry;
}
type CompensationResult =
  | { kind: 'compensated' }
  | { kind: 'cancel_pending' }
  | { kind: 'recorded_elsewhere'; state: FinalizationState }
  | { kind: 'lease_lost' };
/** The subset of the Valkey client used for the provider confirm marker. */
interface ProviderConfirmMarkerStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

/**
 * pg-boss job that converges a confirm which ended in an unknown outcome (a
 * 503 after a possible provider approval, or a compensation cancel that
 * failed or is still pending) without depending on a client retry: the
 * confirm admission guard stops accepting retries once the order's window
 * ends, and PayPal DONE webhooks never finalize an order.
 */
export const PAYMENT_CONFIRM_RECONCILE_JOB = 'payment-confirm-reconcile';

export interface PaymentConfirmReconcileJobPayload {
  orderId: string;
  paymentKey: string;
  expectation: ProviderApprovalExpectation;
  providerCharge: {
    currency: 'USD';
    amountMinor: number;
    amountDecimal: string;
    rate: string;
    quotedAt: string;
  } | null;
  reason: string;
  attempt: number;
}

export type PaymentConfirmReconcileOutcome =
  | {
      status: 'resolved';
      resolution:
        | 'missing_reservation'
        | 'recorded'
        | 'compensated'
        | 'not_approved'
        | 'duplicate_cancelled'
        | 'manual_review';
    }
  | { status: 'retry'; reason: string; retryAt: Date };

/** Reconcile attempts (about eight hours with the capped backoff) before manual handling. */
export const PAYMENT_CONFIRM_RECONCILE_MAX_ATTEMPTS = 20;
const RECONCILE_INITIAL_DELAY_MS = 60_000;
const RECONCILE_WINDOW_MARGIN_MS = 30_000;
const RECONCILE_LEASE_BUSY_DELAY_MS = 30_000;
const RECONCILE_BACKOFF_BASE_MS = 60_000;
const RECONCILE_BACKOFF_MAX_MS = 30 * 60_000;
/** Compensation cancel reason once the order can no longer be finalized. */
const ADMISSION_WINDOW_CANCEL_REASON = '결제 유효 시간 초과로 인한 자동 취소';
const DUPLICATE_PAYMENT_CANCEL_REASON = '중복 결제로 인한 자동 취소';
/** Payment row states that mean the order already holds a captured charge. */
const CAPTURED_PAYMENT_STATUSES: ReadonlySet<string> = new Set(['DONE', 'PARTIAL_CANCELED', 'CANCELED']);
function duplicateCancelIdempotencyKey(paymentKey: string): string {
  return `reservation-finalization-duplicate-cancel:${paymentKey}`;
}
/**
 * Every reconcile cancel is preceded, under the order's confirm lease, by a
 * lookup proving the payment is still approved with no cancel in progress,
 * so each call gets its own key: Toss replays the first response of a key,
 * and a stored failure must not block the next attempt.
 */
function reconcileCancelIdempotencyKey(paymentKey: string): string {
  return `payment-confirm-reconcile-cancel:${paymentKey}:${randomUUID()}`;
}
/** An earlier cancel request is still being processed by the provider. */
function hasProviderCancelInProgress(payment: TossPaymentResponse): boolean {
  return payment.cancels?.some((cancel) => cancel.cancelStatus === 'IN_PROGRESS') ?? false;
}

/**
 * Set right before every Toss confirm call and kept for a day. Only an order
 * with this marker (or an unreadable one) can have a merchant-confirmed
 * approval without a local payment row, so pre-approval rejections and the
 * sales cutoff skip the provider lookup otherwise. It is not the Provider
 * Handoff confirm-attempt marker, which is set before the gates run.
 */
const PROVIDER_CONFIRM_MARKER_TTL_SECONDS = 24 * 60 * 60;
function providerConfirmMarkerKey(orderId: string): string {
  return `{payment-provider-confirm}:${orderId}`;
}

export const PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE = '결제 확인이 이미 진행 중입니다.';
export const PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE =
  '결제 승인 결과를 확인하고 있습니다. 잠시 후 예매 내역에서 다시 확인해주세요.';
/** C1 cutoff message; one source with seat lock and prepare (showtime-sales-cutoff.ts). */
export const SHOWTIME_SALES_CLOSED_MESSAGE = SHOWTIME_STARTED_MESSAGE;
const PAYMENT_APPROVAL_MISMATCH_MESSAGE =
  '결제 승인 정보가 주문과 일치하지 않아 결제 자동 취소를 요청했습니다. 다시 시도해주세요.';
const PAYMENT_APPROVAL_NOT_DONE_MESSAGE =
  '결제가 완료 상태가 아니어서 예매를 확정할 수 없습니다. 결제 자동 취소를 요청했습니다.';
const PAYMENT_NOT_APPROVED_MESSAGE = '결제가 승인되지 않았습니다. 좌석을 다시 선택해주세요.';
const PAYMENT_CANCEL_IN_PROGRESS_MESSAGE =
  '결제 취소가 처리 중입니다. 예매 내역에서 상태를 확인해주세요.';
const POST_APPROVAL_FAILURE_MESSAGE =
  '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.';
const PROVIDER_CONFIRM_UNRECORDABLE_MESSAGE =
  '결제 승인을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.';

/** Provider states that mean the payment was approved at some point. */
const PROVIDER_APPROVED_STATUSES = new Set(['DONE', 'WAITING_FOR_DEPOSIT', 'PARTIAL_CANCELED']);
/** Provider states that prove the payment was never approved. */
const PROVIDER_NOT_APPROVED_STATUSES = new Set(['ABORTED', 'EXPIRED']);

/**
 * Toss returns Korean method labels by default and English codes with an
 * English Accept-Language. Virtual accounts and gift certificates are not
 * sold here, and foreign easy pay only belongs to the PayPal route.
 */
const CARD_METHOD_LABELS = new Set(['카드', 'CARD']);
const FOREIGN_EASY_PAY_METHOD_LABELS = new Set(['해외간편결제', 'FOREIGN_EASY_PAY']);
const DOMESTIC_METHOD_LABELS = new Set([
  ...CARD_METHOD_LABELS,
  '계좌이체',
  'TRANSFER',
  '간편결제',
  'EASY_PAY',
  '휴대폰',
  'MOBILE_PHONE',
]);
/** Foreign merchant webhooks label USD charges as MUSD. */
const USD_CURRENCY_LABELS = new Set(['USD', 'MUSD']);

const FINALIZATION_MAX_ATTEMPTS = 3;
const FINALIZATION_RETRY_BASE_DELAY_MS = 150;

const TICKET_SERVICE_FEE_KRW = 2000;
const OVERSEAS_CARD_PROVIDER_METADATA = {
  requestedProvider: 'OVERSEAS_CARD',
  secretKeyScope: 'overseas-card',
} as const;

function isPaypalCheckoutMethod(method: PaymentMethod | null | undefined): boolean {
  return method?.method === 'FOREIGN_EASY_PAY' && method.provider === 'PAYPAL';
}

function isOverseasCardCheckoutMethod(method: PaymentMethod | null | undefined): boolean {
  return method?.method === 'CARD'
    && method.provider === 'CARD'
    && (
      (method.currency !== undefined && method.currency.toUpperCase() !== 'KRW')
      || method.overseasPaymentConsent?.required === true
    );
}

function isAllowedApprovedMethod(
  method: string | null | undefined,
  route: ProviderConfirmRoute,
): boolean {
  const label = method?.trim().toUpperCase();
  if (!label) {
    return false;
  }
  if (route === 'PAYPAL') {
    return FOREIGN_EASY_PAY_METHOD_LABELS.has(label);
  }
  if (route === 'DOMESTIC') {
    return DOMESTIC_METHOD_LABELS.has(label);
  }
  return CARD_METHOD_LABELS.has(label);
}

function toValidDate(value: unknown): Date | null {
  const date = value instanceof Date
    ? value
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * The provider answered that it has no payment under this paymentKey, which
 * proves nothing was approved with it. Any other lookup failure (timeout,
 * network, 5xx, rate limit, malformed body, key configuration) proves nothing.
 */
function isProviderPaymentNotFound(error: unknown): boolean {
  return error instanceof TossPaymentError
    && (error.httpStatus === 404 || error.code === 'NOT_FOUND_PAYMENT' || error.code === 'NOT_FOUND');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPaypalConfirmPaymentRequest(
  dto: ConfirmPaymentRequest,
): dto is PaypalConfirmPaymentRequest {
  return 'provider' in dto && dto.provider === 'PAYPAL';
}

function isOverseasCardConfirmPaymentRequest(
  dto: ConfirmPaymentRequest,
): dto is OverseasCardConfirmPaymentRequest {
  return 'provider' in dto && dto.provider === 'OVERSEAS_CARD';
}

function isOverseasCardAmountConfirmPaymentRequest(
  dto: ConfirmPaymentRequest,
): dto is OverseasCardAmountConfirmPaymentRequest {
  return isOverseasCardConfirmPaymentRequest(dto)
    && 'amount' in dto
    && typeof dto.amount === 'number';
}

function createOverseasCardProviderMetadata(): Record<string, unknown> {
  return { ...OVERSEAS_CARD_PROVIDER_METADATA };
}

function getExistingPaymentProviderMetadata(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export interface ReservationFinalizationResult {
  reservationId: string;
}

@Injectable()
export class ReservationFinalizationService {
  private readonly logger = new Logger(ReservationFinalizationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tossClient: TossPaymentsClient,
    private readonly bookingService: BookingService,
    private readonly bookingGateway: BookingGateway,
    @Optional() private readonly qrTicketService?: QrTicketService,
    @Optional() private readonly providerChargeQuoteService?: ProviderChargeQuoteService,
    @Optional() @Inject(PG_BOSS) private readonly pgBoss?: PgBossContract,
    @Optional() @Inject(REDIS_CLIENT) private readonly providerConfirmMarkers?: ProviderConfirmMarkerStore,
  ) {}

  async confirmAndCreateReservation(
    dto: ConfirmPaymentRequest,
    userId: string,
  ): Promise<ReservationFinalizationResult> {
    const confirmLockToken = randomUUID();
    const confirmLockAcquired = await this.bookingService.acquirePaymentConfirmLock(
      dto.orderId,
      confirmLockToken,
    );

    // Contention is retryable: the other holder converges the same order
    // (show-relaunch runbook: lease contention/loss is a 503 retry).
    if (!confirmLockAcquired) {
      throw new ServiceUnavailableException(PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE);
    }

    const refreshTimer = this.startPaymentConfirmLockRefresh(
      dto.orderId,
      confirmLockToken,
    );

    try {
      const lockStillOwned = await this.bookingService.refreshPaymentConfirmLock(
        dto.orderId,
        confirmLockToken,
      );
      if (!lockStillOwned) {
        throw new ServiceUnavailableException(PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE);
      }
      // Provider Handoff release must never reopen an order once its approval may have
      // been requested, even after this lease ends without a Payment row (ADR 0010).
      await this.bookingService.markPaymentConfirmAttempted(dto.orderId);

      return await this.confirmAndCreateReservationLocked(
        dto,
        userId,
        confirmLockToken,
      );
    } finally {
      clearInterval(refreshTimer);
      try {
        await this.bookingService.releasePaymentConfirmLock(
          dto.orderId,
          confirmLockToken,
        );
      } catch (releaseError) {
        this.logger.error(
          `Payment confirm lock release failed. orderId=${dto.orderId}`,
          releaseError instanceof Error ? releaseError.stack : String(releaseError),
        );
      }
    }
  }

  private startPaymentConfirmLockRefresh(
    orderId: string,
    lockToken: string,
  ): ReturnType<typeof setInterval> {
    const refreshEveryMs = Math.max(
      1000,
      Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2),
    );
    return setInterval(() => {
      void this.bookingService
        .refreshPaymentConfirmLock(orderId, lockToken)
        .catch((refreshError) => {
          this.logger.error(
            `Payment confirm lock refresh failed. orderId=${orderId}`,
            refreshError instanceof Error
              ? refreshError.stack
              : String(refreshError),
          );
        });
    }, refreshEveryMs);
  }

  /**
   * Records that this order is about to be sent to Toss confirm. A failed
   * write stops the confirm before anything is charged (retryable 503).
   */
  private async markProviderConfirmSent(identity: ConfirmPaymentIdentity): Promise<void> {
    if (!this.providerConfirmMarkers) {
      return;
    }
    try {
      await this.providerConfirmMarkers.set(
        providerConfirmMarkerKey(identity.orderId),
        identity.paymentKey,
        'EX',
        PROVIDER_CONFIRM_MARKER_TTL_SECONDS,
      );
    } catch (markerError) {
      this.logger.error(
        `Provider confirm marker write failed; confirm not sent. orderId=${identity.orderId}`,
        markerError instanceof Error ? markerError.stack : String(markerError),
      );
      throw new ServiceUnavailableException(PROVIDER_CONFIRM_UNRECORDABLE_MESSAGE);
    }
  }

  /**
   * False only when the marker store proves that no Toss confirm was ever
   * sent for this order, so no merchant-confirmed approval can exist.
   * Unreadable means maybe.
   */
  private async mayHaveProviderApproval(orderId: string): Promise<boolean> {
    if (!this.providerConfirmMarkers) {
      return true;
    }
    try {
      return await this.providerConfirmMarkers.get(providerConfirmMarkerKey(orderId)) !== null;
    } catch (markerError) {
      this.logger.warn(
        `Provider confirm marker read failed; looking up the provider. orderId=${orderId}`,
        markerError instanceof Error ? markerError.stack : String(markerError),
      );
      return true;
    }
  }

  /**
   * Answers an unknown confirm outcome with a 503 after scheduling the
   * reconcile job, so the order converges even if the client never retries.
   */
  private async throwOutcomeUnknown(input: {
    identity: ConfirmPaymentIdentity;
    /** Absent when a local payment row already records the approval. */
    reconcile?: ConfirmReconcileContext;
    reason: string;
    cause?: unknown;
    message?: string;
    providerStatus?: string;
  }): Promise<never> {
    const { identity, reason, cause } = input;
    this.logger.error(
      `PAYMENT_CONFIRM_OUTCOME_UNKNOWN reason=${reason}. paymentKey=${identity.paymentKey}, orderId=${identity.orderId}${input.providerStatus ? `, providerStatus=${input.providerStatus}` : ''}`,
      cause instanceof Error ? cause.stack : cause === undefined ? undefined : String(cause),
    );
    if (input.reconcile) {
      await this.scheduleConfirmReconcile(input.reconcile, reason);
    }
    throw new ServiceUnavailableException(input.message ?? PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
  }

  /** Best effort: a failed enqueue is logged for the manual reconciliation runbook. */
  private async scheduleConfirmReconcile(
    context: ConfirmReconcileContext,
    reason: string,
    options: { attempt?: number; startAfter?: Date } = {},
  ): Promise<boolean> {
    const { identity } = context;
    if (!this.pgBoss?.isAvailable) {
      this.logger.error(
        `CRITICAL: payment confirm reconcile not scheduled (pg-boss unavailable). reason=${reason}, paymentKey=${identity.paymentKey}, orderId=${identity.orderId}`,
      );
      return false;
    }

    const payload: PaymentConfirmReconcileJobPayload = {
      orderId: identity.orderId,
      paymentKey: identity.paymentKey,
      expectation: context.expectation,
      providerCharge: context.providerCharge
        ? { ...context.providerCharge, quotedAt: context.providerCharge.quotedAt.toISOString() }
        : null,
      reason,
      attempt: options.attempt ?? 0,
    };
    try {
      await this.ensurePaymentConfirmReconcileQueue();
      await this.pgBoss.send(PAYMENT_CONFIRM_RECONCILE_JOB, payload, {
        startAfter: options.startAfter ?? new Date(Date.now() + RECONCILE_INITIAL_DELAY_MS),
        // One queued job per approval; a later enqueue while one waits is a
        // no-op. Jobs of the same order serialize on its confirm lease.
        singletonKey: `${identity.orderId}:${identity.paymentKey}`,
        retryLimit: 2,
        retryDelay: 60,
      });
      return true;
    } catch (enqueueError) {
      this.logger.error(
        `CRITICAL: payment confirm reconcile enqueue failed. reason=${reason}, paymentKey=${identity.paymentKey}, orderId=${identity.orderId}`,
        enqueueError instanceof Error ? enqueueError.stack : String(enqueueError),
      );
      return false;
    }
  }

  private reconcileQueueReady: Promise<void> | null = null;

  /**
   * The queue keeps at most one queued job per approval (`short` policy keyed
   * by orderId and paymentKey). Creating it is idempotent.
   */
  ensurePaymentConfirmReconcileQueue(): Promise<void> {
    if (!this.pgBoss?.isAvailable) {
      return Promise.resolve();
    }
    this.reconcileQueueReady ??= this.pgBoss
      .createQueue(PAYMENT_CONFIRM_RECONCILE_JOB, { policy: 'short' })
      .catch((error: unknown) => {
        this.reconcileQueueReady = null;
        throw error;
      });
    return this.reconcileQueueReady;
  }

  private startOwnedSeatLockRefresh(
    userId: string,
    showtimeId: string,
    seatIds: string[],
  ): ReturnType<typeof setInterval> {
    const refreshEveryMs = Math.max(
      1000,
      Math.floor(PAYMENT_CONFIRM_LOCK_TTL * 1000 / 2),
    );
    return setInterval(() => {
      void this.bookingService
        .extendOwnedSeatLocks(
          userId,
          showtimeId,
          seatIds,
          PAYMENT_CONFIRM_LOCK_TTL,
        )
        .catch((refreshError) => {
          this.logger.error(
            `Seat lock refresh failed during payment confirm. showtimeId=${showtimeId}`,
            refreshError instanceof Error
              ? refreshError.stack
              : String(refreshError),
          );
        });
    }, refreshEveryMs);
  }

  private async cancelApprovedPaymentOrThrow(
    approvedPayment: ApprovedPaymentSnapshot,
    reason: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<boolean> {
    const command = buildFullPaymentCancelRequest({
      payment: {
        id: approvedPayment.existingPaymentId,
        paymentKey: approvedPayment.paymentKey,
        method: approvedPayment.method,
        provider: approvedPayment.provider,
        currency: approvedPayment.currency,
        amount: approvedPayment.totalAmount,
        providerMetadata: approvedPayment.providerMetadata,
        providerChargeCurrency: approvedPayment.providerChargeCurrency,
        providerChargeAmountMinor: approvedPayment.providerChargeAmountMinor,
      },
      reason,
      idempotencyKey: options.idempotencyKey
        ?? `reservation-finalization-cancel:${approvedPayment.orderId}`,
      cancelRequestIdSeed: approvedPayment.existingPaymentId ?? approvedPayment.orderId,
    });

    try {
      const response = await this.tossClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );
      this.logger.log(`Compensation cancel succeeded. paymentKey=${approvedPayment.paymentKey}`);
      return this.isProviderFullCancelCompleted(response);
    } catch (cancelError) {
      this.logger.error(
        `CRITICAL: compensation cancel failed. paymentKey=${approvedPayment.paymentKey}. Manual refund required.`,
        cancelError instanceof Error ? cancelError.stack : String(cancelError),
      );
      throw new InternalServerErrorException(
        '결제는 승인되었으나 자동 취소에 실패했습니다. 고객센터에 문의해주세요.',
      );
    }
  }

  private async cancelExistingDonePaymentAfterFailure(input: {
    payment: ApprovedPaymentSnapshot & { existingPaymentId: string };
    reservationId: string;
    reason: string;
  }): Promise<void> {
    const terminalCancelCompleted = await this.cancelApprovedPaymentOrThrow(
      input.payment,
      input.reason,
    );
    if (!terminalCancelCompleted) {
      return;
    }

    await this.db
      .update(payments)
      .set({
        status: 'CANCELED',
        cancelledAt: new Date(),
        cancelReason: input.reason,
      })
      .where(eq(payments.id, input.payment.existingPaymentId));
    await this.expirePendingReservation(input.reservationId);
  }

  private async cancelApprovedPaymentAfterFailure(
    approvedPayment: ApprovedPaymentSnapshot,
    reservationId: string,
    reason: string,
  ): Promise<void> {
    if (approvedPayment.existingPaymentId) {
      await this.cancelExistingDonePaymentAfterFailure({
        payment: approvedPayment as ApprovedPaymentSnapshot & { existingPaymentId: string },
        reservationId,
        reason,
      });
      return;
    }

    try {
      await this.cancelApprovedPaymentOrThrow(approvedPayment, reason);
    } catch (cancelError) {
      // Nothing local records this approval; the reconcile job retries the
      // compensation instead of leaving it to a manual refund.
      if (approvedPayment.reconcileContext) {
        await this.scheduleConfirmReconcile(
          approvedPayment.reconcileContext,
          'compensation_cancel_failed',
        );
      }
      throw cancelError;
    }
  }

  private async confirmAndCreateReservationLocked(
    dto: ConfirmPaymentRequest,
    userId: string,
    confirmLockToken: string,
  ): Promise<ReservationFinalizationResult> {
    const [existingPayment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tossOrderId, dto.orderId));

    const legacyExistingPayment = existingPayment as
      | { reservationId: string; status?: unknown }
      | undefined;
    if (legacyExistingPayment && !legacyExistingPayment.status) {
      return { reservationId: legacyExistingPayment.reservationId };
    }

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.tossOrderId, dto.orderId),
          eq(reservations.userId, userId),
        ),
      );

    if (!reservation) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
    }

    if (existingPayment?.asyncStatus === 'cancel_pending') {
      throw new ConflictException('결제 취소가 처리 중입니다. 예매 내역에서 상태를 확인해주세요.');
    }

    if (reservation.status !== 'CONFIRMED' && reservation.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    const pendingSeats = await this.getReservationSeatSelections(reservation.id);
    const expectedAmount = this.calculatePayableTotal(pendingSeats);
    let paypalProviderCharge: PaypalResolvedProviderCharge | null = null;
    const isOverseasCardConfirm = isOverseasCardConfirmPaymentRequest(dto);
    let overseasCardProviderCharge: PaypalResolvedProviderCharge | null = null;
    let confirmAmount: number;
    if (isPaypalConfirmPaymentRequest(dto)) {
      paypalProviderCharge = this.resolvePaypalProviderCharge(dto, reservation);
      confirmAmount = Number(paypalProviderCharge.amountDecimal);
    } else if (
      isOverseasCardConfirm
      && 'providerChargeAmount' in dto
      && dto.providerChargeAmount
    ) {
      overseasCardProviderCharge = this.resolveOverseasCardProviderCharge(dto, reservation);
      confirmAmount = Number(overseasCardProviderCharge.amountDecimal);
    } else if (isOverseasCardAmountConfirmPaymentRequest(dto)) {
      confirmAmount = dto.amount;
    } else if (
      isOverseasCardConfirm
      && reservation.status === 'CONFIRMED'
      && existingPayment?.status === 'DONE'
    ) {
      confirmAmount = reservation.totalAmount;
    } else if (isOverseasCardConfirm) {
      throw new BadRequestException('해외카드 결제 금액이 필요합니다');
    } else if (typeof dto.amount === 'number') {
      confirmAmount = dto.amount;
    } else {
      throw new BadRequestException('해외카드 결제 금액이 필요합니다');
    }
    const providerCharge = paypalProviderCharge ?? overseasCardProviderCharge;
    if (
      reservation.totalAmount !== expectedAmount
      || (!providerCharge && confirmAmount !== expectedAmount)
    ) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }

    if (reservation.status === 'CONFIRMED') {
      if (
        isOverseasCardConfirm
        && existingPayment?.status === 'DONE'
        && this.canBackfillOverseasCardProviderMetadata(
          existingPayment,
          reservation,
          dto,
        )
      ) {
        // Metadata repair is a side effect of an already confirmed payment;
        // its failure must not turn the confirmed result into an error.
        try {
          await this.backfillOverseasCardProviderMetadataIfMissing(existingPayment);
        } catch (backfillError) {
          this.logger.warn(
            `Overseas card metadata backfill failed for confirmed payment. orderId=${dto.orderId}`,
            backfillError instanceof Error ? backfillError.stack : String(backfillError),
          );
        }
      }

      return { reservationId: reservation.id };
    }

    const approvalExpectation = this.buildProviderApprovalExpectation({
      isPaypal: paypalProviderCharge !== null,
      isOverseasCard: isOverseasCardConfirm,
      providerCharge,
      confirmAmount,
    });
    // Without a local payment row, a gate below cannot tell whether an earlier
    // attempt was approved and then ended in a 503 before recording anything,
    // so the provider state of this paymentKey decides what the rejection does.
    const rejectBeforeApproval = (
      gate: PreApprovalGate,
      rejection: HttpException,
      cancelReason: string,
    ): Promise<never> => this.rejectBeforeApprovalWithoutLocalPayment({
      dto,
      reservation,
      providerCharge,
      expectation: approvalExpectation,
      gate,
      rejection,
      cancelReason,
      confirmLockToken,
    });

    if (this.isPastWindow(reservation.admissionActiveUntilAt)) {
      const rejection = new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
      const cancelReason = '결제 유효 시간 초과로 인한 자동 취소';
      if (existingPayment?.status === 'DONE') {
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason: cancelReason,
        });
      } else if (!existingPayment) {
        await rejectBeforeApproval('admission_window', rejection, cancelReason);
      }

      throw rejection;
    }

    if (
      existingPayment
      && existingPayment.status
      && existingPayment.status !== 'DONE'
    ) {
      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    if (existingPayment?.status === 'DONE') {
      this.assertExistingDonePaymentCanSatisfyOverseasCardRequest(
        existingPayment,
        reservation,
        dto,
      );
      this.assertExistingDonePaymentMatchesRequest(existingPayment, reservation, dto);
    } else {
      this.assertCheckoutMethodMatchesProviderChargeRequest(dto, reservation);
    }

    const ticketLimit = await getTicketLimitSnapshot(
      this.db, userId,
      reservation.id,
      reservation.showtimeId,
    );
    if (ticketLimit.activeTicketCount + pendingSeats.length > ticketLimit.maxTicketsPerUser) {
      const rejection = new ConflictException(
        buildMaxTicketsPerUserExceededMessage(ticketLimit.maxTicketsPerUser),
      );
      const cancelReason = '예매 매수 제한 초과로 인한 자동 취소';
      if (existingPayment?.status === 'DONE') {
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason: cancelReason,
        });
      } else if (!existingPayment) {
        await rejectBeforeApproval('ticket_limit', rejection, cancelReason);
      }

      throw rejection;
    }

    const pendingSeatIds = pendingSeats.map((seat) => seat.seatKey);
    try {
      await this.bookingService.extendOwnedSeatLocks(
        userId,
        reservation.showtimeId,
        pendingSeatIds,
        PAYMENT_CONFIRM_LOCK_TTL,
      );
    } catch (lockError) {
      const reason = lockError instanceof ConflictException
        && lockError.message.includes('비활성화')
        ? '판매 불가능 좌석으로 인한 자동 취소'
        : '좌석 점유 만료로 인한 자동 취소';
      if (existingPayment?.status === 'DONE') {
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason,
        });
      } else if (!existingPayment && lockError instanceof HttpException) {
        // Only a definitive hold rejection; a Redis outage proves nothing and
        // stays a retryable failure without a provider call.
        await rejectBeforeApproval('seat_hold', lockError, reason);
      }
      throw lockError;
    }

    const seatLockRefreshTimer = this.startOwnedSeatLockRefresh(
      userId,
      reservation.showtimeId,
      pendingSeatIds,
    );
    // Set once Toss approved this order in this request and nothing local
    // records it yet; an unexpected failure from there on schedules the
    // reconcile job instead of stranding the approval.
    let unrecordedApproval: ConfirmReconcileContext | undefined;
    try {
      let approvedPayment: ApprovedPaymentSnapshot;
      if (existingPayment?.status === 'DONE') {
        const hasExistingProviderMetadata =
          existingPayment.providerMetadata !== null
          && existingPayment.providerMetadata !== undefined;
        const existingProviderMetadata = getExistingPaymentProviderMetadata(
          existingPayment.providerMetadata,
        );
        approvedPayment = {
          existingPaymentId: existingPayment.id,
          paymentKey: existingPayment.paymentKey,
          orderId: existingPayment.tossOrderId,
          method: existingPayment.method,
          provider: existingPayment.provider,
          currency: existingPayment.currency,
          totalAmount: existingPayment.amount,
          approvedAt:
            existingPayment.paidAt?.toISOString()
            ?? new Date().toISOString(),
          asyncStatus: existingPayment.asyncStatus,
          providerChargeCurrency: existingPayment.providerChargeCurrency,
          providerChargeAmountMinor: existingPayment.providerChargeAmountMinor,
          providerChargeRate: existingPayment.providerChargeRate,
          providerChargeQuotedAt: existingPayment.providerChargeQuotedAt,
          providerMetadata: existingProviderMetadata
            ?? (!hasExistingProviderMetadata
              && isOverseasCardConfirm
              && this.canBackfillOverseasCardProviderMetadata(
                existingPayment,
                reservation,
                dto,
              )
              ? createOverseasCardProviderMetadata()
              : null),
        };
      } else {
        approvedPayment = await this.approvePaymentWithProvider({
          dto,
          reservation,
          confirmAmount,
          providerCharge,
          expectation: approvalExpectation,
        });
        unrecordedApproval = approvedPayment.reconcileContext;
      }

      // The lease protects this order against a concurrent finalizer (another
      // confirm or the DONE webhook). Losing it never cancels the approved
      // payment: whoever holds it converges the same order, and the client
      // or provider retries on 503.
      const leaseState = await this.verifyConfirmLeaseAfterApproval(
        dto.orderId,
        confirmLockToken,
        approvedPayment.paymentKey,
      );
      if (leaseState !== 'owned') {
        const state = await this.readFinalizationState(reservation.id, dto.orderId);
        if (state.kind === 'committed') {
          await this.cancelApprovalIfCommittedWithAnotherPayment(approvedPayment, state);
          return { reservationId: reservation.id };
        }
        if (state.kind === 'cancelled') {
          throw new ConflictException(PAYMENT_CANCEL_IN_PROGRESS_MESSAGE);
        }
        if (leaseState !== 'reacquired') {
          return await this.throwOutcomeUnknown({
            identity: approvedPayment,
            reconcile: approvedPayment.reconcileContext,
            reason: `confirm_lease_${leaseState}`,
            message: leaseState === 'lost'
              ? PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE
              : PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE,
          });
        }
      }

      try {
        await this.bookingService.assertOwnedSeatLocks(
          userId,
          reservation.showtimeId,
          pendingSeatIds,
        );
      } catch (lockError) {
        if (!(lockError instanceof HttpException)) {
          // Redis/DB unavailability is not proof that the hold was lost.
          return await this.throwOutcomeUnknown({
            identity: approvedPayment,
            reconcile: approvedPayment.reconcileContext,
            reason: 'seat_lock_check_failed',
            cause: lockError,
          });
        }
        this.logger.error(
          `Seat lock ownership lost after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
          lockError.stack,
        );
        await this.cancelApprovedPaymentAfterFailure(
          approvedPayment,
          reservation.id,
          '좌석 점유 만료로 인한 자동 취소',
        );
        throw lockError;
      }

      const committedPaymentId = await this.commitFinalizationWithRetry({
        dto,
        userId,
        reservation,
        pendingSeats,
        performanceId: ticketLimit.performanceId,
        approvedPayment,
      });

      unrecordedApproval = undefined;

      clearInterval(seatLockRefreshTimer);
      await this.runPostCommitSideEffects({
        userId,
        reservationId: reservation.id,
        showtimeId: reservation.showtimeId,
        pendingSeats,
        committedPaymentId,
      });

      return { reservationId: reservation.id };
    } catch (postApprovalError) {
      // Every handled path above answers with an HttpException after
      // recording, compensating or scheduling the approval. Anything else
      // (a bug, an unexpected infrastructure error) may leave it unrecorded.
      if (unrecordedApproval && !(postApprovalError instanceof HttpException)) {
        this.logger.error(
          `Unexpected failure after provider approval; scheduling the confirm reconcile. paymentKey=${unrecordedApproval.identity.paymentKey}, orderId=${dto.orderId}`,
          postApprovalError instanceof Error ? postApprovalError.stack : String(postApprovalError),
        );
        await this.scheduleConfirmReconcile(unrecordedApproval, 'unexpected_post_approval_error');
      }
      throw postApprovalError;
    } finally {
      clearInterval(seatLockRefreshTimer);
    }
  }

  /**
   * Post-commit work is best effort. The payment and tickets are already
   * committed, so these failures are logged and self-heal on the next
   * reservation read (QR issuance) or by TTL (seat locks).
   */
  private async runPostCommitSideEffects(input: {
    userId: string;
    reservationId: string;
    showtimeId: string;
    pendingSeats: FloorAwareSeatSelection[];
    committedPaymentId: string | null;
  }): Promise<void> {
    const seatIds = input.pendingSeats.map((seat) => seat.seatKey);
    try {
      await this.bookingService.consumeOwnedSeatLocks(
        input.userId,
        input.showtimeId,
        seatIds,
        { skipUnavailableCheck: true },
      );
    } catch (cleanupError) {
      this.logger.warn(
        `Post-commit seat lock cleanup failed. reservationId=${input.reservationId}`,
        cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
      );
    }

    try {
      for (const seat of input.pendingSeats) {
        this.bookingGateway.broadcastSeatUpdate(
          input.showtimeId,
          seat.seatKey,
          'sold',
          input.userId,
        );
      }
    } catch (broadcastError) {
      this.logger.warn(
        `Post-commit sold broadcast failed. reservationId=${input.reservationId}`,
        broadcastError instanceof Error ? broadcastError.stack : String(broadcastError),
      );
    }

    if (this.qrTicketService && input.committedPaymentId) {
      try {
        await this.qrTicketService.ensureIssuedTicketsForReservation({
          reservationId: input.reservationId,
          paymentId: input.committedPaymentId,
        });
      } catch (issueError) {
        this.logger.warn(
          `Post-commit QR issuance failed; reservation detail reads will retry. reservationId=${input.reservationId}`,
          issueError instanceof Error ? issueError.stack : String(issueError),
        );
      }
    }
  }

  /**
   * pg-boss entry point: reconciles one order and reschedules itself with
   * backoff until the order converges or the attempts run out. Throws only
   * when the next attempt could not be scheduled, so pg-boss retries this one.
   */
  async runPaymentConfirmReconcileJob(
    payload: PaymentConfirmReconcileJobPayload,
  ): Promise<PaymentConfirmReconcileOutcome> {
    const outcome = await this.reconcileUnresolvedConfirm(payload);
    if (outcome.status === 'resolved') {
      this.logger.log(
        `Payment confirm reconcile resolved. resolution=${outcome.resolution}, attempt=${payload.attempt}, paymentKey=${payload.paymentKey}, orderId=${payload.orderId}`,
      );
      return outcome;
    }

    const nextAttempt = payload.attempt + 1;
    if (nextAttempt >= PAYMENT_CONFIRM_RECONCILE_MAX_ATTEMPTS) {
      this.logger.error(
        `CRITICAL: PAYMENT_CONFIRM_RECONCILE_EXHAUSTED; manual reconciliation required. lastReason=${outcome.reason}, attempts=${nextAttempt}, paymentKey=${payload.paymentKey}, orderId=${payload.orderId}`,
      );
      return outcome;
    }

    const scheduled = await this.scheduleConfirmReconcile(
      this.toReconcileContext(payload),
      payload.reason,
      { attempt: nextAttempt, startAfter: outcome.retryAt },
    );
    if (!scheduled) {
      throw new Error(`Payment confirm reconcile could not be rescheduled. orderId=${payload.orderId}`);
    }
    this.logger.warn(
      `Payment confirm reconcile rescheduled. reason=${outcome.reason}, nextAttempt=${nextAttempt}, retryAt=${outcome.retryAt.toISOString()}, paymentKey=${payload.paymentKey}, orderId=${payload.orderId}`,
    );
    return outcome;
  }

  /**
   * Converges an order whose confirm ended without a known outcome, with no
   * client involved. It never issues tickets: while a client confirm could
   * still finalize the order (its admission window or payment deadline is
   * open) it only waits. After that, under the order's confirm lease (the
   * same lease as confirm and the provider webhooks):
   * - a payment row of this paymentKey means the order is recorded; a claimed
   *   compensation (DONE/cancel_pending) is finished,
   * - a payment row of another paymentKey means this approval can never be
   *   recorded (payments.reservation_id is unique), so it is cancelled,
   * - otherwise the provider decides: an approval is claimed with a
   *   cancel_pending row, cancelled and recorded; a provider-proven
   *   ABORTED/EXPIRED payment is recorded like the terminal webhook; anything
   *   unknown or still in progress is retried with backoff.
   */
  async reconcileUnresolvedConfirm(
    payload: PaymentConfirmReconcileJobPayload,
    now: Date = new Date(),
  ): Promise<PaymentConfirmReconcileOutcome> {
    const context = this.toReconcileContext(payload);
    const { orderId } = context.identity;
    const retry: ReconcileRetry = (reason, retryAt) => ({
      status: 'retry',
      reason,
      retryAt: retryAt ?? new Date(now.getTime() + Math.min(
        RECONCILE_BACKOFF_MAX_MS,
        RECONCILE_BACKOFF_BASE_MS * 2 ** Math.max(0, payload.attempt),
      )),
    });

    let reservation: ReconcileReservation | undefined;
    try {
      [reservation] = await this.db
        .select({
          id: reservations.id,
          status: reservations.status,
          totalAmount: reservations.totalAmount,
          admissionActiveUntilAt: reservations.admissionActiveUntilAt,
          paymentDeadlineAt: reservations.paymentDeadlineAt,
        })
        .from(reservations)
        .where(eq(reservations.tossOrderId, orderId));
    } catch (readError) {
      this.logger.warn(
        `Payment confirm reconcile could not read the order. orderId=${orderId}`,
        readError instanceof Error ? readError.stack : String(readError),
      );
      return retry('reservation_read_failed');
    }
    if (!reservation) {
      return { status: 'resolved', resolution: 'missing_reservation' };
    }

    const leaseToken = randomUUID();
    let leaseAcquired = false;
    try {
      leaseAcquired = await this.bookingService.acquirePaymentConfirmLock(orderId, leaseToken);
    } catch (leaseError) {
      this.logger.warn(
        `Payment confirm reconcile could not take the confirm lease. orderId=${orderId}`,
        leaseError instanceof Error ? leaseError.stack : String(leaseError),
      );
      return retry('confirm_lease_unavailable');
    }
    if (!leaseAcquired) {
      // A confirm or webhook of this order is running; it converges the order
      // or leaves it for the next attempt.
      return retry('confirm_lease_busy', new Date(now.getTime() + RECONCILE_LEASE_BUSY_DELAY_MS));
    }

    const refreshTimer = this.startPaymentConfirmLockRefresh(orderId, leaseToken);
    try {
      return await this.reconcileUnresolvedConfirmLocked({
        context,
        reservation,
        leaseStillOwned: () => this.bookingService.refreshPaymentConfirmLock(orderId, leaseToken),
        now,
        retry,
      });
    } catch (reconcileError) {
      this.logger.error(
        `Payment confirm reconcile attempt failed; retrying. attempt=${payload.attempt}, paymentKey=${payload.paymentKey}, orderId=${orderId}`,
        reconcileError instanceof Error ? reconcileError.stack : String(reconcileError),
      );
      return retry('reconcile_failed');
    } finally {
      clearInterval(refreshTimer);
      try {
        await this.bookingService.releasePaymentConfirmLock(orderId, leaseToken);
      } catch (releaseError) {
        this.logger.error(
          `Payment confirm lock release failed after reconcile. orderId=${orderId}`,
          releaseError instanceof Error ? releaseError.stack : String(releaseError),
        );
      }
    }
  }

  private async reconcileUnresolvedConfirmLocked(input: ReconcileLockedInput & {
    reservation: ReconcileReservation;
  }): Promise<PaymentConfirmReconcileOutcome> {
    const { context, reservation, retry, now } = input;
    const { identity, expectation, providerCharge } = context;

    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tossOrderId, identity.orderId));
    const payment = rows.find((row) => row.reservationId === reservation.id);

    if (payment && payment.paymentKey !== identity.paymentKey) {
      return this.cancelUnrecordableApproval(
        input,
        CAPTURED_PAYMENT_STATUSES.has(payment.status)
          ? DUPLICATE_PAYMENT_CANCEL_REASON
          : ADMISSION_WINDOW_CANCEL_REASON,
      );
    }

    if (payment) {
      const claimedCompensation = payment.status === 'DONE'
        && payment.asyncStatus === 'cancel_pending'
        && reservation.status !== 'CONFIRMED';
      return claimedCompensation
        ? this.resumeClaimedCompensation({ ...input, reservation, payment })
        : { status: 'resolved', resolution: 'recorded' };
    }

    if (reservation.status === 'CONFIRMED') {
      return { status: 'resolved', resolution: 'recorded' };
    }

    if (reservation.status === 'PENDING_PAYMENT') {
      const finalizableUntil = this.resolveClientFinalizableUntil(reservation);
      if (finalizableUntil && finalizableUntil.getTime() > now.getTime()) {
        // A client confirm can still finalize (or, past the window, compensate)
        // this order; act only once no client can.
        return retry(
          'awaiting_client_window',
          new Date(finalizableUntil.getTime() + RECONCILE_WINDOW_MARGIN_MS),
        );
      }
    }

    const lookup = await this.lookupProviderPayment(identity, expectation);
    if (lookup.kind === 'unknown') {
      return retry('provider_lookup_failed');
    }
    if (lookup.kind === 'not_approved') {
      const providerStatus = lookup.payment?.status;
      if (providerStatus === 'IN_PROGRESS' || providerStatus === 'READY') {
        return retry('provider_in_progress');
      }
      await this.recordProviderNotApprovedPaymentIfTerminal(
        { dto: identity, reservation, providerCharge, expectation },
        lookup.payment,
      );
      return { status: 'resolved', resolution: 'not_approved' };
    }
    if (hasProviderCancelInProgress(lookup.payment)) {
      return retry('provider_cancel_in_progress');
    }

    this.logger.error(
      `Unrecorded provider approval found by the confirm reconcile; cancelling it. paymentKey=${identity.paymentKey}, orderId=${identity.orderId}, providerStatus=${lookup.payment.status}`,
    );
    const snapshot = this.toNewApprovedPaymentSnapshot({
      dto: identity,
      reservation,
      expectation,
      providerCharge,
      providerPayment: lookup.payment,
    });
    const result = await this.compensateUnrecordedApproval({
      snapshot,
      reservationId: reservation.id,
      reason: ADMISSION_WINDOW_CANCEL_REASON,
      diagnosticSource: 'payment_confirm_reconcile',
      leaseStillOwned: input.leaseStillOwned,
      idempotencyKey: reconcileCancelIdempotencyKey(identity.paymentKey),
    });

    switch (result.kind) {
      case 'compensated':
        return { status: 'resolved', resolution: 'compensated' };
      case 'cancel_pending':
        return retry('compensation_cancel_pending');
      case 'lease_lost':
        return retry('confirm_lease_lost', new Date(now.getTime() + RECONCILE_LEASE_BUSY_DELAY_MS));
      case 'recorded_elsewhere':
        if (result.state.kind === 'committed') {
          return result.state.paymentKey === identity.paymentKey
            ? { status: 'resolved', resolution: 'recorded' }
            : this.cancelUnrecordableApproval(input, DUPLICATE_PAYMENT_CANCEL_REASON);
        }
        // Another finalizer wrote this order's payment row between the read
        // and the claim; the next attempt classifies it.
        return retry(
          'payment_recorded_concurrently',
          new Date(now.getTime() + RECONCILE_LEASE_BUSY_DELAY_MS),
        );
    }
  }

  /** Finishes a compensation whose claimed row is still DONE/cancel_pending. */
  private async resumeClaimedCompensation(input: ReconcileLockedInput & {
    reservation: ReconcileReservation;
    payment: typeof payments.$inferSelect;
  }): Promise<PaymentConfirmReconcileOutcome> {
    const { context, reservation, payment, retry, now } = input;
    const reason = payment.cancelReason ?? ADMISSION_WINDOW_CANCEL_REASON;
    const lookup = await this.lookupProviderPayment(context.identity, context.expectation);
    if (lookup.kind === 'unknown') {
      return retry('provider_lookup_failed');
    }
    if (lookup.kind === 'not_approved') {
      if (lookup.payment?.status === 'CANCELED') {
        await this.recordCompensatedCancel({
          paymentId: payment.id,
          reservationId: reservation.id,
          orderId: context.identity.orderId,
          reason,
          diagnosticSource: 'payment_confirm_reconcile',
        });
        return { status: 'resolved', resolution: 'compensated' };
      }
      this.logger.error(
        `CRITICAL: claimed compensation row has no approved or cancelled provider payment; manual reconciliation required. providerStatus=${lookup.payment?.status ?? 'not_found'}, paymentKey=${payment.paymentKey}, orderId=${context.identity.orderId}`,
      );
      return { status: 'resolved', resolution: 'manual_review' };
    }
    if (hasProviderCancelInProgress(lookup.payment)) {
      return retry('provider_cancel_in_progress');
    }
    if (!await this.isLeaseStillOwned(input.leaseStillOwned, context.identity)) {
      return retry('confirm_lease_lost', new Date(now.getTime() + RECONCILE_LEASE_BUSY_DELAY_MS));
    }

    const result = await this.cancelClaimedApproval({
      payment: this.toApprovedPaymentSnapshot(payment),
      reservationId: reservation.id,
      reason,
      diagnosticSource: 'payment_confirm_reconcile',
      idempotencyKey: reconcileCancelIdempotencyKey(payment.paymentKey),
    });
    return result.kind === 'compensated'
      ? { status: 'resolved', resolution: 'compensated' }
      : retry('compensation_cancel_pending');
  }

  /**
   * The order's only payment row belongs to another paymentKey, so this
   * approval can never be recorded or issued. It is cancelled at the provider
   * only; the other payment row is never touched.
   */
  private async cancelUnrecordableApproval(
    input: ReconcileLockedInput,
    reason: string,
  ): Promise<PaymentConfirmReconcileOutcome> {
    const { context, retry, now } = input;
    const lookup = await this.lookupProviderPayment(context.identity, context.expectation);
    if (lookup.kind === 'unknown') {
      return retry('provider_lookup_failed');
    }
    if (lookup.kind === 'not_approved') {
      return { status: 'resolved', resolution: 'not_approved' };
    }
    if (hasProviderCancelInProgress(lookup.payment)) {
      return retry('provider_cancel_in_progress');
    }
    if (!await this.isLeaseStillOwned(input.leaseStillOwned, context.identity)) {
      return retry('confirm_lease_lost', new Date(now.getTime() + RECONCILE_LEASE_BUSY_DELAY_MS));
    }

    this.logger.error(
      `CRITICAL: order recorded with another payment; cancelling this approval. paymentKey=${context.identity.paymentKey}, orderId=${context.identity.orderId}`,
    );
    const completed = await this.cancelApprovedPaymentOrThrow(
      this.toNewApprovedPaymentSnapshot({
        dto: context.identity,
        reservation: { totalAmount: 0 },
        expectation: context.expectation,
        providerCharge: context.providerCharge,
        providerPayment: lookup.payment,
      }),
      reason,
      { idempotencyKey: reconcileCancelIdempotencyKey(context.identity.paymentKey) },
    );
    return completed
      ? { status: 'resolved', resolution: 'duplicate_cancelled' }
      : retry('compensation_cancel_pending');
  }

  private async isLeaseStillOwned(
    leaseStillOwned: () => Promise<boolean>,
    identity: ConfirmPaymentIdentity,
  ): Promise<boolean> {
    try {
      return await leaseStillOwned();
    } catch (leaseError) {
      this.logger.error(
        `Payment confirm lease check failed before a compensation cancel. paymentKey=${identity.paymentKey}, orderId=${identity.orderId}`,
        leaseError instanceof Error ? leaseError.stack : String(leaseError),
      );
      return false;
    }
  }

  /**
   * Until when a client confirm could still finalize this order: the later of
   * the admission window (the finalization gate) and the payment deadline
   * plus one confirm seat-lock extension (the seat hold and, with the order
   * binding, the confirm authorization). Waiting longer only delays a refund.
   */
  private resolveClientFinalizableUntil(reservation: {
    admissionActiveUntilAt?: Date | null;
    paymentDeadlineAt?: Date | null;
  }): Date | null {
    const candidates: number[] = [];
    const admissionEnd = toValidDate(reservation.admissionActiveUntilAt);
    if (admissionEnd) {
      candidates.push(admissionEnd.getTime());
    }
    const paymentDeadline = toValidDate(reservation.paymentDeadlineAt);
    if (paymentDeadline) {
      candidates.push(paymentDeadline.getTime() + PAYMENT_CONFIRM_LOCK_TTL * 1000);
    }
    return candidates.length > 0 ? new Date(Math.max(...candidates)) : null;
  }

  private toReconcileContext(payload: PaymentConfirmReconcileJobPayload): ConfirmReconcileContext {
    const charge = payload.providerCharge;
    const quotedAt = charge ? toValidDate(charge.quotedAt) : null;
    return {
      identity: { orderId: payload.orderId, paymentKey: payload.paymentKey },
      expectation: payload.expectation,
      providerCharge: charge && quotedAt ? { ...charge, quotedAt } : null,
    };
  }

  private buildProviderApprovalExpectation(input: {
    isPaypal: boolean;
    isOverseasCard: boolean;
    providerCharge: PaypalResolvedProviderCharge | null;
    confirmAmount: number;
  }): ProviderApprovalExpectation {
    if (input.isPaypal && input.providerCharge) {
      return {
        route: 'PAYPAL',
        currency: 'USD',
        amountMinor: input.providerCharge.amountMinor,
      };
    }
    if (input.isOverseasCard && input.providerCharge) {
      return {
        route: 'OVERSEAS_CARD_USD',
        currency: 'USD',
        amountMinor: input.providerCharge.amountMinor,
        secretKeyScope: 'overseas-card',
      };
    }
    if (input.isOverseasCard) {
      return {
        route: 'OVERSEAS_CARD_KRW',
        currency: 'KRW',
        amountMinor: input.confirmAmount,
        secretKeyScope: 'overseas-card',
      };
    }
    return { route: 'DOMESTIC', currency: 'KRW', amountMinor: input.confirmAmount };
  }

  /**
   * Calls Toss confirm and accepts the result only when the provider approved
   * exactly this order, in the expected currency and amount, with a completed
   * status and an allowed method. A mismatching approval is cancelled at once.
   */
  private async approvePaymentWithProvider(input: {
    dto: ConfirmPaymentRequest;
    reservation: { id: string; showtimeId: string; totalAmount: number };
    confirmAmount: number;
    providerCharge: PaypalResolvedProviderCharge | null;
    expectation: ProviderApprovalExpectation;
  }): Promise<ApprovedPaymentSnapshot> {
    const { dto, expectation } = input;
    const reconcile: ConfirmReconcileContext = {
      identity: dto,
      expectation,
      providerCharge: input.providerCharge,
    };
    let providerPayment: TossPaymentResponse;
    // C1 sales cutoff, checked at the last moment before anything is charged.
    // A payment an earlier attempt already approved is not a new sale: it is
    // looked up and finalized (or compensated) like any approved payment. A
    // failed lookup proves nothing, so it is a retryable 503, not a final 403.
    if (await this.isShowtimeSalesClosed(input.reservation.showtimeId)) {
      if (!await this.mayHaveProviderApproval(dto.orderId)) {
        throw new ForbiddenException(SHOWTIME_SALES_CLOSED_MESSAGE);
      }
      const lookup = await this.lookupProviderPayment(dto, expectation);
      if (lookup.kind === 'unknown') {
        return await this.throwOutcomeUnknown({
          identity: dto,
          reconcile,
          reason: 'closed_showtime_lookup_failed',
        });
      }
      if (lookup.kind === 'not_approved') {
        await this.recordProviderNotApprovedPaymentIfTerminal(input, lookup.payment);
        throw new ForbiddenException(SHOWTIME_SALES_CLOSED_MESSAGE);
      }
      providerPayment = lookup.payment;
    } else {
      await this.markProviderConfirmSent(dto);
      try {
        providerPayment = await this.tossClient.confirmPayment({
          paymentKey: dto.paymentKey,
          orderId: dto.orderId,
          amount: input.confirmAmount,
          ...(expectation.secretKeyScope ? { secretKeyScope: expectation.secretKeyScope } : {}),
        });
      } catch (confirmError) {
        providerPayment = await this.reconcileFailedProviderConfirm({ ...input, confirmError });
      }
    }

    const approvedPayment = this.toNewApprovedPaymentSnapshot({
      dto,
      reservation: input.reservation,
      expectation,
      providerCharge: input.providerCharge,
      providerPayment,
    });
    const mismatch = this.findProviderApprovalMismatch(providerPayment, dto, expectation);
    if (!mismatch) {
      return approvedPayment;
    }

    // Toss validated the paymentKey/orderId pair before approving (and the
    // lookup path only returns this order's payment), so the requested
    // paymentKey is this order's payment and is safe to cancel.
    this.logger.error(
      `CRITICAL: provider approval does not match the order. mismatch=${mismatch}, route=${expectation.route}, orderId=${dto.orderId}, providerStatus=${providerPayment.status}, providerCurrency=${providerPayment.currency ?? 'missing'}, providerAmount=${providerPayment.totalAmount}, providerMethod=${providerPayment.method ?? 'missing'}`,
    );
    await this.cancelApprovedPaymentAfterFailure(
      approvedPayment,
      input.reservation.id,
      mismatch === 'status'
        ? '결제 미완료 상태로 인한 자동 취소'
        : '결제 승인 정보 불일치로 인한 자동 취소',
    );
    if (mismatch === 'status') {
      throw new ConflictException(PAYMENT_APPROVAL_NOT_DONE_MESSAGE);
    }
    throw new BadRequestException(PAYMENT_APPROVAL_MISMATCH_MESSAGE);
  }

  /**
   * A failed confirm call is resolved against the provider's payment state.
   * Only a provider lookup of this order's paymentKey can prove approval or
   * non-approval; anything else keeps the outcome unknown (503, no cancel).
   */
  private async reconcileFailedProviderConfirm(input: {
    dto: ConfirmPaymentRequest;
    reservation: { id: string; totalAmount: number };
    providerCharge: PaypalResolvedProviderCharge | null;
    expectation: ProviderApprovalExpectation;
    confirmError: unknown;
  }): Promise<TossPaymentResponse> {
    const { dto, expectation, confirmError } = input;
    const outcomeUnknown = isTossConfirmOutcomeUnknown(confirmError);
    let queried: TossPaymentResponse | null = null;
    try {
      // A malformed lookup body proves nothing and counts as a failed lookup.
      queried = parseTossPaymentResponse(await this.tossClient.queryPayment(
        dto.paymentKey,
        expectation.secretKeyScope ? { secretKeyScope: expectation.secretKeyScope } : {},
      ));
    } catch (queryError) {
      this.logger.warn(
        `Provider lookup after confirm failure failed. orderId=${dto.orderId}`,
        queryError instanceof Error ? queryError.stack : String(queryError),
      );
    }

    // queryPayment does not check the order binding; never act on another
    // order's payment.
    const belongsToOrder = queried !== null
      && queried.paymentKey === dto.paymentKey
      && queried.orderId === dto.orderId;
    if (queried && belongsToOrder) {
      if (PROVIDER_APPROVED_STATUSES.has(queried.status)) {
        this.logger.warn(
          `Recovered provider approval after confirm failure. orderId=${dto.orderId}, providerStatus=${queried.status}`,
        );
        return queried;
      }
      if (queried.status === 'CANCELED') {
        throw new ConflictException(PAYMENT_CANCEL_IN_PROGRESS_MESSAGE);
      }
      if (PROVIDER_NOT_APPROVED_STATUSES.has(queried.status)) {
        await this.recordProviderNotApprovedPayment({ ...input, providerPayment: queried });
        throw outcomeUnknown
          ? new ConflictException(PAYMENT_NOT_APPROVED_MESSAGE)
          : confirmError;
      }
    }

    if (!outcomeUnknown) {
      throw confirmError;
    }

    return await this.throwOutcomeUnknown({
      identity: dto,
      reconcile: { identity: dto, expectation, providerCharge: input.providerCharge },
      reason: 'provider_confirm_unresolved',
      cause: confirmError,
      providerStatus: queried?.status ?? 'lookup_failed',
    });
  }

  /**
   * Mirrors the terminal PAYMENT_STATUS_CHANGED webhook for a payment the
   * provider reports as never approved, so the checkout does not stay in
   * "checking" until the webhook arrives. Best effort.
   */
  private async recordProviderNotApprovedPayment(input: {
    dto: ConfirmPaymentIdentity;
    reservation: { id: string; totalAmount: number };
    providerCharge: PaypalResolvedProviderCharge | null;
    expectation: ProviderApprovalExpectation;
    providerPayment: TossPaymentResponse;
  }): Promise<void> {
    const status = input.providerPayment.status as 'ABORTED' | 'EXPIRED';
    const snapshot = this.toNewApprovedPaymentSnapshot(input);
    try {
      const paymentId = await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(payments)
          .values({
            reservationId: input.reservation.id,
            paymentKey: input.dto.paymentKey,
            tossOrderId: input.dto.orderId,
            method: snapshot.method,
            provider: snapshot.provider,
            currency: snapshot.currency,
            asyncStatus: 'confirm_rejected',
            amount: input.reservation.totalAmount,
            status,
            paidAt: null,
            ...this.toPaymentProviderChargeValues(snapshot),
            ...this.toPaymentProviderMetadataValues(snapshot),
          })
          .onConflictDoNothing()
          .returning({ id: payments.id });
        if (!inserted) {
          return null;
        }

        await tx
          .update(reservations)
          .set({ status: 'FAILED', updatedAt: new Date() })
          .where(and(
            eq(reservations.id, input.reservation.id),
            eq(reservations.status, 'PENDING_PAYMENT'),
          ));
        return inserted.id;
      });
      if (!paymentId) {
        return;
      }

      await recordReservationPaymentFailureDiagnostic(this.db, {
        reservationId: input.reservation.id,
        paymentId,
        tossOrderId: input.dto.orderId,
        ...paymentTerminalFailureDiagnostic(status),
        diagnosticSource: 'payment_confirm',
      });
    } catch (recordError) {
      this.logger.warn(
        `Recording provider non-approval failed; the provider webhook will converge it. orderId=${input.dto.orderId}`,
        recordError instanceof Error ? recordError.stack : String(recordError),
      );
    }
  }

  private findProviderApprovalMismatch(
    providerPayment: TossPaymentResponse,
    dto: ConfirmPaymentRequest,
    expectation: ProviderApprovalExpectation,
  ): ProviderApprovalMismatch | null {
    if (
      providerPayment.paymentKey !== dto.paymentKey
      || providerPayment.orderId !== dto.orderId
    ) {
      return 'identity';
    }
    if (providerPayment.status !== 'DONE') {
      return 'status';
    }

    const currency = providerPayment.currency?.trim().toUpperCase();
    const currencyMatches = expectation.currency === 'USD'
      ? currency !== undefined && USD_CURRENCY_LABELS.has(currency)
      : currency === 'KRW';
    if (!currencyMatches) {
      return 'currency';
    }

    const totalAmount = providerPayment.totalAmount;
    const amountMatches = typeof totalAmount === 'number'
      && Number.isFinite(totalAmount)
      && (expectation.currency === 'USD'
        ? Math.round(totalAmount * 100) === expectation.amountMinor
        : totalAmount === expectation.amountMinor);
    if (!amountMatches) {
      return 'amount';
    }

    if (!isAllowedApprovedMethod(providerPayment.method, expectation.route)) {
      return 'method';
    }

    return null;
  }

  private toNewApprovedPaymentSnapshot(input: {
    dto: ConfirmPaymentIdentity;
    reservation: { totalAmount: number };
    expectation: ProviderApprovalExpectation;
    providerCharge: PaypalResolvedProviderCharge | null;
    providerPayment: TossPaymentResponse;
  }): ApprovedPaymentSnapshot {
    const isPaypal = input.expectation.route === 'PAYPAL';
    const isOverseasCard = input.expectation.route === 'OVERSEAS_CARD_KRW'
      || input.expectation.route === 'OVERSEAS_CARD_USD';
    const providerCharge = input.providerCharge;

    return {
      paymentKey: input.dto.paymentKey,
      orderId: input.dto.orderId,
      method: input.providerPayment.method || (isPaypal ? 'FOREIGN_EASY_PAY' : 'CARD'),
      provider: isPaypal ? 'PAYPAL' : 'CARD',
      // The KRW reservation total stays the ledger amount; a USD charge is
      // kept as the provider charge snapshot.
      currency: 'KRW',
      totalAmount: input.reservation.totalAmount,
      approvedAt: input.providerPayment.approvedAt ?? new Date().toISOString(),
      asyncStatus: 'sync',
      providerMetadata: isOverseasCard ? createOverseasCardProviderMetadata() : null,
      ...(providerCharge
        ? {
            providerChargeCurrency: providerCharge.currency,
            providerChargeAmountMinor: providerCharge.amountMinor,
            providerChargeRate: providerCharge.rate,
            providerChargeQuotedAt: providerCharge.quotedAt,
          }
        : {}),
      reconcileContext: {
        identity: { paymentKey: input.dto.paymentKey, orderId: input.dto.orderId },
        expectation: input.expectation,
        providerCharge,
      },
    };
  }

  /** C1: a showtime stops selling at its scheduled start (no offset). */
  private async isShowtimeSalesClosed(
    showtimeId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT ${showtimes.dateTime} AS date_time
      FROM ${showtimes}
      WHERE ${showtimes.id} = ${showtimeId}
    `);
    const row = result.rows[0] as { date_time?: unknown } | undefined;
    const startsAt = toValidDate(row?.date_time);
    if (!startsAt) {
      throw new NotFoundException('회차를 찾을 수 없습니다');
    }
    return isShowtimeSalesClosedAt(startsAt, now);
  }

  /**
   * Looks up the requested paymentKey with the order's secret key scope to
   * learn whether an earlier attempt already got this order approved (a
   * confirm whose response or local record was lost).
   */
  private async lookupProviderPayment(
    dto: ConfirmPaymentIdentity,
    expectation: Pick<ProviderApprovalExpectation, 'secretKeyScope'>,
  ): Promise<ProviderPaymentLookup> {
    let response: unknown;
    try {
      response = await this.tossClient.queryPayment(
        dto.paymentKey,
        expectation.secretKeyScope ? { secretKeyScope: expectation.secretKeyScope } : {},
      );
    } catch (queryError) {
      if (isProviderPaymentNotFound(queryError)) {
        return { kind: 'not_approved', payment: null };
      }
      this.logger.warn(
        `Provider payment lookup failed. orderId=${dto.orderId}`,
        queryError instanceof Error ? queryError.stack : String(queryError),
      );
      return { kind: 'unknown' };
    }

    // A body without paymentKey, orderId, status and amount proves nothing.
    const queried = parseTossPaymentResponse(response);
    if (!queried) {
      this.logger.warn(`Provider payment lookup returned a malformed body. orderId=${dto.orderId}`);
      return { kind: 'unknown' };
    }
    // Toss binds a paymentKey to one order: a present key of another order
    // means this order has no payment under it. Never act on another order's
    // payment.
    if (queried.paymentKey !== dto.paymentKey || queried.orderId !== dto.orderId) {
      return { kind: 'not_approved', payment: null };
    }
    return PROVIDER_APPROVED_STATUSES.has(queried.status)
      ? { kind: 'approved', payment: queried }
      : { kind: 'not_approved', payment: queried };
  }

  /**
   * A pre-approval gate rejected an order that has no local payment row. An
   * earlier confirm attempt may have been approved and then ended in a 503
   * before anything was recorded (unknown provider outcome, confirm lease
   * loss, unverifiable seat hold or commit). Rejecting without looking would
   * strand that charge, so the provider state of this paymentKey decides:
   * approved means a recorded compensation cancel and then the original
   * rejection; not approved means the original rejection; a failed lookup is
   * a 503 without cancelling, with the reconcile job scheduled. Orders never
   * sent to Toss confirm (no attempt marker) skip the lookup.
   */
  private async rejectBeforeApprovalWithoutLocalPayment(input: {
    dto: ConfirmPaymentRequest;
    reservation: { id: string; totalAmount: number };
    providerCharge: PaypalResolvedProviderCharge | null;
    expectation: ProviderApprovalExpectation;
    gate: PreApprovalGate;
    rejection: HttpException;
    cancelReason: string;
    confirmLockToken: string;
  }): Promise<never> {
    const { dto } = input;
    if (!await this.mayHaveProviderApproval(dto.orderId)) {
      throw input.rejection;
    }

    const reconcile: ConfirmReconcileContext = {
      identity: dto,
      expectation: input.expectation,
      providerCharge: input.providerCharge,
    };
    const lookup = await this.lookupProviderPayment(dto, input.expectation);
    if (lookup.kind === 'unknown') {
      return await this.throwOutcomeUnknown({
        identity: dto,
        reconcile,
        reason: `pre_approval_${input.gate}_lookup_failed`,
      });
    }
    if (lookup.kind === 'not_approved') {
      await this.recordProviderNotApprovedPaymentIfTerminal(input, lookup.payment);
      throw input.rejection;
    }

    this.logger.error(
      `Earlier provider approval found at a pre-approval rejection; cancelling it. gate=${input.gate}, paymentKey=${dto.paymentKey}, orderId=${dto.orderId}, providerStatus=${lookup.payment.status}`,
    );
    const snapshot = this.toNewApprovedPaymentSnapshot({ ...input, providerPayment: lookup.payment });
    let result: CompensationResult;
    try {
      result = await this.compensateUnrecordedApproval({
        snapshot,
        reservationId: input.reservation.id,
        reason: input.cancelReason,
        diagnosticSource: 'payment_confirm',
        leaseStillOwned: () => this.bookingService.refreshPaymentConfirmLock(
          dto.orderId,
          input.confirmLockToken,
        ),
      });
    } catch (compensationError) {
      if (compensationError instanceof HttpException) {
        // The cancel failed (logged as CRITICAL); the claimed row keeps the
        // order closed and the reconcile job retries the cancel.
        await this.scheduleConfirmReconcile(reconcile, 'compensation_cancel_failed');
        throw compensationError;
      }
      return await this.throwOutcomeUnknown({
        identity: dto,
        reconcile,
        reason: 'compensation_claim_failed',
        cause: compensationError,
      });
    }

    if (result.kind === 'cancel_pending') {
      // The provider accepted the cancel without completing it; the CANCELED
      // webhook or the reconcile job records it.
      await this.scheduleConfirmReconcile(reconcile, 'compensation_cancel_pending');
      throw input.rejection;
    }
    if (result.kind === 'compensated') {
      throw input.rejection;
    }
    if (result.kind === 'lease_lost') {
      return await this.throwOutcomeUnknown({
        identity: dto,
        reconcile,
        reason: 'confirm_lease_lost_before_compensation',
        message: PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE,
      });
    }
    if (result.state.kind === 'cancelled') {
      throw input.rejection;
    }
    if (result.state.kind === 'committed') {
      // Another finalizer committed the order between the gate and the claim.
      await this.cancelApprovalIfCommittedWithAnotherPayment(snapshot, result.state);
      throw new ServiceUnavailableException(PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE);
    }
    return await this.throwOutcomeUnknown({
      identity: dto,
      reconcile,
      reason: 'compensation_claim_unresolved',
    });
  }

  /**
   * Cancels an approval that no local payment row records, after claiming the
   * order with a DONE/cancel_pending payment row. payments.reservation_id and
   * payment_key are unique, so a finalizer still committing this order (for
   * example an earlier attempt whose lease expired in a Valkey failover)
   * either commits first, and nothing is cancelled, or fails on the claim and
   * reads the cancel in progress. The claim also turns a late DONE webhook
   * into a no-op (DONE_CANCEL_PENDING, then STALE_PROGRESS_IGNORED).
   */
  private async compensateUnrecordedApproval(input: {
    snapshot: ApprovedPaymentSnapshot;
    reservationId: string;
    reason: string;
    diagnosticSource: string;
    leaseStillOwned: () => Promise<boolean>;
    idempotencyKey?: string;
  }): Promise<CompensationResult> {
    const { snapshot } = input;
    let owned = false;
    try {
      owned = await input.leaseStillOwned();
    } catch (leaseError) {
      this.logger.error(
        `Payment confirm lease check failed before compensation. paymentKey=${snapshot.paymentKey}, orderId=${snapshot.orderId}`,
        leaseError instanceof Error ? leaseError.stack : String(leaseError),
      );
    }
    if (!owned) {
      return { kind: 'lease_lost' };
    }

    const [claimed] = await this.db
      .insert(payments)
      .values({
        reservationId: input.reservationId,
        paymentKey: snapshot.paymentKey,
        tossOrderId: snapshot.orderId,
        method: snapshot.method,
        provider: snapshot.provider,
        currency: snapshot.currency,
        asyncStatus: 'cancel_pending',
        amount: snapshot.totalAmount,
        status: 'DONE',
        paidAt: toValidDate(snapshot.approvedAt) ?? new Date(),
        cancelReason: input.reason,
        ...this.toPaymentProviderChargeValues(snapshot),
        ...this.toPaymentProviderMetadataValues(snapshot),
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    if (!claimed) {
      return {
        kind: 'recorded_elsewhere',
        state: await this.readFinalizationState(input.reservationId, snapshot.orderId),
      };
    }

    return this.cancelClaimedApproval({
      payment: { ...snapshot, existingPaymentId: claimed.id },
      reservationId: input.reservationId,
      reason: input.reason,
      diagnosticSource: input.diagnosticSource,
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Throws (500) when the cancel fails; the claimed row stays cancel_pending. */
  private async cancelClaimedApproval(input: {
    payment: ApprovedPaymentSnapshot & { existingPaymentId: string };
    reservationId: string;
    reason: string;
    diagnosticSource: string;
    idempotencyKey?: string;
  }): Promise<CompensationResult> {
    const completed = await this.cancelApprovedPaymentOrThrow(
      input.payment,
      input.reason,
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {},
    );
    if (!completed) {
      // The CANCELED webhook completes the claimed row like any unissued
      // compensation (payment CANCELED, reservation FAILED).
      return { kind: 'cancel_pending' };
    }

    await this.recordCompensatedCancel({
      paymentId: input.payment.existingPaymentId,
      reservationId: input.reservationId,
      orderId: input.payment.orderId,
      reason: input.reason,
      diagnosticSource: input.diagnosticSource,
    });
    return { kind: 'compensated' };
  }

  /**
   * Best effort after a completed provider cancel: the CANCELED webhook or
   * the reconcile job converges a claimed row whose record failed.
   */
  private async recordCompensatedCancel(input: {
    paymentId: string;
    reservationId: string;
    orderId: string;
    reason: string;
    diagnosticSource: string;
  }): Promise<void> {
    try {
      const cancelledAt = new Date();
      await this.db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: 'CANCELED',
            asyncStatus: 'compensation_cancelled',
            cancelledAt,
            cancelReason: input.reason,
          })
          .where(and(
            eq(payments.id, input.paymentId),
            eq(payments.asyncStatus, 'cancel_pending'),
          ));
        await tx
          .update(reservations)
          .set({ status: 'FAILED', updatedAt: cancelledAt })
          .where(and(
            eq(reservations.id, input.reservationId),
            eq(reservations.status, 'PENDING_PAYMENT'),
          ));
      });
      await recordReservationPaymentFailureDiagnostic(this.db, {
        reservationId: input.reservationId,
        paymentId: input.paymentId,
        tossOrderId: input.orderId,
        diagnosticKind: 'payment_compensated_cancel',
        diagnosticCode: CONFIRM_APPROVAL_COMPENSATED_DIAGNOSTIC_CODE,
        diagnosticMessage: input.reason,
        diagnosticSource: input.diagnosticSource,
      });
    } catch (recordError) {
      this.logger.warn(
        `Recording a completed compensation cancel failed; the CANCELED webhook converges it. orderId=${input.orderId}`,
        recordError instanceof Error ? recordError.stack : String(recordError),
      );
    }
  }

  private async recordProviderNotApprovedPaymentIfTerminal(
    input: {
      dto: ConfirmPaymentIdentity;
      reservation: { id: string; totalAmount: number };
      providerCharge: PaypalResolvedProviderCharge | null;
      expectation: ProviderApprovalExpectation;
    },
    providerPayment: TossPaymentResponse | null,
  ): Promise<void> {
    if (providerPayment && PROVIDER_NOT_APPROVED_STATUSES.has(providerPayment.status)) {
      await this.recordProviderNotApprovedPayment({ ...input, providerPayment });
    }
  }

  /**
   * The order is already committed. If it was committed with another payment
   * than the one approved in this request, this approval is a duplicate
   * charge: it is cancelled at the provider only, and the committed payment
   * row is left untouched. A failed cancel never turns the confirmed order
   * into an error: it is logged as CRITICAL and retried by the reconcile job.
   */
  private async cancelApprovalIfCommittedWithAnotherPayment(
    approvedPayment: ApprovedPaymentSnapshot,
    committed: { paymentId: string; paymentKey: string },
  ): Promise<void> {
    if (committed.paymentKey === approvedPayment.paymentKey) {
      return;
    }

    this.logger.error(
      `CRITICAL: order committed with another payment; cancelling this approval. orderId=${approvedPayment.orderId}, committedPaymentId=${committed.paymentId}, paymentKey=${approvedPayment.paymentKey}`,
    );
    try {
      await this.cancelApprovedPaymentOrThrow(
        { ...approvedPayment, existingPaymentId: undefined },
        DUPLICATE_PAYMENT_CANCEL_REASON,
        { idempotencyKey: duplicateCancelIdempotencyKey(approvedPayment.paymentKey) },
      );
    } catch {
      if (approvedPayment.reconcileContext) {
        await this.scheduleConfirmReconcile(
          approvedPayment.reconcileContext,
          'duplicate_cancel_failed',
        );
      }
    }
  }

  private assertCheckoutMethodMatchesProviderChargeRequest(
    dto: ConfirmPaymentRequest,
    reservation: { checkoutPaymentMethod?: PaymentMethod | null },
  ): void {
    if (isPaypalConfirmPaymentRequest(dto)) {
      if (!isPaypalCheckoutMethod(reservation.checkoutPaymentMethod)) {
        throw new BadRequestException('예매에 저장된 결제수단과 PayPal 결제 요청이 일치하지 않습니다');
      }
      return;
    }
    if (
      isOverseasCardConfirmPaymentRequest(dto)
      && 'providerChargeAmount' in dto
      && dto.providerChargeAmount
      && !isOverseasCardCheckoutMethod(reservation.checkoutPaymentMethod)
    ) {
      throw new BadRequestException('예매에 저장된 결제수단과 해외카드 결제 요청이 일치하지 않습니다');
    }
  }

  private async verifyConfirmLeaseAfterApproval(
    orderId: string,
    lockToken: string,
    paymentKey: string,
  ): Promise<ConfirmLeaseState> {
    try {
      if (await this.bookingService.refreshPaymentConfirmLock(orderId, lockToken)) {
        return 'owned';
      }
    } catch (lockError) {
      this.logger.error(
        `Payment confirm lock refresh failed after payment approval. paymentKey=${paymentKey}, orderId=${orderId}`,
        lockError instanceof Error ? lockError.stack : String(lockError),
      );
      return 'unknown';
    }

    this.logger.error(
      `Payment confirm lock ownership lost after payment approval. paymentKey=${paymentKey}, orderId=${orderId}`,
    );
    try {
      return await this.bookingService.acquirePaymentConfirmLock(orderId, lockToken)
        ? 'reacquired'
        : 'lost';
    } catch (lockError) {
      this.logger.error(
        `Payment confirm lock reacquire failed after payment approval. paymentKey=${paymentKey}, orderId=${orderId}`,
        lockError instanceof Error ? lockError.stack : String(lockError),
      );
      return 'unknown';
    }
  }

  /**
   * Committed means this reservation is CONFIRMED with a DONE payment (by this
   * request whose commit acknowledgement was lost, or by another finalizer).
   */
  private async readFinalizationState(
    reservationId: string,
    orderId: string,
  ): Promise<FinalizationState> {
    try {
      const rows = await this.db
        .select()
        .from(payments)
        .where(eq(payments.tossOrderId, orderId));
      const payment = rows.find((row) => row.reservationId === reservationId);
      if (!payment) {
        return { kind: 'not_committed' };
      }
      if (
        payment.asyncStatus === 'cancel_pending'
        || payment.status === 'CANCELED'
        || payment.status === 'PARTIAL_CANCELED'
      ) {
        return { kind: 'cancelled' };
      }
      if (payment.status !== 'DONE') {
        return { kind: 'not_committed' };
      }

      const [current] = await this.db
        .select({ status: reservations.status })
        .from(reservations)
        .where(eq(reservations.id, reservationId));
      return current?.status === 'CONFIRMED'
        ? { kind: 'committed', paymentId: payment.id, paymentKey: payment.paymentKey }
        : { kind: 'not_committed' };
    } catch (lookupError) {
      this.logger.error(
        `Failed to read finalization state. orderId=${orderId}`,
        lookupError instanceof Error ? lookupError.stack : String(lookupError),
      );
      return { kind: 'unknown' };
    }
  }

  /**
   * Runs the issuance transaction. Transient database failures (pool acquire
   * timeout, connection reset, deadlock, serialization failure) are retried
   * while the confirm lease and seat locks stay refreshed; the committed state
   * is re-read first because a lost COMMIT acknowledgement may have committed.
   * Only a definitive failure, or one that persists, cancels the payment.
   * When a connection died during an attempt (so a COMMIT may have applied)
   * and the committed state cannot be read back, the outcome is unknown: it
   * is answered with a 503 instead of a cancel that could refund issued
   * tickets. A retry then converges on the committed or uncommitted order.
   */
  private async commitFinalizationWithRetry(input: {
    dto: ConfirmPaymentRequest;
    userId: string;
    reservation: { id: string; showtimeId: string };
    pendingSeats: FloorAwareSeatSelection[];
    performanceId: string;
    approvedPayment: ApprovedPaymentSnapshot;
  }): Promise<string | null> {
    const { dto, reservation, approvedPayment } = input;
    let mayHaveCommitted = false;
    const throwIfCommitUnverifiable = async (
      state: FinalizationState,
      dbError: unknown,
    ): Promise<void> => {
      if (state.kind !== 'unknown' || !mayHaveCommitted) {
        return;
      }
      await this.throwOutcomeUnknown({
        identity: approvedPayment,
        reconcile: approvedPayment.reconcileContext,
        reason: 'finalization_commit_unverified',
        cause: dbError,
      });
    };
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction((tx) => this.commitFinalization(tx, input));
      } catch (dbError) {
        if (isConnectionLossDatabaseError(dbError)) {
          mayHaveCommitted = true;
        }
        // Checked before any compensation: a seat conflict or duplicate row can
        // be this order's own earlier commit (lost acknowledgement) or another
        // finalizer's commit of the same order, which must never be refunded.
        const state = await this.readFinalizationState(reservation.id, dto.orderId);
        if (state.kind === 'committed') {
          this.logger.warn(
            `Finalization already committed after transaction failure. orderId=${dto.orderId}, reservationId=${reservation.id}`,
          );
          await this.cancelApprovalIfCommittedWithAnotherPayment(approvedPayment, state);
          return state.paymentId;
        }
        if (state.kind === 'cancelled') {
          throw new ConflictException(PAYMENT_CANCEL_IN_PROGRESS_MESSAGE);
        }

        if (dbError instanceof ConflictException) {
          // A conflict after an attempt that may have committed can be that
          // commit itself (the same seats are already sold to this order).
          await throwIfCommitUnverifiable(state, dbError);
          this.logger.error(
            `Seat finalization failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
            dbError.stack,
          );
          await this.cancelApprovedPaymentAfterFailure(
            approvedPayment,
            reservation.id,
            this.resolvePostApprovalConflictCancelReason(dbError),
          );
          throw dbError;
        }

        if (isTransientDatabaseError(dbError) && attempt < FINALIZATION_MAX_ATTEMPTS) {
          this.logger.warn(
            `Transient DB failure after payment approval; retrying finalization. attempt=${attempt}, orderId=${dto.orderId}`,
            dbError instanceof Error ? dbError.stack : String(dbError),
          );
          await delay(
            FINALIZATION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
              + Math.floor(Math.random() * FINALIZATION_RETRY_BASE_DELAY_MS),
          );
          continue;
        }

        await throwIfCommitUnverifiable(state, dbError);
        this.logger.error(
          `DB transaction failed after payment approval. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}, attempts=${attempt}`,
          dbError instanceof Error ? dbError.stack : String(dbError),
        );
        await this.cancelApprovedPaymentAfterFailure(
          approvedPayment,
          reservation.id,
          '서버 오류로 인한 자동 취소',
        );
        throw new InternalServerErrorException(POST_APPROVAL_FAILURE_MESSAGE);
      }
    }
  }

  private async commitFinalization(
    tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
    input: {
      userId: string;
      reservation: { id: string; showtimeId: string };
      pendingSeats: FloorAwareSeatSelection[];
      performanceId: string;
      approvedPayment: ApprovedPaymentSnapshot;
    },
  ): Promise<string> {
    const { userId, reservation, pendingSeats, approvedPayment } = input;
    await lockTicketLimitScope(tx, userId, input.performanceId);
    const lockedTicketLimit = await getTicketLimitSnapshot(
      tx, userId,
      reservation.id,
      reservation.showtimeId,
    );
    if (
      lockedTicketLimit.activeTicketCount + pendingSeats.length
      > lockedTicketLimit.maxTicketsPerUser
    ) {
      throw new ConflictException(
        buildMaxTicketsPerUserExceededMessage(lockedTicketLimit.maxTicketsPerUser),
      );
    }

    await tx
      .update(reservations)
      .set({
        status: 'CONFIRMED',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    let committedPaymentId: string | null = null;
    if (approvedPayment.existingPaymentId) {
      committedPaymentId = approvedPayment.existingPaymentId;
      const providerChargeValues = this.toPaymentProviderChargeValues(approvedPayment);
      const providerMetadataValues = this.toPaymentProviderMetadataValues(approvedPayment);
      await tx
        .update(payments)
        .set({
          status: 'DONE',
          amount: approvedPayment.totalAmount,
          paidAt: new Date(approvedPayment.approvedAt),
          asyncStatus: approvedPayment.asyncStatus ?? 'pending_webhook',
          ...providerChargeValues,
          ...providerMetadataValues,
        })
        .where(eq(payments.id, approvedPayment.existingPaymentId));
    } else {
      const providerChargeValues = this.toPaymentProviderChargeValues(approvedPayment);
      const providerMetadataValues = this.toPaymentProviderMetadataValues(approvedPayment);
      const insertedPayments = await tx
        .insert(payments)
        .values({
          reservationId: reservation.id,
          paymentKey: approvedPayment.paymentKey,
          tossOrderId: approvedPayment.orderId,
          method: approvedPayment.method,
          provider: approvedPayment.provider,
          currency: approvedPayment.currency,
          asyncStatus: approvedPayment.asyncStatus ?? 'sync',
          amount: approvedPayment.totalAmount,
          status: 'DONE',
          paidAt: new Date(approvedPayment.approvedAt),
          ...providerChargeValues,
          ...providerMetadataValues,
        })
        .returning({ id: payments.id });

      committedPaymentId = insertedPayments[0]?.id ?? null;
    }

    if (!committedPaymentId) {
      throw new InternalServerErrorException('결제 정보 저장에 실패했습니다');
    }
    const ticketItemPaymentId = committedPaymentId;

    let insertedTicketItems: Array<{ id: string; tierName: string }>;
    try {
      insertedTicketItems = await tx.insert(ticketItems).values(
        pendingSeats.map((seat) => ({
          reservationId: reservation.id,
          paymentId: ticketItemPaymentId,
          showtimeId: reservation.showtimeId,
          seatId: seat.seatId,
          seatKey: seat.seatKey,
          floorKey: seat.floorKey,
          floorLabel: seat.floorLabel,
          tierName: seat.tierName,
          row: seat.row,
          number: seat.number,
          price: seat.price,
          serviceFee: TICKET_SERVICE_FEE_KRW,
          status: 'active' as const,
          admissionState: 'not_entered' as const,
        })),
      ).returning({
        id: ticketItems.id,
        tierName: ticketItems.tierName,
      });
    } catch (error) {
      if (isActiveSeatUniqueViolation(error)) {
        throw new ConflictException('판매 불가능한 좌석입니다');
      }
      throw error;
    }

    await syncIncludedBenefitEntitlementsForTicketItems(
      tx,
      reservation.showtimeId,
      insertedTicketItems,
      new Date(),
    );

    for (const seat of pendingSeats) {
      const updated = await tx
        .update(seatInventories)
        .set({
          status: 'sold',
          soldAt: new Date(),
          lockedBy: null,
          lockedUntil: null,
        })
        .where(
          and(
            eq(seatInventories.showtimeId, reservation.showtimeId),
            eq(seatInventories.floorKey, seat.floorKey),
            or(
              eq(seatInventories.seatKey, seat.seatKey),
              and(
                sql`${seatInventories.seatKey} IS NULL`,
                eq(seatInventories.seatId, seat.seatId),
              ),
            ),
            eq(seatInventories.status, 'available'),
          ),
        )
        .returning({ id: seatInventories.id });

      if (updated.length > 0) continue;

      const inserted = await tx
        .insert(seatInventories)
        .values({
          showtimeId: reservation.showtimeId,
          seatId: seat.seatId,
          floorKey: seat.floorKey,
          seatKey: seat.seatKey,
          status: 'sold',
          soldAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: seatInventories.id });

      if (inserted.length === 0) {
        throw new ConflictException('판매 불가능한 좌석입니다');
      }
    }

    return committedPaymentId;
  }

  private async getReservationSeatSelections(
    reservationId: string,
  ): Promise<FloorAwareSeatSelection[]> {
    const rows = await this.db
      .select({
        seatId: reservationSeats.seatId,
        tierName: reservationSeats.tierName,
        price: reservationSeats.price,
        row: reservationSeats.row,
        number: reservationSeats.number,
      })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

    return rows.map((seat) => toFloorAwareSeatSelection(seat));
  }

  private resolvePostApprovalConflictCancelReason(error: ConflictException): string {
    return error.message.includes('1인 최대')
      ? '예매 매수 제한 초과로 인한 자동 취소'
      : '판매 불가능 좌석으로 인한 자동 취소';
  }

  private resolvePaypalProviderCharge(
    dto: PaypalConfirmPaymentRequest,
    reservation: {
      providerChargeCurrency?: string | null;
      providerChargeAmountMinor?: number | null;
      providerChargeRate?: string | null;
      providerChargeQuotedAt?: Date | null;
    },
  ): PaypalResolvedProviderCharge {
    if (!this.providerChargeQuoteService) {
      throw new BadRequestException('PayPal 결제 금액을 검증할 수 없습니다');
    }

    let amountMinor: number;
    try {
      amountMinor = this.providerChargeQuoteService.parseProviderDecimalToMinor(
        dto.providerChargeAmount,
      );
    } catch {
      throw new BadRequestException('PayPal 결제 금액이 올바르지 않습니다');
    }

    if (
      reservation.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
      || reservation.providerChargeAmountMinor !== amountMinor
    ) {
      throw new BadRequestException('PayPal 결제 금액이 일치하지 않습니다');
    }

    return {
      currency: 'USD',
      amountMinor,
      amountDecimal: dto.providerChargeAmount,
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt,
    };
  }

  private resolveOverseasCardProviderCharge(
    dto: OverseasCardConfirmPaymentRequest & { providerChargeAmount: string },
    reservation: {
      providerChargeCurrency?: string | null;
      providerChargeAmountMinor?: number | null;
      providerChargeRate?: string | null;
      providerChargeQuotedAt?: Date | null;
    },
  ): PaypalResolvedProviderCharge {
    if (!this.providerChargeQuoteService) {
      throw new BadRequestException('해외카드 결제 금액을 검증할 수 없습니다');
    }

    let amountMinor: number;
    try {
      amountMinor = this.providerChargeQuoteService.parseProviderDecimalToMinor(
        dto.providerChargeAmount,
      );
    } catch {
      throw new BadRequestException('해외카드 결제 금액이 올바르지 않습니다');
    }

    if (
      reservation.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
      || reservation.providerChargeAmountMinor !== amountMinor
    ) {
      throw new BadRequestException('해외카드 결제 금액이 일치하지 않습니다');
    }

    return {
      currency: 'USD',
      amountMinor,
      amountDecimal: dto.providerChargeAmount,
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt,
    };
  }

  private toPaymentProviderChargeValues(
    approvedPayment: ApprovedPaymentSnapshot,
  ): {
    providerChargeCurrency?: string;
    providerChargeAmountMinor?: number;
    providerChargeRate?: string;
    providerChargeQuotedAt?: Date;
  } {
    if (
      !approvedPayment.providerChargeCurrency
      || typeof approvedPayment.providerChargeAmountMinor !== 'number'
      || !approvedPayment.providerChargeRate
      || !approvedPayment.providerChargeQuotedAt
    ) {
      return {};
    }

    return {
      providerChargeCurrency: approvedPayment.providerChargeCurrency,
      providerChargeAmountMinor: approvedPayment.providerChargeAmountMinor,
      providerChargeRate: approvedPayment.providerChargeRate,
      providerChargeQuotedAt: approvedPayment.providerChargeQuotedAt,
    };
  }

  private toPaymentProviderMetadataValues(
    approvedPayment: ApprovedPaymentSnapshot,
  ): {
    providerMetadata?: Record<string, unknown>;
  } {
    if (!approvedPayment.providerMetadata) {
      return {};
    }

    return { providerMetadata: approvedPayment.providerMetadata };
  }

  private toApprovedPaymentSnapshot(
    payment: {
      id: string;
      paymentKey: string;
      tossOrderId: string;
      method: string;
      provider: string;
      currency: string;
      amount: number;
      paidAt?: Date | null;
      asyncStatus?: string | null;
      providerChargeCurrency?: string | null;
      providerChargeAmountMinor?: number | null;
      providerChargeRate?: string | null;
      providerChargeQuotedAt?: Date | null;
      providerMetadata?: unknown;
    },
  ): ApprovedPaymentSnapshot & { existingPaymentId: string } {
    return {
      existingPaymentId: payment.id,
      paymentKey: payment.paymentKey,
      orderId: payment.tossOrderId,
      method: payment.method,
      provider: payment.provider,
      currency: payment.currency,
      totalAmount: payment.amount,
      approvedAt: payment.paidAt?.toISOString() ?? new Date().toISOString(),
      asyncStatus: payment.asyncStatus,
      providerChargeCurrency: payment.providerChargeCurrency,
      providerChargeAmountMinor: payment.providerChargeAmountMinor,
      providerChargeRate: payment.providerChargeRate,
      providerChargeQuotedAt: payment.providerChargeQuotedAt,
      providerMetadata: getExistingPaymentProviderMetadata(payment.providerMetadata),
    };
  }

  private isProviderFullCancelCompleted(response: {
    status: string;
    cancels?: Array<{ cancelStatus?: string }>;
  }): boolean {
    return response.status === 'CANCELED'
      && (
        !Array.isArray(response.cancels)
        || response.cancels.some((cancel) =>
          cancel.cancelStatus === undefined || cancel.cancelStatus === 'DONE'
        )
      );
  }

  private async backfillOverseasCardProviderMetadataIfMissing(
    existingPayment: {
      id: string;
      providerMetadata?: unknown;
    },
  ): Promise<void> {
    if (
      existingPayment.providerMetadata !== null
      && existingPayment.providerMetadata !== undefined
    ) {
      return;
    }

    await this.db
      .update(payments)
      .set({ providerMetadata: createOverseasCardProviderMetadata() })
      .where(and(
        eq(payments.id, existingPayment.id),
        isNull(payments.providerMetadata),
      ));
  }

  private canBackfillOverseasCardProviderMetadata(
    existingPayment: {
      reservationId: string;
      paymentKey: string;
      tossOrderId: string;
      amount: number;
      method?: string | null;
      provider?: string | null;
      providerChargeAmountMinor?: number | null;
    },
    reservation: {
      id: string;
      totalAmount: number;
      providerChargeAmountMinor?: number | null;
    },
    dto: OverseasCardConfirmPaymentRequest,
  ): boolean {
    if (existingPayment.provider !== 'CARD' || existingPayment.method !== 'CARD') {
      return false;
    }

    try {
      this.assertExistingDonePaymentMatchesRequest(existingPayment, reservation, dto);
      return true;
    } catch {
      return false;
    }
  }

  private assertExistingDonePaymentCanSatisfyOverseasCardRequest(
    existingPayment: {
      reservationId: string;
      paymentKey: string;
      tossOrderId: string;
      amount: number;
      method?: string | null;
      provider?: string | null;
      providerChargeAmountMinor?: number | null;
      providerMetadata?: unknown;
    },
    reservation: {
      id: string;
      totalAmount: number;
      providerChargeAmountMinor?: number | null;
    },
    dto: ConfirmPaymentRequest,
  ): void {
    if (!isOverseasCardConfirmPaymentRequest(dto)) {
      return;
    }

    if (
      this.hasOverseasCardProviderMetadata(existingPayment.providerMetadata)
      || this.canBackfillOverseasCardProviderMetadata(existingPayment, reservation, dto)
    ) {
      return;
    }

    throw new BadRequestException('해외카드 결제 정보가 일치하지 않습니다');
  }

  private hasOverseasCardProviderMetadata(value: unknown): boolean {
    const metadata = getExistingPaymentProviderMetadata(value);
    if (!metadata) {
      return false;
    }

    return (
      metadata.secretKeyScope === 'overseas-card'
      || (
        typeof metadata.requestedProvider === 'string'
        && metadata.requestedProvider.toUpperCase() === 'OVERSEAS_CARD'
      )
    );
  }

  private calculatePayableTotal(seats: FloorAwareSeatSelection[]): number {
    const seatTotal = seats.reduce((total, seat) => total + seat.price, 0);
    return seatTotal + seats.length * TICKET_SERVICE_FEE_KRW;
  }

  private async expirePendingReservation(reservationId: string): Promise<void> {
    await this.db
      .update(reservations)
      .set({
        status: 'FAILED',
        updatedAt: new Date(),
      })
      .where(and(eq(reservations.id, reservationId), eq(reservations.status, 'PENDING_PAYMENT')));
  }

  private isPastWindow(
    value: Date | null | undefined,
    now: Date = new Date(),
  ): boolean {
    return value instanceof Date
      && !Number.isNaN(value.getTime())
      && value.getTime() < now.getTime();
  }

  private assertExistingDonePaymentMatchesRequest(
    existingPayment: {
      reservationId: string;
      paymentKey: string;
      tossOrderId: string;
      amount: number;
      provider?: string | null;
      providerChargeAmountMinor?: number | null;
    },
    reservation: {
      id: string;
      totalAmount: number;
      providerChargeAmountMinor?: number | null;
    },
    dto: ConfirmPaymentRequest,
  ): void {
    if (
      existingPayment.reservationId !== reservation.id
      || existingPayment.paymentKey !== dto.paymentKey
      || existingPayment.tossOrderId !== dto.orderId
    ) {
      throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
    }

    if (isPaypalConfirmPaymentRequest(dto)) {
      const amountMinor =
        this.providerChargeQuoteService?.parseProviderDecimalToMinor(
          dto.providerChargeAmount,
        );

      if (
        existingPayment.provider !== 'PAYPAL'
        || existingPayment.amount !== reservation.totalAmount
        || existingPayment.providerChargeAmountMinor !== amountMinor
        || reservation.providerChargeAmountMinor !== amountMinor
      ) {
        throw new BadRequestException('PayPal 결제 금액이 일치하지 않습니다');
      }
      return;
    }

    if (
      isOverseasCardConfirmPaymentRequest(dto)
      && 'providerChargeAmount' in dto
      && dto.providerChargeAmount
    ) {
      const amountMinor =
        this.providerChargeQuoteService?.parseProviderDecimalToMinor(
          dto.providerChargeAmount,
        );

      if (
        existingPayment.provider !== 'CARD'
        || existingPayment.amount !== reservation.totalAmount
        || existingPayment.providerChargeAmountMinor !== amountMinor
        || reservation.providerChargeAmountMinor !== amountMinor
      ) {
        throw new BadRequestException('해외카드 결제 금액이 일치하지 않습니다');
      }
      return;
    }

    const expectedRequestAmount = isOverseasCardConfirmPaymentRequest(dto)
      ? reservation.totalAmount
      : dto.amount;

    if (
      existingPayment.amount !== reservation.totalAmount
      || existingPayment.amount !== expectedRequestAmount
    ) {
      throw new BadRequestException('금액이 일치하지 않습니다');
    }
  }
}
