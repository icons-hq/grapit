import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  paymentWebhookEvents,
  payments,
  reservations,
} from '../../database/schema/index.js';
import type {
  PaymentInfo,
  PaymentMethod,
  PaymentProvider,
  ReservationStatus,
  PaymentStatus,
} from '@grabit/shared';

const ASYNC_FOREIGN_EASY_PAY_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'TRUEMONEY',
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
}

export type TossWebhookEventType =
  | 'PAYMENT_STATUS_CHANGED'
  | 'CANCEL_STATUS_CHANGED';

export interface TossWebhookRequestBody {
  eventId: string;
  eventType: TossWebhookEventType;
  createdAt?: string;
  data: {
    paymentKey: string;
    orderId: string;
    status: string;
    method?: string;
    provider?: PaymentProvider;
    currency?: string;
    totalAmount?: number;
    approvedAt?: string;
    canceledAt?: string;
    cancelReason?: string;
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

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  prepareTossPaymentBranch(input: TossPaymentBranchRequest): TossPaymentBranch {
    const { orderId, paymentMethod, successUrl, failUrl, pendingUrl } = input;

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
      return {
        orderId,
        method: 'CARD',
        provider: 'CARD',
        currency: 'KRW',
        successUrl,
        failUrl,
        asyncStatus: 'sync',
        useInternationalCardOnly: this.isOverseasCardBranch(paymentMethod),
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
        paymentKey: payload.data.paymentKey,
        tossOrderId: payload.data.orderId,
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

  async upsertAsyncPaymentProgress(
    payload: TossWebhookRequestBody,
    paymentStatus: PaymentStatus,
    asyncStatus: string,
  ): Promise<void> {
    const [reservation] = await this.db
      .select({
        id: reservations.id,
        status: reservations.status,
        totalAmount: reservations.totalAmount,
      })
      .from(reservations)
      .where(eq(reservations.tossOrderId, payload.data.orderId));

    if (!reservation) {
      throw new NotFoundException('웹훅 대상 예매를 찾을 수 없습니다');
    }

    const [existingPayment] = await this.db
      .select({
        id: payments.id,
      })
      .from(payments)
      .where(
        or(
          eq(payments.tossOrderId, payload.data.orderId),
          eq(payments.paymentKey, payload.data.paymentKey),
        ),
      );

    const provider = this.resolveWebhookProvider(payload);
    const method = this.resolveWebhookMethod(payload, provider);
    const amount = payload.data.totalAmount ?? reservation.totalAmount;
    const paidAt = paymentStatus === 'DONE' && payload.data.approvedAt
      ? new Date(payload.data.approvedAt)
      : null;
    const cancelledAt = paymentStatus === 'CANCELED' && payload.data.canceledAt
      ? new Date(payload.data.canceledAt)
      : null;

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey: payload.data.paymentKey,
      tossOrderId: payload.data.orderId,
      method,
      provider,
      currency: payload.data.currency ?? 'KRW',
      asyncStatus,
      amount,
      status: paymentStatus,
      paidAt,
      cancelledAt,
      cancelReason: payload.data.cancelReason ?? null,
    } as const;

    if (existingPayment) {
      await this.db
        .update(payments)
        .set(paymentValues)
        .where(eq(payments.id, existingPayment.id));
    } else {
      await this.db.insert(payments).values(paymentValues);
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
    }
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
        processingResultMessage: processingResultMessage ?? null,
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
        processingResultMessage,
      })
      .where(eq(paymentWebhookEvents.eventId, eventId));
  }

  private requiresAsyncWebhookBranch(paymentMethod: PaymentMethod): boolean {
    return (
      paymentMethod.method === 'FOREIGN_EASY_PAY'
      && ASYNC_FOREIGN_EASY_PAY_PROVIDERS.has(paymentMethod.provider)
    );
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

  private resolveWebhookProvider(payload: TossWebhookRequestBody): PaymentProvider {
    if (payload.data.provider) {
      return payload.data.provider;
    }

    if (payload.data.method === 'FOREIGN_EASY_PAY') {
      return 'ALIPAY_PLUS';
    }

    return 'CARD';
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
}
