import type {
  TossPaymentCancelOptions,
  TossPaymentRequestOptions,
} from './toss-payments.client.js';

type PaymentCancelSecretScope = TossPaymentRequestOptions['secretKeyScope'];

export type PaymentCancelPolicyPayment = {
  id: string;
  reservationId: string;
  paymentKey: string;
  method: string;
  provider: string;
  currency: string;
  amount: number;
  providerMetadata?: unknown;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
};

export type PaymentCancelRequest = {
  paymentKey: string;
  reason: string;
  options: TossPaymentCancelOptions;
};

type FullCancelInput = {
  payment: PaymentCancelPolicyPayment;
  reason: string;
  idempotencyKey: string;
  cancelRequestSeed: string;
};

type TicketItemCancelInput = FullCancelInput & {
  cancelAmountKrw: number;
  activeTicketItemCount: number;
};

function paymentMetadata(payment: PaymentCancelPolicyPayment): Record<string, unknown> {
  return payment.providerMetadata
    && typeof payment.providerMetadata === 'object'
    && !Array.isArray(payment.providerMetadata)
    ? payment.providerMetadata as Record<string, unknown>
    : {};
}

function persistedSecretScope(payment: PaymentCancelPolicyPayment): PaymentCancelSecretScope {
  const metadata = paymentMetadata(payment);
  const scope = metadata['secretKeyScope'];
  if (
    scope === 'default'
    || scope === 'overseas-card'
    || scope === 'foreign-easy-pay'
  ) {
    return scope;
  }
  return undefined;
}

export function resolvePaymentCancelSecretScope(
  payment: PaymentCancelPolicyPayment,
): PaymentCancelSecretScope {
  const persisted = persistedSecretScope(payment);
  if (persisted) {
    return persisted;
  }

  if (payment.provider === 'ALIPAY_PLUS' || payment.provider === 'TRUEMONEY') {
    return 'foreign-easy-pay';
  }

  return undefined;
}

function requiresAsyncForeignCancelRequestId(payment: PaymentCancelPolicyPayment): boolean {
  return payment.provider === 'ALIPAY_PLUS' || payment.provider === 'TRUEMONEY';
}

function cancelRequestId(seed: string): string {
  const normalized = seed.replace(/[^A-Za-z0-9_\-=]/g, '-').slice(0, 57);
  const value = `cancel_${normalized || 'request'}`;
  return value.length >= 6 ? value.slice(0, 64) : 'cancel_request';
}

function providerCurrencyCancelAmount(
  payment: PaymentCancelPolicyPayment,
  cancelAmountKrw: number,
): number | null {
  if (
    !payment.providerChargeCurrency
    || typeof payment.providerChargeAmountMinor !== 'number'
    || payment.providerChargeAmountMinor <= 0
    || payment.amount <= 0
  ) {
    return null;
  }

  const cancelMinor = Math.round(
    (payment.providerChargeAmountMinor * cancelAmountKrw) / payment.amount,
  );
  return Math.max(1, cancelMinor) / 100;
}

function baseOptions(input: FullCancelInput): TossPaymentCancelOptions {
  const secretKeyScope = resolvePaymentCancelSecretScope(input.payment);
  return {
    idempotencyKey: input.idempotencyKey,
    ...(secretKeyScope ? { secretKeyScope } : {}),
    ...(requiresAsyncForeignCancelRequestId(input.payment)
      ? { cancelRequestId: cancelRequestId(input.cancelRequestSeed) }
      : {}),
  };
}

export function buildFullPaymentCancelRequest(input: FullCancelInput): PaymentCancelRequest {
  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options: baseOptions(input),
  };
}

export function buildTicketItemPaymentCancelRequest(
  input: TicketItemCancelInput,
): PaymentCancelRequest {
  if (input.activeTicketItemCount <= 1) {
    return buildFullPaymentCancelRequest(input);
  }

  const options = baseOptions(input);
  const providerAmount = providerCurrencyCancelAmount(
    input.payment,
    input.cancelAmountKrw,
  );

  if (providerAmount !== null && input.payment.providerChargeCurrency) {
    return {
      paymentKey: input.payment.paymentKey,
      reason: input.reason,
      options: {
        ...options,
        cancelAmount: providerAmount,
        currency: input.payment.providerChargeCurrency,
      },
    };
  }

  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options: {
      ...options,
      cancelAmount: input.cancelAmountKrw,
    },
  };
}
