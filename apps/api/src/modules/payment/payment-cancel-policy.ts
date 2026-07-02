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

interface BuildFullReservationPaymentCancelRequestInput
  extends BuildFullPaymentCancelRequestInput {
  cancellationQuote: {
    refundableAmount: number;
    originalPaymentAmount: number;
  };
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
const SAFE_CANCEL_REQUEST_ID_MAX_LENGTH = 64;

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
      selectFullCancelRequestIdSeed(input),
    );
  }

  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options,
  };
}

export function buildFullReservationPaymentCancelRequest(
  input: BuildFullReservationPaymentCancelRequestInput,
): PaymentCancelRequest {
  if (input.cancellationQuote.refundableAmount >= input.payment.amount) {
    return buildFullPaymentCancelRequest(input);
  }

  const options: TossPaymentCancelOptions = {
    secretKeyScope: resolvePaymentCancelSecretScope(input.payment),
  };

  if (input.idempotencyKey !== undefined) {
    options.idempotencyKey = input.idempotencyKey;
  }
  const providerCurrencyCancel = buildProviderCurrencyCancelAmount(input.payment, {
    id: input.cancelRequestIdSeed ?? input.payment.id ?? input.payment.paymentKey,
    refundableAmount: input.cancellationQuote.refundableAmount,
  });

  if (providerCurrencyCancel) {
    options.cancelAmount = providerCurrencyCancel.cancelAmount;
    options.currency = providerCurrencyCancel.currency;
  } else {
    options.cancelAmount = input.cancellationQuote.refundableAmount;
  }

  if (requiresCancelRequestId(input.payment)) {
    options.cancelRequestId = buildPaymentCancelRequestId(
      selectFullCancelRequestIdSeed(input),
    );
  }

  return {
    paymentKey: input.payment.paymentKey,
    reason: input.reason,
    options,
  };
}

export function canBuildFullReservationPaymentCancelRequest(
  input: BuildFullReservationPaymentCancelRequestInput,
): boolean {
  if (input.cancellationQuote.refundableAmount >= input.payment.amount) {
    return true;
  }

  return canBuildProviderCurrencyPartialCancel(input.payment);
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
    options.cancelRequestId = buildPaymentCancelRequestId(input.ticketItem.id);
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

function requiresProviderCurrencyPartialCancel(
  payment: PaymentCancelPaymentSnapshot,
): boolean {
  const provider = payment.provider.toUpperCase();

  return provider === 'PAYPAL' || FOREIGN_EASY_PAY_PROVIDERS.has(provider);
}

function canBuildProviderCurrencyPartialCancel(
  payment: PaymentCancelPaymentSnapshot,
): boolean {
  if (!requiresProviderCurrencyPartialCancel(payment)) {
    return true;
  }

  const providerChargeCurrency = payment.providerChargeCurrency?.trim().toUpperCase();

  return Boolean(
    providerChargeCurrency
    && providerChargeCurrency !== 'KRW'
    && typeof payment.providerChargeAmountMinor === 'number',
  );
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
  const safeSeed = seed
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!safeSeed) {
    throw new Error('cancelRequestId seed must contain a safe character');
  }

  return `cancel_${safeSeed}`.slice(0, SAFE_CANCEL_REQUEST_ID_MAX_LENGTH);
}

function selectFullCancelRequestIdSeed(
  input: BuildFullPaymentCancelRequestInput,
): string {
  const seed = [
    input.cancelRequestIdSeed,
    input.payment.id,
    input.idempotencyKey,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  if (!seed) {
    throw new Error(
      'cancelRequestId seed is required for async foreign payment cancellation',
    );
  }

  return seed;
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
  const providerChargeCurrency = payment.providerChargeCurrency?.trim().toUpperCase();

  if (
    !providerChargeCurrency
    || providerChargeCurrency === 'KRW'
    || typeof payment.providerChargeAmountMinor !== 'number'
  ) {
    if (!canBuildProviderCurrencyPartialCancel(payment)) {
      throw new Error(
        'Provider-currency partial cancellation requires provider charge data',
      );
    }

    return null;
  }

  assertPositiveInteger('payment.amount', payment.amount);
  assertPositiveInteger(
    'providerChargeAmountMinor',
    payment.providerChargeAmountMinor,
  );
  assertPositiveInteger('ticketItem.refundableAmount', ticketItem.refundableAmount);

  const allocatedMinor = Math.round(
    payment.providerChargeAmountMinor
    * ticketItem.refundableAmount
    / payment.amount,
  );

  if (allocatedMinor <= 0) {
    throw new Error(
      'Provider-currency partial cancellation amount must be greater than zero',
    );
  }

  return {
    cancelAmount: allocatedMinor / 100,
    currency: providerChargeCurrency,
  };
}

function assertPositiveInteger(label: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
