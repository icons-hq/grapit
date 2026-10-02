import { describe, expect, it } from 'vitest';
import type { PaymentMethod, PaymentProvider } from '@grabit/shared';
import {
  ABANDONED_PAYMENT_HANDOFF_GRACE_MS,
  ASYNC_APPROVAL_FOREIGN_EASY_PAY_PROVIDERS,
  PAYMENT_PROCESSING_TOTAL_CAP_MS,
  TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS,
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

describe('payment handoff release timing invariants (w2a docs-invariant, pay-server-9)', () => {
  it('keeps the order deadline cap below Toss READY expiry, so a late EXPIRED of a closed checkout never meets a retry in progress', () => {
    expect(TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS).toBe(30 * 60 * 1000);
    expect(PAYMENT_PROCESSING_TOTAL_CAP_MS).toBe(15 * 60 * 1000);
    expect(PAYMENT_PROCESSING_TOTAL_CAP_MS).toBeLessThan(TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS);
  });

  it('starts orphan sweeps only after the provider-owned READY expiry had time to land', () => {
    expect(ABANDONED_PAYMENT_HANDOFF_GRACE_MS).toBeGreaterThan(TOSS_UNAUTHENTICATED_CHECKOUT_EXPIRY_MS);
  });
});
