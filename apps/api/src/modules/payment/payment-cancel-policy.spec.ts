import { describe, expect, it } from 'vitest';
import {
  buildFullPaymentCancelRequest,
  buildFullReservationPaymentCancelRequest,
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

  it('builds Alipay and Alipay+ full cancel with safe foreign-easy-pay cancelRequestId', () => {
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
        cancelRequestId: `cancel_${provider}`,
      });
      expect(request.options.cancelRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(request.options.cancelRequestId).not.toContain(':');
      expect(request.options).not.toHaveProperty('cancelAmount');
      expect(request.options).not.toHaveProperty('currency');
    }
  });

  it('fails fast when async full cancel has no safe cancelRequestId seed', () => {
    expect(() => buildFullPaymentCancelRequest({
      payment: basePayment({
        id: undefined,
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY',
      }),
      reason: 'alipay full cancel',
    })).toThrow('cancelRequestId seed is required for async foreign payment cancellation');
  });

  it('sanitizes idempotency key when it is the last async full cancelRequestId seed', () => {
    const request = buildFullPaymentCancelRequest({
      payment: basePayment({
        id: undefined,
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY',
      }),
      reason: 'alipay full cancel',
      idempotencyKey: 'payment-cancel:alipay#1',
    });

    expect(request.options.cancelRequestId).toBe('cancel_payment-cancel_alipay_1');
    expect(request.options.cancelRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(request.options.cancelRequestId).not.toContain(':');
  });

  it('builds TrueMoney full cancel with foreign-easy-pay scope and safe cancelRequestId', () => {
    const request = buildFullPaymentCancelRequest({
      payment: basePayment({
        id: 'payment-truemoney-1',
        method: 'FOREIGN_EASY_PAY',
        provider: 'TRUEMONEY',
      }),
      reason: 'truemoney full cancel',
      idempotencyKey: 'payment-cancel:truemoney-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'payment-cancel:truemoney-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelRequestId: 'cancel_payment-truemoney-1',
    });
    expect(request.options.cancelRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
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

  it('builds fee-bearing full-reservation cancel as a domestic partial cancel', () => {
    const request = buildFullReservationPaymentCancelRequest({
      payment: basePayment({ amount: 102_000 }),
      cancellationQuote: {
        originalPaymentAmount: 102_000,
        refundableAmount: 70_000,
      },
      reason: 'reservation cancel with fee',
      idempotencyKey: 'refund-cancel:refund-1',
      cancelRequestIdSeed: 'refund-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
      cancelAmount: 70_000,
    });
  });

  it('keeps no-fee full-reservation cancel as a provider full cancel', () => {
    const request = buildFullReservationPaymentCancelRequest({
      payment: basePayment({ amount: 102_000 }),
      cancellationQuote: {
        originalPaymentAmount: 102_000,
        refundableAmount: 102_000,
      },
      reason: 'same-day full refund',
      idempotencyKey: 'refund-cancel:refund-1',
      cancelRequestIdSeed: 'refund-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(request.options).not.toHaveProperty('cancelAmount');
  });

  it('allocates provider currency for fee-bearing full-reservation cancels', () => {
    const request = buildFullReservationPaymentCancelRequest({
      payment: basePayment({
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        amount: 150_000,
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10_800,
      }),
      cancellationQuote: {
        originalPaymentAmount: 150_000,
        refundableAmount: 50_000,
      },
      reason: 'reservation cancel with fee',
      idempotencyKey: 'refund-cancel:refund-1',
      cancelRequestIdSeed: 'refund-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelAmount: 36,
      currency: 'USD',
      cancelRequestId: 'cancel_refund-1',
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
      if (provider === 'ALIPAY_PLUS') {
        expect(request.options.cancelRequestId).toBe(
          'cancel_ticket-item-ALIPAY_PLUS',
        );
        expect(request.options.cancelRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        expect(request.options.cancelRequestId).not.toContain(':');
      }
    }
  });

  it('builds overseas-card provider-currency partial cancel with overseas-card scope', () => {
    const request = buildTicketItemPaymentCancelRequest({
      payment: basePayment({
        provider: 'CARD',
        providerMetadata: { secretKeyScope: 'overseas-card' },
        currency: 'USD',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10_800,
      }),
      ticketItem: ticketItem({ id: 'ticket-item-overseas-card-1' }),
      activeTicketItems: [
        ticketItem({ id: 'ticket-item-overseas-card-1' }),
        ticketItem({ id: 'ticket-item-overseas-card-2', refundableAmount: 100_000 }),
      ],
      reason: 'overseas-card ticket cancel',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'ticket-item-cancel:ticket-item-overseas-card-1',
      secretKeyScope: 'overseas-card',
      cancelAmount: 36,
      currency: 'USD',
    });
  });

  it('throws when PayPal partial cancel is missing provider charge data', () => {
    expect(() => buildTicketItemPaymentCancelRequest({
      payment: basePayment({
        method: 'PAYPAL',
        provider: 'PAYPAL',
        currency: 'USD',
      }),
      ticketItem: ticketItem({ id: 'ticket-item-paypal-missing-charge' }),
      activeTicketItems: [
        ticketItem({ id: 'ticket-item-paypal-missing-charge' }),
        ticketItem({ id: 'ticket-item-paypal-active-2', refundableAmount: 100_000 }),
      ],
      reason: 'paypal ticket cancel',
    })).toThrow('Provider-currency partial cancellation requires provider charge data');
  });

  it('throws when provider-currency partial cancel has invalid allocation values', () => {
    expect(() => buildTicketItemPaymentCancelRequest({
      payment: basePayment({
        amount: 0,
        method: 'FOREIGN_EASY_PAY',
        provider: 'ALIPAY_PLUS',
        currency: 'USD',
        providerChargeCurrency: 'USD',
        providerChargeAmountMinor: 10_800,
      }),
      ticketItem: ticketItem({ id: 'ticket-item-alipay-invalid-amount' }),
      activeTicketItems: [
        ticketItem({ id: 'ticket-item-alipay-invalid-amount' }),
        ticketItem({ id: 'ticket-item-alipay-active-2', refundableAmount: 100_000 }),
      ],
      reason: 'alipay ticket cancel',
    })).toThrow('payment.amount must be a positive integer');
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
