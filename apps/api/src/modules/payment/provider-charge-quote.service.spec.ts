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

  it('keeps overseas-card rates separate from PayPal quotes', () => {
    const service = new ProviderChargeQuoteService(
      config({
        PAYPAL_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.00068',
        TOSS_OVERSEAS_CARD_SECRET_KEY: 'test_sk_overseas_card',
        OVERSEAS_CARD_KRW_USD_RATE: '0.00072',
      }),
    );

    expect(
      service.createPaypalQuote({
        reservationPayableAmount: 150000,
        now: new Date('2026-05-29T00:00:00.000Z'),
      }),
    ).toMatchObject({
      amountMinor: 10200,
      amountDecimal: '102.00',
      rate: '0.00068',
    });
    expect(
      service.createOverseasCardQuote({
        reservationPayableAmount: 150000,
        now: new Date('2026-05-29T00:00:00.000Z'),
      }),
    ).toMatchObject({
      amountMinor: 10800,
      amountDecimal: '108.00',
      rate: '0.00072',
    });
  });

  it('does not use an overseas-card-only rate to enable PayPal quotes', () => {
    expect(
      () =>
        new ProviderChargeQuoteService(
          config({
            PAYPAL_CHECKOUT_ENABLED: 'true',
            OVERSEAS_CARD_KRW_USD_RATE: '0.00072',
          }),
        ),
    ).toThrow(/PAYPAL_KRW_USD_RATE/);
  });

  it('enables local test-key checkout with the default KRW/USD rate when no explicit flag is set', () => {
    const service = new ProviderChargeQuoteService(
      config({
        NODE_ENV: 'development',
        TOSS_SECRET_KEY: 'test_sk_local_checkout',
      }),
    );

    expect(service.getForeignEasyPayAvailability()).toEqual({ enabled: true });
    expect(service.createForeignEasyPayQuote({
      reservationPayableAmount: 150000,
      now: new Date('2026-05-29T00:00:00.000Z'),
    })).toMatchObject({
      currency: 'USD',
      amountMinor: 10200,
      amountDecimal: '102.00',
      rate: '0.00068',
    });
  });

  it('keeps Alipay unavailable unless it is explicitly enabled', () => {
    const localTestService = new ProviderChargeQuoteService(
      config({
        NODE_ENV: 'development',
        TOSS_SECRET_KEY: 'test_sk_local_checkout',
      }),
    );

    expect(localTestService.isAlipayCheckoutEnabled()).toBe(false);
    expect(localTestService.getAlipayAvailability()).toEqual({
      enabled: false,
      disabledReason: 'ALIPAY_CHECKOUT_DISABLED',
    });

    const enabledService = new ProviderChargeQuoteService(
      config({
        ALIPAY_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.00068',
        TOSS_FOREIGN_EASY_PAY_SECRET_KEY: 'test_sk_foreign_easy_pay',
      }),
    );

    expect(enabledService.isAlipayCheckoutEnabled()).toBe(true);
    expect(enabledService.getAlipayAvailability()).toEqual({ enabled: true });
  });

  it('keeps Alipay unavailable when the foreign easy pay secret is missing', () => {
    const service = new ProviderChargeQuoteService(
      config({
        ALIPAY_CHECKOUT_ENABLED: 'true',
        PAYPAL_KRW_USD_RATE: '0.00068',
      }),
    );

    expect(service.isAlipayCheckoutEnabled()).toBe(false);
    expect(service.getAlipayAvailability()).toEqual({
      enabled: false,
      disabledReason: 'ALIPAY_SECRET_KEY_MISSING',
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
