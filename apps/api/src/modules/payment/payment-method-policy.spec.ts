import { describe, expect, it } from 'vitest';
import { CHECKOUT_CONFIGURABLE_PAYMENT_METHODS } from '@grabit/shared';
import {
  categorizeTossMethodLabel,
  findApprovedMethodPolicyMismatch,
  isEnforcedCheckoutPaymentMethod,
  normalizeTossApprovedMethod,
  readTossEasyPayProvider,
  resolveEnforcedAllowedPaymentMethods,
} from './payment-method-policy.js';
import { parseTossPaymentResponse } from './toss-payments.client.js';

/**
 * Audit #70 (D1): the Toss `Payment.method` labels (ENUM 코드 > 결제수단 응답 타입,
 * Korean by default and English with Accept-Language en-US) and
 * `easyPay.provider` codes (기관 코드 > 간편결제사 코드) map to checkout categories.
 */
describe('normalizeTossApprovedMethod', () => {
  it.each([
    ['카드', undefined, { category: 'CARD' }],
    ['CARD', undefined, { category: 'CARD' }],
    ['계좌이체', undefined, { category: 'TRANSFER' }],
    ['TRANSFER', undefined, { category: 'TRANSFER' }],
    ['간편결제', { provider: '토스페이' }, { category: 'SIMPLE_PAY', provider: 'TOSS_PAY' }],
    ['간편결제', { provider: '토스결제' }, { category: 'SIMPLE_PAY', provider: 'TOSS_PAY' }],
    ['EASY_PAY', { provider: 'TOSSPAY' }, { category: 'SIMPLE_PAY', provider: 'TOSS_PAY' }],
    ['간편결제', { provider: '네이버페이' }, { category: 'SIMPLE_PAY', provider: 'NAVER_PAY' }],
    ['EASY_PAY', { provider: 'NAVERPAY' }, { category: 'SIMPLE_PAY', provider: 'NAVER_PAY' }],
    ['간편결제', { provider: '카카오페이' }, { category: 'SIMPLE_PAY', provider: 'KAKAOPAY' }],
    ['EASY_PAY', { provider: 'KAKAOPAY' }, { category: 'SIMPLE_PAY', provider: 'KAKAOPAY' }],
    ['해외간편결제', '알리페이', { category: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' }],
    ['해외간편결제', 'ALIPAYHK', { category: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' }],
    ['FOREIGN_EASY_PAY', { provider: '지캐시' }, { category: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' }],
    ['해외간편결제', '트루머니', { category: 'FOREIGN_EASY_PAY', provider: 'TRUEMONEY' }],
    ['해외간편결제', '페이팔', { category: 'FOREIGN_EASY_PAY', provider: 'PAYPAL' }],
    ['FOREIGN_EASY_PAY', { provider: 'PAYPAL' }, { category: 'FOREIGN_EASY_PAY', provider: 'PAYPAL' }],
    ['해외간편결제', undefined, { category: 'FOREIGN_EASY_PAY' }],
    ['가상계좌', undefined, { category: 'VIRTUAL_ACCOUNT' }],
    ['VIRTUAL_ACCOUNT', undefined, { category: 'VIRTUAL_ACCOUNT' }],
    ['휴대폰', undefined, { category: 'MOBILE_PHONE' }],
    ['MOBILE_PHONE', undefined, { category: 'MOBILE_PHONE' }],
  ])('maps %s (easyPay %j) to %j', (method, easyPay, expected) => {
    expect(normalizeTossApprovedMethod(method, easyPay)).toEqual(expected);
  });

  it.each([
    ['간편결제', { provider: '페이코' }],
    ['간편결제', { provider: 'PAYCO' }],
    ['간편결제', { provider: '삼성페이' }],
    ['EASY_PAY', { provider: 'APPLEPAY' }],
    ['간편결제', null],
    ['문화상품권', undefined],
    ['BOOK_GIFT_CERTIFICATE', undefined],
    ['게임문화상품권', undefined],
    [null, undefined],
    ['', undefined],
  ])('treats %s (easyPay %j) as unsupported', (method, easyPay) => {
    expect(normalizeTossApprovedMethod(method, easyPay)).toEqual({ category: 'UNSUPPORTED' });
  });

  it('reads the easy pay provider from the Payment object or a webhook string', () => {
    expect(readTossEasyPayProvider({ provider: ' 토스페이 ', amount: 0 })).toBe('토스페이');
    expect(readTossEasyPayProvider('알리페이')).toBe('알리페이');
    expect(readTossEasyPayProvider(null)).toBeUndefined();
    expect(readTossEasyPayProvider({ provider: null })).toBeUndefined();
  });

  it('categorizes a label without the provider check for storage', () => {
    expect(categorizeTossMethodLabel('휴대폰')).toBe('MOBILE_PHONE');
    expect(categorizeTossMethodLabel('가상계좌')).toBe('VIRTUAL_ACCOUNT');
    expect(categorizeTossMethodLabel('간편결제')).toBe('SIMPLE_PAY');
    expect(categorizeTossMethodLabel('문화상품권')).toBe('UNSUPPORTED');
  });
});

describe('resolveEnforcedAllowedPaymentMethods', () => {
  it('uses the platform default (CARD) for a missing or empty policy', () => {
    expect(resolveEnforcedAllowedPaymentMethods(null)).toEqual(['CARD']);
    expect(resolveEnforcedAllowedPaymentMethods(undefined)).toEqual(['CARD']);
    expect(resolveEnforcedAllowedPaymentMethods([])).toEqual(['CARD']);
  });

  it('intersects the stored policy with the checkout-configurable methods', () => {
    expect(resolveEnforcedAllowedPaymentMethods(['VIRTUAL_ACCOUNT', 'MOBILE_PHONE', 'TRANSFER', 'CARD']))
      .toEqual(['CARD', 'TRANSFER']);
    expect(resolveEnforcedAllowedPaymentMethods([...CHECKOUT_CONFIGURABLE_PAYMENT_METHODS]))
      .toEqual([...CHECKOUT_CONFIGURABLE_PAYMENT_METHODS]);
    expect(resolveEnforcedAllowedPaymentMethods('["SIMPLE_PAY"]')).toEqual(['SIMPLE_PAY']);
  });

  it('never enforces a method outside the configurable set at branch', () => {
    const enforced = resolveEnforcedAllowedPaymentMethods(['CARD', 'MOBILE_PHONE']);
    expect(isEnforcedCheckoutPaymentMethod({ method: 'CARD' }, enforced)).toBe(true);
    expect(isEnforcedCheckoutPaymentMethod({ method: 'MOBILE_PHONE' }, enforced)).toBe(false);
    expect(isEnforcedCheckoutPaymentMethod({ method: 'TRANSFER' }, enforced)).toBe(false);
  });
});

describe('findApprovedMethodPolicyMismatch', () => {
  const card = { method: 'CARD', provider: 'CARD' } as const;
  const tossPay = { method: 'SIMPLE_PAY', provider: 'TOSS_PAY' } as const;
  const alipay = { method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' } as const;
  const paypal = { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL' } as const;
  const all = [...CHECKOUT_CONFIGURABLE_PAYMENT_METHODS];

  it('accepts an approval of the frozen checkout method inside the policy', () => {
    expect(findApprovedMethodPolicyMismatch({ category: 'CARD' }, card, ['CARD'])).toBeNull();
    expect(findApprovedMethodPolicyMismatch({ category: 'SIMPLE_PAY', provider: 'TOSS_PAY' }, tossPay, all))
      .toBeNull();
    expect(findApprovedMethodPolicyMismatch({ category: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' }, alipay, all))
      .toBeNull();
    expect(findApprovedMethodPolicyMismatch({ category: 'FOREIGN_EASY_PAY', provider: 'PAYPAL' }, paypal, all))
      .toBeNull();
  });

  /**
   * PR #235 review: a foreign wallet order must be approved with its frozen
   * wallet, like a domestic easy pay. An Alipay+ order approved as PayPal (or
   * the reverse) was issued because only the category was compared.
   */
  it('rejects a foreign wallet approved with another wallet than the one checked out', () => {
    expect(findApprovedMethodPolicyMismatch({ category: 'FOREIGN_EASY_PAY', provider: 'PAYPAL' }, alipay, all))
      .toBe('checkout_provider_mismatch');
    expect(findApprovedMethodPolicyMismatch({ category: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS' }, paypal, all))
      .toBe('checkout_provider_mismatch');
    expect(findApprovedMethodPolicyMismatch({ category: 'FOREIGN_EASY_PAY', provider: 'TRUEMONEY' }, alipay, all))
      .toBe('checkout_provider_mismatch');
  });

  it.each([
    ['ALIPAY'],
    ['알리페이'],
    ['alipay'],
    ['ALIPAY_PLUS'],
    ['ALIPAYHK'],
    ['GCASH'],
    ['지캐시'],
    ['DANA'],
    ['TOUCHNGO'],
    ['RABBIT_LINE_PAY'],
  ])('keeps an Alipay+ checkout settled with the Toss wallet code %s', (easyPay) => {
    expect(findApprovedMethodPolicyMismatch(
      normalizeTossApprovedMethod('해외간편결제', easyPay),
      alipay,
      all,
    )).toBeNull();
    expect(findApprovedMethodPolicyMismatch(
      normalizeTossApprovedMethod('FOREIGN_EASY_PAY', { provider: easyPay }),
      alipay,
      all,
    )).toBeNull();
  });

  it.each([['PAYPAL'], ['페이팔']])('keeps a PayPal checkout settled with %s', (easyPay) => {
    expect(findApprovedMethodPolicyMismatch(
      normalizeTossApprovedMethod('해외간편결제', easyPay),
      paypal,
      all,
    )).toBeNull();
  });

  it.each([
    [undefined],
    [null],
    ['PAYPAY'],
    [{ provider: null }],
  ])('treats a foreign wallet with an unknown provider (%j) as unsupported, like a domestic easy pay', (easyPay) => {
    const approved = normalizeTossApprovedMethod('해외간편결제', easyPay);
    expect(findApprovedMethodPolicyMismatch(approved, alipay, all)).toBe('unsupported_method');
    expect(findApprovedMethodPolicyMismatch(approved, paypal, all)).toBe('unsupported_method');
  });

  it('rejects methods checkout never sells, whatever the policy says', () => {
    expect(findApprovedMethodPolicyMismatch({ category: 'MOBILE_PHONE' }, card, all)).toBe('unsupported_method');
    expect(findApprovedMethodPolicyMismatch({ category: 'VIRTUAL_ACCOUNT' }, card, all)).toBe('unsupported_method');
    expect(findApprovedMethodPolicyMismatch({ category: 'UNSUPPORTED' }, card, all)).toBe('unsupported_method');
  });

  it('rejects a category the performance policy does not allow', () => {
    expect(findApprovedMethodPolicyMismatch({ category: 'TRANSFER' }, { method: 'TRANSFER', provider: 'CARD' }, ['CARD']))
      .toBe('not_allowed_by_policy');
  });

  it('rejects an approval that differs from the frozen checkout method or its easy pay provider', () => {
    expect(findApprovedMethodPolicyMismatch({ category: 'SIMPLE_PAY', provider: 'TOSS_PAY' }, card, all))
      .toBe('checkout_method_mismatch');
    expect(findApprovedMethodPolicyMismatch({ category: 'SIMPLE_PAY', provider: 'KAKAOPAY' }, tossPay, all))
      .toBe('checkout_provider_mismatch');
    expect(findApprovedMethodPolicyMismatch({ category: 'CARD' }, null, all)).toBe('checkout_method_missing');
  });
});

describe('Toss payment response easyPay parsing', () => {
  const base = { paymentKey: 'pay_1', orderId: 'GRP-1', status: 'DONE', totalAmount: 52000, method: '간편결제' };

  it('keeps the Payment object easyPay provider', () => {
    expect(parseTossPaymentResponse({ ...base, easyPay: { provider: '토스페이', amount: 0, discountAmount: 0 } })?.easyPay)
      .toMatchObject({ provider: '토스페이' });
  });

  it('normalizes a webhook-style string to the same shape', () => {
    expect(parseTossPaymentResponse({ ...base, easyPay: '카카오페이' })?.easyPay).toEqual({ provider: '카카오페이' });
  });

  it('never fails the whole response on an unexpected easyPay shape', () => {
    const parsed = parseTossPaymentResponse({ ...base, easyPay: 42 });
    expect(parsed).not.toBeNull();
    expect(parsed?.easyPay).toBeUndefined();
    // The policy then treats the easy pay provider as unknown.
    expect(normalizeTossApprovedMethod(parsed?.method, parsed?.easyPay)).toEqual({ category: 'UNSUPPORTED' });
  });
});
