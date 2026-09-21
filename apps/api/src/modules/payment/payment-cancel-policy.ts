import type { TossPaymentCancelOptions, TossPaymentResponse } from './toss-payments.client.js';

type PaymentCancelSecretScope =
  NonNullable<TossPaymentCancelOptions['secretKeyScope']>;

export interface PaymentCancelPaymentSnapshot {
  id?: string;
  paymentKey: string;
  method: string;
  provider: string;
  currency: string;
  amount: number;
  /** Completed cancellations only, in the original KRW ledger and provider minor units. */
  refundedAmount?: number;
  providerRefundedAmountMinor?: number;
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

export function describePaymentCancellation(payment: PaymentCancelPaymentSnapshot, command: PaymentCancelRequest) {
  const currency = payment.providerChargeCurrency === 'USD' ? 'USD' as const : 'KRW' as const;
  if (requiresProviderCurrencyPartialCancel(payment) && !canBuildProviderCurrencyPartialCancel(payment)) {
    throw new Error('Provider-currency cancellation requires provider charge data');
  }
  const originalAmountMinor = payment.providerChargeAmountMinor ?? payment.amount;
  const balanceBeforeMinor = originalAmountMinor - (payment.providerRefundedAmountMinor ?? 0);
  const amountMinor = command.options.cancelAmount === undefined ? balanceBeforeMinor
    : Math.round(command.options.cancelAmount * (currency === 'USD' ? 100 : 1));
  return { currency, amountMinor, amountDecimal: (amountMinor / (currency === 'USD' ? 100 : 1)).toFixed(currency === 'USD' ? 2 : 0),
    originalAmountMinor, balanceBeforeMinor };
}

export function withCompletedRefunds(payment: PaymentCancelPaymentSnapshot, items: Array<{
  status: string; refundableAmount: number; cancellationCommand?: { amountMinor: number } | null;
}>): PaymentCancelPaymentSnapshot {
  const completed = items.filter((item) => item.status === 'cancelled');
  const foreign = requiresProviderCurrencyPartialCancel(payment);
  if (foreign && completed.some((item) => !item.cancellationCommand)) {
    throw new Error('Previous foreign refunds require ledger reconciliation');
  }
  return { ...payment,
    refundedAmount: completed.reduce((total, item) => total + item.refundableAmount, 0),
    providerRefundedAmountMinor: completed.reduce((total, item) => total + (item.cancellationCommand?.amountMinor ?? item.refundableAmount), 0),
  };
}

export function readStoredPaymentCancelRequest(metadata: unknown): PaymentCancelRequest | null {
  if (!isRecord(metadata) || !isRecord(metadata.cancelRequest)) return null;
  const value = metadata.cancelRequest;
  if (typeof value.paymentKey !== 'string' || typeof value.reason !== 'string' || !isRecord(value.options)) return null;
  if (typeof value.options.idempotencyKey !== 'string') return null;
  return value as unknown as PaymentCancelRequest;
}

export function readStoredPaymentCancelReceipt(metadata: unknown): { expectedCancelReason?: string; expectedCancelAmount?: number } {
  const command = readStoredPaymentCancelRequest(metadata);
  if (!command || !isRecord(metadata)) return {};
  const amount = metadata.providerRefund;
  return { expectedCancelReason: command.reason,
    expectedCancelAmount: isRecord(amount) && typeof amount.amountMinor === 'number'
      ? amount.amountMinor / (amount.currency === 'USD' ? 100 : 1) : command.options.cancelAmount };
}

/** A frozen amount is the evidence required before sending or restoring a cancellation. */
export function hasUnchangedCancellationBalance(response: TossPaymentResponse, snapshot: unknown): boolean {
  if (!isRecord(snapshot) || !['KRW', 'USD'].includes(String(snapshot.currency))
    || !Number.isSafeInteger(snapshot.originalAmountMinor) || !Number.isSafeInteger(snapshot.balanceBeforeMinor)) return false;
  const scale = snapshot.currency === 'USD' ? 100 : 1;
  return (response.currency === undefined || response.currency === snapshot.currency)
    && Math.round(response.totalAmount * scale) === snapshot.originalAmountMinor
    && Math.round((response.balanceAmount ?? -1) * scale) === snapshot.balanceBeforeMinor;
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
  assertRefundFitsBalance(input.payment, input.cancellationQuote.refundableAmount);
  if (input.cancellationQuote.refundableAmount + (input.payment.refundedAmount ?? 0) === input.payment.amount) {
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
  try {
    buildFullReservationPaymentCancelRequest(input);
    return true;
  } catch {
    return false;
  }
}

export function buildTicketItemPaymentCancelRequest(
  input: BuildTicketItemPaymentCancelRequestInput,
): PaymentCancelRequest {
  assertRefundFitsBalance(input.payment, input.ticketItem.refundableAmount);
  const idempotencyKey = `ticket-item-cancel:${input.ticketItem.id}`;

  if (
    isLastActiveTicketItem(input.ticketItem, input.activeTicketItems)
    && input.ticketItem.refundableAmount + (input.payment.refundedAmount ?? 0) === input.payment.amount
  ) {
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

  return provider === 'PAYPAL' || FOREIGN_EASY_PAY_PROVIDERS.has(provider)
    || isOverseasCardPayment(payment) || payment.currency.toUpperCase() !== 'KRW';
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
    && providerChargeCurrency === 'USD'
    && Number.isSafeInteger(payment.providerChargeAmountMinor)
    && (payment.providerChargeAmountMinor ?? 0) > 0,
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
  if (providerChargeCurrency !== 'USD') {
    throw new Error('Unsupported provider charge currency');
  }
  const alreadyRefundedMinor = payment.providerRefundedAmountMinor ?? 0;
  if (!Number.isSafeInteger(alreadyRefundedMinor) || alreadyRefundedMinor < 0
    || alreadyRefundedMinor > payment.providerChargeAmountMinor) {
    throw new Error('Invalid provider refund balance');
  }

  const cumulativeRefund = (payment.refundedAmount ?? 0) + ticketItem.refundableAmount;
  const denominator = BigInt(payment.amount);
  const cumulativeMinor = Number((
    BigInt(payment.providerChargeAmountMinor) * BigInt(cumulativeRefund) * 2n + denominator
  ) / (denominator * 2n));
  const allocatedMinor = cumulativeMinor - alreadyRefundedMinor;

  if (allocatedMinor <= 0 || allocatedMinor > payment.providerChargeAmountMinor - alreadyRefundedMinor) {
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
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertRefundFitsBalance(payment: PaymentCancelPaymentSnapshot, amount: number): void {
  assertPositiveInteger('payment.amount', payment.amount);
  assertPositiveInteger('refund amount', amount);
  const refunded = payment.refundedAmount ?? 0;
  if (!Number.isSafeInteger(refunded) || refunded < 0 || amount > payment.amount - refunded) {
    throw new Error('Refund exceeds the remaining payment balance');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
