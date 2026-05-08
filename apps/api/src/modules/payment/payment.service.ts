import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';
import { payments } from '../../database/schema/index.js';
import type {
  PaymentInfo,
  PaymentMethod,
  PaymentProvider,
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
}
