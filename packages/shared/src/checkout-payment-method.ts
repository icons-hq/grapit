import type { PaymentMethod } from './types/booking.types';

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
