import { describe, expect, it } from 'vitest';
import {
  buildFullPaymentCancelRequest,
  buildTicketItemPaymentCancelRequest,
  resolvePaymentCancelSecretScope,
  type PaymentCancelPaymentSnapshot,
  type PaymentCancelTicketItemSnapshot,
} from './payment-cancel-policy.js';

const basePayment = (
  overrides: Partial<PaymentCancelPaymentSnapshot> = {},
): PaymentCancelPaymentSnapshot => ({
  id: 'payment-1',
  paymentKey: 'pay_payment_1',
  method: 'CARD',
  provider: 'CARD',
  currency: 'KRW',
  amount: 150_000,
  ...overrides,
});

const ticketItem = (
  overrides: Partial<PaymentCancelTicketItemSnapshot> = {},
): PaymentCancelTicketItemSnapshot => ({
  id: 'ticket-item-1',
  refundableAmount: 50_000,
  ...overrides,
});

describe('payment cancel policy', () => {
  it('builds domestic card full cancel with default secret scope and no optional cancel body fields', () => {
    const request = buildFullPaymentCancelRequest({
      payment: basePayment(),
      reason: 'full cancel',
      idempotencyKey: 'payment-cancel:payment-1',
    });

    expect(request).toEqual({
      paymentKey: 'pay_payment_1',
      reason: 'full cancel',
      options: {
        idempotencyKey: 'payment-cancel:payment-1',
        secretKeyScope: 'default',
      },
    });
    expect(request.options).not.toHaveProperty('cancelAmount');
    expect(request.options).not.toHaveProperty('currency');
    expect(request.options).not.toHaveProperty('cancelRequestId');
  });

  it('resolves overseas-card secret scope from provider metadata while provider remains CARD', () => {
    const paymentFromRequestedProvider = basePayment({
      provider: 'CARD',
      providerMetadata: { requestedProvider: 'OVERSEAS_CARD' },
    });
    const paymentFromSecretScope = basePayment({
      provider: 'CARD',
      providerMetadata: { secretKeyScope: 'overseas-card' },
    });

    expect(resolvePaymentCancelSecretScope(paymentFromRequestedProvider))
      .toBe('overseas-card');
    expect(resolvePaymentCancelSecretScope(paymentFromSecretScope))
      .toBe('overseas-card');
    expect(paymentFromRequestedProvider.provider).toBe('CARD');
  });

  it('builds PayPal full cancel with default secret scope and no cancel amount', () => {
    const request = buildFullPaymentCancelRequest({
      payment: basePayment({
        method: 'PAYPAL',
        provider: 'PAYPAL',
        currency: 'USD',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10_800,
      }),
      reason: 'paypal full cancel',
      idempotencyKey: 'payment-cancel:paypal-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'payment-cancel:paypal-1',
      secretKeyScope: 'default',
    });
    expect(request.options).not.toHaveProperty('cancelAmount');
  });

  it('builds Alipay and Alipay+ full cancel with foreign-easy-pay scope and cancelRequestId', () => {
    for (const provider of ['ALIPAY', 'ALIPAY_PLUS']) {
      const request = buildFullPaymentCancelRequest({
        payment: basePayment({
          method: 'FOREIGN_EASY_PAY',
          provider,
          currency: 'USD',
        }),
        reason: `${provider} full cancel`,
        idempotencyKey: `payment-cancel:${provider}`,
        cancelRequestIdSeed: provider,
      });

      expect(request.options).toEqual({
        idempotencyKey: `payment-cancel:${provider}`,
        secretKeyScope: 'foreign-easy-pay',
        cancelRequestId: `payment-cancel:${provider}`,
      });
      expect(request.options).not.toHaveProperty('cancelAmount');
      expect(request.options).not.toHaveProperty('currency');
    }
  });

  it('builds partial domestic ticket-item cancel with KRW cancelAmount and idempotency key', () => {
    const request = buildTicketItemPaymentCancelRequest({
      payment: basePayment(),
      ticketItem: ticketItem({ id: 'ticket-item-domestic-1', refundableAmount: 50_000 }),
      activeTicketItems: [
        ticketItem({ id: 'ticket-item-domestic-1', refundableAmount: 50_000 }),
        ticketItem({ id: 'ticket-item-domestic-2', refundableAmount: 100_000 }),
      ],
      reason: 'ticket item cancel',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'ticket-item-cancel:ticket-item-domestic-1',
      secretKeyScope: 'default',
      cancelAmount: 50_000,
    });
  });

  it('builds partial PayPal and Alipay provider-currency cancel using providerChargeCurrency', () => {
    for (const provider of ['PAYPAL', 'ALIPAY_PLUS']) {
      const request = buildTicketItemPaymentCancelRequest({
        payment: basePayment({
          method: provider === 'PAYPAL' ? 'PAYPAL' : 'FOREIGN_EASY_PAY',
          provider,
          currency: 'USD',
          providerChargeCurrency: 'USD',
          providerChargeAmountMinor: 10_800,
        }),
        ticketItem: ticketItem({ id: `ticket-item-${provider}`, refundableAmount: 50_000 }),
        activeTicketItems: [
          ticketItem({ id: `ticket-item-${provider}`, refundableAmount: 50_000 }),
          ticketItem({ id: `ticket-item-${provider}-2`, refundableAmount: 100_000 }),
        ],
        reason: `${provider} ticket cancel`,
      });

      expect(request.options).toMatchObject({
        cancelAmount: 36,
        currency: 'USD',
      });
    }
  });

  it('builds partial Alipay cancel with deterministic cancelRequestId', () => {
    const request = buildTicketItemPaymentCancelRequest({
      payment: basePayment({
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10_800,
      }),
      ticketItem: ticketItem({
        id: 'ticket-item-alipay-1',
        refundableAmount: 50_000,
      }),
      activeTicketItems: [
        ticketItem({ id: 'ticket-item-alipay-1', refundableAmount: 50_000 }),
        ticketItem({ id: 'ticket-item-alipay-2', refundableAmount: 100_000 }),
      ],
      reason: 'alipay ticket cancel',
    });

    expect(request.options.cancelRequestId).toBe(
      'ticket-item-cancel:ticket-item-alipay-1',
    );
  });

  it('treats last active ticket-item cancel as full cancel even when refundable amount exists', () => {
    const request = buildTicketItemPaymentCancelRequest({
      payment: basePayment(),
      ticketItem: ticketItem({
        id: 'ticket-item-last-active-1',
        refundableAmount: 50_000,
      }),
      activeTicketItems: [
        ticketItem({
          id: 'ticket-item-last-active-1',
          refundableAmount: 50_000,
        }),
      ],
      reason: 'last active ticket cancel',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'ticket-item-cancel:ticket-item-last-active-1',
      secretKeyScope: 'default',
    });
    expect(request.options).not.toHaveProperty('cancelAmount');
    expect(request.options).not.toHaveProperty('currency');
  });
});
