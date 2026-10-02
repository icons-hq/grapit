import type { PaymentMethod, PaymentProvider } from '@grabit/shared';
import { PAYMENT_CONFIRM_LOCK_TTL } from '../booking/booking.service.js';
import type { TossPaymentRequestOptions } from './toss-payments.client.js';

const ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS = new Set<PaymentProvider>([
  'ALIPAY_PLUS',
  'TRUEMONEY',
]);

/**
 * A browser may release its own Provider Handoff only right after the provider SDK
 * rejected before opening checkout. The window stays shorter than the confirm lease
 * TTL (with clock-skew headroom): any confirm that started after this handoff still
 * holds its lease when a release inside the window runs, so release cannot hide an
 * approval whose recording failed.
 */
export const PAYMENT_HANDOFF_RELEASE_WINDOW_MS = Math.min(
  45_000,
  (PAYMENT_CONFIRM_LOCK_TTL - 15) * 1000,
);

/**
 * Toss expires an unauthenticated checkout after 30 minutes and an authenticated but
 * unconfirmed one after 10 minutes, and reports both through the EXPIRED webhook.
 * Orphan sweeps start only after that provider-owned resolution had time to land.
 */
export const ABANDONED_PAYMENT_HANDOFF_GRACE_MS = 45 * 60 * 1000;

export const PAYMENT_HANDOFF_UNKNOWN_MESSAGE =
  '결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.';

/**
 * Card, transfer, domestic easy pay, overseas card and PayPal are charged only when
 * this server calls the Toss confirm API. Asynchronous foreign wallets can be
 * approved at the provider without a merchant confirm, so their unknown handoff is
 * never released or abandoned locally.
 */
export function isMerchantConfirmedCheckoutMethod(paymentMethod: PaymentMethod): boolean {
  return !(
    paymentMethod.method === 'FOREIGN_EASY_PAY'
    && ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS.has(paymentMethod.provider)
  );
}

export function isOverseasCardCheckoutMethod(paymentMethod: PaymentMethod): boolean {
  return (
    paymentMethod.method === 'CARD'
    && paymentMethod.provider === 'CARD'
    && (
      (paymentMethod.currency !== undefined
        && paymentMethod.currency.toUpperCase() !== 'KRW')
      || paymentMethod.overseasPaymentConsent?.required === true
    )
  );
}

/** The secret key (and therefore Toss MID) whose transactions contain this checkout. */
export function resolveCheckoutSecretKeyScope(
  paymentMethod: PaymentMethod,
): NonNullable<TossPaymentRequestOptions['secretKeyScope']> {
  return isOverseasCardCheckoutMethod(paymentMethod) ? 'overseas-card' : 'default';
}
