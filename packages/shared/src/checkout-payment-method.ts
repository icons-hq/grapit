import type { PaymentMethod } from './types/booking.types';
import type { PerformanceAllowedPaymentMethod } from './types/performance.types';

/**
 * Payment method categories a performance can allow and buyer checkout can complete. The
 * admin performance form offers exactly this list, and isCheckoutPaymentMethodAllowed
 * accepts nothing outside it, so the admin choices and the server-enforced set are the same.
 *
 * The checkout widget classifies VIRTUAL_ACCOUNT and MOBILE_PHONE selections as such (never
 * as CARD) and the server rejects them under every policy: an asynchronous deposit (virtual
 * account) or a phone-bill charge is not part of the checkout contract. Widget selections
 * with no category here (PAYCO, Samsung Pay, gift certificates, unknown codes) are flagged
 * unsupported in the browser and never reach the server.
 */
export const CHECKOUT_CONFIGURABLE_PAYMENT_METHODS = [
  'CARD',
  'TRANSFER',
  'SIMPLE_PAY',
  'FOREIGN_EASY_PAY',
] as const satisfies readonly PerformanceAllowedPaymentMethod[];

export function isForeignCheckout(method: PaymentMethod): boolean {
  return method.method === 'FOREIGN_EASY_PAY'
    || (method.method === 'CARD' && method.currency === 'USD')
    || method.overseasPaymentConsent?.required === true;
}

/** Consent timestamps can change on retry; the provider route and charge currency cannot. */
export function isSameCheckoutPaymentMethod(a: PaymentMethod, b: PaymentMethod): boolean {
  return a.method === b.method
    && a.provider === b.provider
    && (a.currency ?? (isForeignCheckout(a) ? 'USD' : 'KRW'))
      === (b.currency ?? (isForeignCheckout(b) ? 'USD' : 'KRW'))
    && isForeignCheckout(a) === isForeignCheckout(b);
}

/**
 * Reservation prepare answers 409 with this exact message when the method is not in the
 * performance's allowed payment methods. Checkout keeps the buyer on the payment step.
 */
export const CHECKOUT_PAYMENT_METHOD_NOT_ALLOWED_MESSAGE =
  '이 공연에서 사용할 수 없는 결제수단입니다. 다른 결제수단을 선택해주세요.';

/** Whether checkout can complete this method category under some performance policy. */
export function isCheckoutConfigurablePaymentMethod(method: Pick<PaymentMethod, 'method'>): boolean {
  return (CHECKOUT_CONFIGURABLE_PAYMENT_METHODS as readonly string[]).includes(method.method);
}

/**
 * Whether checkout may use this method category for a performance: it must be a category
 * checkout supports and one the performance allows. A stored policy that still lists
 * VIRTUAL_ACCOUNT or MOBILE_PHONE does not enable them.
 */
export function isCheckoutPaymentMethodAllowed(
  method: Pick<PaymentMethod, 'method'>,
  allowedPaymentMethods: readonly string[],
): boolean {
  return isCheckoutConfigurablePaymentMethod(method)
    && allowedPaymentMethods.includes(method.method);
}
