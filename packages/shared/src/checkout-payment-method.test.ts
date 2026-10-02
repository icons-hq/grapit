import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_CONFIGURABLE_PAYMENT_METHODS,
  isCheckoutConfigurablePaymentMethod,
  isCheckoutPaymentMethodAllowed,
} from './checkout-payment-method';
import { PERFORMANCE_ALLOWED_PAYMENT_METHODS } from './types/performance.types';

describe('isCheckoutPaymentMethodAllowed (audit #70)', () => {
  it.each(['VIRTUAL_ACCOUNT', 'MOBILE_PHONE'] as const)(
    'never allows %s, even when a stored policy lists it',
    (method) => {
      expect(isCheckoutConfigurablePaymentMethod({ method })).toBe(false);
      expect(isCheckoutPaymentMethodAllowed({ method }, [...PERFORMANCE_ALLOWED_PAYMENT_METHODS])).toBe(false);
      expect(isCheckoutPaymentMethodAllowed({ method }, [method])).toBe(false);
    },
  );

  it('allows a configurable category only when the performance allows it', () => {
    for (const method of CHECKOUT_CONFIGURABLE_PAYMENT_METHODS) {
      expect(isCheckoutPaymentMethodAllowed({ method }, [method])).toBe(true);
      expect(isCheckoutPaymentMethodAllowed({ method }, [])).toBe(false);
    }
    expect(isCheckoutPaymentMethodAllowed({ method: 'TRANSFER' }, ['CARD'])).toBe(false);
  });
});
