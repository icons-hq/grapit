import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { normalizeSeatIdentity, TICKET_SERVICE_FEE_KRW } from '@grabit/shared';
import type {
  CancellationQuote,
  RefundTimeline,
  TicketItemCancellationPolicyCode,
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
} from '../../database/schema/index.js';
import {
  PG_BOSS,
  PG_BOSS_JOB_NAMES,
  type PgBossContract,
  type SeatIdentityPayload,
} from '../jobs/pgboss.provider.js';
import { TossPaymentError, TossPaymentsClient, type TossPaymentResponse } from '../payment/toss-payments.client.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import { buildFullReservationPaymentCancelRequest } from '../payment/payment-cancel-policy.js';

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

export type AdminRefundRequestOptions = {
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
export const REFUND_CANCEL_MAX_RETRIES = 3;
export const SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID = 'JOB_ENQUEUE_FAILED';

const REFUND_TIMELINE_STATE_MAP: Record<
  RefundStateMachineStatus,
  RefundTimeline['currentState']
> = {
  requested: 'REQUESTED',
  sent_to_pg: 'SENT_TO_PG',
  processing_at_pg: 'PROCESSING_AT_PG',
  completed: 'COMPLETED',
  failed: 'FAILED',
};

const TRANSIENT_TOSS_CANCEL_CODES = new Set([
  'INTERNAL_SERVER_ERROR',
  'INTERNAL_SYSTEM_PROCESSING_ERROR',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
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

export function calculateExpectedRefundDepositAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
}

export function isTransientRefundCancelFailure(error: unknown): boolean {
  if (error instanceof TossPaymentError) {
    return TRANSIENT_TOSS_CANCEL_CODES.has(error.code);
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return [
      'timeout',
      'timed out',
      'network',
      'fetch failed',
      'econnreset',
      'socket hang up',
      'temporar',
      '5xx',
    ].some((token) => message.includes(token));
  }

  return false;
}

export function getRefundErrorCode(error: unknown): string {
  if (error instanceof TossPaymentError) {
    return error.code;
  }

  if (error instanceof Error) {
    if (isTransientRefundCancelFailure(error)) {
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
  cancelRequestId?: string,
  options: {
    allowPartialStatus?: boolean;
    expectedCancelAmount?: number;
    expectedCurrency?: string;
    allowUnidentifiedPartialCancel?: boolean;
  } = {},
): boolean {
  const completedPaymentStatuses = options.allowPartialStatus
    ? new Set(['CANCELED', 'PARTIAL_CANCELED'])
    : new Set(['CANCELED']);

  if (cancelRequestId) {
    if (!completedPaymentStatuses.has(response.status)) {
      return false;
    }

    return hasMatchingCompletedCancel(response, {
      cancelRequestId,
      expectedCancelAmount: options.expectedCancelAmount,
      expectedCurrency: options.expectedCurrency,
    });
  }

  if (response.status === 'PARTIAL_CANCELED') {
    return options.allowUnidentifiedPartialCancel === true
      && typeof options.expectedCancelAmount === 'number'
      && hasMatchingCompletedCancel(response, {
        expectedCancelAmount: options.expectedCancelAmount,
        expectedCurrency: options.expectedCurrency,
      });
  }

  return completedPaymentStatuses.has(response.status);
}

function hasMatchingCompletedCancel(
  response: TossPaymentResponse,
  expected: {
    cancelRequestId?: string;
    expectedCancelAmount?: number;
    expectedCurrency?: string;
  },
): boolean {
  return response.cancels?.some((cancel) => {
    if (cancel.cancelStatus !== 'DONE') {
      return false;
    }
    if (
      expected.cancelRequestId !== undefined
      && cancel.cancelRequestId !== expected.cancelRequestId
    ) {
      return false;
    }
    if (
      expected.expectedCancelAmount !== undefined
      && cancel.cancelAmount !== expected.expectedCancelAmount
    ) {
      return false;
    }
    if (expected.expectedCurrency !== undefined) {
      const cancelCurrency = (cancel as { currency?: unknown }).currency;
      if (cancelCurrency !== expected.expectedCurrency) {
        return false;
      }
    }
    return true;
  }) ?? false;
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

function toTimeline(refund: RefundRecord, now: Date = new Date()): RefundTimeline {
  const expectedDepositAt =
    refund.expectedDepositAt instanceof Date ? refund.expectedDepositAt : null;
  const isDelayed =
    expectedDepositAt instanceof Date &&
    refund.status !== 'completed' &&
    expectedDepositAt.getTime() < now.getTime();

  return {
    currentState: REFUND_TIMELINE_STATE_MAP[refund.status],
    requestedAt: refund.requestedAt.toISOString(),
    sentToPgAt: refund.sentToPgAt?.toISOString() ?? null,
    processedAtPgAt: refund.processingAtPgAt?.toISOString() ?? null,
    completedAt: refund.completedAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null,
    expectedDepositAt: expectedDepositAt?.toISOString() ?? null,
    customerServiceCtaVisible: refund.customerServiceCtaVisible || isDelayed,
  };
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
    const context = await this.ensureTicketItemsAvailableForQuote(
      await this.loadReservationContext(reservationId, userId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.buildPreview(context, existingRefund);
  }

  async requestRefund(
    reservationId: string,
    userId: string,
    reason: string,
  ): Promise<RefundRequestResponse> {
    const context = await this.ensureTicketItemsAvailableForQuote(
      await this.loadReservationContext(reservationId, userId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.requestRefundWithContext(context, existingRefund, reason, { kind: 'user' });
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
    const context = await this.ensureTicketItemsAvailableForQuote(
      await this.loadReservationContextByReservationId(reservationId),
    );
    const existingRefund = await this.findExistingRefund(reservationId);

    return this.buildPreview(context, existingRefund, options);
  }

  protected async requestRefundWithContext(
    context: ReservationRefundContext,
    existingRefund: RefundRecord | null,
    reason: string,
    actor: RefundRequestActor,
    options: AdminRefundRequestOptions = {},
  ): Promise<RefundRequestResponse> {
    if (existingRefund) {
      const refund = await this.ensureRefundCancelRetryScheduled(existingRefund);

      return this.buildRequestResponse(context, refund, {
        idempotent: true,
        retryEnqueued:
          (refund.status === 'sent_to_pg' || refund.status === 'processing_at_pg')
          && Boolean(getRefundCancelRetryJobId(refund)),
      });
    }

    if (context.reservation.status !== 'CONFIRMED') {
      throw new BadRequestException('환불 가능한 예매 상태가 아닙니다');
    }

    if (new Date(context.reservation.cancelDeadline) <= new Date()) {
      throw new ForbiddenException('취소 마감시간이 지났습니다');
    }

    const cancellationQuote = this.buildFullReservationCancellationQuote(context, options);
    const requestedRefund = await this.insertRequestedRefund(
      context,
      reason,
      actor,
      cancellationQuote,
      options,
    );
    const command = buildFullReservationPaymentCancelRequest({
      payment: context.payment,
      cancellationQuote,
      reason,
      idempotencyKey: this.buildRefundCancelIdempotencyKey(requestedRefund.id),
      cancelRequestIdSeed: requestedRefund.id,
    });
    const allowPartialStatus = cancellationQuote.refundableAmount < context.payment.amount;

    try {
      const cancelResult = await this.tossPaymentsClient.cancelPayment(
        command.paymentKey,
        command.reason,
        command.options,
      );

      if (
        isTossCancelCompleted(cancelResult, command.options.cancelRequestId, {
          allowPartialStatus,
          expectedCancelAmount: command.options.cancelAmount,
          expectedCurrency: command.options.currency,
          allowUnidentifiedPartialCancel: true,
        })
      ) {
        await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
          source: 'refund_request',
          refundId: requestedRefund.id,
          context: this.toFullPaymentCancellationContext(context),
          fullReservationCancellationQuote: cancellationQuote,
          reason,
          providerResponse: cancelResult as unknown as Record<string, unknown>,
          actor,
        });
        const completedRefund = await this.loadRefundById(requestedRefund.id);

        return this.buildRequestResponse(context, completedRefund, {
          idempotent: false,
          retryEnqueued: false,
        });
      }

      const processingRefund = await this.markRefundProcessing(
        requestedRefund.id,
        cancelResult,
        reason,
        requestedRefund.retryCount,
        cancellationQuote,
      );
      const jobId = await this.scheduleRefundCancelRetry(
        processingRefund.id,
        processingRefund.retryCount,
      );
      const scheduledRefund = await this.recordRefundCancelRetrySchedule(
        processingRefund,
        jobId,
      );

      return this.buildRequestResponse(context, scheduledRefund, {
        idempotent: false,
        retryEnqueued: Boolean(jobId),
      });
    } catch (error) {
      if (isTransientRefundCancelFailure(error)) {
        const retryableRefund = await this.markRefundSentToPg(
          requestedRefund.id,
          error,
          reason,
          requestedRefund.retryCount,
          cancellationQuote,
        );
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

      const failedRefund = await this.markRefundFailed(requestedRefund.id, error);
      return this.buildRequestResponse(context, failedRefund, {
        idempotent: false,
        retryEnqueued: false,
      });
    }
  }

  protected buildPreview(
    context: ReservationRefundContext,
    refund: RefundRecord | null,
    options: AdminRefundRequestOptions = {},
  ): RefundPreviewResponse {
    const holdWindow = this.resolveHoldWindowMinutes(context.bookingPolicy);
    const cancellationQuote = refund
      ? getStoredCancellationQuote(refund)
      : this.buildFullReservationCancellationQuote(context, options);

    return {
      reservationId: context.reservation.id,
      reservationNumber: context.reservation.reservationNumber,
      paymentKey: context.payment.paymentKey,
      refundableAmount: cancellationQuote?.refundableAmount ?? context.payment.amount,
      canRequestRefund: context.reservation.status === 'CONFIRMED' && refund === null,
      cancelledSeatHoldWindowMinutes: holdWindow,
      refundTimeline: refund ? toTimeline(refund) : null,
      cancellationQuote,
    };
  }

  protected buildRequestResponse(
    context: ReservationRefundContext,
    refund: RefundRecord,
    options: { idempotent: boolean; retryEnqueued: boolean },
  ): RefundRequestResponse {
    return {
      ...this.buildPreview(context, refund),
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
        reservationCreatedAt: context.reservation.createdAt,
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

  protected calculateTicketItemCancellationQuote(input: {
    price: number;
    serviceFee: number;
    reservationCreatedAt: Date;
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
    const bookingDay = this.getSeoulDayOrdinal(input.reservationCreatedAt);
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
    const [created] = await this.db
      .insert(refunds)
      .values({
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
          ...(cancellationQuote ? { cancellationQuote } : {}),
          ...(actor.kind === 'admin' ? { operatorUserId: actor.operatorUserId } : {}),
        },
        requestedAt: now,
        expectedDepositAt: calculateExpectedRefundDepositAt(now),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: refunds.reservationId })
      .returning();

    if (created) {
      return created;
    }

    const existingRefund = await this.findExistingRefund(context.reservation.id);
    if (existingRefund) {
      return existingRefund;
    }

    throw new BadRequestException('환불 상태를 초기화하지 못했습니다');
  }

  protected async markRefundSentToPg(
    refundId: string,
    error: unknown,
    reason: string,
    retryCount: number,
    cancellationQuote?: FullReservationCancellationQuote,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'sent_to_pg',
      sentToPgAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      retryCount,
      expectedDepositAt: calculateExpectedRefundDepositAt(now),
      providerMetadata: {
        cancelReason: reason,
        ...(cancellationQuote ? { cancellationQuote } : {}),
        lastTransientError: getRefundErrorMessage(error),
      },
      updatedAt: now,
    });
  }

  protected async markRefundProcessing(
    refundId: string,
    response: TossPaymentResponse,
    reason: string,
    retryCount: number,
    cancellationQuote?: FullReservationCancellationQuote,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'processing_at_pg',
      sentToPgAt: now,
      processingAtPgAt: now,
      resultCode: response.status,
      resultMessage: 'PG cancel accepted and is processing',
      retryCount,
      expectedDepositAt: calculateExpectedRefundDepositAt(now),
      providerMetadata: {
        cancelReason: reason,
        ...(cancellationQuote ? { cancellationQuote } : {}),
        paymentStatus: response.status,
      },
      updatedAt: now,
    });
  }

  protected async markRefundFailed(
    refundId: string,
    error: unknown,
  ): Promise<RefundRecord> {
    const now = new Date();
    return this.updateRefund(refundId, {
      status: 'failed',
      failedAt: now,
      resultCode: getRefundErrorCode(error),
      resultMessage: getRefundErrorMessage(error),
      failureReason: getRefundErrorMessage(error),
      customerServiceCtaVisible: true,
      updatedAt: now,
    });
  }

  protected async updateRefund(
    refundId: string,
    values: Partial<typeof refunds.$inferInsert>,
  ): Promise<RefundRecord> {
    const [updated] = await this.db
      .update(refunds)
      .set(values)
      .where(eq(refunds.id, refundId))
      .returning();

    if (!updated) {
      throw new NotFoundException('환불 상태를 찾을 수 없습니다');
    }

    return updated;
  }

  protected async ensureRefundCancelRetryScheduled(
    refund: RefundRecord,
  ): Promise<RefundRecord> {
    if (
      (refund.status !== 'sent_to_pg' && refund.status !== 'processing_at_pg')
      || refund.retryCount >= REFUND_CANCEL_MAX_RETRIES
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
  ): Promise<RefundRecord> {
    const now = new Date();
    const providerMetadata = getRefundProviderMetadata(refund.providerMetadata);

    return this.updateRefund(refund.id, {
      providerMetadata: {
        ...providerMetadata,
        [REFUND_CANCEL_RETRY_METADATA_KEY]: {
          status: jobId ? 'scheduled' : 'schedule_failed',
          jobId,
          attempt: refund.retryCount + 1,
          scheduledAt: jobId ? now.toISOString() : null,
          failedAt: jobId ? null : now.toISOString(),
        },
      },
      customerServiceCtaVisible: !jobId,
      updatedAt: now,
    });
  }

  protected async scheduleRefundCancelRetry(
    refundId: string,
    retryCount: number,
  ): Promise<string | null> {
    if (!this.pgBoss?.isAvailable) {
      this.logger.warn(
        `pg-boss unavailable. refund-cancel-retry job skipped for refundId=${refundId}`,
      );
      return null;
    }

    const nextAttempt = retryCount + 1;
    const delaySeconds = Math.min(600, 60 * Math.max(1, nextAttempt));
    const startAfter = new Date(Date.now() + delaySeconds * 1000);

    try {
      return await this.pgBoss.send(
        PG_BOSS_JOB_NAMES.refundCancelRetry,
        {
          refundId,
          attempt: nextAttempt,
        },
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
