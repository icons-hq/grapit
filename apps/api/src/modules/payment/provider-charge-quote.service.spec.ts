import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ProviderChargeQuoteService } from './provider-charge-quote.service.js';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('ProviderChargeQuoteService', () => {
  it('throws at startup when PayPal checkout is enabled without a KRW/USD rate', () => {
    expect(
      () =>
        new ProviderChargeQuoteService(
          config({ PAYPAL_CHECKOUT_ENABLED: 'true' }),
        ),
    ).toThrow(/PAYPAL_KRW_USD_RATE/);
  });

  it('creates a USD PayPal quote from the KRW reservation payable amount', () => {
    const service = new ProviderChargeQuoteService(
      config({
        PAYPAL_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.00068',
      }),
    );

    expect(
      service.createPaypalQuote({
        reservationPayableAmount: 150000,
        now: new Date('2026-05-29T00:00:00.000Z'),
      }),
    ).toMatchObject({
      currency: 'USD',
      amountMinor: 10200,
      amountDecimal: '102.00',
      rate: '0.00068',
      quotedAt: '2026-05-29T00:00:00.000Z',
    });
  });

  it('rounds high precision rates with integer decimal arithmetic', () => {
    const service = new ProviderChargeQuoteService(
      config({
        PAYPAL_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.000681234567890123456',
      }),
    );

    expect(
      service.createPaypalQuote({
        reservationPayableAmount: 150000,
        now: new Date('2026-05-29T00:00:00.000Z'),
      }),
    ).toMatchObject({
      amountMinor: 10219,
      amountDecimal: '102.19',
      rate: '0.000681234567890123456',
    });
  });

  it('stays unavailable when checkout is disabled without requiring a rate', () => {
    const service = new ProviderChargeQuoteService(
      config({ PAYPAL_CHECKOUT_ENABLED: 'false' }),
    );

    expect(service.isPaypalCheckoutEnabled()).toBe(false);
    expect(service.getPaypalAvailability()).toEqual({
      enabled: false,
      disabledReason: 'PAYPAL_CHECKOUT_DISABLED',
    });
  });

  it('parses provider decimal strings to minor units and rejects invalid decimals', () => {
    const service = new ProviderChargeQuoteService(
      config({
        PAYPAL_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.00068',
      }),
    );

    expect(service.parseProviderDecimalToMinor('108.00')).toBe(10800);
    expect(service.parseProviderDecimalToMinor('108.5')).toBe(10850);
    expect(() => service.parseProviderDecimalToMinor('0')).toThrow();
    expect(() => service.parseProviderDecimalToMinor('0.00')).toThrow();
    expect(() =>
      service.parseProviderDecimalToMinor('9007199254740992.00'),
    ).toThrow();
    expect(() => service.parseProviderDecimalToMinor('108.001')).toThrow();
    expect(() => service.parseProviderDecimalToMinor('not-a-decimal')).toThrow();
  });
});
