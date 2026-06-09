import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
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
import { BookingService } from '../booking/booking.service.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
import type {
  PaymentInfo,
  PaymentMethod,
  PaymentProvider,
  ReservationStatus,
  PaymentStatus,
} from '@grabit/shared';
import { TossPaymentsClient, type TossPaymentResponse } from './toss-payments.client.js';
import { ProviderChargeQuoteService } from './provider-charge-quote.service.js';
import { PaymentCancellationFinalizerService } from '../cancellation/payment-cancellation-finalizer.service.js';
import {
  buildFullPaymentCancelRequest,
  type PaymentCancelPaymentSnapshot,
} from './payment-cancel-policy.js';
import {
  paymentTerminalFailureDiagnostic,
  recordReservationPaymentFailureDiagnostic,
} from './payment-failure-diagnostic.js';

type TossWebhookProvider = PaymentProvider | 'ALIPAY';
type ProviderChargeQuote = {
  currency: 'USD';
  amountMinor: number;
  amountDecimal: string;
  rate: string;
  quotedAt: string;
};

const ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON = '판매 불가능 좌석으로 인한 자동 취소';
const TICKET_SERVICE_FEE_KRW = 2000;

const ASYNC_FOREIGN_EASY_PAY_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'TRUEMONEY',
]);

const PROVIDER_CHARGE_QUOTE_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'PAYPAL',
]);

export type TossPaymentAsyncStatus = 'sync' | 'pending_webhook';

export interface TossPaymentBranchRequest {
  orderId: string;
  paymentMethod: PaymentMethod;
  successUrl: string;
  failUrl: string;
  pendingUrl?: string;
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
  providerMetadata?: unknown;
  providerChargeAmountMinor?: number | null;
};

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

@Injectable()
export class PaymentService {
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
    const { orderId, paymentMethod, successUrl, failUrl, pendingUrl } = input;

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

      return {
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
    }

    if (this.requiresAsyncWebhookBranch(paymentMethod)) {
      if (!pendingUrl) {
        throw new BadRequestException('FOREIGN_EASY_PAY 결제는 pendingUrl이 필요합니다');
      }

      return {
        orderId,
        method: 'FOREIGN_EASY_PAY',
        provider: paymentMethod.provider,
        currency: paymentMethod.currency ?? 'USD',
        successUrl,
        failUrl,
        pendingUrl,
        asyncStatus: 'pending_webhook',
        useInternationalCardOnly: false,
      };
    }

    if (paymentMethod.provider === 'CARD') {
      const useInternationalCardOnly = this.isOverseasCardBranch(paymentMethod);
      const overseasCardAvailability = useInternationalCardOnly
        ? this.getOverseasCardAvailability()
        : undefined;

      return {
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
    }

    return {
      orderId,
      method: paymentMethod.method,
      provider: paymentMethod.provider,
      currency: paymentMethod.currency ?? 'KRW',
      successUrl,
      failUrl,
      asyncStatus: 'sync',
      useInternationalCardOnly: false,
    };
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
          totalAmount: queriedPayment.totalAmount,
          approvedAt: queriedPayment.approvedAt ?? undefined,
        },
      },
      paymentStatus,
      `client_return:${paymentStatus.toLowerCase()}`,
    );
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
        paymentStatus: payments.status,
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
    const localId = this.parseGeneratedCancelRequestId(cancelRequestId);
    if (!localId) {
      return null;
    }

    return await this.findPaymentCancelSnapshotByRefundId(localId)
      ?? await this.findPaymentCancelSnapshotByTicketItemId(localId)
      ?? await this.findPaymentCancelSnapshotByPaymentId(localId)
      ?? await this.findPaymentCancelSnapshotByReservationId(localId);
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
      const providerChargeAmountMatches = usesProviderChargeQuote
        ? providerChargeQuote !== undefined
          && this.toProviderAmountMinor(payload.data.totalAmount) === providerChargeQuote.amountMinor
        : payload.data.totalAmount === expectedAmount;
      if (reservation.totalAmount !== expectedAmount || !providerChargeAmountMatches) {
        await this.storeRejectedWebhookPayment({
          payload,
          reservation,
          existingPayment,
          provider,
          method,
          amount,
          asyncStatus: 'payment_amount_mismatch',
          providerChargeQuote,
        });
        throw new BadRequestException('결제 금액이 일치하지 않습니다');
      }

      return await this.finalizeAsyncDonePayment({
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

    const paidAt = null;
    const cancelledAt = paymentStatus === 'CANCELED' && payload.data.canceledAt
      ? new Date(payload.data.canceledAt)
      : null;

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey,
      tossOrderId: orderId,
      method,
      provider,
      currency,
      asyncStatus,
      amount,
      status: paymentStatus,
      paidAt,
      cancelledAt,
      cancelReason: payload.data.cancelReason ?? null,
      ...this.toPaymentProviderChargeValues(providerChargeQuote),
    } as const;

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

    if (
      (paymentStatus === 'CANCELED'
        || paymentStatus === 'ABORTED'
        || paymentStatus === 'EXPIRED')
      && reservation.status === 'PENDING_PAYMENT'
    ) {
      await this.db
        .update(reservations)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, reservation.id));

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
      })
      .from(refunds)
      .where(
        and(
          eq(refunds.reservationId, reservation.id),
          eq(refunds.paymentId, payment.id),
          inArray(refunds.status, ['sent_to_pg', 'processing_at_pg', 'failed']),
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
    if (providerResponse.status === 'PARTIAL_CANCELED' && !ticketItemCancellation) {
      return 'no_local_match';
    }
    const seats = ticketItemCancellation
      ? [{
          seatId: ticketItemCancellation.seatId,
          floorKey: ticketItemCancellation.floorKey,
          seatKey: ticketItemCancellation.seatKey,
        }]
      : reservationSeatSelections;

    await this.paymentCancellationFinalizer.finalizeFullPaymentCancellation({
      source: 'cancel_webhook',
      ...(matchingRefund ? { refundId: matchingRefund.id } : {}),
      ...(ticketItemCancellation ? { ticketItemCancellation } : {}),
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
        seats,
      },
      reason: this.resolveCancelWebhookReason(payload, providerResponse),
      providerResponse: providerResponse as unknown as Record<string, unknown>,
      actor: { kind: 'system' },
    });

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
    cancellationFee: number;
    serviceFeeRefund: number;
    refundableAmount: number;
  } | null> {
    if (payload.eventType !== 'CANCEL_STATUS_CHANGED') {
      return null;
    }

    const ticketItemId = this.parseGeneratedCancelRequestId(
      payload.data.cancelRequestId ?? '',
    );
    if (!ticketItemId) {
      return null;
    }

    const [ticketItem] = await this.db
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
          eq(ticketItems.id, ticketItemId),
          eq(ticketItems.paymentId, paymentId),
        ),
      );

    return ticketItem ?? null;
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
    const recoverySeatLock = await this.acquireLateRecoverySeatLocksIfNeeded({
      payload,
      reservation,
      existingPayment,
      pendingSeats,
    });

    if (recoverySeatLock.acquired === false) {
      return await this.compensateAsyncDoneSeatFailure({
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

        await tx.insert(ticketItems).values(
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
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        return await this.compensateAsyncDoneSeatFailure({
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
    const ownerToken = `payment-recovery:${reservation.id}:${payload.eventId}`;

    if (
      !this.bookingService
      || !this.canRecoverLateDoneReservation(reservation, existingPayment, payload)
    ) {
      return {
        acquired: true,
        shouldRelease: false,
        showtimeId: reservation.showtimeId,
        seatKeys,
        ownerToken,
      };
    }

    const result = await this.bookingService.acquireRecoverySeatLocks(
      reservation.showtimeId,
      seatKeys,
      ownerToken,
    );

    return {
      acquired: result.acquired,
      shouldRelease: result.acquired,
      showtimeId: reservation.showtimeId,
      seatKeys,
      ownerToken,
    };
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
        payload.data.method === 'FOREIGN_EASY_PAY'
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
    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);

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
      amount,
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

  private async compensateAsyncDoneSeatFailure(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    amount: number;
    asyncStatus: string;
    providerChargeQuote?: ProviderChargeQuote;
  }): Promise<'DONE_COMPENSATED_SEAT_CONFLICT' | 'DONE_CANCEL_PENDING'> {
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

    if (!this.tossClient) {
      throw new ConflictException('판매 불가능한 좌석입니다');
    }

    const orderId = this.requireWebhookOrderId(payload);
    const paymentKey = this.requireWebhookPaymentKey(payload);
    const cancelCommand = buildFullPaymentCancelRequest({
      payment: {
        id: existingPayment?.id,
        paymentKey,
        method,
        provider,
        currency: this.storesWebhookAmountAsKrw(provider, providerChargeQuote)
          ? 'KRW'
          : payload.data.currency ?? 'KRW',
        amount,
        providerChargeCurrency: providerChargeQuote?.currency,
        providerChargeAmountMinor: providerChargeQuote?.amountMinor,
      },
      reason: ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON,
      idempotencyKey: this.buildWebhookCancelIdempotencyKey(
        payload,
        'seat-failure-cancel',
      ),
      cancelRequestIdSeed: reservation.id,
    });
    const cancelResponse = await this.tossClient.cancelPayment(
      cancelCommand.paymentKey,
      cancelCommand.reason,
      cancelCommand.options,
    );
    const terminalCancelCompleted = this.isProviderFullCancelCompleted(cancelResponse);

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey,
      tossOrderId: orderId,
      method,
      provider,
      currency: this.storesWebhookAmountAsKrw(provider, providerChargeQuote)
        ? 'KRW'
        : payload.data.currency ?? 'KRW',
      asyncStatus: terminalCancelCompleted ? asyncStatus : 'cancel_pending',
      amount,
      status: terminalCancelCompleted ? 'CANCELED' as const : 'DONE' as const,
      paidAt: payload.data.approvedAt ? new Date(payload.data.approvedAt) : new Date(),
      cancelledAt: terminalCancelCompleted ? new Date() : null,
      cancelReason: ASYNC_DONE_SEAT_FAILURE_CANCEL_REASON,
      ...this.toPaymentProviderChargeValues(providerChargeQuote),
      ...this.toRecoveredPaymentProviderMetadataValues(existingPayment, payload),
    };

    if (existingPayment) {
      await this.db
        .update(payments)
        .set(paymentValues)
        .where(eq(payments.id, existingPayment.id));
    } else {
      await this.db.insert(payments).values(paymentValues);
    }

    if (terminalCancelCompleted && reservation.status !== 'CONFIRMED') {
      await this.db
        .update(reservations)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, reservation.id));
    }

    return terminalCancelCompleted
      ? 'DONE_COMPENSATED_SEAT_CONFLICT'
      : 'DONE_CANCEL_PENDING';
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

    if (
      payload.data.method === 'FOREIGN_EASY_PAY'
      && this.isKnownForeignEasyPayProvider(existingPayment?.provider)
    ) {
      return existingPayment.provider;
    }

    if (payload.data.method === 'FOREIGN_EASY_PAY') {
      return 'ALIPAY_PLUS';
    }

    return 'CARD';
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
    if (payload.data.method === 'FOREIGN_EASY_PAY') {
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
