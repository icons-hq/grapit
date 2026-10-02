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
import { isTransientDatabaseError } from '../../database/transient-db-error.js';
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
  BookingService,
  PAYMENT_CONFIRM_LOCK_TTL,
  buildMaxTicketsPerUserExceededMessage,
} from '../booking/booking.service.js';
import {
  TossPaymentsClient,
  isTossConfirmOutcomeUnknown,
  type TossPaymentResponse,
} from '../payment/toss-payments.client.js';
import { ProviderChargeQuoteService } from '../payment/provider-charge-quote.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import { buildFullPaymentCancelRequest } from '../payment/payment-cancel-policy.js';
import {
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
};
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
type ProviderConfirmRoute = 'DOMESTIC' | 'OVERSEAS_CARD_KRW' | 'OVERSEAS_CARD_USD' | 'PAYPAL';
interface ProviderApprovalExpectation {
  route: ProviderConfirmRoute;
  currency: 'KRW' | 'USD';
  amountMinor: number;
  secretKeyScope?: 'overseas-card';
}
type ProviderApprovalMismatch = 'identity' | 'status' | 'currency' | 'amount' | 'method';
type FinalizationState =
  | { kind: 'committed'; paymentId: string }
  | { kind: 'cancelled' }
  | { kind: 'not_committed' }
  | { kind: 'unknown' };
type ConfirmLeaseState = 'owned' | 'reacquired' | 'lost' | 'unknown';

export const PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE = '결제 확인이 이미 진행 중입니다.';
export const PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE =
  '결제 승인 결과를 확인하고 있습니다. 잠시 후 예매 내역에서 다시 확인해주세요.';
export const SHOWTIME_SALES_CLOSED_MESSAGE = '이미 시작된 회차는 예매할 수 없습니다.';
const PAYMENT_APPROVAL_MISMATCH_MESSAGE =
  '결제 승인 정보가 주문과 일치하지 않아 결제 자동 취소를 요청했습니다. 다시 시도해주세요.';
const PAYMENT_APPROVAL_NOT_DONE_MESSAGE =
  '결제가 완료 상태가 아니어서 예매를 확정할 수 없습니다. 결제 자동 취소를 요청했습니다.';
const PAYMENT_NOT_APPROVED_MESSAGE = '결제가 승인되지 않았습니다. 좌석을 다시 선택해주세요.';
const PAYMENT_CANCEL_IN_PROGRESS_MESSAGE =
  '결제 취소가 처리 중입니다. 예매 내역에서 상태를 확인해주세요.';
const POST_APPROVAL_FAILURE_MESSAGE =
  '결제는 승인되었으나 처리 중 오류가 발생했습니다. 자동 취소를 시도했습니다. 고객센터에 문의해주세요.';

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
      idempotencyKey: `reservation-finalization-cancel:${approvedPayment.orderId}`,
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

    await this.cancelApprovedPaymentOrThrow(approvedPayment, reason);
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

    if (this.isPastWindow(reservation.admissionActiveUntilAt)) {
      if (existingPayment?.status === 'DONE') {
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason: '결제 유효 시간 초과로 인한 자동 취소',
        });
      }

      throw new ConflictException('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.');
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
      if (existingPayment?.status === 'DONE') {
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason: '예매 매수 제한 초과로 인한 자동 취소',
        });
      }

      throw new ConflictException(
        buildMaxTicketsPerUserExceededMessage(ticketLimit.maxTicketsPerUser),
      );
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
      if (existingPayment?.status === 'DONE') {
        const reason = lockError instanceof ConflictException
          && lockError.message.includes('비활성화')
          ? '판매 불가능 좌석으로 인한 자동 취소'
          : '좌석 점유 만료로 인한 자동 취소';
        await this.cancelExistingDonePaymentAfterFailure({
          payment: this.toApprovedPaymentSnapshot(existingPayment),
          reservationId: reservation.id,
          reason,
        });
      }
      throw lockError;
    }

    const seatLockRefreshTimer = this.startOwnedSeatLockRefresh(
      userId,
      reservation.showtimeId,
      pendingSeatIds,
    );
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
          expectation: this.buildProviderApprovalExpectation({
            isPaypal: paypalProviderCharge !== null,
            isOverseasCard: isOverseasCardConfirm,
            providerCharge,
            confirmAmount,
          }),
        });
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
          return { reservationId: reservation.id };
        }
        if (state.kind === 'cancelled') {
          throw new ConflictException(PAYMENT_CANCEL_IN_PROGRESS_MESSAGE);
        }
        if (leaseState !== 'reacquired') {
          this.logger.error(
            `PAYMENT_CONFIRM_OUTCOME_UNKNOWN reason=confirm_lease_${leaseState}. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
          );
          throw new ServiceUnavailableException(
            leaseState === 'lost'
              ? PAYMENT_CONFIRM_IN_PROGRESS_MESSAGE
              : PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE,
          );
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
          this.logger.error(
            `PAYMENT_CONFIRM_OUTCOME_UNKNOWN reason=seat_lock_check_failed. paymentKey=${approvedPayment.paymentKey}, orderId=${dto.orderId}`,
            lockError instanceof Error ? lockError.stack : String(lockError),
          );
          throw new ServiceUnavailableException(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
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

      clearInterval(seatLockRefreshTimer);
      await this.runPostCommitSideEffects({
        userId,
        reservationId: reservation.id,
        showtimeId: reservation.showtimeId,
        pendingSeats,
        committedPaymentId,
      });

      return { reservationId: reservation.id };
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
    let providerPayment: TossPaymentResponse;
    // C1 sales cutoff, checked at the last moment before anything is charged.
    // A payment an earlier attempt already approved is not a new sale: it is
    // looked up and finalized (or compensated) like any approved payment.
    if (await this.isShowtimeSalesClosed(input.reservation.showtimeId)) {
      const earlierApproval = await this.findEarlierProviderApproval(dto, expectation);
      if (!earlierApproval) {
        throw new ForbiddenException(SHOWTIME_SALES_CLOSED_MESSAGE);
      }
      providerPayment = earlierApproval;
    } else {
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
      queried = await this.tossClient.queryPayment(
        dto.paymentKey,
        expectation.secretKeyScope ? { secretKeyScope: expectation.secretKeyScope } : {},
      );
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

    this.logger.error(
      `PAYMENT_CONFIRM_OUTCOME_UNKNOWN reason=provider_confirm_unresolved. orderId=${dto.orderId}, providerStatus=${queried?.status ?? 'lookup_failed'}`,
      confirmError instanceof Error ? confirmError.stack : String(confirmError),
    );
    throw new ServiceUnavailableException(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
  }

  /**
   * Mirrors the terminal PAYMENT_STATUS_CHANGED webhook for a payment the
   * provider reports as never approved, so the checkout does not stay in
   * "checking" until the webhook arrives. Best effort.
   */
  private async recordProviderNotApprovedPayment(input: {
    dto: ConfirmPaymentRequest;
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
    dto: ConfirmPaymentRequest;
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
    return now.getTime() >= startsAt.getTime();
  }

  /**
   * Returns this order's payment if Toss already approved it (an earlier
   * confirm whose response was lost). Any lookup failure means "not proven".
   */
  private async findEarlierProviderApproval(
    dto: ConfirmPaymentRequest,
    expectation: ProviderApprovalExpectation,
  ): Promise<TossPaymentResponse | null> {
    try {
      const queried = await this.tossClient.queryPayment(
        dto.paymentKey,
        expectation.secretKeyScope ? { secretKeyScope: expectation.secretKeyScope } : {},
      );
      return queried
        && queried.paymentKey === dto.paymentKey
        && queried.orderId === dto.orderId
        && PROVIDER_APPROVED_STATUSES.has(queried.status)
        ? queried
        : null;
    } catch (queryError) {
      this.logger.warn(
        `Provider lookup for a closed showtime failed. orderId=${dto.orderId}`,
        queryError instanceof Error ? queryError.stack : String(queryError),
      );
      return null;
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
        ? { kind: 'committed', paymentId: payment.id }
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
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.db.transaction((tx) => this.commitFinalization(tx, input));
      } catch (dbError) {
        // Checked before any compensation: a seat conflict or duplicate row can
        // be this order's own earlier commit (lost acknowledgement) or another
        // finalizer's commit of the same order, which must never be refunded.
        const state = await this.readFinalizationState(reservation.id, dto.orderId);
        if (state.kind === 'committed') {
          this.logger.warn(
            `Finalization already committed after transaction failure. orderId=${dto.orderId}, reservationId=${reservation.id}`,
          );
          return state.paymentId;
        }
        if (state.kind === 'cancelled') {
          throw new ConflictException(PAYMENT_CANCEL_IN_PROGRESS_MESSAGE);
        }

        if (dbError instanceof ConflictException) {
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
