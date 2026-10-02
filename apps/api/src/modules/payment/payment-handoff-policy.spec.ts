import { describe, expect, it } from 'vitest';
import type { PaymentMethod, PaymentProvider } from '@grabit/shared';
import {
  ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS,
  isAsyncApprovalForeignEasyPayProvider,
  isMerchantConfirmedCheckoutMethod,
} from './payment-handoff-policy.js';

const PROVIDERS: PaymentProvider[] = [
  'CARD',
  'TOSS_PAY',
  'NAVER_PAY',
  'KAKAOPAY',
  'ALIPAY_PLUS',
  'TRUEMONEY',
  'PAYPAL',
];

describe('payment handoff policy (w2a x u02: one async wallet list)', () => {
  it('names exactly the provider-approved foreign wallets', () => {
    expect([...ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS]).toEqual(['ALIPAY_PLUS', 'TRUEMONEY']);
    expect(PROVIDERS.filter(isAsyncApprovalForeignEasyPayProvider)).toEqual(['ALIPAY_PLUS', 'TRUEMONEY']);
    expect(isAsyncApprovalForeignEasyPayProvider(undefined)).toBe(false);
    expect(isAsyncApprovalForeignEasyPayProvider(null)).toBe(false);
  });

  it('treats a checkout as merchant-confirmed exactly when it is not an async foreign wallet', () => {
    for (const provider of PROVIDERS) {
      const foreign = { method: 'FOREIGN_EASY_PAY', provider, currency: 'USD' } as PaymentMethod;
      expect(isMerchantConfirmedCheckoutMethod(foreign)).toBe(!isAsyncApprovalForeignEasyPayProvider(provider));
    }
    expect(isMerchantConfirmedCheckoutMethod({ method: 'CARD', provider: 'CARD', currency: 'KRW' } as PaymentMethod))
      .toBe(true);
  });
});
