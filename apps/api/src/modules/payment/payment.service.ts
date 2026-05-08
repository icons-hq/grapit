import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import {
  paymentWebhookEvents,
  payments,
  reservationSeats,
  reservations,
  seatInventories,
} from '../../database/schema/index.js';
import { BookingGateway } from '../booking/booking.gateway.js';
import { QrTicketService } from '../ticket/qr-ticket.service.js';
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

type WebhookReservationSnapshot = {
  id: string;
  userId: string;
  showtimeId: string;
  status: ReservationStatus;
  totalAmount: number;
};

type WebhookPaymentSnapshot = {
  id: string;
  reservationId: string;
  paymentKey: string;
  tossOrderId: string;
  amount: number;
  status: PaymentStatus;
};

type WebhookSeatSelection = {
  seatId: string;
  floorKey: string;
  seatKey: string;
};

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly bookingGateway?: BookingGateway,
    @Optional() private readonly qrTicketService?: QrTicketService,
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
        userId: reservations.userId,
        showtimeId: reservations.showtimeId,
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
        reservationId: payments.reservationId,
        paymentKey: payments.paymentKey,
        tossOrderId: payments.tossOrderId,
        amount: payments.amount,
        status: payments.status,
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

    if (paymentStatus === 'DONE') {
      if (payload.data.totalAmount !== reservation.totalAmount) {
        await this.storeRejectedWebhookPayment({
          payload,
          reservation,
          existingPayment,
          provider,
          method,
          amount: payload.data.totalAmount ?? 0,
          asyncStatus: 'payment_amount_mismatch',
        });
        throw new BadRequestException('결제 금액이 일치하지 않습니다');
      }

      await this.finalizeAsyncDonePayment({
        payload,
        reservation,
        existingPayment,
        provider,
        method,
        asyncStatus,
      });
      return;
    }

    const paidAt = null;
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

  private async finalizeAsyncDonePayment(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    asyncStatus: string;
  }): Promise<void> {
    const {
      payload,
      reservation,
      existingPayment,
      provider,
      method,
      asyncStatus,
    } = input;

    if (reservation.status !== 'PENDING_PAYMENT' && reservation.status !== 'CONFIRMED') {
      throw new ConflictException('결제 완료 처리 대상 예매 상태가 아닙니다');
    }

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
        await this.qrTicketService.ensureIssuedTicketForReservation({
          reservationId: reservation.id,
          paymentId: existingPayment.id,
        });
      }
      return;
    }

    const pendingSeats = await this.getReservationSeatSelections(reservation.id);
    const paidAt = payload.data.approvedAt
      ? new Date(payload.data.approvedAt)
      : new Date();
    let committedPaymentId = existingPayment?.id ?? null;

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
        paymentKey: payload.data.paymentKey,
        tossOrderId: payload.data.orderId,
        method,
        provider,
        currency: payload.data.currency ?? 'KRW',
        asyncStatus,
        amount: reservation.totalAmount,
        status: 'DONE' as const,
        paidAt,
        cancelledAt: null,
        cancelReason: null,
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
              sql`${seatInventories.status} <> 'sold'`,
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
          throw new ConflictException('이미 판매된 좌석입니다');
        }
      }
    });

    for (const seat of pendingSeats) {
      this.bookingGateway?.broadcastSeatUpdate(
        reservation.showtimeId,
        seat.seatKey,
        'sold',
        reservation.userId,
      );
    }

    if (this.qrTicketService && committedPaymentId) {
      await this.qrTicketService.ensureIssuedTicketForReservation({
        reservationId: reservation.id,
        paymentId: committedPaymentId,
      });
    }
  }

  private assertExistingPaymentMatchesWebhook(input: {
    existingPayment?: WebhookPaymentSnapshot;
    reservation: WebhookReservationSnapshot;
    payload: TossWebhookRequestBody;
  }): void {
    const { existingPayment, reservation, payload } = input;

    if (!existingPayment) {
      return;
    }

    if (existingPayment.reservationId !== reservation.id) {
      throw new ConflictException('결제 정보가 예매와 일치하지 않습니다');
    }

    if (
      existingPayment.paymentKey !== payload.data.paymentKey
      || existingPayment.tossOrderId !== payload.data.orderId
      || existingPayment.amount !== reservation.totalAmount
    ) {
      throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
    }
  }

  private async getReservationSeatSelections(
    reservationId: string,
  ): Promise<WebhookSeatSelection[]> {
    const rows = await this.db
      .select({
        seatId: reservationSeats.seatId,
      })
      .from(reservationSeats)
      .where(eq(reservationSeats.reservationId, reservationId));

    return rows.map((row) => this.normalizeReservationSeatIdentity(row.seatId));
  }

  private normalizeReservationSeatIdentity(seatId: string): WebhookSeatSelection {
    if (seatId.includes(':')) {
      const separatorIndex = seatId.indexOf(':');
      const floorKey = seatId.slice(0, separatorIndex) || '1F';
      const rawSeatId = seatId.slice(separatorIndex + 1);

      return {
        floorKey,
        seatId: rawSeatId,
        seatKey: `${floorKey}:${rawSeatId}`,
      };
    }

    return {
      floorKey: '1F',
      seatId,
      seatKey: `1F:${seatId}`,
    };
  }

  private async storeRejectedWebhookPayment(input: {
    payload: TossWebhookRequestBody;
    reservation: WebhookReservationSnapshot;
    existingPayment?: WebhookPaymentSnapshot;
    provider: PaymentProvider;
    method: PaymentMethod['method'];
    amount: number;
    asyncStatus: string;
  }): Promise<void> {
    const {
      payload,
      reservation,
      existingPayment,
      provider,
      method,
      amount,
      asyncStatus,
    } = input;

    const paymentValues = {
      reservationId: reservation.id,
      paymentKey: payload.data.paymentKey,
      tossOrderId: payload.data.orderId,
      method,
      provider,
      currency: payload.data.currency ?? 'KRW',
      asyncStatus,
      amount,
      status: 'ABORTED' as const,
      paidAt: null,
      cancelledAt: null,
      cancelReason: '결제 금액 불일치',
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
