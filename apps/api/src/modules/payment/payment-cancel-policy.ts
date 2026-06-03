import type { TossPaymentCancelOptions } from './toss-payments.client.js';

type PaymentCancelSecretScope =
  NonNullable<TossPaymentCancelOptions['secretKeyScope']>;

export interface PaymentCancelPaymentSnapshot {
  id?: string;
  paymentKey: string;
  method: string;
  provider: string;
  currency: string;
  amount: number;
  providerMetadata?: unknown;
  providerChargeCurrency?: string | null;
  providerChargeAmountMinor?: number | null;
}

export interface PaymentCancelTicketItemSnapshot {
  id: string;
  refundableAmount: number;
}

export interface PaymentCancelRequest {
  paymentKey: string;
  reason: string;
  options: TossPaymentCancelOptions;
}

interface BuildFullPaymentCancelRequestInput {
  payment: PaymentCancelPaymentSnapshot;
  reason: string;
  idempotencyKey?: string;
  cancelRequestIdSeed?: string;
}

interface BuildTicketItemPaymentCancelRequestInput {
  payment: PaymentCancelPaymentSnapshot;
  ticketItem: PaymentCancelTicketItemSnapshot;
  activeTicketItems: PaymentCancelTicketItemSnapshot[];
  reason: string;
}

const FOREIGN_EASY_PAY_PROVIDERS = new Set([
  'ALIPAY',
  'ALIPAY_PLUS',
  'TRUEMONEY',
]);

export function resolvePaymentCancelSecretScope(
  payment: PaymentCancelPaymentSnapshot,
): PaymentCancelSecretScope {
  if (usesForeignEasyPaySecret(payment)) {
    return 'foreign-easy-pay';
  }

  if (isOverseasCardPayment(payment)) {
    return 'overseas-card';
  }

  return 'default';
}

export function buildFullPaymentCancelRequest(
  input: BuildFullPaymentCancelRequestInput,
): PaymentCancelRequest {
  const options: TossPaymentCancelOptions = {
    secretKeyScope: resolvePaymentCancelSecretScope(input.payment),
  };

  if (input.idempotencyKey !== undefined) {
    options.idempotencyKey = input.idempotencyKey;
  }

  if (requiresCancelRequestId(input.payment)) {
    options.cancelRequestId = buildPaymentCancelRequestId(
      input.cancelRequestIdSeed
      ?? input.payment.id
      ?? input.idempotencyKey
      ?? input.payment.paymentKey,
    );
  }

  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options,
  };
}

export function buildTicketItemPaymentCancelRequest(
  input: BuildTicketItemPaymentCancelRequestInput,
): PaymentCancelRequest {
  const idempotencyKey = `ticket-item-cancel:${input.ticketItem.id}`;

  if (isLastActiveTicketItem(input.ticketItem, input.activeTicketItems)) {
    return buildFullPaymentCancelRequest({
      payment: input.payment,
      reason: input.reason,
      idempotencyKey,
      cancelRequestIdSeed: input.ticketItem.id,
    });
  }

  const options: TossPaymentCancelOptions = {
    idempotencyKey,
    secretKeyScope: resolvePaymentCancelSecretScope(input.payment),
  };
  const providerCurrencyCancel = buildProviderCurrencyCancelAmount(
    input.payment,
    input.ticketItem,
  );

  if (providerCurrencyCancel) {
    options.cancelAmount = providerCurrencyCancel.cancelAmount;
    options.currency = providerCurrencyCancel.currency;
  } else {
    options.cancelAmount = input.ticketItem.refundableAmount;
  }

  if (requiresCancelRequestId(input.payment)) {
    options.cancelRequestId = idempotencyKey;
  }

  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options,
  };
}

function usesForeignEasyPaySecret(payment: PaymentCancelPaymentSnapshot): boolean {
  return FOREIGN_EASY_PAY_PROVIDERS.has(payment.provider.toUpperCase());
}

function requiresCancelRequestId(payment: PaymentCancelPaymentSnapshot): boolean {
  return FOREIGN_EASY_PAY_PROVIDERS.has(payment.provider.toUpperCase());
}

function isOverseasCardPayment(payment: PaymentCancelPaymentSnapshot): boolean {
  if (!isRecord(payment.providerMetadata)) {
    return false;
  }

  const { requestedProvider, secretKeyScope } = payment.providerMetadata;

  return (
    (typeof secretKeyScope === 'string'
      && secretKeyScope.toLowerCase() === 'overseas-card')
    || (typeof requestedProvider === 'string'
      && requestedProvider.toUpperCase() === 'OVERSEAS_CARD')
  );
}

function buildPaymentCancelRequestId(seed: string): string {
  return `payment-cancel:${seed}`;
}

function isLastActiveTicketItem(
  ticketItem: PaymentCancelTicketItemSnapshot,
  activeTicketItems: PaymentCancelTicketItemSnapshot[],
): boolean {
  return activeTicketItems.length === 1 && activeTicketItems[0]?.id === ticketItem.id;
}

function buildProviderCurrencyCancelAmount(
  payment: PaymentCancelPaymentSnapshot,
  ticketItem: PaymentCancelTicketItemSnapshot,
): { cancelAmount: number; currency: string } | null {
  if (
    !payment.providerChargeCurrency
    || payment.providerChargeCurrency === 'KRW'
    || typeof payment.providerChargeAmountMinor !== 'number'
  ) {
    return null;
  }

  return {
    cancelAmount:
      Math.round(
        payment.providerChargeAmountMinor
        * ticketItem.refundableAmount
        / payment.amount,
      ) / 100,
    currency: payment.providerChargeCurrency,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
