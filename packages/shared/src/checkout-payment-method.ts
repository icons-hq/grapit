import type { PaymentMethod } from './types/booking.types';
import type { PerformanceAllowedPaymentMethod } from './types/performance.types';

/**
 * Payment method categories buyer checkout can submit: every Toss widget selection maps to
 * one of these (VIRTUAL_ACCOUNT and MOBILE_PHONE are never submitted). Reservation prepare
 * enforces a performance's allowedPaymentMethods, so the admin performance form offers
 * exactly this list — a category checkout can send must also be one an admin can allow.
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

/** Whether a performance's allowed payment methods include this checkout method category. */
export function isCheckoutPaymentMethodAllowed(
  method: Pick<PaymentMethod, 'method'>,
  allowedPaymentMethods: readonly string[],
): boolean {
  return allowedPaymentMethods.includes(method.method);
}
