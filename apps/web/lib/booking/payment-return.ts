import type { ConfirmPaymentRequest } from '@grabit/shared';

interface ConfirmPaymentReturnParams {
  paymentKey: string;
  orderId: string;
  amount: string | null;
  provider: string | null;
  providerChargeAmount: string | null;
}

export function hasValidConfirmPaymentReturn({
  provider,
  amount,
  providerChargeAmount,
}: Pick<ConfirmPaymentReturnParams, 'provider' | 'amount' | 'providerChargeAmount'>): boolean {
  const parsedAmount = Number(amount);
  const hasValidAmount = amount !== null && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const hasValidProviderChargeAmount = !!providerChargeAmount?.trim();

  if (provider === 'PAYPAL') {
    return hasValidProviderChargeAmount;
  }
  if (provider === 'OVERSEAS_CARD') {
    return hasValidProviderChargeAmount || hasValidAmount;
  }
  return hasValidAmount;
}

export function buildConfirmPaymentPayload({
  paymentKey,
  orderId,
  amount,
  provider,
  providerChargeAmount,
}: ConfirmPaymentReturnParams): ConfirmPaymentRequest {
  if (provider === 'PAYPAL') {
    return {
      paymentKey,
      orderId,
      provider: 'PAYPAL',
      providerChargeAmount: providerChargeAmount ?? '',
    };
  }

  if (provider === 'OVERSEAS_CARD') {
    if (!providerChargeAmount?.trim()) {
      return {
        paymentKey,
        orderId,
        provider: 'OVERSEAS_CARD',
        amount: Number(amount),
      };
    }
    return {
      paymentKey,
      orderId,
      provider: 'OVERSEAS_CARD',
      providerChargeAmount: providerChargeAmount ?? '',
    };
  }

  return {
    paymentKey,
    orderId,
    amount: Number(amount),
  };
}

/** Server message for a confirm lease held by another request (C8: match status + message). */
const CONFIRM_LEASE_BUSY_MESSAGE = '결제 확인이 이미 진행 중입니다.';
/** 5xx messages that report a decided outcome (approved, then cancelled or cancel attempted). */
const CONFIRM_DECIDED_SERVER_ERROR_PATTERN = /자동 취소/;
const RETRYABLE_CONFIRM_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export const CONFIRM_PAYMENT_MAX_RETRIES = 3;
const CONFIRM_PAYMENT_RETRY_BASE_DELAY_MS = 1_000;
const CONFIRM_PAYMENT_RETRY_MAX_DELAY_MS = 8_000;

/**
 * Repeating the confirm POST is safe: the server serializes it with the order's confirm
 * lease, returns an already CONFIRMED order unchanged, and Toss approves a paymentKey at
 * most once. Only failures whose outcome can change on retry are repeated: a lost
 * request or response, a gateway or server error, throttling, or a busy confirm lease.
 * Definite rejections (amount, admission, expired seat lock) go straight to lookup.
 */
export function isRetryableConfirmPaymentError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== 'number') {
    return true;
  }
  if (statusCode === 409) {
    return error.message === CONFIRM_LEASE_BUSY_MESSAGE;
  }
  if (statusCode >= 500 && CONFIRM_DECIDED_SERVER_ERROR_PATTERN.test(error.message)) {
    return false;
  }
  return RETRYABLE_CONFIRM_STATUS_CODES.has(statusCode);
}

/** `failureCount` is TanStack Query's zero-based count of failures before this retry. */
export function getConfirmPaymentRetryDelayMs(failureCount: number): number {
  return Math.min(
    CONFIRM_PAYMENT_RETRY_MAX_DELAY_MS,
    CONFIRM_PAYMENT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failureCount),
  );
}

/** Return parameters that would make a reload send the confirm again. */
export const CONFIRM_PAYMENT_RETURN_PARAMS = [
  'paymentKey',
  'amount',
  'provider',
  'providerChargeAmount',
  'paymentType',
] as const;
