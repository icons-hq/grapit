import { isSameCheckoutPaymentMethod, normalizeSeatIdentity } from '@grabit/shared';
import { getTicketLimitSnapshot, lockTicketLimitScope } from '../../database/ticket-limit.js';
import { randomUUID } from 'node:crypto';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../../database/included-benefit-entitlements.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { TicketItemCancellationCommand } from '../../database/schema/ticket-items.js';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { isActiveSeatUniqueViolation } from '../../database/seat-ownership.js';
import {
  bookingPolicies,
  paymentWebhookEvents,
  payments,
  refunds,
  reservationSeats,
  reservations,
  seatInventories,
  showtimes,
  ticketItems,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import {
  BookingService,
  LOCK_EXPIRED_MESSAGE,
  LOCK_OTHER_OWNER_MESSAGE,
  PAYMENT_CONFIRM_LOCK_TTL,
  RECOVERY_SEAT_LOCK_TTL,
  buildMaxTicketsPerUserExceededMessage,
} from '../booking/booking.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import type {
  PaymentInfo,
  PaymentMethod,
  PaymentProvider,
  ReservationStatus,
  PaymentStatus,
  CancellationQuote,
} from '@grabit/shared';
import { TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import { TossPaymentsClient, type TossPaymentResponse } from './toss-payments.client.js';
import { ProviderChargeQuoteService } from './provider-charge-quote.service.js';
import {
  PaymentCancellationFinalizerService,
  type FullPaymentCancellationContext,
} from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  buildFullPaymentCancelRequest,
  buildFullReservationPaymentCancelRequest,
  readStoredPaymentCancelRequest,
  type PaymentCancelPaymentSnapshot,
  type PaymentCancelRequest,
} from './payment-cancel-policy.js';
import {
  buildCompletedCancelExpectation,
  getCompletedProviderCancels,
  hasMatchingCompletedProviderCancel,
  type TossPaymentCancelRecord,
} from './toss-cancel-matcher.js';
import {
  ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES,
  ASYNC_DONE_COMPENSATION_MAX_ATTEMPTS,
  ASYNC_DONE_COMPENSATION_METADATA_KEY,
  ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY,
  ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_COUNT,
  ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_MS,
  ASYNC_DONE_COMPENSATION_REASONS,
  DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY,
  REJECTED_DONE_ASYNC_STATUSES,
  buildCompensationRecord,
  buildDuplicateCancelRequestSeed,
  isCompensationDue,
  isOpenCompensationState,
  isSettledOrCompensatedPaymentState,
  readAsyncDoneCompensation,
  readDuplicatePaymentCompensations,
  synthesizeLegacyCompensationRecord,
  toCompensationCancelSnapshot,
  type AsyncDoneCompensationKind,
  type AsyncDoneCompensationRecord,
  type CompensationCancelOutcome,
  type CompensationPaymentRow,
} from './async-done-compensation.js';
import {
  paymentTerminalFailureDiagnostic,
  recordReservationPaymentFailureDiagnostic,
} from './payment-failure-diagnostic.js';
import {
  PAYMENT_HANDOFF_RELEASE_WINDOW_MS,
  PAYMENT_HANDOFF_UNKNOWN_MESSAGE,
  isMerchantConfirmedCheckoutMethod,
} from './payment-handoff-policy.js';

type TossWebhookProvider = PaymentProvider | 'ALIPAY';
type ProviderChargeQuote = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
};

export type { AsyncDoneCompensationRecord } from './async-done-compensation.js';

export interface AsyncDoneCompensationRecoveryResult {
  checked: number;
  cancelled: number;
  retried: number;
  waiting: number;
  attention: number;
  skipped: number;
}

type CompensationStepAction = 'cancelled' | 'retried' | 'waiting' | 'attention';

/** Shares the order-lease keyspace; real order ids never take this value. */
const ASYNC_DONE_COMPENSATION_SWEEP_LEASE_KEY = 'async-done-compensation-sweep';
/** Open compensations are rare; non-due rows are read but not rewritten. */
const ASYNC_DONE_COMPENSATION_SWEEP_LIMIT = 100;
/**
 * TrueMoney has no provider charge quote contract yet, so it can never be
 * issued safely. Branch creation rejects it and a captured DONE is refunded.
 */
const UNSUPPORTED_TOSS_CHECKOUT_PROVIDERS = new Set<PaymentProvider>(['TRUEMONEY']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ASYNC_FOREIGN_EASY_PAY_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'TRUEMONEY',
]);

const PROVIDER_CHARGE_QUOTE_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'PAYPAL',
]);
const PAYMENT_PROCESSING_GRACE_MS = 8 * 60 * 1000;
const PAYMENT_PROCESSING_TOTAL_CAP_MS = 15 * 60 * 1000;

export type TossPaymentAsyncStatus = 'sync' | 'pending_webhook';

export interface TossPaymentBranchRequest {
  orderId: string;
  paymentMethod: PaymentMethod;
  successUrl: string;
  failUrl: string;
  pendingUrl?: string;
  userId?: string;
}

export interface TossPaymentBranch {
  orderId: string;
  method: PaymentMethod['method'];
  provider: PaymentMethod['provider'];
  currency: string;
  successUrl: string;
  failUrl: string;
  pendingUrl?: string;
  asyncStatus: TossPaymentAsyncStatus;
  useInternationalCardOnly: boolean;
  providerChargeQuote?: ProviderChargeQuote;
  checkoutEnabled?: boolean;
  disabledReason?: string;
  paymentDeadlineAt?: string;
}

export interface TossPaymentHandoffReleaseRequest {
  orderId: string;
  userId: string;
}

export interface TossPaymentHandoffRelease {
  orderId: string;
  released: true;
  paymentDeadlineAt?: string;
}

export interface TossPaymentAsyncReturnRequest {
  orderId: string;
  paymentKey: string;
  amount?: number;
  provider?: Extract<PaymentProvider, 'ALIPAY_PLUS' | 'TRUEMONEY'>;
  userId: string;
}

export type TossWebhookEventType =
  | 'PAYMENT_STATUS_CHANGED'
  | 'CANCEL_STATUS_CHANGED';

export interface TossWebhookRequestBody {
  eventId: string;
  eventType: TossWebhookEventType;
  createdAt?: string;
  data: {
    paymentKey?: string;
    orderId?: string;
    status?: string;
    method?: string;
    provider?: TossWebhookProvider;
    currency?: string;
    totalAmount?: number;
    approvedAt?: string;
    canceledAt?: string;
    cancelReason?: string;
    cancelAmount?: number;
    cancelStatus?: string;
    cancelRequestId?: string;
    easyPay?: string;
  };
}

export interface TossWebhookRecordResult {
  state: 'inserted' | 'duplicate-processed' | 'duplicate-pending';
  eventId: string;
  processingResultCode?: string;
}

export interface AsyncPaymentProgressSnapshot {
  reservationId: string;
  reservationStatus: ReservationStatus;
  paymentStatus: PaymentStatus | null;
  paymentAsyncStatus?: string | null;
  /** The stored payment's key; a DONE for another key may be a duplicate charge. */
  paymentKey?: string | null;
}

type WebhookReservationSnapshot = {
  id: string;
  userId: string;
  showtimeId: string;
  status: ReservationStatus;
  totalAmount: number;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
  providerChargeRate?: string | null;
  providerChargeQuotedAt?: Date | null;
};

type WebhookPaymentSnapshot = {
  id: string;
  reservationId: string;
  paymentKey: string;
  tossOrderId: string;
  method?: string;
  provider?: string;
  currency?: string;
  amount: number;
  status: PaymentStatus;
  asyncStatus?: string | null;
  paidAt?: Date | null;
  cancelReason?: string | null;
  providerMetadata?: unknown;
  providerChargeAmountMinor?: number | null;
};

function readCancellationQuoteFromMetadata(value: unknown): CancellationQuote | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const quote = (value as { cancellationQuote?: unknown }).cancellationQuote;
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

function getRefundCancelRequestAnchor(refund: {
  requestedAt?: Date | null;
  sentToPgAt?: Date | null;
  processingAtPgAt?: Date | null;
}): Date | null {
  return refund.requestedAt ?? refund.sentToPgAt ?? refund.processingAtPgAt ?? null;
}

type WebhookSeatSelection = {
  seatId: string;
  floorKey: string;
  floorLabel: string;
  seatKey: string;
  tierName: string;
  row: string;
  number: string;
  price: number;
};

type PaymentStatusPartialCancelTicketItemCancellation = {
  cancellationCommand?: TicketItemCancellationCommand | null;
  ticketItemId: string;
  seatId: string;
  floorKey: string;
  seatKey: string;
  status?: string;
  cancellationFee: number;
  serviceFeeRefund: number;
  refundableAmount: number;
  cancelReason?: string;
};

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly bookingGateway?: BookingGateway,
    @Optional() private readonly qrTicketService?: QrTicketService,
    @Optional() private readonly tossClient?: TossPaymentsClient,
    @Optional() private readonly providerChargeQuoteService?: ProviderChargeQuoteService,
    @Optional()
    private readonly paymentCancellationFinalizer?: PaymentCancellationFinalizerService,
    @Optional() private readonly bookingService?: BookingService,
  ) {}

  async prepareTossPaymentBranch(input: TossPaymentBranchRequest): Promise<TossPaymentBranch> {
    const { orderId, paymentMethod, successUrl, failUrl, pendingUrl, userId } = input;
    this.assertSupportedTossCheckoutProvider(paymentMethod);

    if (this.usesProviderChargeQuoteForPaymentMethod(paymentMethod)) {
      if (this.requiresAsyncWebhookBranch(paymentMethod) && !pendingUrl) {
        throw new BadRequestException('FOREIGN_EASY_PAY 결제는 pendingUrl이 필요합니다');
      }

      const availability =
        this.getProviderChargeAvailability(paymentMethod.provider)
        ?? {
          enabled: false,
          disabledReason: 'PAYPAL_CHECKOUT_UNAVAILABLE',
        };
      const providerChargeQuote = availability.enabled
        ? await this.findStoredProviderChargeQuote(orderId)
        : undefined;
      const checkoutEnabled = availability.enabled && !!providerChargeQuote;
      const disabledReason = availability.enabled
        ? providerChargeQuote ? undefined : 'PAYPAL_PROVIDER_CHARGE_QUOTE_MISSING'
        : availability.disabledReason;
      const asyncStatus = this.requiresAsyncWebhookBranch(paymentMethod)
        ? 'pending_webhook'
        : 'sync';

      const method = paymentMethod.method === 'CARD' ? 'CARD' : 'FOREIGN_EASY_PAY';

      const branch: TossPaymentBranch = {
        orderId,
        method,
        provider: paymentMethod.provider,
        currency: 'USD',
        successUrl,
        failUrl,
        ...(pendingUrl ? { pendingUrl } : {}),
        asyncStatus,
        useInternationalCardOnly: method === 'CARD',
        checkoutEnabled,
        ...(disabledReason ? { disabledReason } : {}),
        ...(providerChargeQuote ? { providerChargeQuote } : {}),
      };
      return checkoutEnabled
        ? await this.withPaymentProcessingGrace(branch, userId, paymentMethod)
        : branch;
    }

    if (this.requiresAsyncWebhookBranch(paymentMethod)) {
      if (!pendingUrl) {
        throw new BadRequestException('FOREIGN_EASY_PAY 결제는 pendingUrl이 필요합니다');
      }

      return await this.withPaymentProcessingGrace({
        orderId,
        method: 'FOREIGN_EASY_PAY',
        provider: paymentMethod.provider,
        currency: paymentMethod.currency ?? 'USD',
        successUrl,
        failUrl,
        pendingUrl,
        asyncStatus: 'pending_webhook',
        useInternationalCardOnly: false,
      }, userId, paymentMethod);
    }

    if (paymentMethod.provider === 'CARD') {
      const useInternationalCardOnly = this.isOverseasCardBranch(paymentMethod);
      const overseasCardAvailability = useInternationalCardOnly
        ? this.getOverseasCardAvailability()
        : undefined;

      const branch: TossPaymentBranch = {
        orderId,
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        successUrl,
        failUrl,
        asyncStatus: 'sync',
        useInternationalCardOnly,
        ...(overseasCardAvailability
          ? {
              checkoutEnabled: overseasCardAvailability.enabled,
              ...(overseasCardAvailability.disabledReason
                ? { disabledReason: overseasCardAvailability.disabledReason }
                : {}),
            }
          : {}),
      };
      return overseasCardAvailability && !overseasCardAvailability.enabled
        ? branch
        : await this.withPaymentProcessingGrace(branch, userId, paymentMethod);
    }

    return await this.withPaymentProcessingGrace({
      orderId,
      method: paymentMethod.method,
      provider: paymentMethod.provider,
      currency: paymentMethod.currency ?? 'KRW',
      successUrl,
      failUrl,
      asyncStatus: 'sync',
      useInternationalCardOnly: false,
    }, userId, paymentMethod);
  }

  private async withPaymentProcessingGrace<T extends TossPaymentBranch>(
    branch: T,
    userId: string | undefined,
    paymentMethod: PaymentMethod,
  ): Promise<T> {
    const paymentDeadlineAt = await this.extendPendingPaymentProcessingGrace(
      branch.orderId,
      userId,
      new Date(),
      paymentMethod,
    );
    return paymentDeadlineAt ? { ...branch, paymentDeadlineAt } : branch;
  }

  private async extendPendingPaymentProcessingGrace(
    orderId: string,
    userId?: string,
    now: Date = new Date(),
    paymentMethod?: PaymentMethod,
  ): Promise<string | undefined> {
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        userId: reservations.userId,
        showtimeId: reservations.showtimeId,
        status: reservations.status,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
        admissionActiveUntilAt: reservations.admissionActiveUntilAt,
        reentryGraceUntilAt: reservations.reentryGraceUntilAt,
        createdAt: reservations.createdAt,
        checkoutPaymentMethod: reservations.checkoutPaymentMethod,
        checkoutStartedAt: reservations.checkoutStartedAt,
      })
      .from(reservations)
      .where(
        userId
          ? and(
              eq(reservations.tossOrderId, orderId),
              eq(reservations.userId, userId),
            )
          : eq(reservations.tossOrderId, orderId),
      );

    if (!reservation?.id) {
      if (userId) {
        throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
      }
      return undefined;
    }

    if (reservation.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('이미 처리된 주문 ID입니다. 새 주문 ID로 다시 시도해주세요.');
    }

    if (paymentMethod && reservation.checkoutStartedAt) {
      throw new ConflictException('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.');
    }

    if (paymentMethod && (
      !reservation.checkoutPaymentMethod
      || !isSameCheckoutPaymentMethod(reservation.checkoutPaymentMethod, paymentMethod)
    )) {
      throw new ConflictException('예매에 저장된 결제수단과 일치하지 않습니다. 기존 예매를 다시 확인해주세요.');
    }

    if (!this.isValidDate(reservation.paymentDeadlineAt)) {
      return undefined;
    }

    if (reservation.paymentDeadlineAt.getTime() < now.getTime()) {
      throw new ConflictException('결제 가능 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    if (!this.isValidDate(reservation.createdAt)) {
      return reservation.paymentDeadlineAt.toISOString();
    }

    const capAt = new Date(
      reservation.createdAt.getTime() + PAYMENT_PROCESSING_TOTAL_CAP_MS,
    );
    const graceAt = new Date(now.getTime() + PAYMENT_PROCESSING_GRACE_MS);
    const effectiveDeadlineAt = new Date(Math.max(
      reservation.paymentDeadlineAt.getTime(),
      Math.min(graceAt.getTime(), capAt.getTime()),
    ));
    const ttlSeconds = Math.max(
      1,
      Math.ceil((effectiveDeadlineAt.getTime() - now.getTime()) / 1000),
    );

    const seats = await this.db
      .select({ seatId: reservationSeats.seatId })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));
    const seatIds = seats
      .map((seat) => seat.seatId)
      .filter((seatId): seatId is string => typeof seatId === 'string' && seatId.length > 0);

    const updatedReservations = await this.db
      .update(reservations)
      .set({
        paymentDeadlineAt: effectiveDeadlineAt,
        admissionActiveUntilAt: effectiveDeadlineAt,
        reentryGraceUntilAt: effectiveDeadlineAt,
        updatedAt: now,
      })
      .where(and(
        eq(reservations.id, reservation.id),
        eq(reservations.status, 'PENDING_PAYMENT'),
        eq(reservations.paymentDeadlineAt, reservation.paymentDeadlineAt),
        ...(paymentMethod ? [sql`${reservations.checkoutStartedAt} is null`] : []),
        ...(paymentMethod ? [sql`${reservations.checkoutPaymentMethod} = ${JSON.stringify(reservation.checkoutPaymentMethod)}::jsonb`] : []),
      ))
      .returning({ id: reservations.id });

    if (updatedReservations.length === 0) {
      throw new ConflictException('결제 가능 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
    }

    if (seatIds.length > 0) {
      if (!this.bookingService) {
        throw new InternalServerErrorException('좌석 잠금 서비스가 설정되지 않았습니다');
      }
      try {
        await this.bookingService.extendOwnedSeatLocks(
          reservation.userId,
          reservation.showtimeId,
          seatIds,
          ttlSeconds,
        );
      } catch (error) {
        await this.db
          .update(reservations)
          .set({
            paymentDeadlineAt: reservation.paymentDeadlineAt,
            admissionActiveUntilAt: reservation.admissionActiveUntilAt,
            reentryGraceUntilAt: reservation.reentryGraceUntilAt,
            updatedAt: now,
          })
          .where(and(
            eq(reservations.id, reservation.id),
            eq(reservations.status, 'PENDING_PAYMENT'),
            eq(reservations.paymentDeadlineAt, effectiveDeadlineAt),
            sql`${reservations.checkoutStartedAt} is null`,
            ...(paymentMethod ? [sql`${reservations.checkoutPaymentMethod} = ${JSON.stringify(reservation.checkoutPaymentMethod)}::jsonb`] : []),
          ));
        throw error;
      }
    }

    if (paymentMethod) {
      const [started] = await this.db.update(reservations).set({
        checkoutStartedAt: now,
        updatedAt: now,
      }).where(and(
        eq(reservations.id, reservation.id),
        eq(reservations.status, 'PENDING_PAYMENT'),
        eq(reservations.paymentDeadlineAt, effectiveDeadlineAt),
        sql`${reservations.checkoutStartedAt} is null`,
        sql`${reservations.checkoutPaymentMethod} = ${JSON.stringify(reservation.checkoutPaymentMethod)}::jsonb`,
      )).returning({ id: reservations.id });
      if (!started) {
        throw new ConflictException('예매 상태가 변경되었습니다. 기존 예매를 다시 확인해주세요.');
      }
    }
    return effectiveDeadlineAt.toISOString();
  }

  /**
   * Reopens a Prepared Checkout whose provider SDK rejected before opening checkout
   * (card issuer not selected, a selection race, invalid parameters). Without this the
   * order keeps `checkout_started_at` with no provider payment, so no webhook ever
   * resolves it and retry, abandonment and expiry stay blocked.
   *
   * Only merchant-confirmed methods qualify, only inside the short release window,
   * only while no Payment exists, only while holding the same confirm lease that
   * payment confirm and async progress use, and only when no confirm was ever
   * attempted for the order. The lease ends with each confirm, so a confirm that
   * finished without a Payment row (provider timeout, recording failure) is visible
   * only through its attempt marker; such an order stays in status review.
   */
  async releaseTossPaymentHandoff(
    input: TossPaymentHandoffReleaseRequest,
    now: Date = new Date(),
  ): Promise<TossPaymentHandoffRelease> {
    const { orderId, userId } = input;
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        status: reservations.status,
        paymentDeadlineAt: reservations.paymentDeadlineAt,
        checkoutPaymentMethod: reservations.checkoutPaymentMethod,
        checkoutStartedAt: reservations.checkoutStartedAt,
      })
      .from(reservations)
      .where(and(
        eq(reservations.tossOrderId, orderId),
        eq(reservations.userId, userId),
      ));

    if (!reservation?.id) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
    }
    if (reservation.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('이미 처리된 주문 ID입니다. 새 주문 ID로 다시 시도해주세요.');
    }

    const toRelease = (paymentDeadlineAt: Date | null | undefined): TossPaymentHandoffRelease => ({
      orderId,
      released: true,
      ...(this.isValidDate(paymentDeadlineAt)
        ? { paymentDeadlineAt: paymentDeadlineAt.toISOString() }
        : {}),
    });

    if (!reservation.checkoutStartedAt) {
      return toRelease(reservation.paymentDeadlineAt);
    }

    const handoffAgeMs = now.getTime() - reservation.checkoutStartedAt.getTime();
    if (
      !reservation.checkoutPaymentMethod
      || !isMerchantConfirmedCheckoutMethod(reservation.checkoutPaymentMethod)
      || !Number.isFinite(handoffAgeMs)
      || handoffAgeMs > PAYMENT_HANDOFF_RELEASE_WINDOW_MS
    ) {
      throw new ConflictException(PAYMENT_HANDOFF_UNKNOWN_MESSAGE);
    }

    if (!this.bookingService) {
      throw new InternalServerErrorException('결제 확인 잠금 서비스가 설정되지 않았습니다');
    }

    const leaseToken = randomUUID();
    let leaseAcquired: boolean;
    try {
      leaseAcquired = await this.bookingService.acquirePaymentConfirmLock(orderId, leaseToken);
    } catch {
      throw new ServiceUnavailableException('결제 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.');
    }
    if (!leaseAcquired) {
      throw new ConflictException('결제 확인이 이미 진행 중입니다.');
    }

    try {
      let confirmAttempted: boolean;
      try {
        confirmAttempted = await this.bookingService.hasPaymentConfirmAttempt(orderId);
      } catch {
        throw new ServiceUnavailableException('결제 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }
      if (confirmAttempted) {
        throw new ConflictException(PAYMENT_HANDOFF_UNKNOWN_MESSAGE);
      }

      const [released] = await this.db
        .update(reservations)
        .set({ checkoutStartedAt: null, updatedAt: now })
        .where(and(
          eq(reservations.id, reservation.id),
          eq(reservations.status, 'PENDING_PAYMENT'),
          eq(reservations.checkoutStartedAt, reservation.checkoutStartedAt),
          sql`${reservations.checkoutPaymentMethod} = ${JSON.stringify(reservation.checkoutPaymentMethod)}::jsonb`,
          sql`not exists (
            select 1 from ${payments}
            where ${payments.reservationId} = ${reservations.id}
          )`,
        ))
        .returning({
          id: reservations.id,
          paymentDeadlineAt: reservations.paymentDeadlineAt,
        });
      if (!released) {
        throw new ConflictException(PAYMENT_HANDOFF_UNKNOWN_MESSAGE);
      }
      return toRelease(released.paymentDeadlineAt);
    } finally {
      await this.bookingService
        .releasePaymentConfirmLock(orderId, leaseToken)
        .catch(() => undefined);
    }
  }

  private isValidDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
  }

  private async findStoredProviderChargeQuote(
    orderId: string,
  ): Promise<ProviderChargeQuote | undefined> {
    const [reservation] = await this.db
      .select({
        providerChargeCurrency: reservations.providerChargeCurrency,
        providerChargeAmountMinor: reservations.providerChargeAmountMinor,
        providerChargeRate: reservations.providerChargeRate,
        providerChargeQuotedAt: reservations.providerChargeQuotedAt,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));

    if (
      reservation?.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
    ) {
      return undefined;
    }

    return {
      currency: 'USD',
      amountMinor: reservation.providerChargeAmountMinor,
      amountDecimal: this.formatProviderMinorToDecimal(
        reservation.providerChargeAmountMinor,
      ),
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt.toISOString(),
    };
  }

  private formatProviderMinorToDecimal(amountMinor: number): string {
    const whole = Math.floor(amountMinor / 100);
    const fraction = String(amountMinor % 100).padStart(2, '0');
    return `${whole}.${fraction}`;
  }

  private getReservationProviderChargeQuote(
    reservation: WebhookReservationSnapshot,
  ): ProviderChargeQuote | undefined {
    if (
      reservation.providerChargeCurrency !== 'USD'
      || typeof reservation.providerChargeAmountMinor !== 'number'
      || !reservation.providerChargeRate
      || !reservation.providerChargeQuotedAt
    ) {
      return undefined;
    }

    return {
      currency: 'USD',
      amountMinor: reservation.providerChargeAmountMinor,
      amountDecimal: this.formatProviderMinorToDecimal(
        reservation.providerChargeAmountMinor,
      ),
      rate: reservation.providerChargeRate,
      quotedAt: reservation.providerChargeQuotedAt.toISOString(),
    };
  }

  private toPaymentProviderChargeValues(
    quote: ProviderChargeQuote | undefined,
  ): {
    providerChargeCurrency?: 'USD';
    providerChargeAmountMinor?: number;
    providerChargeRate?: string;
    providerChargeQuotedAt?: Date;
  } {
    if (!quote) {
      return {};
    }

    return {
      providerChargeCurrency: quote.currency,
      providerChargeAmountMinor: quote.amountMinor,
      providerChargeRate: quote.rate,
      providerChargeQuotedAt: new Date(quote.quotedAt),
    };
  }

  private toProviderAmountMinor(totalAmount: number | undefined): number | undefined {
    if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      return undefined;
    }

    return Math.round(totalAmount * 100);
  }

  async getPaymentByReservationId(reservationId: string): Promise<PaymentInfo | null> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.reservationId, reservationId));

    if (!payment) {
      return null;
    }

    return {
      paymentKey: payment.paymentKey,
      method: payment.method,
      amount: payment.amount,
      status: payment.status as PaymentStatus,
      paidAt: payment.paidAt?.toISOString() ?? null,
    };
  }

  async recordWebhookEvent(payload: TossWebhookRequestBody): Promise<TossWebhookRecordResult> {
    const [inserted] = await this.db
      .insert(paymentWebhookEvents)
      .values({
        eventId: payload.eventId,
        eventType: payload.eventType,
        paymentKey: payload.data.paymentKey ?? null,
        tossOrderId: payload.data.orderId ?? null,
        payload,
        receivedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.id });

    if (inserted) {
      return {
        state: 'inserted',
        eventId: payload.eventId,
      };
    }

    const [existing] = await this.db
      .select({
        processedAt: paymentWebhookEvents.processedAt,
        processingResultCode: paymentWebhookEvents.processingResultCode,
      })
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.eventId, payload.eventId));

    if (existing?.processedAt) {
      return {
        state: 'duplicate-processed',
        eventId: payload.eventId,
        processingResultCode: existing.processingResultCode ?? undefined,
      };
    }

    return {
      state: 'duplicate-pending',
      eventId: payload.eventId,
      processingResultCode: existing?.processingResultCode ?? undefined,
    };
  }

  async reconcileAsyncPaymentReturn(input: TossPaymentAsyncReturnRequest): Promise<void> {
    if (!this.tossClient) {
      throw new InternalServerErrorException('Toss 결제 상태 조회 클라이언트가 설정되지 않았습니다');
    }

    const [reservation] = await this.db
      .select({
        id: reservations.id,
        userId: reservations.userId,
        status: reservations.status,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, input.orderId));

    if (!reservation || reservation.userId !== input.userId) {
      throw new NotFoundException('예매 정보를 찾을 수 없습니다. 다시 시도해주세요.');
    }

    if (await this.isAsyncReturnAlreadySettled(reservation, input.paymentKey)) {
      return;
    }

    const queriedPayment = await this.tossClient.queryPayment(input.paymentKey, {
      secretKeyScope: this.usesForeignEasyPaySecret(input.provider)
        ? 'foreign-easy-pay'
        : 'default',
    });
    this.assertQueriedPaymentMatchesAsyncReturn(input, queriedPayment);

    const paymentStatus = this.normalizeTossPaymentStatus(queriedPayment.status);
    await this.upsertAsyncPaymentProgress(
      {
        eventId: [
          'client-return',
          queriedPayment.orderId,
          queriedPayment.paymentKey,
          queriedPayment.status,
        ].join(':'),
        eventType: 'PAYMENT_STATUS_CHANGED',
        data: {
          paymentKey: queriedPayment.paymentKey,
          orderId: queriedPayment.orderId,
          status: queriedPayment.status,
          method: queriedPayment.method || 'FOREIGN_EASY_PAY',
          provider: this.toWebhookProvider(input.provider),
          ...(queriedPayment.currency ? { currency: queriedPayment.currency } : {}),
          totalAmount: queriedPayment.totalAmount,
          approvedAt: queriedPayment.approvedAt ?? undefined,
        },
      },
      paymentStatus,
      `client_return:${paymentStatus.toLowerCase()}`,
    );
  }

  /**
   * A pending-return refresh for an order whose same payment is already issued
   * or cancelled has nothing to reconcile: skip the provider query and the
   * order lease so repeated returns cannot contend with webhook processing.
   */
  private async isAsyncReturnAlreadySettled(
    reservation: { id: string; status: string },
    paymentKey: string,
  ): Promise<boolean> {
    if (reservation.status !== 'CONFIRMED' && reservation.status !== 'CANCELLED') {
      return false;
    }

    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));

    if (!payment || payment.paymentKey !== paymentKey) {
      return false;
    }

    if (reservation.status === 'CANCELLED') {
      return payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED';
    }

    if (payment.status === 'PARTIAL_CANCELED') {
      // Seat-level cancellations belong to the cancellation finalizer.
      return true;
    }

    if (payment.status !== 'DONE') {
      return false;
    }

    // Issuance is idempotent and DB-only; it repairs a post-commit QR failure
    // without another provider round trip.
    if (this.qrTicketService) {
      await this.qrTicketService.ensureIssuedTicketsForReservation({
        reservationId: reservation.id,
        paymentId: payment.id,
      });
    }
    return true;
  }

  async findAsyncPaymentProgress(
    orderId: string,
    paymentKey: string,
  ): Promise<AsyncPaymentProgressSnapshot | null> {
    const [reservation] = await this.db
      .select({
        reservationId: reservations.id,
        reservationStatus: reservations.status,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));

    if (!reservation) {
      return null;
    }

    const [payment] = await this.db
      .select({
        paymentKey: payments.paymentKey,
        paymentStatus: payments.status,
        paymentAsyncStatus: payments.asyncStatus,
      })
      .from(payments)
      .where(
        or(
          eq(payments.tossOrderId, orderId),
          eq(payments.paymentKey, paymentKey),
        ),
      );

    return {
      reservationId: reservation.reservationId,
      reservationStatus: reservation.reservationStatus as ReservationStatus,
      paymentStatus: payment?.paymentStatus as PaymentStatus | undefined ?? null,
      paymentAsyncStatus: payment?.paymentAsyncStatus ?? null,
      paymentKey: payment?.paymentKey ?? null,
    };
  }

  async findPaymentCancelSnapshot(
    orderId: string,
    paymentKey: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(
        or(
          eq(payments.tossOrderId, orderId),
          eq(payments.paymentKey, paymentKey),
        ),
      );

    return payment ?? null;
  }

  async findPaymentCancelSnapshotByCancelRequestId(
    cancelRequestId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const normalizedCancelRequestId = cancelRequestId.trim();
    if (!normalizedCancelRequestId) {
      return null;
    }

    // `cancel_<row id>` resolves through primary keys. The id columns are uuid,
    // so other suffixes are never cast into those lookups.
    const localId = this.parseGeneratedCancelRequestId(normalizedCancelRequestId);
    if (localId && UUID_PATTERN.test(localId)) {
      const byLocalId = await this.findPaymentCancelSnapshotByRefundId(localId)
        ?? await this.findPaymentCancelSnapshotByTicketItemId(localId)
        ?? await this.findPaymentCancelSnapshotByPaymentId(localId)
        ?? await this.findPaymentCancelSnapshotByReservationId(localId);
      if (byLocalId) {
        return byLocalId;
      }
    }

    // Seat-level commands and retried refunds send `cancel_<random command or
    // attempt id>`, and compensation retries add a suffix; none of them equal a
    // local row id, so match the full value stored with the command.
    return await this.findPaymentCancelSnapshotByStoredTicketItemCommand(normalizedCancelRequestId)
      ?? await this.findPaymentCancelSnapshotByStoredRefundCommand(normalizedCancelRequestId)
      ?? await this.findPaymentCancelSnapshotByCompensationRecord(normalizedCancelRequestId);
  }

  private async findPaymentCancelSnapshotByStoredTicketItemCommand(
    cancelRequestId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(ticketItems)
      .innerJoin(payments, eq(ticketItems.paymentId, payments.id))
      .where(
        sql`${ticketItems.cancellationCommand}->'options'->>'cancelRequestId' = ${cancelRequestId}`,
      );

    return payment ?? null;
  }

  private async findPaymentCancelSnapshotByStoredRefundCommand(
    cancelRequestId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const previousAttempt = JSON.stringify([
      { cancelRequest: { options: { cancelRequestId } } },
    ]);
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(refunds)
      .innerJoin(payments, eq(refunds.paymentId, payments.id))
      .where(or(
        sql`${refunds.providerMetadata}->'cancelRequest'->'options'->>'cancelRequestId' = ${cancelRequestId}`,
        sql`${refunds.providerMetadata}->'previousAttempts' @> ${previousAttempt}::jsonb`,
      ));

    return payment ?? null;
  }

  private async findPaymentCancelSnapshotByCompensationRecord(
    cancelRequestId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const ownRecord = JSON.stringify({
      [ASYNC_DONE_COMPENSATION_METADATA_KEY]: { cancelRequestIds: [cancelRequestId] },
    });
    const duplicateRecord = JSON.stringify({
      [DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY]: [{ cancelRequestIds: [cancelRequestId] }],
    });
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(or(
        sql`${payments.providerMetadata} @> ${ownRecord}::jsonb`,
        sql`${payments.providerMetadata} @> ${duplicateRecord}::jsonb`,
      ));

    if (!payment) {
      return null;
    }

    const duplicate = readDuplicatePaymentCompensations(payment.providerMetadata)
      .find((record) => record.cancelRequestIds.includes(cancelRequestId));
    if (duplicate && !readAsyncDoneCompensation(payment.providerMetadata)
      ?.cancelRequestIds.includes(cancelRequestId)) {
      // The duplicate charge has no payment row of its own; query it by its key.
      return toCompensationCancelSnapshot(duplicate);
    }

    return payment;
  }

  private async findPaymentCancelSnapshotByRefundId(
    refundId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(refunds)
      .innerJoin(payments, eq(refunds.paymentId, payments.id))
      .where(eq(refunds.id, refundId));

    return payment ?? null;
  }

  private async findPaymentCancelSnapshotByTicketItemId(
    ticketItemId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(ticketItems)
      .innerJoin(payments, eq(ticketItems.paymentId, payments.id))
      .where(eq(ticketItems.id, ticketItemId));

    return payment ?? null;
  }

  private async findPaymentCancelSnapshotByPaymentId(
    paymentId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(eq(payments.id, paymentId));

    return payment ?? null;
  }

  private async findPaymentCancelSnapshotByReservationId(
    reservationId: string,
  ): Promise<PaymentCancelPaymentSnapshot | null> {
    const [payment] = await this.db
      .select({
        id: payments.id,
        paymentKey: payments.paymentKey,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(eq(payments.reservationId, reservationId));

    return payment ?? null;
  }

  private parseGeneratedCancelRequestId(cancelRequestId: string): string | null {
    if (!cancelRequestId.startsWith('cancel_')) {
      return null;
    }

    const localId = cancelRequestId.slice('cancel_'.length).trim();
    return localId.length > 0 ? localId : null;
  }

  async upsertAsyncPaymentProgress(
    payload: TossWebhookRequestBody,
    paymentStatus: PaymentStatus,
    asyncStatus: string,
  ): Promise<string | void> {
    if (!this.bookingService) {
      throw new ServiceUnavailableException('결제 확인 서비스를 사용할 수 없습니다.');
    }
    const orderId = this.requireWebhookOrderId(payload);
    // Same order lock as synchronous confirm, acquired before reading snapshots
    // or taking late-recovery seat locks. Contention asks the provider to retry.
    const result = await this.withPaymentOrderLease(orderId, (assertLease) =>
      this.upsertAsyncPaymentProgressLocked(payload, paymentStatus, asyncStatus, assertLease));
    if (!result.acquired) {
      throw new ServiceUnavailableException('결제 확인이 이미 진행 중입니다.');
    }
    return result.value;
  }

  private async withPaymentOrderLease<T>(
    orderId: string,
    run: (assertLease: () => Promise<void>) => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    if (!this.bookingService) {
      throw new ServiceUnavailableException('결제 확인 서비스를 사용할 수 없습니다.');
    }
    const bookingService = this.bookingService;
    const token = randomUUID();
    if (!await bookingService.acquirePaymentConfirmLock(orderId, token)) {
      return { acquired: false };
    }
    let leaseHealthy = true;
    const assertLease = async () => {
      if (!leaseHealthy || !await bookingService.refreshPaymentConfirmLock(orderId, token)) {
        throw new ServiceUnavailableException('결제 확인 잠금을 다시 확보해야 합니다.');
      }
    };
    const timer = setInterval(() => {
      void assertLease().catch(() => { leaseHealthy = false; });
    }, PAYMENT_CONFIRM_LOCK_TTL * 500);
    timer.unref?.();
    try {
      await assertLease();
      return { acquired: true, value: await run(assertLease) };
    } finally {
      clearInterval(timer);
      // A failed cleanup must not undo the committed result; the owner lease expires.
      await bookingService.releasePaymentConfirmLock(orderId, token).catch(() => {});
    }
  }

  private async upsertAsyncPaymentProgressLocked(
    payload: TossWebhookRequestBody,
    paymentStatus: PaymentStatus,
    asyncStatus: string,
    assertLease?: () => Promise<void>,
  ): Promise<string | void> {
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        userId: reservations.userId,
        showtimeId: reservations.showtimeId,
        status: reservations.status,
        totalAmount: reservations.totalAmount,
        providerChargeCurrency: reservations.providerChargeCurrency,
        providerChargeAmountMinor: reservations.providerChargeAmountMinor,
        providerChargeRate: reservations.providerChargeRate,
        providerChargeQuotedAt: reservations.providerChargeQuotedAt,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));

    if (!reservation) {
      throw new NotFoundException('웹훅 대상 예매를 찾을 수 없습니다');
    }

    const existingPayments = await this.db
      .select({
        id: payments.id,
        reservationId: payments.reservationId,
        paymentKey: payments.paymentKey,
        tossOrderId: payments.tossOrderId,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        status: payments.status,
        asyncStatus: payments.asyncStatus,
        paidAt: payments.paidAt,
        cancelReason: payments.cancelReason,
        providerMetadata: payments.providerMetadata,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(
        or(
          eq(payments.tossOrderId, orderId),
          eq(payments.paymentKey, paymentKey),
        ),
      );
    const paymentKeyConflict = existingPayments.find((payment) =>
      payment.paymentKey === paymentKey && payment.reservationId !== reservation.id
    );
    if (paymentKeyConflict) {
      throw new ConflictException('결제 정보가 예매와 일치하지 않습니다');
    }

    const existingPayment = existingPayments.find((payment) =>
      payment.reservationId === reservation.id
    );

    if (
      paymentStatus === 'DONE'
      && existingPayment
      && existingPayment.paymentKey !== paymentKey
      && this.isSettledOrCompensatedPayment(existingPayment, reservation)
    ) {
      // A second provider-verified DONE for the same order can never be issued:
      // the reservation already has its payment. Refund it instead of failing
      // the webhook forever.
      await assertLease?.();
      return await this.compensateDuplicateDonePayment({
        payload,
        reservation,
        existingPayment,
      });
    }

    if (paymentStatus === 'DONE' && (reservation.status === 'CANCELLED'
      || existingPayment?.status === 'CANCELED' || existingPayment?.status === 'PARTIAL_CANCELED')) {
      return 'STALE_PROGRESS_IGNORED';
    }
    const compensationPending = existingPayment?.asyncStatus === 'cancel_pending';
    if (compensationPending && paymentStatus !== 'CANCELED') {
      return 'DONE_CANCEL_PENDING';
    }
    const completesUnissuedCompensation = compensationPending && paymentStatus === 'CANCELED'
      && reservation.status !== 'CONFIRMED';

    const provider = this.resolveWebhookProvider(payload, existingPayment);
    const method = this.resolveWebhookMethod(payload, provider);
    const providerChargeQuote = this.getReservationProviderChargeQuote(reservation);
    const usesProviderChargeQuote =
      (
        this.usesProviderChargeQuote(provider)
        || provider === 'CARD'
      ) && providerChargeQuote !== undefined;
    const storesWebhookAmountAsKrw = this.storesWebhookAmountAsKrw(
      provider,
      providerChargeQuote,
    );
    const amount = storesWebhookAmountAsKrw
      ? reservation.totalAmount
      : payload.data.totalAmount ?? reservation.totalAmount;
    const currency = storesWebhookAmountAsKrw ? 'KRW' : payload.data.currency ?? 'KRW';
    const ledgerCharge = this.toPaymentLedgerCharge(amount, currency, reservation);

    if (
      provider === 'PAYPAL'
      && payload.eventType === 'PAYMENT_STATUS_CHANGED'
      && (paymentStatus === 'IN_PROGRESS' || paymentStatus === 'DONE')
    ) {
      this.assertExistingPaymentIdentityMatchesWebhook({
        existingPayment,
        reservation,
        payload,
      });
      if (paymentStatus === 'DONE') {
        // PayPal is issued by synchronous confirm, but the provider-verified
        // charge must still be the quoted USD amount, never a same-number KRW charge.
        const pendingSeats = await this.getReservationSeatSelections(reservation.id);
        const expectedAmount = this.calculatePayableTotal(pendingSeats);
        if (
          reservation.totalAmount !== expectedAmount
          || !this.providerReportedChargeMatches(payload, usesProviderChargeQuote, providerChargeQuote, expectedAmount)
        ) {
          this.logger.error(
            `PayPal DONE webhook charge does not match the reservation quote. orderId=${orderId}, paymentKey=${paymentKey}, reservationId=${reservation.id}, reservationStatus=${reservation.status}, currency=${payload.data.currency ?? 'unknown'}, totalAmount=${payload.data.totalAmount ?? 'unknown'}`,
          );
          return 'PAYPAL_DONE_AMOUNT_MISMATCH';
        }
      }
      return;
    }

    if (paymentStatus === 'DONE') {
      this.assertExistingPaymentIdentityMatchesWebhook({
        existingPayment,
        reservation,
        payload,
      });

      const pendingSeats = await this.getReservationSeatSelections(reservation.id);
      const expectedAmount = this.calculatePayableTotal(pendingSeats);
      const unsupportedProvider = UNSUPPORTED_TOSS_CHECKOUT_PROVIDERS.has(provider);
      const providerChargeAmountMatches = !unsupportedProvider
        && this.providerReportedChargeMatches(payload, usesProviderChargeQuote, providerChargeQuote, expectedAmount);
      if (reservation.totalAmount !== expectedAmount || !providerChargeAmountMatches) {
        if (this.canCompensateRejectedDone(reservation, existingPayment)) {
          // The PG captured money we will not issue: refund it in full and keep
          // the cancellation recoverable instead of only marking it ABORTED.
          await assertLease?.();
          return await this.compensateAsyncDoneFinalizationFailure({
            failure: unsupportedProvider ? 'unsupported_provider' : 'amount_mismatch',
            payload,
            reservation,
            existingPayment,
            provider,
            method,
            amount,
            asyncStatus,
            providerChargeQuote,
          });
        }
        await this.storeRejectedWebhookPayment({
          payload,
          reservation,
          existingPayment,
          provider,
          method,
          amount,
          asyncStatus: unsupportedProvider ? 'payment_provider_unsupported' : 'payment_amount_mismatch',
          providerChargeQuote,
        });
        throw new BadRequestException('결제 금액이 일치하지 않습니다');
      }

      return await this.finalizeAsyncDonePayment({
        assertLease,
        payload,
        reservation,
        existingPayment,
        pendingSeats,
        provider,
        method,
        asyncStatus,
        providerChargeQuote,
      });
    }

    if (reservation.status === 'CONFIRMED' && ['CANCELED', 'PARTIAL_CANCELED'].includes(paymentStatus)) {
      // The controller may have read PENDING_PAYMENT before DONE committed.
      // Retry so it reloads the confirmed state and uses the full finalizer;
      // acknowledging here would leave a cancelled payment's tickets usable.
      throw new ServiceUnavailableException('발권된 결제 취소를 다시 대조해야 합니다.');
    }
    // All progress events re-read under the same order lease as confirm/DONE.
    // Cancellation of an issued payment belongs to the cancellation finalizer,
    // never this pre-issuance progress path.
    if (reservation.status === 'CONFIRMED' || reservation.status === 'CANCELLED'
      || (existingPayment && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(existingPayment.status)
        && !completesUnissuedCompensation)
      || (existingPayment && ['ABORTED', 'EXPIRED'].includes(existingPayment.status)
        && ['READY', 'IN_PROGRESS'].includes(paymentStatus))
      || (existingPayment?.status === 'IN_PROGRESS' && paymentStatus === 'READY')) {
      return 'STALE_PROGRESS_IGNORED';
    }
    if (existingPayment && existingPayment.paymentKey !== paymentKey) {
      return 'STALE_PAYMENT_KEY_IGNORED';
    }
    await assertLease?.();

    const paidAt = completesUnissuedCompensation ? existingPayment?.paidAt ?? null : null;
    const cancelledAt = paymentStatus === 'CANCELED' && payload.data.canceledAt
      ? new Date(payload.data.canceledAt)
      : null;

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey,
      tossOrderId: orderId,
      method,
      provider,
      currency: ledgerCharge.currency,
      asyncStatus: completesUnissuedCompensation ? 'compensation_cancelled' : asyncStatus,
      amount: ledgerCharge.amount,
      status: paymentStatus,
      paidAt,
      cancelledAt,
      cancelReason: payload.data.cancelReason ?? (completesUnissuedCompensation ? existingPayment?.cancelReason : null) ?? null,
      ...this.toPaymentProviderChargeValues(providerChargeQuote),
    } as const;

    let storedPaymentId = existingPayment?.id ?? null;

    if (existingPayment) {
      await this.db
        .update(payments)
        .set(paymentValues)
        .where(and(eq(payments.id, existingPayment.id), eq(payments.status, existingPayment.status)));
    } else {
      const [insertedPayment] = await this.db
        .insert(payments)
        .values(paymentValues)
        .returning({ id: payments.id });
      storedPaymentId = insertedPayment?.id ?? null;
    }

    const isTerminalFailureStatus =
      paymentStatus === 'CANCELED'
      || paymentStatus === 'ABORTED'
      || paymentStatus === 'EXPIRED';

    if (
      isTerminalFailureStatus
      && (
        reservation.status === 'PENDING_PAYMENT'
        || reservation.status === 'FAILED'
      )
    ) {
      if (reservation.status === 'PENDING_PAYMENT') {
        await this.db
          .update(reservations)
          .set({
            status: 'FAILED',
            updatedAt: new Date(),
          })
          .where(and(eq(reservations.id, reservation.id), eq(reservations.status, 'PENDING_PAYMENT')));
      }

      await recordReservationPaymentFailureDiagnostic(this.db, {
        reservationId: reservation.id,
        paymentId: storedPaymentId,
        tossOrderId: orderId,
        ...paymentTerminalFailureDiagnostic(paymentStatus, paymentValues.cancelReason),
        diagnosticSource: asyncStatus,
      });
    }
  }

  async finalizeConfirmedCancelWebhook(
    payload: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): Promise<'finalized' | 'already_finalized' | 'no_local_match'> {
    if (!this.paymentCancellationFinalizer) {
      throw new InternalServerErrorException('결제 취소 최종화 서비스가 설정되지 않았습니다');
    }

    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        showtimeId: reservations.showtimeId,
        status: reservations.status,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));

    if (!reservation) {
      return 'no_local_match';
    }

    const [payment] = await this.db
      .select({
        id: payments.id,
        reservationId: payments.reservationId,
        paymentKey: payments.paymentKey,
        tossOrderId: payments.tossOrderId,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        status: payments.status,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, reservation.id),
          eq(payments.paymentKey, paymentKey),
          eq(payments.tossOrderId, orderId),
        ),
      );

    if (!payment) {
      return 'no_local_match';
    }

    if (reservation.status === 'CANCELLED') {
      return 'already_finalized';
    }

    if (reservation.status !== 'CONFIRMED') {
      return 'no_local_match';
    }

    const [matchingRefund] = await this.db
      .select({
        id: refunds.id,
        providerMetadata: refunds.providerMetadata,
        requestedAt: refunds.requestedAt,
        sentToPgAt: refunds.sentToPgAt,
        processingAtPgAt: refunds.processingAtPgAt,
      })
      .from(refunds)
      .where(
        and(
          eq(refunds.reservationId, reservation.id),
          eq(refunds.paymentId, payment.id),
          inArray(refunds.status, ['requested', 'sent_to_pg', 'processing_at_pg', 'failed']),
          sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
        ),
      );

    const [showtime] = await this.db
      .select({
        id: showtimes.id,
        performanceId: showtimes.performanceId,
      })
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      return 'no_local_match';
    }

    const [bookingPolicy] = await this.db
      .select({
        cancelledSeatHoldMinMinutes: bookingPolicies.cancelledSeatHoldMinMinutes,
        cancelledSeatHoldMaxMinutes: bookingPolicies.cancelledSeatHoldMaxMinutes,
      })
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const reservationSeatSelections = await this.db
      .select({
        seatId: reservationSeats.seatId,
      })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservation.id));
    const ticketItemCancellation =
      await this.findCancelWebhookTicketItemCancellation(payload, payment.id);
    if (ticketItemCancellation?.status === 'cancelled') {
      // The seat-level command was already finalized (synchronously or by an
      // earlier event); re-applying would rewrite its history and seat state.
      return 'already_finalized';
    }
    const fullReservationCancellationQuote = matchingRefund
      ? readCancellationQuoteFromMetadata(matchingRefund.providerMetadata)
      : null;
    const completedCancels = this.getCompletedProviderCancels(providerResponse);
    if (
      providerResponse.status === 'PARTIAL_CANCELED'
      && !ticketItemCancellation
      && !fullReservationCancellationQuote
    ) {
      return 'no_local_match';
    }
    const reason = this.resolveCancelWebhookReason(payload, providerResponse);
    if (
      matchingRefund
      && fullReservationCancellationQuote
    ) {
      const expectedCancelRequest = readStoredPaymentCancelRequest(matchingRefund.providerMetadata) ?? buildFullReservationPaymentCancelRequest({
        payment,
        cancellationQuote: fullReservationCancellationQuote,
        reason,
        idempotencyKey: `refund-cancel:${matchingRefund.id}`,
        cancelRequestIdSeed: matchingRefund.id,
      });
      if (
        !hasMatchingCompletedProviderCancel(
          completedCancels,
          buildCompletedCancelExpectation(
            expectedCancelRequest.options,
            getRefundCancelRequestAnchor(matchingRefund),
            matchingRefund.providerMetadata,
          ),
        )
      ) {
        return 'no_local_match';
      }
    }
    const finalizerContext = {
      reservation: {
        id: reservation.id,
        showtimeId: reservation.showtimeId,
        reservationNumber: reservation.reservationNumber,
      },
      payment: {
        id: payment.id,
        paymentKey: payment.paymentKey,
        providerMetadata: payment.providerMetadata,
      },
      bookingPolicy: bookingPolicy ?? null,
    };

    if (ticketItemCancellation || matchingRefund) {
      const seats = ticketItemCancellation
        ? [{
            seatId: ticketItemCancellation.seatId,
            floorKey: ticketItemCancellation.floorKey,
            seatKey: ticketItemCancellation.seatKey,
          }]
        : fullReservationCancellationQuote
          ? reservationSeatSelections
          : await this.findUncancelledPaymentSeats(reservation.id, payment.id, reservationSeatSelections);

      await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
        source: 'cancel_webhook',
        ...(matchingRefund ? { refundId: matchingRefund.id } : {}),
        ...(ticketItemCancellation ? { ticketItemCancellation } : {}),
        ...(fullReservationCancellationQuote
          ? { fullReservationCancellationQuote }
          : {}),
        context: { ...finalizerContext, seats },
        reason,
        providerResponse: providerResponse as unknown as Record<string, unknown>,
        actor: { kind: 'system' },
      });

      return 'finalized';
    }

    // No seat-level or refund intent matched this event: the provider has the
    // whole payment cancelled (PAYMENT_STATUS_CHANGED, console cancel, or a last
    // seat whose synchronous finalize did not finish). Finalize each prepared
    // seat command with its own economics first, then only the seats that are
    // still uncancelled; earlier seat cancellations keep their history.
    const preparedCancellations = await this.findPaymentStatusPartialCancelTicketItemCancellations(
      completedCancels,
      payment.id,
      payment.currency === 'KRW' && (payment.providerChargeCurrency ?? 'KRW') === 'KRW' && payment.provider !== 'PAYPAL',
    ) ?? [];
    for (const preparedCancellation of preparedCancellations) {
      await this.finalizeTicketItemCancelWebhook({
        ticketItemCancellation: preparedCancellation,
        context: finalizerContext,
        providerResponse,
      });
    }

    const remainingSeats = await this.findUncancelledPaymentSeats(
      reservation.id,
      payment.id,
      reservationSeatSelections,
    );
    if (preparedCancellations.length > 0 && remainingSeats.length === 0) {
      return 'finalized';
    }

    await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
      source: 'cancel_webhook',
      context: { ...finalizerContext, seats: remainingSeats },
      reason,
      providerResponse: providerResponse as unknown as Record<string, unknown>,
      actor: { kind: 'system' },
    });

    return 'finalized';
  }

  /**
   * Seats a quote-less full cancellation may still release. Seats whose Ticket
   * Item is already cancelled were finalized by their own seat cancellation.
   * Legacy reservations without Ticket Items keep the reservation seat list.
   */
  private async findUncancelledPaymentSeats(
    reservationId: string,
    paymentId: string,
    legacyReservationSeats: Array<{ seatId: string }>,
  ): Promise<Array<{ seatId: string; floorKey?: string | null; seatKey?: string | null }>> {
    const items = await this.db
      .select({
        seatId: ticketItems.seatId,
        floorKey: ticketItems.floorKey,
        seatKey: ticketItems.seatKey,
        status: ticketItems.status,
      })
      .from(ticketItems)
      .where(and(
        eq(ticketItems.reservationId, reservationId),
        eq(ticketItems.paymentId, paymentId),
      ));

    if (items.length === 0) {
      return legacyReservationSeats;
    }

    return items
      .filter((item) => item.status === 'active' || item.status === 'cancellation_pending')
      .map((item) => ({ seatId: item.seatId, floorKey: item.floorKey, seatKey: item.seatKey }));
  }

  private async finalizeTicketItemCancelWebhook(input: {
    ticketItemCancellation: PaymentStatusPartialCancelTicketItemCancellation;
    context: Omit<FullPaymentCancellationContext, 'seats'>;
    providerResponse: TossPaymentResponse;
  }): Promise<void> {
    const { ticketItemCancellation, context, providerResponse } = input;
    await this.paymentCancellationFinalizer!.finalizeFullPaymentCancellation({
      source: 'cancel_webhook',
      ticketItemCancellation: {
        ticketItemId: ticketItemCancellation.ticketItemId,
        cancellationFee: ticketItemCancellation.cancellationFee,
        serviceFeeRefund: ticketItemCancellation.serviceFeeRefund,
        refundableAmount: ticketItemCancellation.refundableAmount,
        cancellationCommand: ticketItemCancellation.cancellationCommand,
      },
      context: {
        ...context,
        seats: [{
          seatId: ticketItemCancellation.seatId,
          floorKey: ticketItemCancellation.floorKey,
          seatKey: ticketItemCancellation.seatKey,
        }],
      },
      reason: ticketItemCancellation.cancelReason ?? 'provider cancellation',
      providerResponse: providerResponse as unknown as Record<string, unknown>,
      actor: { kind: 'system' },
    });
  }

  async finalizePaymentStatusPartialCancelWebhook(
    payload: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): Promise<'finalized' | 'already_finalized' | 'no_local_match'> {
    if (!this.paymentCancellationFinalizer) {
      throw new InternalServerErrorException('결제 취소 최종화 서비스가 설정되지 않았습니다');
    }

    if (
      payload.eventType !== 'PAYMENT_STATUS_CHANGED'
      || providerResponse.status !== 'PARTIAL_CANCELED'
    ) {
      return 'no_local_match';
    }

    const completedCancels = this.getCompletedProviderCancels(providerResponse);
    if (completedCancels.length === 0) {
      return 'no_local_match';
    }

    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        reservationNumber: reservations.reservationNumber,
        showtimeId: reservations.showtimeId,
        status: reservations.status,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));

    if (!reservation) {
      return 'no_local_match';
    }

    if (reservation.status === 'CANCELLED') {
      return 'already_finalized';
    }

    if (reservation.status !== 'CONFIRMED') {
      return 'no_local_match';
    }

    const [payment] = await this.db
      .select({
        id: payments.id,
        reservationId: payments.reservationId,
        paymentKey: payments.paymentKey,
        tossOrderId: payments.tossOrderId,
        method: payments.method,
        provider: payments.provider,
        currency: payments.currency,
        amount: payments.amount,
        status: payments.status,
        providerMetadata: payments.providerMetadata,
        providerChargeCurrency: payments.providerChargeCurrency,
        providerChargeAmountMinor: payments.providerChargeAmountMinor,
      })
      .from(payments)
      .where(
        and(
          eq(payments.reservationId, reservation.id),
          eq(payments.paymentKey, paymentKey),
          eq(payments.tossOrderId, orderId),
        ),
      );

    if (!payment) {
      return 'no_local_match';
    }

    const [showtime] = await this.db
      .select({
        id: showtimes.id,
        performanceId: showtimes.performanceId,
      })
      .from(showtimes)
      .where(eq(showtimes.id, reservation.showtimeId));

    if (!showtime) {
      return 'no_local_match';
    }

    const [bookingPolicy] = await this.db
      .select({
        cancelledSeatHoldMinMinutes: bookingPolicies.cancelledSeatHoldMinMinutes,
        cancelledSeatHoldMaxMinutes: bookingPolicies.cancelledSeatHoldMaxMinutes,
      })
      .from(bookingPolicies)
      .where(eq(bookingPolicies.performanceId, showtime.performanceId));

    const ticketItemCancellations =
      await this.findPaymentStatusPartialCancelTicketItemCancellations(
        completedCancels,
        payment.id,
        payment.currency === 'KRW' && (payment.providerChargeCurrency ?? 'KRW') === 'KRW' && payment.provider !== 'PAYPAL',
      );

    if (!ticketItemCancellations?.length) {
      const [matchingRefund] = await this.db
        .select({
          id: refunds.id,
          providerMetadata: refunds.providerMetadata,
          requestedAt: refunds.requestedAt,
          sentToPgAt: refunds.sentToPgAt,
          processingAtPgAt: refunds.processingAtPgAt,
        })
        .from(refunds)
        .where(
          and(
            eq(refunds.reservationId, reservation.id),
            eq(refunds.paymentId, payment.id),
            inArray(refunds.status, ['requested', 'sent_to_pg', 'processing_at_pg', 'failed']),
          sql`${refunds.providerMetadata}->>'rightsRestoredAt' IS NULL`,
          ),
        );
      const fullReservationCancellationQuote = matchingRefund
        ? readCancellationQuoteFromMetadata(matchingRefund.providerMetadata)
        : null;

      if (fullReservationCancellationQuote) {
        const reason = this.resolveCancelWebhookReason(payload, providerResponse);
        const expectedCancelRequest = readStoredPaymentCancelRequest(matchingRefund.providerMetadata) ?? buildFullReservationPaymentCancelRequest({
          payment,
          cancellationQuote: fullReservationCancellationQuote,
          reason,
          idempotencyKey: `refund-cancel:${matchingRefund.id}`,
          cancelRequestIdSeed: matchingRefund.id,
        });
        if (
          !hasMatchingCompletedProviderCancel(
            completedCancels,
            buildCompletedCancelExpectation(
              expectedCancelRequest.options,
              getRefundCancelRequestAnchor(matchingRefund),
              matchingRefund.providerMetadata,
            ),
          )
        ) {
          return 'no_local_match';
        }

        const reservationSeatSelections = await this.db
          .select({
            seatId: reservationSeats.seatId,
          })
          .from(reservationSeats)
          .where(eq(reservationSeats.reservationId, reservation.id));

        await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
          source: 'cancel_webhook',
          refundId: matchingRefund.id,
          fullReservationCancellationQuote,
          context: {
            reservation: {
              id: reservation.id,
              showtimeId: reservation.showtimeId,
              reservationNumber: reservation.reservationNumber,
            },
            payment: {
              id: payment.id,
              paymentKey: payment.paymentKey,
              providerMetadata: payment.providerMetadata,
            },
            bookingPolicy: bookingPolicy ?? null,
            seats: reservationSeatSelections,
          },
          reason,
          providerResponse: providerResponse as unknown as Record<string, unknown>,
          actor: { kind: 'system' },
        });

        return 'finalized';
      }
      return 'no_local_match';
    }

    for (const ticketItemCancellation of ticketItemCancellations) {
      await this.finalizeTicketItemCancelWebhook({
        ticketItemCancellation,
        context: {
          reservation: {
            id: reservation.id,
            showtimeId: reservation.showtimeId,
            reservationNumber: reservation.reservationNumber,
          },
          payment: {
            id: payment.id,
            paymentKey: payment.paymentKey,
            providerMetadata: payment.providerMetadata,
          },
          bookingPolicy: bookingPolicy ?? null,
        },
        providerResponse,
      });
    }

    return 'finalized';
  }

  private async findCancelWebhookTicketItemCancellation(
    payload: TossWebhookRequestBody,
    paymentId: string,
  ): Promise<{
    ticketItemId: string;
    seatId: string;
    floorKey: string;
    seatKey: string;
    status?: string;
    cancellationFee: number;
    serviceFeeRefund: number;
    refundableAmount: number;
    cancellationCommand?: TicketItemCancellationCommand | null;
  } | null> {
    if (payload.eventType !== 'CANCEL_STATUS_CHANGED') {
      return null;
    }

    const cancelRequestId = payload.data.cancelRequestId?.trim() ?? '';
    const ticketItemId = this.parseGeneratedCancelRequestId(cancelRequestId);
    if (!ticketItemId) {
      return null;
    }

    const storedCommandMatch =
      sql`${ticketItems.cancellationCommand}->'options'->>'cancelRequestId' = ${cancelRequestId}`;
    const [ticketItem] = await this.db
      .select({
        ticketItemId: ticketItems.id,
        seatId: ticketItems.seatId,
        floorKey: ticketItems.floorKey,
        seatKey: ticketItems.seatKey,
        status: ticketItems.status,
        cancellationFee: ticketItems.cancellationFee,
        serviceFeeRefund: ticketItems.serviceFeeRefund,
        refundableAmount: ticketItems.refundableAmount,
        cancellationCommand: ticketItems.cancellationCommand,
      })
      .from(ticketItems)
      .where(
        and(
          UUID_PATTERN.test(ticketItemId)
            ? or(eq(ticketItems.id, ticketItemId), storedCommandMatch)
            : storedCommandMatch,
          eq(ticketItems.paymentId, paymentId),
        ),
      );

    return ticketItem ?? null;
  }

  private getCompletedProviderCancels(
    providerResponse: TossPaymentResponse,
  ): TossPaymentCancelRecord[] {
    return getCompletedProviderCancels(providerResponse);
  }

  private async findPaymentStatusPartialCancelTicketItemCancellations(
    completedCancels: readonly TossPaymentCancelRecord[],
    paymentId: string,
    allowLegacyKrwAmountMatch: boolean,
  ): Promise<PaymentStatusPartialCancelTicketItemCancellation[] | null> {
    const ticketItemCancellations: PaymentStatusPartialCancelTicketItemCancellation[] = [];
    const matchedTicketItemIds = new Set<string>();
    const matchedProviderCancels = new Set<TossPaymentCancelRecord>();

    const preparedCommands = await this.db.select({
      ticketItemId: ticketItems.id, seatId: ticketItems.seatId, floorKey: ticketItems.floorKey,
      seatKey: ticketItems.seatKey, cancellationFee: ticketItems.cancellationFee,
      serviceFeeRefund: ticketItems.serviceFeeRefund, refundableAmount: ticketItems.refundableAmount,
      cancellationCommand: ticketItems.cancellationCommand, cancelReason: ticketItems.cancelReason,
    }).from(ticketItems).where(and(eq(ticketItems.paymentId, paymentId),
      eq(ticketItems.status, 'cancellation_pending'), sql`${ticketItems.cancellationCommand} IS NOT NULL`));
    for (const item of preparedCommands) {
      const command = item.cancellationCommand;
      if (!command) continue;
      const matches = completedCancels.filter((cancel) => cancel.cancelReason === command.reason
        && Math.round(cancel.cancelAmount * (command.currency === 'USD' ? 100 : 1)) === command.amountMinor
        && (!command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId));
      if (matches.length > 1) return null;
      if (matches.length === 1) {
        ticketItemCancellations.push({ ...item, cancelReason: item.cancelReason ?? 'Ticket cancellation' });
        matchedTicketItemIds.add(item.ticketItemId);
        matchedProviderCancels.add(matches[0]!);
      }
    }

    for (const cancel of completedCancels) {
      if (matchedProviderCancels.has(cancel)) continue;
      const ticketItemId = typeof cancel.cancelRequestId === 'string'
        ? this.parseGeneratedCancelRequestId(cancel.cancelRequestId)
        : null;

      if (!ticketItemId) {
        continue;
      }

      const [ticketItem] = await this.db
        .select({
          ticketItemId: ticketItems.id,
          seatId: ticketItems.seatId,
          floorKey: ticketItems.floorKey,
          seatKey: ticketItems.seatKey,
          status: ticketItems.status,
          cancellationFee: ticketItems.cancellationFee,
          serviceFeeRefund: ticketItems.serviceFeeRefund,
          refundableAmount: ticketItems.refundableAmount,
        })
        .from(ticketItems)
        .where(
          and(
            eq(ticketItems.id, ticketItemId),
            eq(ticketItems.paymentId, paymentId),
            eq(ticketItems.status, 'cancellation_pending'),
          ),
        );

      if (ticketItem?.status === 'cancellation_pending') {
        if (matchedTicketItemIds.has(ticketItem.ticketItemId)) {
          continue;
        }

        ticketItemCancellations.push({
          ...ticketItem,
          cancelReason: cancel.cancelReason,
        });
        matchedTicketItemIds.add(ticketItem.ticketItemId);
      }
    }

    for (const cancel of completedCancels) {
      if (matchedProviderCancels.has(cancel)) continue;
      // The legacy fallback compares an integer KRW ledger, never a provider USD amount.
      if (!allowLegacyKrwAmountMatch || !Number.isSafeInteger(cancel.cancelAmount)) continue;
      if (typeof cancel.cancelRequestId === 'string' && cancel.cancelRequestId.trim()) {
        continue;
      }

      if (
        typeof cancel.cancelReason !== 'string'
        || !cancel.cancelReason.trim()
      ) {
        continue;
      }

      const providerCompletedMatchingCount = completedCancels.filter((candidate) =>
        candidate.cancelAmount === cancel.cancelAmount
        && candidate.cancelReason === cancel.cancelReason
      ).length;
      const localCancelledTicketItems = await this.db
        .select({
          ticketItemId: ticketItems.id,
        })
        .from(ticketItems)
        .where(
          and(
            eq(ticketItems.paymentId, paymentId),
            eq(ticketItems.status, 'cancelled'),
            eq(ticketItems.refundableAmount, cancel.cancelAmount),
            eq(ticketItems.cancelReason, cancel.cancelReason),
            isNull(ticketItems.cancellationCommand),
          ),
        );

      if (localCancelledTicketItems.length >= providerCompletedMatchingCount) {
        continue;
      }

      const matchingTicketItems = await this.db
        .select({
          ticketItemId: ticketItems.id,
          seatId: ticketItems.seatId,
          floorKey: ticketItems.floorKey,
          seatKey: ticketItems.seatKey,
          cancellationFee: ticketItems.cancellationFee,
          serviceFeeRefund: ticketItems.serviceFeeRefund,
          refundableAmount: ticketItems.refundableAmount,
        })
        .from(ticketItems)
        .where(
          and(
            eq(ticketItems.paymentId, paymentId),
            eq(ticketItems.status, 'cancellation_pending'),
            eq(ticketItems.refundableAmount, cancel.cancelAmount),
            eq(ticketItems.cancelReason, cancel.cancelReason),
            isNull(ticketItems.cancellationCommand),
          ),
        );

      if (matchingTicketItems.length === 1) {
        const matchingTicketItem = matchingTicketItems[0]!;
        if (matchedTicketItemIds.has(matchingTicketItem.ticketItemId)) {
          continue;
        }

        ticketItemCancellations.push({
          ...matchingTicketItem,
          cancelReason: cancel.cancelReason,
        });
        matchedTicketItemIds.add(matchingTicketItem.ticketItemId);
        continue;
      }

      if (matchingTicketItems.length > 1) {
        return null;
      }
    }

    return ticketItemCancellations;
  }

  private resolveCancelWebhookReason(
    payload: TossWebhookRequestBody,
    providerResponse: TossPaymentResponse,
  ): string {
    const cancels = providerResponse.cancels;
    const latestCancel = Array.isArray(cancels) ? cancels.at(-1) : null;
    if (
      latestCancel
      && typeof latestCancel === 'object'
      && !Array.isArray(latestCancel)
      && typeof (latestCancel as { cancelReason?: unknown }).cancelReason === 'string'
    ) {
      return (latestCancel as { cancelReason: string }).cancelReason;
    }

    return payload.data.cancelReason ?? 'provider cancellation';
  }

  private async finalizeAsyncDonePayment(input: {
    assertLease?: () => Promise<void>;
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    pendingSeats: WebhookSeatSelection[];
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    asyncStatus: string;
    providerChargeQuote?: ProviderChargeQuote;
  }): Promise<string> {
    const {
      payload,
      reservation,
      existingPayment,
      pendingSeats,
      provider,
      method,
      asyncStatus,
      providerChargeQuote,
    } = input;

    if (
      reservation.status !== 'PENDING_PAYMENT'
      && reservation.status !== 'CONFIRMED'
      && !this.canRecoverLateDoneReservation(reservation, existingPayment, payload)
    ) {
      throw new ConflictException('결제 완료 처리 대상 예매 상태가 아닙니다');
    }

    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const recoveredPaymentKey = this.hasRecoveredPaymentKey(existingPayment, payload);
    this.assertExistingPaymentMatchesWebhook({
      existingPayment,
      reservation,
      payload,
    });

    if (
      existingPayment
      && reservation.status === 'CONFIRMED'
      && existingPayment.status === 'DONE'
    ) {
      if (this.qrTicketService) {
        await this.qrTicketService.ensureIssuedTicketsForReservation({
          reservationId: reservation.id,
          paymentId: existingPayment.id,
        });
      }
      return 'DONE_APPLIED';
    }

    const paidAt = payload.data.approvedAt
      ? new Date(payload.data.approvedAt)
      : new Date();
    let committedPaymentId = existingPayment?.id ?? null;
    await input.assertLease?.();
    const recoverySeatLock = await this.acquireLateRecoverySeatLocksIfNeeded({
      payload,
      reservation,
      existingPayment,
      pendingSeats,
    });

    if (recoverySeatLock.acquired === false) {
      await input.assertLease?.();
      return await this.compensateAsyncDoneFinalizationFailure({
        payload,
        reservation,
        existingPayment,
        provider,
        method,
        amount: reservation.totalAmount,
        asyncStatus,
        providerChargeQuote,
      });
    }

    try {
      await this.db.transaction(async (tx) => {
        const limit = await getTicketLimitSnapshot(tx, reservation.userId, reservation.id, reservation.showtimeId);
        await lockTicketLimitScope(tx, reservation.userId, limit.performanceId);
        const lockedLimit = await getTicketLimitSnapshot(tx, reservation.userId, reservation.id, reservation.showtimeId);
        if (lockedLimit.activeTicketCount + pendingSeats.length > lockedLimit.maxTicketsPerUser) {
          throw new ConflictException(buildMaxTicketsPerUserExceededMessage(lockedLimit.maxTicketsPerUser));
        }

        await tx
          .update(reservations)
          .set({
            status: 'CONFIRMED',
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, reservation.id));

        const paymentValues = {
          reservationId: reservation.id,
          paymentKey,
          tossOrderId: orderId,
          method,
          provider,
          currency: this.storesWebhookAmountAsKrw(provider, providerChargeQuote)
            ? 'KRW'
            : payload.data.currency ?? 'KRW',
          asyncStatus,
          amount: reservation.totalAmount,
          status: 'DONE' as const,
          paidAt,
          cancelledAt: null,
          cancelReason: null,
          ...this.toPaymentProviderChargeValues(providerChargeQuote),
          ...this.toRecoveredPaymentProviderMetadataValues(existingPayment, payload),
        };

        if (existingPayment) {
          await tx
            .update(payments)
            .set(paymentValues)
            .where(eq(payments.id, existingPayment.id));
        } else {
          const insertedPayments = await tx
            .insert(payments)
            .values(paymentValues)
            .returning({ id: payments.id });

          committedPaymentId = insertedPayments[0]?.id ?? null;
        }

        if (!committedPaymentId) {
          throw new InternalServerErrorException('결제 정보 저장에 실패했습니다');
        }
        const ticketItemPaymentId = committedPaymentId;

        try {
          const insertedTicketItems = await tx.insert(ticketItems).values(
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
          ).returning({ id: ticketItems.id, tierName: ticketItems.tierName });
          await syncIncludedBenefitEntitlementsForTicketItems(
            tx, reservation.showtimeId, insertedTicketItems, new Date(),
          );
        } catch (error) {
          if (isActiveSeatUniqueViolation(error)) {
            throw new ConflictException('판매 불가능한 좌석입니다');
          }
          throw error;
        }

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
        await input.assertLease?.();
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        await input.assertLease?.();
        return await this.compensateAsyncDoneFinalizationFailure({
          failure: error.message.includes('1인 최대') ? 'ticket_limit' : 'seat_conflict',
          payload,
          reservation,
          existingPayment,
          provider,
          method,
          amount: reservation.totalAmount,
          asyncStatus,
          providerChargeQuote,
        });
      }
      throw error;
    } finally {
      if (recoverySeatLock.shouldRelease) {
        await this.releaseLateRecoverySeatLocks(recoverySeatLock);
      }
    }

    for (const seat of pendingSeats) {
      this.bookingGateway?.broadcastSeatUpdate(
        reservation.showtimeId,
        seat.seatKey,
        'sold',
        reservation.userId,
      );
    }

    if (this.qrTicketService && committedPaymentId) {
      await this.qrTicketService.ensureIssuedTicketsForReservation({
        reservationId: reservation.id,
        paymentId: committedPaymentId,
      });
    }

    return recoveredPaymentKey ? 'DONE_RECOVERED_PAYMENT_KEY' : 'DONE_APPLIED';
  }

  private async acquireLateRecoverySeatLocksIfNeeded(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    pendingSeats: WebhookSeatSelection[];
  }): Promise<{
    acquired: boolean;
    shouldRelease: boolean;
    showtimeId: string;
    seatKeys: string[];
    ownerToken: string;
  }> {
    const { payload, reservation, existingPayment, pendingSeats } = input;
    const seatKeys = pendingSeats.map((seat) => seat.seatKey);
    // Reservation-scoped so a crashed earlier attempt for the same order (any
    // event id) cannot be mistaken for another buyer within its short TTL.
    const ownerToken = `payment-recovery:${reservation.id}`;
    const held = (recoverySeatKeys: string[]) => ({
      acquired: true,
      shouldRelease: recoverySeatKeys.length > 0,
      showtimeId: reservation.showtimeId,
      seatKeys: recoverySeatKeys,
      ownerToken,
    });
    const lost = {
      acquired: false,
      shouldRelease: false,
      showtimeId: reservation.showtimeId,
      seatKeys: [],
      ownerToken,
    };

    if (
      !this.bookingService
      || seatKeys.length === 0
      || (
        reservation.status !== 'PENDING_PAYMENT'
        && !this.canRecoverLateDoneReservation(reservation, existingPayment, payload)
      )
    ) {
      return held([]);
    }

    // A PENDING_PAYMENT row outlives its Redis checkout locks (15-minute cap), so
    // a late DONE must prove the seats are still this buyer's or free before it
    // takes them from someone who legitimately re-locked them.
    // A FAILED reservation's checkout is over: a live lock of the same buyer
    // belongs to a newer checkout, so it only recovers seats nobody holds.
    const ownsCheckoutLocks = reservation.status === 'PENDING_PAYMENT';
    if (ownsCheckoutLocks) {
      const ownLocks = await this.tryHoldBuyerSeatLocks(reservation, seatKeys);
      if (ownLocks === 'held') {
        return held([]);
      }
      if (ownLocks === 'unavailable') {
        return lost;
      }
    }

    const recovered = await this.bookingService.acquireRecoverySeatLocks(
      reservation.showtimeId,
      seatKeys,
      ownerToken,
    );
    if (recovered.acquired) {
      return held(seatKeys);
    }
    if (!ownsCheckoutLocks) {
      return lost;
    }

    // Recovery fails when any seat has another owner. That owner may still be
    // this buyer for a subset whose lock has not expired yet.
    const ownedSeatKeys = new Set(
      (await this.bookingService.getMyLocks(reservation.userId, reservation.showtimeId)).seatIds
        .map((seatId) => normalizeSeatIdentity({ seatId }).seatKey),
    );
    const buyerSeatKeys = seatKeys.filter((seatKey) => ownedSeatKeys.has(seatKey));
    if (buyerSeatKeys.length === 0) {
      return lost;
    }

    const partialOwnLocks = await this.tryHoldBuyerSeatLocks(reservation, buyerSeatKeys);
    if (partialOwnLocks === 'unavailable') {
      return lost;
    }
    if (partialOwnLocks === 'lost') {
      throw new ServiceUnavailableException('좌석 잠금 상태를 다시 확인해야 합니다.');
    }

    const freeSeatKeys = seatKeys.filter((seatKey) => !ownedSeatKeys.has(seatKey));
    const partialRecovery = await this.bookingService.acquireRecoverySeatLocks(
      reservation.showtimeId,
      freeSeatKeys,
      ownerToken,
    );
    return partialRecovery.acquired ? held(freeSeatKeys) : lost;
  }

  /**
   * Extends the buyer's own checkout locks through the commit window.
   * `lost` means at least one lock expired or has another owner;
   * `unavailable` means the seat is already sold, held for a refund or disabled.
   */
  private async tryHoldBuyerSeatLocks(
    reservation: WebhookReservationSnapshot,
    seatKeys: string[],
  ): Promise<'held' | 'lost' | 'unavailable'> {
    try {
      await this.bookingService!.extendOwnedSeatLocks(
        reservation.userId,
        reservation.showtimeId,
        seatKeys,
        RECOVERY_SEAT_LOCK_TTL,
      );
      return 'held';
    } catch (error) {
      if (
        error instanceof ConflictException
        && (error.message === LOCK_EXPIRED_MESSAGE || error.message === LOCK_OTHER_OWNER_MESSAGE)
      ) {
        return 'lost';
      }
      if (error instanceof ConflictException) {
        return 'unavailable';
      }
      throw error;
    }
  }

  private async releaseLateRecoverySeatLocks(lock: {
    showtimeId: string;
    seatKeys: string[];
    ownerToken: string;
  }): Promise<void> {
    try {
      await this.bookingService?.releaseRecoverySeatLocks(
        lock.showtimeId,
        lock.seatKeys,
        lock.ownerToken,
      );
    } catch {
      // Recovery locks are short-lived and only protect the DB commit window.
    }
  }

  private assertExistingPaymentMatchesWebhook(input: {
    existingPayment?: WebhookPaymentSnapshot;
    reservation: WebhookReservationSnapshot;
    payload: TossWebhookRequestBody;
  }): void {
    this.assertExistingPaymentIdentityMatchesWebhook(input);

    const { existingPayment, reservation } = input;

    if (!existingPayment) {
      return;
    }

    if (existingPayment.amount !== reservation.totalAmount) {
      throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
    }
  }

  private assertExistingPaymentIdentityMatchesWebhook(input: {
    existingPayment?: WebhookPaymentSnapshot;
    reservation: WebhookReservationSnapshot;
    payload: TossWebhookRequestBody;
  }): void {
    const { existingPayment, reservation, payload } = input;
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);

    if (!existingPayment) {
      return;
    }

    if (existingPayment.reservationId !== reservation.id) {
      throw new ConflictException('결제 정보가 예매와 일치하지 않습니다');
    }

    if (
      existingPayment.paymentKey !== paymentKey
      || existingPayment.tossOrderId !== orderId
    ) {
      if (this.canRecoverAlipayPaymentKeyMismatch({
        existingPayment,
        reservation,
        payload,
      })) {
        return;
      }

      throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
    }
  }

  /**
   * The reservation's payment row already represents an accepted, cancelled or
   * compensated charge, so another paymentKey for the same order is a duplicate.
   */
  private isSettledOrCompensatedPayment(
    existingPayment: WebhookPaymentSnapshot,
    reservation: WebhookReservationSnapshot,
  ): boolean {
    return isSettledOrCompensatedPaymentState({
      reservationStatus: reservation.status,
      paymentStatus: existingPayment.status,
      paymentAsyncStatus: existingPayment.asyncStatus,
    });
  }

  /** A rejected DONE is refunded unless the reservation already accepted a payment. */
  private canCompensateRejectedDone(
    reservation: WebhookReservationSnapshot,
    existingPayment: WebhookPaymentSnapshot | undefined,
  ): boolean {
    return !!this.tossClient
      && reservation.status !== 'CONFIRMED'
      && reservation.status !== 'CANCELLED'
      && !(
        existingPayment
        && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(existingPayment.status)
      );
  }

  /**
   * Compares the provider-verified charge, including its currency, with what
   * the reservation expects. A quoted USD charge must be reported in USD;
   * otherwise a same-number KRW charge would satisfy the USD minor amount.
   */
  private providerReportedChargeMatches(
    payload: TossWebhookRequestBody,
    usesProviderChargeQuote: boolean,
    providerChargeQuote: ProviderChargeQuote | undefined,
    expectedAmount: number,
  ): boolean {
    const currency = this.normalizeProviderCurrency(payload.data.currency);
    if (usesProviderChargeQuote) {
      return providerChargeQuote !== undefined
        && currency === 'USD'
        && this.toProviderAmountMinor(payload.data.totalAmount) === providerChargeQuote.amountMinor;
    }

    return (currency === undefined || currency === 'KRW')
      && payload.data.totalAmount === expectedAmount;
  }

  /** Toss reports overseas multi-currency USD as `MUSD` on webhook payloads. */
  private normalizeProviderCurrency(currency: string | undefined): string | undefined {
    const normalized = currency?.trim().toUpperCase();
    if (!normalized) {
      return undefined;
    }

    return normalized === 'MUSD' ? 'USD' : normalized;
  }

  private assertSupportedTossCheckoutProvider(paymentMethod: PaymentMethod): void {
    if (UNSUPPORTED_TOSS_CHECKOUT_PROVIDERS.has(paymentMethod.provider)) {
      throw new BadRequestException('현재 지원하지 않는 결제수단입니다. 다른 결제수단을 선택해주세요.');
    }
  }

  private canRecoverLateDoneReservation(
    reservation: WebhookReservationSnapshot,
    existingPayment: WebhookPaymentSnapshot | undefined,
    payload: TossWebhookRequestBody,
  ): boolean {
    return reservation.status === 'FAILED'
      && payload.eventType === 'PAYMENT_STATUS_CHANGED'
      && payload.data.status === 'DONE'
      && this.isAlipayLikePayment(payload, existingPayment);
  }

  private canRecoverAlipayPaymentKeyMismatch(input: {
    existingPayment: WebhookPaymentSnapshot;
    reservation: WebhookReservationSnapshot;
    payload: TossWebhookRequestBody;
  }): boolean {
    const { existingPayment, payload } = input;
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);

    if (existingPayment.tossOrderId !== orderId) {
      return false;
    }

    if (existingPayment.paymentKey === paymentKey) {
      return true;
    }

    if (
      payload.eventType !== 'PAYMENT_STATUS_CHANGED'
      || payload.data.status !== 'DONE'
      || !this.isAlipayLikePayment(payload, existingPayment)
    ) {
      return false;
    }

    return existingPayment.status !== 'DONE'
      && existingPayment.status !== 'CANCELED';
  }

  private hasRecoveredPaymentKey(
    existingPayment: WebhookPaymentSnapshot | undefined,
    payload: TossWebhookRequestBody,
  ): boolean {
    return !!existingPayment
      && existingPayment.paymentKey !== this.requireWebhookPaymentKey(payload);
  }

  private isAlipayLikePayment(
    payload: TossWebhookRequestBody,
    existingPayment?: Pick<WebhookPaymentSnapshot, 'provider' | 'method'>,
  ): boolean {
    const provider = payload.data.provider?.trim().toUpperCase();
    const easyPay = payload.data.easyPay?.trim().toUpperCase();
    const existingProvider = existingPayment?.provider?.trim().toUpperCase();

    return provider === 'ALIPAY'
      || provider === 'ALIPAY_PLUS'
      || easyPay === 'ALIPAY'
      || easyPay === '알리페이'
      || (
        this.isForeignEasyPayMethod(payload.data.method)
        && (existingProvider === 'ALIPAY' || existingProvider === 'ALIPAY_PLUS')
      );
  }

  private toRecoveredPaymentProviderMetadataValues(
    existingPayment: WebhookPaymentSnapshot | undefined,
    payload: TossWebhookRequestBody,
  ): { providerMetadata?: Record<string, unknown> } {
    if (!existingPayment) {
      return {};
    }

    const paymentKey = this.requireWebhookPaymentKey(payload);
    if (existingPayment.paymentKey === paymentKey) {
      return {};
    }

    return {
      providerMetadata: {
        ...this.toProviderMetadataRecord(existingPayment.providerMetadata),
        paymentKeyRecovery: {
          previousPaymentKey: existingPayment.paymentKey,
          recoveredPaymentKey: paymentKey,
          eventId: payload.eventId,
          recoveredAt: new Date().toISOString(),
        },
      },
    };
  }

  private toProviderMetadataRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private async getReservationSeatSelections(
    reservationId: string,
  ): Promise<WebhookSeatSelection[]> {
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

    return rows.map((row) => this.normalizeReservationSeatIdentity(row));
  }

  private normalizeReservationSeatIdentity(row: {
    seatId: string;
    tierName: string;
    price: number;
    row: string;
    number: string;
  }): WebhookSeatSelection {
    const { seatId } = row;
    if (seatId.includes(':')) {
      const separatorIndex = seatId.indexOf(':');
      const floorKey = seatId.slice(0, separatorIndex) || '1F';
      const rawSeatId = seatId.slice(separatorIndex + 1);

      return {
        floorKey,
        floorLabel: floorKey === '1F' ? '1층' : floorKey,
        seatId: rawSeatId,
        seatKey: `${floorKey}:${rawSeatId}`,
        tierName: row.tierName,
        row: row.row,
        number: row.number,
        price: row.price,
      };
    }

    return {
      floorKey: '1F',
      floorLabel: '1층',
      seatId,
      seatKey: `1F:${seatId}`,
      tierName: row.tierName,
      row: row.row,
      number: row.number,
      price: row.price,
    };
  }

  private calculatePayableTotal(seats: WebhookSeatSelection[]): number {
    const seatTotal = seats.reduce((total, seat) => total + seat.price, 0);
    return seatTotal + seats.length * TICKET_SERVICE_FEE_KRW;
  }

  private async storeRejectedWebhookPayment(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    amount: number;
    asyncStatus: string;
    providerChargeQuote?: ProviderChargeQuote;
  }): Promise<void> {
    const {
      payload,
      reservation,
      existingPayment,
      provider,
      method,
      amount,
      asyncStatus,
      providerChargeQuote,
    } = input;
    // Invalid callback data must not rewrite a previously accepted payment.
    if (reservation.status === 'CONFIRMED' || reservation.status === 'CANCELLED'
      || (existingPayment && ['DONE', 'PARTIAL_CANCELED', 'CANCELED'].includes(existingPayment.status))) {
      return;
    }
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const ledgerCharge = this.toPaymentLedgerCharge(
      amount,
      this.storesWebhookAmountAsKrw(provider, providerChargeQuote)
        ? 'KRW'
        : payload.data.currency ?? 'KRW',
      reservation,
    );

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey,
      tossOrderId: orderId,
      method,
      provider,
      currency: ledgerCharge.currency,
      asyncStatus,
      amount: ledgerCharge.amount,
      status: 'ABORTED' as const,
      paidAt: null,
      cancelledAt: null,
      cancelReason: '결제 금액 불일치',
      ...this.toPaymentProviderChargeValues(providerChargeQuote),
    };

    if (existingPayment) {
      await this.db
        .update(payments)
        .set(paymentValues)
        .where(eq(payments.id, existingPayment.id));
      return;
    }

    await this.db.insert(payments).values(paymentValues);
  }

  private async compensateAsyncDoneFinalizationFailure(input: {
    failure?: Exclude<AsyncDoneCompensationKind, 'duplicate_payment_key'>;
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    amount: number;
    asyncStatus: string;
    providerChargeQuote?: ProviderChargeQuote;
  }): Promise<string> {
    const {
      payload,
      reservation,
      existingPayment,
      provider,
      method,
      amount,
      asyncStatus,
      providerChargeQuote,
    } = input;
    const failure = input.failure ?? 'seat_conflict';
    const reason = ASYNC_DONE_COMPENSATION_REASONS[failure];
    if (!this.tossClient) {
      throw new ConflictException('판매 불가능한 좌석입니다');
    }

    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    // The record keeps the provider-reported charge; the row keeps the KRW ledger.
    const currency = this.storesWebhookAmountAsKrw(provider, providerChargeQuote)
      ? 'KRW'
      : payload.data.currency ?? 'KRW';
    const ledgerCharge = this.toPaymentLedgerCharge(amount, currency, reservation);
    const scopeMetadata = this.resolveWebhookPaymentScopeMetadata(payload, provider);
    const paymentSnapshot: PaymentCancelPaymentSnapshot = {
      id: existingPayment?.id,
      paymentKey,
      method,
      provider,
      currency,
      amount,
      providerChargeCurrency: providerChargeQuote?.currency,
      providerChargeAmountMinor: providerChargeQuote?.amountMinor,
      ...(scopeMetadata ? { providerMetadata: scopeMetadata } : {}),
    };
    const cancelCommand = buildFullPaymentCancelRequest({
      payment: paymentSnapshot,
      reason,
      idempotencyKey: this.buildCompensationIdempotencyKey(failure, payload),
      cancelRequestIdSeed: reservation.id,
    });
    const outcome = await this.sendCompensationCancel(cancelCommand);
    const now = new Date();
    const record = buildCompensationRecord({
      kind: failure,
      paymentKey,
      reason,
      payment: paymentSnapshot,
      cancelCommand,
      outcome,
      now,
    });
    const terminalCancelCompleted = outcome.state === 'cancelled';
    const rejectedCharge = failure === 'amount_mismatch' || failure === 'unsupported_provider';

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey,
      tossOrderId: orderId,
      method,
      provider,
      currency: ledgerCharge.currency,
      asyncStatus: terminalCancelCompleted
        ? rejectedCharge ? 'compensation_cancelled' : asyncStatus
        : 'cancel_pending',
      amount: ledgerCharge.amount,
      status: terminalCancelCompleted ? 'CANCELED' as const : 'DONE' as const,
      paidAt: payload.data.approvedAt ? new Date(payload.data.approvedAt) : now,
      cancelledAt: terminalCancelCompleted ? now : null,
      cancelReason: reason,
      ...this.toPaymentProviderChargeValues(providerChargeQuote),
      providerMetadata: {
        ...this.toProviderMetadataRecord(existingPayment?.providerMetadata),
        ...(this.toRecoveredPaymentProviderMetadataValues(existingPayment, payload).providerMetadata ?? {}),
        ...(scopeMetadata ?? {}),
        [ASYNC_DONE_COMPENSATION_METADATA_KEY]: record,
        [ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY]: isOpenCompensationState(record.state),
      },
    };

    let storedPaymentId = existingPayment?.id ?? null;

    if (existingPayment) {
      await this.db
        .update(payments)
        .set(paymentValues)
        .where(eq(payments.id, existingPayment.id));
    } else {
      const [insertedPayment] = await this.db
        .insert(payments)
        .values(paymentValues)
        .returning({ id: payments.id });
      storedPaymentId = insertedPayment?.id ?? null;
    }

    if (terminalCancelCompleted && reservation.status !== 'CONFIRMED') {
      await this.db
        .update(reservations)
        .set({
          status: 'FAILED',
          updatedAt: now,
        })
        .where(eq(reservations.id, reservation.id));

      await recordReservationPaymentFailureDiagnostic(this.db, {
        reservationId: reservation.id,
        paymentId: storedPaymentId,
        tossOrderId: orderId,
        diagnosticKind: 'payment_compensated_cancel',
        diagnosticCode: ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES[failure],
        diagnosticMessage: reason,
        diagnosticSource: asyncStatus,
      });
    }

    if (outcome.state === 'error') {
      this.logger.error(
        `Async DONE compensation cancel request failed; recovery sweep will retry. orderId=${orderId}, paymentKey=${paymentKey}, kind=${failure}, error=${outcome.error}`,
      );
    }

    if (!terminalCancelCompleted) {
      return 'DONE_CANCEL_PENDING';
    }

    switch (failure) {
      case 'ticket_limit':
        return 'DONE_COMPENSATED_TICKET_LIMIT';
      case 'amount_mismatch':
        return 'DONE_COMPENSATED_AMOUNT_MISMATCH';
      case 'unsupported_provider':
        return 'DONE_COMPENSATED_UNSUPPORTED_PROVIDER';
      default:
        return 'DONE_COMPENSATED_SEAT_CONFLICT';
    }
  }

  /**
   * Refunds a second provider-verified DONE for an order whose reservation
   * already has a settled or compensated payment row. The duplicate charge has
   * no row of its own, so its cancellation is tracked on the existing row.
   */
  private async compensateDuplicateDonePayment(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment: WebhookPaymentSnapshot;
  }): Promise<'DONE_DUPLICATE_PAYMENT_COMPENSATED' | 'DONE_DUPLICATE_PAYMENT_CANCEL_PENDING'> {
    const { payload, reservation, existingPayment } = input;
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const records = readDuplicatePaymentCompensations(existingPayment.providerMetadata);
    const previous = records.find((record) => record.paymentKey === paymentKey);

    this.logger.error(
      `Duplicate DONE payment for an already settled order. orderId=${orderId}, reservationId=${reservation.id}, reservationStatus=${reservation.status}, settledPaymentKey=${existingPayment.paymentKey}, duplicatePaymentKey=${paymentKey}, compensationState=${previous?.state ?? 'new'}`,
    );

    if (previous && previous.state !== 'error') {
      return previous.state === 'cancelled'
        ? 'DONE_DUPLICATE_PAYMENT_COMPENSATED'
        : 'DONE_DUPLICATE_PAYMENT_CANCEL_PENDING';
    }

    if (!this.tossClient) {
      throw new ServiceUnavailableException('중복 결제 취소를 처리할 수 없습니다.');
    }

    const provider = this.resolveWebhookProvider(payload, existingPayment);
    const method = this.resolveWebhookMethod(payload, provider);
    const scopeMetadata = this.resolveWebhookPaymentScopeMetadata(payload, provider);
    const reason = ASYNC_DONE_COMPENSATION_REASONS.duplicate_payment_key;
    const paymentSnapshot: PaymentCancelPaymentSnapshot = {
      paymentKey,
      method,
      provider,
      currency: payload.data.currency ?? 'KRW',
      amount: payload.data.totalAmount ?? existingPayment.amount,
      ...(scopeMetadata ? { providerMetadata: scopeMetadata } : {}),
    };
    // A previous request with an unknown outcome is resent with the same
    // idempotency key so the PG can return its original result.
    const cancelCommand = previous?.cancelRequest ?? buildFullPaymentCancelRequest({
      payment: paymentSnapshot,
      reason,
      idempotencyKey: `async-done-duplicate-cancel:${orderId}:${paymentKey}`,
      cancelRequestIdSeed: buildDuplicateCancelRequestSeed(paymentKey),
    });
    const outcome = await this.sendCompensationCancel(cancelCommand);
    const record = buildCompensationRecord({
      kind: 'duplicate_payment_key',
      paymentKey,
      reason,
      payment: paymentSnapshot,
      cancelCommand,
      outcome,
      now: new Date(),
      previous,
    });
    const nextRecords = [
      ...records.filter((candidate) => candidate.paymentKey !== paymentKey),
      record,
    ];
    await this.db
      .update(payments)
      .set({
        providerMetadata: this.mergeProviderMetadataSql({
          [DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY]: nextRecords,
          ...(isOpenCompensationState(record.state)
            ? { [ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY]: true }
            : {}),
        }),
      })
      .where(eq(payments.id, existingPayment.id));

    if (outcome.state === 'error') {
      this.logger.error(
        `Duplicate DONE compensation cancel request failed; recovery sweep will retry. orderId=${orderId}, duplicatePaymentKey=${paymentKey}, error=${outcome.error}`,
      );
    }

    return outcome.state === 'cancelled'
      ? 'DONE_DUPLICATE_PAYMENT_COMPENSATED'
      : 'DONE_DUPLICATE_PAYMENT_CANCEL_PENDING';
  }

  /**
   * CANCEL_STATUS_CHANGED ABORTED for a compensation cancel: the captured
   * money is still at the PG. Keep the payment unissuable (`cancel_pending`),
   * make the abort visible, and let the recovery sweep re-request the cancel.
   */
  async recordCompensationCancelAborted(
    payload: TossWebhookRequestBody,
  ): Promise<'own' | 'duplicate' | null> {
    const { orderId, paymentKey, cancelRequestId } = payload.data;
    if (
      payload.eventType !== 'CANCEL_STATUS_CHANGED'
      || payload.data.cancelStatus !== 'ABORTED'
      || !orderId
      || !paymentKey
      || !cancelRequestId
    ) {
      return null;
    }

    // Same order lease as DONE processing and the recovery sweep, so a stale
    // record snapshot never overwrites a newer retry.
    const leased = await this.withPaymentOrderLease(orderId, () =>
      this.recordCompensationCancelAbortedLocked(orderId, paymentKey, cancelRequestId));
    if (!leased.acquired) {
      throw new ServiceUnavailableException('결제 확인이 이미 진행 중입니다.');
    }
    return leased.value;
  }

  private async recordCompensationCancelAbortedLocked(
    orderId: string,
    paymentKey: string,
    cancelRequestId: string,
  ): Promise<'own' | 'duplicate' | null> {
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        status: reservations.status,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, orderId));
    if (!reservation) {
      return null;
    }

    const [payment] = await this.db
      .select(this.compensationPaymentColumns())
      .from(payments)
      .where(eq(payments.reservationId, reservation.id));
    if (!payment) {
      return null;
    }

    const now = new Date();
    if (
      payment.paymentKey === paymentKey
      && payment.status === 'DONE'
      && payment.asyncStatus === 'cancel_pending'
    ) {
      const record = readAsyncDoneCompensation(payment.providerMetadata)
        ?? synthesizeLegacyCompensationRecord(payment, reservation.id);
      // Only the latest request decides the state; an older attempt's late
      // result must not reopen a retry that is already in flight.
      if (record.cancelRequest.options.cancelRequestId !== cancelRequestId) {
        return null;
      }

      const aborted: AsyncDoneCompensationRecord = {
        ...record,
        state: 'aborted',
        lastCheckedAt: now.toISOString(),
      };
      await this.db
        .update(payments)
        .set({
          providerMetadata: this.mergeProviderMetadataSql({
            [ASYNC_DONE_COMPENSATION_METADATA_KEY]: aborted,
            [ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY]: true,
          }),
        })
        .where(and(
          eq(payments.id, payment.id),
          eq(payments.status, 'DONE'),
          eq(payments.asyncStatus, 'cancel_pending'),
        ));
      if (reservation.status !== 'CONFIRMED' && reservation.status !== 'CANCELLED') {
        await recordReservationPaymentFailureDiagnostic(this.db, {
          reservationId: reservation.id,
          paymentId: payment.id,
          tossOrderId: orderId,
          diagnosticKind: 'payment_compensation_cancel_aborted',
          diagnosticCode: 'ASYNC_DONE_COMPENSATION_CANCEL_ABORTED',
          diagnosticMessage: '결제사에서 보상 취소가 중단되어 자동 재시도 대기 중입니다.',
          diagnosticSource: 'cancel_status_changed:aborted',
        });
      }
      this.logger.error(
        `Async DONE compensation cancel ABORTED by the provider; recovery sweep will retry. orderId=${orderId}, paymentKey=${paymentKey}, cancelRequestId=${cancelRequestId}, attempts=${record.attempts}`,
      );
      return 'own';
    }

    const duplicates = readDuplicatePaymentCompensations(payment.providerMetadata);
    const duplicate = duplicates.find((record) =>
      record.paymentKey === paymentKey && record.cancelRequest.options.cancelRequestId === cancelRequestId);
    if (!duplicate || duplicate.state === 'cancelled') {
      return null;
    }

    await this.db
      .update(payments)
      .set({
        providerMetadata: this.mergeProviderMetadataSql({
          [DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY]: duplicates.map((record) =>
            record === duplicate
              ? { ...record, state: 'aborted', lastCheckedAt: now.toISOString() }
              : record),
          [ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY]: true,
        }),
      })
      .where(eq(payments.id, payment.id));
    this.logger.error(
      `Duplicate DONE compensation cancel ABORTED by the provider; recovery sweep will retry. orderId=${orderId}, duplicatePaymentKey=${paymentKey}, cancelRequestId=${cancelRequestId}`,
    );
    return 'duplicate';
  }

  /**
   * Periodic recovery for compensation cancels that did not reach a final PG
   * result: IN_PROGRESS without a terminal webhook, provider ABORTED, or a
   * request whose outcome was unknown. Re-cancels are bounded; exhausted
   * records are surfaced as attention for operator reconciliation.
   */
  async recoverAsyncDoneCompensations(
    now: Date = new Date(),
    limit = ASYNC_DONE_COMPENSATION_SWEEP_LIMIT,
  ): Promise<AsyncDoneCompensationRecoveryResult> {
    const result: AsyncDoneCompensationRecoveryResult = {
      checked: 0,
      cancelled: 0,
      retried: 0,
      waiting: 0,
      attention: 0,
      skipped: 0,
    };
    if (!this.tossClient || !this.bookingService) {
      return result;
    }

    // One API/worker instance sweeps at a time; per-order work also takes the
    // same order lease as confirm and webhook processing.
    const sweep = await this.withPaymentOrderLease(
      ASYNC_DONE_COMPENSATION_SWEEP_LEASE_KEY,
      async (assertSweepLease) => {
        const candidates = await this.db
          .select({ id: payments.id, tossOrderId: payments.tossOrderId })
          .from(payments)
          .innerJoin(reservations, eq(reservations.id, payments.reservationId))
          .where(or(
            sql`${payments.providerMetadata}->>${ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY} = 'true'`,
            // Compensations from before the record existed are adopted once.
            and(
              eq(payments.status, 'DONE'),
              eq(payments.asyncStatus, 'cancel_pending'),
              sql`${payments.providerMetadata}->${ASYNC_DONE_COMPENSATION_METADATA_KEY} IS NULL`,
              notInArray(reservations.status, ['CONFIRMED', 'CANCELLED']),
            ),
          ))
          .orderBy(payments.createdAt)
          .limit(limit);

        for (const candidate of candidates) {
          result.checked += 1;
          try {
            await assertSweepLease();
            const leased = await this.withPaymentOrderLease(candidate.tossOrderId, (assertLease) =>
              this.recoverPaymentCompensations(candidate.id, now, assertLease));
            if (!leased.acquired) {
              result.skipped += 1;
              continue;
            }
            result.cancelled += leased.value.cancelled;
            result.retried += leased.value.retried;
            result.waiting += leased.value.waiting;
            result.attention += leased.value.attention;
          } catch (error) {
            result.skipped += 1;
            this.logger.error(
              `Async DONE compensation recovery failed for paymentId=${candidate.id}, orderId=${candidate.tossOrderId}`,
              error instanceof Error ? error.stack : String(error),
            );
            if (error instanceof ServiceUnavailableException) {
              break;
            }
          }
        }
      },
    );

    return sweep.acquired ? result : { ...result, skipped: result.skipped + 1 };
  }

  private async recoverPaymentCompensations(
    paymentId: string,
    now: Date,
    assertLease: () => Promise<void>,
  ): Promise<{ cancelled: number; retried: number; waiting: number; attention: number }> {
    const counts = { cancelled: 0, retried: 0, waiting: 0, attention: 0 };
    const [payment] = await this.db
      .select(this.compensationPaymentColumns())
      .from(payments)
      .where(eq(payments.id, paymentId));
    if (!payment) {
      return counts;
    }
    const [reservation] = await this.db
      .select({ id: reservations.id, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, payment.reservationId));
    if (!reservation) {
      return counts;
    }

    const tally = (action: CompensationStepAction) => {
      if (action === 'cancelled') counts.cancelled += 1;
      if (action === 'retried') counts.retried += 1;
      if (action === 'waiting') counts.waiting += 1;
      if (action === 'attention') counts.attention += 1;
    };

    let ownRecord = readAsyncDoneCompensation(payment.providerMetadata);
    let paymentStatus = payment.status;
    const newlyNeedsAttention: AsyncDoneCompensationRecord[] = [];
    const ownCompensationOpen = reservation.status !== 'CONFIRMED'
      && reservation.status !== 'CANCELLED'
      && (
        (payment.status === 'DONE' && payment.asyncStatus === 'cancel_pending')
        || (
          payment.status === 'ABORTED'
          && REJECTED_DONE_ASYNC_STATUSES.has(payment.asyncStatus)
          && ownRecord !== null
        )
      );

    if (ownCompensationOpen) {
      const record = ownRecord ?? synthesizeLegacyCompensationRecord(payment, reservation.id);
      if (isCompensationDue(record, now)) {
        const step = await this.advanceCompensation(record, payment.tossOrderId, reservation.id, now, assertLease);
        tally(step.action);
        ownRecord = step.record;
        await assertLease();
        if (step.action === 'cancelled') {
          if (await this.finalizeRecoveredOwnCompensation({
            payment,
            reservation,
            record: step.record,
            cancelledAt: step.cancelledAt ?? now,
          })) {
            paymentStatus = 'CANCELED';
          }
        } else {
          // A re-sent cancel means the PG still holds a DONE charge.
          const reopensRejectedCharge = payment.status === 'ABORTED' && step.action === 'retried';
          await this.db
            .update(payments)
            .set({
              ...(reopensRejectedCharge
                ? { status: 'DONE' as const, asyncStatus: 'cancel_pending' }
                : {}),
              providerMetadata: this.mergeProviderMetadataSql({
                [ASYNC_DONE_COMPENSATION_METADATA_KEY]: step.record,
              }),
            })
            .where(and(eq(payments.id, payment.id), eq(payments.status, payment.status)));
          if (reopensRejectedCharge) {
            paymentStatus = 'DONE';
          }
          if (step.action === 'attention') {
            newlyNeedsAttention.push(step.record);
            await recordReservationPaymentFailureDiagnostic(this.db, {
              reservationId: reservation.id,
              paymentId: payment.id,
              tossOrderId: payment.tossOrderId,
              diagnosticKind: 'payment_compensation_attention',
              diagnosticCode: 'ASYNC_DONE_COMPENSATION_ATTENTION',
              diagnosticMessage: '자동 보상 취소를 완료하지 못했습니다. 결제사 취소 상태를 수동으로 대조해야 합니다.',
              diagnosticSource: 'async_done_compensation_recovery',
            });
          }
        }
      }
    } else if (ownRecord && isOpenCompensationState(ownRecord.state)) {
      // The row was settled elsewhere (terminal webhook, or an issued
      // reservation that must not be cancelled automatically): close the record.
      ownRecord = {
        ...ownRecord,
        state: payment.status === 'CANCELED' ? 'cancelled' : 'attention',
        lastCheckedAt: now.toISOString(),
      };
      if (ownRecord.state === 'attention') {
        newlyNeedsAttention.push(ownRecord);
      }
      await this.db
        .update(payments)
        .set({
          providerMetadata: this.mergeProviderMetadataSql({
            [ASYNC_DONE_COMPENSATION_METADATA_KEY]: ownRecord,
          }),
        })
        .where(eq(payments.id, payment.id));
    }

    const duplicates: AsyncDoneCompensationRecord[] = [];
    let duplicatesChanged = false;
    for (const duplicate of readDuplicatePaymentCompensations(payment.providerMetadata)) {
      if (!isCompensationDue(duplicate, now)) {
        duplicates.push(duplicate);
        continue;
      }
      const step = await this.advanceCompensation(duplicate, payment.tossOrderId, reservation.id, now, assertLease);
      tally(step.action);
      duplicates.push(step.record);
      duplicatesChanged = true;
      if (step.action === 'attention') {
        newlyNeedsAttention.push(step.record);
      }
    }

    const ownStillOpen = ownRecord !== null
      ? isOpenCompensationState(ownRecord.state)
        && (paymentStatus === 'DONE' || paymentStatus === 'ABORTED')
      : paymentStatus === 'DONE' && payment.asyncStatus === 'cancel_pending';
    const stillOpen = ownStillOpen
      || duplicates.some((record) => isOpenCompensationState(record.state));
    const wasOpen =
      this.toProviderMetadataRecord(payment.providerMetadata)[ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY] === true;

    if (duplicatesChanged || stillOpen !== wasOpen) {
      await assertLease();
      await this.db
        .update(payments)
        .set({
          providerMetadata: this.mergeProviderMetadataSql({
            ...(duplicatesChanged ? { [DUPLICATE_PAYMENT_COMPENSATIONS_METADATA_KEY]: duplicates } : {}),
            [ASYNC_DONE_COMPENSATION_OPEN_METADATA_KEY]: stillOpen,
          }),
        })
        .where(eq(payments.id, payment.id));
    }

    for (const record of newlyNeedsAttention) {
      this.logger.error(
        `Async DONE compensation needs operator reconciliation. orderId=${payment.tossOrderId}, kind=${record.kind}, paymentKey=${record.paymentKey}, attempts=${record.attempts}, lastError=${record.lastError ?? 'none'}`,
      );
    }

    return counts;
  }

  private async advanceCompensation(
    record: AsyncDoneCompensationRecord,
    orderId: string,
    reservationId: string,
    now: Date,
    assertLease: () => Promise<void>,
  ): Promise<{ action: CompensationStepAction; record: AsyncDoneCompensationRecord; cancelledAt?: Date }> {
    const { queryFailures: previousQueryFailures, queryFailingSince, ...rest } = record;
    const checked: AsyncDoneCompensationRecord = { ...rest, lastCheckedAt: now.toISOString() };
    let queried: TossPaymentResponse;
    try {
      queried = await this.tossClient!.queryPayment(record.paymentKey, {
        secretKeyScope: record.payment.secretKeyScope,
      });
    } catch (error) {
      // A query that keeps failing (wrong secret scope or key, provider outage)
      // would otherwise be re-polled forever with no operator signal.
      const queryFailures = (previousQueryFailures ?? 0) + 1;
      const failingSince = queryFailingSince ?? now.toISOString();
      const failingForMs = now.getTime() - (Date.parse(failingSince) || now.getTime());
      const lastError = this.describeError(error);
      const failed: AsyncDoneCompensationRecord = {
        ...checked,
        lastError,
        queryFailures,
        queryFailingSince: failingSince,
      };
      if (
        queryFailures >= ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_COUNT
        && failingForMs >= ASYNC_DONE_COMPENSATION_QUERY_FAILURE_ATTENTION_MS
      ) {
        return {
          action: 'attention',
          record: {
            ...failed,
            state: 'attention',
            lastError: `provider query failing since ${failingSince}: ${lastError}`,
          },
        };
      }
      this.logger.warn(
        `Async DONE compensation provider query failed; will retry. orderId=${orderId}, kind=${record.kind}, paymentKey=${record.paymentKey}, queryFailures=${queryFailures}, error=${lastError}`,
      );
      return { action: 'waiting', record: failed };
    }

    if (queried.paymentKey !== record.paymentKey || queried.orderId !== orderId) {
      return {
        action: 'attention',
        record: { ...checked, state: 'attention', lastError: 'provider payment identity mismatch' },
      };
    }

    if (this.isProviderFullCancelCompleted(queried)) {
      const completed = getCompletedProviderCancels(queried).at(-1);
      return {
        action: 'cancelled',
        record: { ...checked, state: 'cancelled' },
        cancelledAt: completed?.canceledAt ? new Date(completed.canceledAt) : now,
      };
    }

    if (queried.status !== 'DONE') {
      // Full compensation never produces PARTIAL_CANCELED; anything else needs a human.
      return {
        action: 'attention',
        record: { ...checked, state: 'attention', lastError: `unexpected provider status ${queried.status}` },
      };
    }

    if (queried.cancels?.some((cancel) => cancel.cancelStatus === 'IN_PROGRESS')) {
      return { action: 'waiting', record: { ...checked, state: 'pending' } };
    }

    // DONE without a live cancel: the earlier request was aborted, rejected or
    // never reached the PG. A full cancel cannot refund twice, so a fresh
    // idempotency key and cancelRequestId are safe.
    if (record.attempts >= ASYNC_DONE_COMPENSATION_MAX_ATTEMPTS) {
      return {
        action: 'attention',
        record: { ...checked, state: 'attention', lastError: checked.lastError ?? 'compensation retries exhausted' },
      };
    }

    const attempt = record.attempts + 1;
    const snapshot = toCompensationCancelSnapshot(record);
    const baseIdempotencyKey = (record.cancelRequest.options.idempotencyKey
      ?? `async-done-compensation:${record.paymentKey}`).replace(/:retry-\d+$/, '');
    const cancelCommand = buildFullPaymentCancelRequest({
      payment: snapshot,
      reason: record.reason,
      idempotencyKey: `${baseIdempotencyKey}:retry-${attempt}`,
      cancelRequestIdSeed: record.kind === 'duplicate_payment_key'
        ? `${buildDuplicateCancelRequestSeed(record.paymentKey)}-r${attempt}`
        : `${reservationId}-r${attempt}`,
    });
    await assertLease();
    const outcome = await this.sendCompensationCancel(cancelCommand);
    const next = buildCompensationRecord({
      kind: record.kind,
      paymentKey: record.paymentKey,
      reason: record.reason,
      payment: snapshot,
      cancelCommand,
      outcome,
      now,
      previous: record,
    });

    return outcome.state === 'cancelled'
      ? { action: 'cancelled', record: next, cancelledAt: now }
      : { action: 'retried', record: next };
  }

  private async finalizeRecoveredOwnCompensation(input: {
    payment: CompensationPaymentRow;
    reservation: { id: string; status: string };
    record: AsyncDoneCompensationRecord;
    cancelledAt: Date;
  }): Promise<boolean> {
    const { payment, reservation, record, cancelledAt } = input;
    const updated = await this.db
      .update(payments)
      .set({
        status: 'CANCELED',
        asyncStatus: 'compensation_cancelled',
        cancelledAt,
        cancelReason: record.reason,
        providerMetadata: this.mergeProviderMetadataSql({
          [ASYNC_DONE_COMPENSATION_METADATA_KEY]: record,
        }),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, payment.status)))
      .returning({ id: payments.id });
    if (updated.length === 0) {
      return false;
    }

    if (reservation.status === 'PENDING_PAYMENT') {
      await this.db
        .update(reservations)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(and(eq(reservations.id, reservation.id), eq(reservations.status, 'PENDING_PAYMENT')));
    }

    await recordReservationPaymentFailureDiagnostic(this.db, {
      reservationId: reservation.id,
      paymentId: payment.id,
      tossOrderId: payment.tossOrderId,
      diagnosticKind: 'payment_compensated_cancel',
      diagnosticCode: ASYNC_DONE_COMPENSATION_DIAGNOSTIC_CODES[record.kind],
      diagnosticMessage: record.reason,
      diagnosticSource: 'async_done_compensation_recovery',
    });
    return true;
  }

  private compensationPaymentColumns() {
    return {
      id: payments.id,
      reservationId: payments.reservationId,
      paymentKey: payments.paymentKey,
      tossOrderId: payments.tossOrderId,
      method: payments.method,
      provider: payments.provider,
      currency: payments.currency,
      amount: payments.amount,
      status: payments.status,
      asyncStatus: payments.asyncStatus,
      paidAt: payments.paidAt,
      cancelReason: payments.cancelReason,
      providerMetadata: payments.providerMetadata,
      providerChargeCurrency: payments.providerChargeCurrency,
      providerChargeAmountMinor: payments.providerChargeAmountMinor,
    };
  }

  private async sendCompensationCancel(command: PaymentCancelRequest): Promise<CompensationCancelOutcome> {
    try {
      const response = await this.tossClient!.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );
      if (this.isProviderFullCancelCompleted(response)) {
        return { state: 'cancelled' };
      }
      const matching = response.cancels?.filter((cancel) =>
        !command.options.cancelRequestId || cancel.cancelRequestId === command.options.cancelRequestId);
      return matching?.at(-1)?.cancelStatus === 'ABORTED'
        ? { state: 'aborted' }
        : { state: 'pending' };
    } catch (error) {
      // The outcome is unknown; keep the charge unissuable and let recovery query the PG.
      return { state: 'error', error: this.describeError(error) };
    }
  }

  private mergeProviderMetadataSql(patch: Record<string, unknown>) {
    return sql`coalesce(${payments.providerMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
  }

  private buildCompensationIdempotencyKey(
    failure: Exclude<AsyncDoneCompensationKind, 'duplicate_payment_key'>,
    payload: TossWebhookRequestBody,
  ): string {
    switch (failure) {
      case 'ticket_limit':
        return this.buildWebhookCancelIdempotencyKey(payload, 'ticket-limit-cancel');
      case 'seat_conflict':
        return this.buildWebhookCancelIdempotencyKey(payload, 'seat-failure-cancel');
      default:
        // Rejected charges are keyed by the charge itself so every replay of the
        // same DONE (webhook, client return, retry) reuses one PG request.
        return `async-done-${failure === 'amount_mismatch' ? 'amount-mismatch' : 'unsupported-provider'}-cancel:${this.requireWebhookOrderId(payload)}:${this.requireWebhookPaymentKey(payload)}`;
    }
  }

  private resolveWebhookPaymentScopeMetadata(
    payload: TossWebhookRequestBody,
    provider: PaymentProvider,
  ): Record<string, unknown> | undefined {
    // USD card charges live on the overseas-card MID; cancel them with that key.
    if (provider !== 'CARD' || this.normalizeProviderCurrency(payload.data.currency) !== 'USD') {
      return undefined;
    }

    return { requestedProvider: 'OVERSEAS_CARD', secretKeyScope: 'overseas-card' };
  }

  private describeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 300 ? `${message.slice(0, 297)}...` : message;
  }

  private isProviderFullCancelCompleted(response: TossPaymentResponse): boolean {
    return response.status === 'CANCELED'
      && (
        !Array.isArray(response.cancels)
        || response.cancels.some((cancel) =>
          cancel.cancelStatus === undefined || cancel.cancelStatus === 'DONE'
        )
      );
  }

  private buildWebhookCancelIdempotencyKey(
    payload: TossWebhookRequestBody,
    reasonCode: string,
  ): string {
    return `toss-webhook:${payload.eventId}:${reasonCode}`;
  }

  async markWebhookEventProcessed(
    eventId: string,
    processingResultCode: string,
    processingResultMessage?: string,
  ): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({
        processedAt: new Date(),
        processingResultCode,
        processingResultMessage: this.truncateWebhookProcessingMessage(
          processingResultMessage,
        ),
      })
      .where(eq(paymentWebhookEvents.eventId, eventId));
  }

  async markWebhookEventFailed(
    eventId: string,
    processingResultCode: string,
    processingResultMessage: string,
  ): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({
        processingResultCode,
        processingResultMessage: this.truncateWebhookProcessingMessage(
          processingResultMessage,
        ),
      })
      .where(eq(paymentWebhookEvents.eventId, eventId));
  }

  private truncateWebhookProcessingMessage(message?: string): string | null {
    if (message === undefined || message === null) {
      return null;
    }

    return message.length > 500 ? `${message.slice(0, 497)}...` : message;
  }

  private requiresAsyncWebhookBranch(paymentMethod: PaymentMethod): boolean {
    return (
      paymentMethod.method === 'FOREIGN_EASY_PAY'
      && ASYNC_FOREIGN_EASY_PAY_PROVIDERS.has(paymentMethod.provider)
    );
  }

  private usesForeignEasyPaySecret(
    provider: TossPaymentAsyncReturnRequest['provider'],
  ): boolean {
    return provider !== undefined && ASYNC_FOREIGN_EASY_PAY_PROVIDERS.has(provider);
  }

  private usesProviderChargeQuote(provider: PaymentProvider): boolean {
    return PROVIDER_CHARGE_QUOTE_PROVIDERS.has(provider);
  }

  private assertQueriedPaymentMatchesAsyncReturn(
    input: TossPaymentAsyncReturnRequest,
    queriedPayment: {
      paymentKey: string;
      orderId: string;
      totalAmount: number;
    },
  ): void {
    const mismatches: string[] = [];

    if (queriedPayment.paymentKey !== input.paymentKey) {
      mismatches.push('paymentKey');
    }
    if (queriedPayment.orderId !== input.orderId) {
      mismatches.push('orderId');
    }
    if (
      typeof input.amount === 'number'
      && Number.isFinite(input.amount)
      && this.toProviderAmountMinor(queriedPayment.totalAmount) !== this.toProviderAmountMinor(input.amount)
    ) {
      mismatches.push('amount');
    }

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Toss provider state mismatch: ${mismatches.join(', ')}`,
      );
    }
  }

  private normalizeTossPaymentStatus(status: string): PaymentStatus {
    switch (status) {
      case 'DONE':
        return 'DONE';
      case 'CANCELED':
        return 'CANCELED';
      case 'PARTIAL_CANCELED':
        return 'PARTIAL_CANCELED';
      case 'ABORTED':
        return 'ABORTED';
      case 'EXPIRED':
        return 'EXPIRED';
      default:
        return 'IN_PROGRESS';
    }
  }

  private toWebhookProvider(
    provider: TossPaymentAsyncReturnRequest['provider'],
  ): TossWebhookProvider | undefined {
    if (provider === 'ALIPAY_PLUS') {
      return 'ALIPAY';
    }

    return provider;
  }

  private storesWebhookAmountAsKrw(
    provider: PaymentProvider,
    providerChargeQuote?: ProviderChargeQuote,
  ): boolean {
    return provider === 'PAYPAL'
      || (providerChargeQuote !== undefined && (
        provider === 'CARD'
        || this.usesProviderChargeQuote(provider)
      ));
  }

  /**
   * payments.amount is the integer KRW ledger. A provider charge outside it
   * (an unquoted USD charge such as TrueMoney's 75.5) would fail the integer
   * column after the PG cancel was already sent, so the row keeps the
   * reservation's KRW total and the provider charge stays in the webhook or
   * compensation record.
   */
  private toPaymentLedgerCharge(
    amount: number,
    currency: string | undefined,
    reservation: { totalAmount: number },
  ): { amount: number; currency: string } {
    if (
      (this.normalizeProviderCurrency(currency) ?? 'KRW') === 'KRW'
      && Number.isSafeInteger(amount)
    ) {
      return { amount, currency: currency ?? 'KRW' };
    }

    return { amount: reservation.totalAmount, currency: 'KRW' };
  }

  private getProviderChargeAvailability(
    provider: PaymentProvider,
  ):
    | { enabled: boolean; disabledReason?: string }
    | undefined {
    const service = this.providerChargeQuoteService as
      | {
          getAlipayAvailability?: () => { enabled: boolean; disabledReason?: string };
          getForeignEasyPayAvailability?: () => { enabled: boolean; disabledReason?: string };
          getOverseasCardAvailability?: () => { enabled: boolean; disabledReason?: string };
          getPaypalAvailability?: () => { enabled: boolean; disabledReason?: string };
        }
      | undefined;

    if (provider === 'CARD') {
      return service?.getOverseasCardAvailability?.();
    }
    if (provider === 'ALIPAY_PLUS') {
      return service?.getAlipayAvailability?.()
        ?? service?.getForeignEasyPayAvailability?.();
    }

    return service?.getPaypalAvailability?.()
      ?? service?.getForeignEasyPayAvailability?.();
  }

  private getOverseasCardAvailability(): { enabled: boolean; disabledReason?: string } {
    const service = this.tossClient as
      | {
          getOverseasCardAvailability?: () => { enabled: boolean; disabledReason?: string };
        }
      | undefined;

    return service?.getOverseasCardAvailability?.()
      ?? {
        enabled: false,
        disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
      };
  }

  private isOverseasCardBranch(paymentMethod: PaymentMethod): boolean {
    return (
      paymentMethod.method === 'CARD'
      && paymentMethod.provider === 'CARD'
      && (
        paymentMethod.currency !== undefined
        && paymentMethod.currency.toUpperCase() !== 'KRW'
        || paymentMethod.overseasPaymentConsent?.required === true
      )
    );
  }

  private usesProviderChargeQuoteForPaymentMethod(paymentMethod: PaymentMethod): boolean {
    return (
      paymentMethod.method === 'FOREIGN_EASY_PAY'
      && this.usesProviderChargeQuote(paymentMethod.provider)
    ) || this.isOverseasCardBranch(paymentMethod);
  }

  private resolveWebhookProvider(
    payload: TossWebhookRequestBody,
    existingPayment?: WebhookPaymentSnapshot,
  ): PaymentProvider {
    if (payload.data.provider === 'ALIPAY') {
      return 'ALIPAY_PLUS';
    }

    if (payload.data.provider) {
      return payload.data.provider;
    }

    const easyPay = payload.data.easyPay?.trim().toUpperCase();
    if (easyPay === 'ALIPAY' || easyPay === '알리페이') {
      return 'ALIPAY_PLUS';
    }
    if (easyPay === 'PAYPAL' || easyPay === '페이팔') {
      return 'PAYPAL';
    }
    if (easyPay === 'TRUEMONEY' || easyPay === '트루머니') {
      return 'TRUEMONEY';
    }

    const foreignEasyPay = this.isForeignEasyPayMethod(payload.data.method);
    if (
      foreignEasyPay
      && this.isKnownForeignEasyPayProvider(existingPayment?.provider)
    ) {
      return existingPayment.provider;
    }

    if (foreignEasyPay) {
      return 'ALIPAY_PLUS';
    }

    return 'CARD';
  }

  /** Live Toss payloads report the method in Korean (`해외간편결제`). */
  private isForeignEasyPayMethod(method: string | undefined): boolean {
    const normalized = method?.trim();
    return normalized === 'FOREIGN_EASY_PAY' || normalized === '해외간편결제';
  }

  private isKnownForeignEasyPayProvider(
    provider: string | undefined,
  ): provider is Extract<PaymentProvider, 'ALIPAY_PLUS' | 'TRUEMONEY' | 'PAYPAL'> {
    return provider === 'ALIPAY_PLUS'
      || provider === 'TRUEMONEY'
      || provider === 'PAYPAL';
  }

  private resolveWebhookMethod(
    payload: TossWebhookRequestBody,
    provider: PaymentProvider,
  ): PaymentMethod['method'] {
    if (this.isForeignEasyPayMethod(payload.data.method)) {
      return 'FOREIGN_EASY_PAY';
    }

    if (ASYNC_FOREIGN_EASY_PAY_PROVIDERS.has(provider)) {
      return 'FOREIGN_EASY_PAY';
    }

    if (payload.data.method === 'TRANSFER') return 'TRANSFER';
    if (payload.data.method === 'VIRTUAL_ACCOUNT') return 'VIRTUAL_ACCOUNT';
    if (payload.data.method === 'MOBILE_PHONE') return 'MOBILE_PHONE';
    if (payload.data.method === 'SIMPLE_PAY') return 'SIMPLE_PAY';

    return 'CARD';
  }

  private requireWebhookOrderId(payload: TossWebhookRequestBody): string {
    if (!payload.data.orderId) {
      throw new BadRequestException('웹훅 orderId가 필요합니다');
    }

    return payload.data.orderId;
  }

  private requireWebhookPaymentKey(payload: TossWebhookRequestBody): string {
    if (!payload.data.paymentKey) {
      throw new BadRequestException('웹훅 paymentKey가 필요합니다');
    }

    return payload.data.paymentKey;
  }
}
