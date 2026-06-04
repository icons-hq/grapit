import { describe, expect, it } from 'vitest';
import {
  buildFullPaymentCancelRequest,
  buildTicketItemPaymentCancelRequest,
  resolvePaymentCancelSecretScope,
} from './payment-cancel-policy.js';

const basePayment = {
  id: 'payment-1',
  reservationId: 'reservation-1',
  paymentKey: 'pay_1',
  method: 'CARD',
  provider: 'CARD',
  currency: 'KRW',
  amount: 100000,
  providerMetadata: null,
  providerChargeCurrency: null,
  providerChargeAmountMinor: null,
};

describe('payment-cancel-policy', () => {
  it('builds default full cancel requests for domestic card and transfer without cancelAmount', () => {
    const card = buildFullPaymentCancelRequest({
      payment: basePayment,
      reason: '사용자 취소',
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
      cancelRequestSeed: 'refund-1',
    });
    const transfer = buildFullPaymentCancelRequest({
      payment: { ...basePayment, method: 'TRANSFER', provider: 'CARD' },
      reason: '사용자 취소',
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
      cancelRequestSeed: 'refund-1',
    });

    expect(card.options).toEqual({
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
    });
    expect(transfer.options).toEqual({
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
    });
  });

  it('uses overseas-card secret scope from persisted provider metadata', () => {
    const payment = {
      ...basePayment,
      providerMetadata: {
        requestedProvider: 'OVERSEAS_CARD',
        secretKeyScope: 'overseas-card',
      },
    };

    expect(resolvePaymentCancelSecretScope(payment)).toBe('overseas-card');
    expect(buildFullPaymentCancelRequest({
      payment,
      reason: '사용자 취소',
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
      cancelRequestSeed: 'refund-1',
    }).options).toEqual({
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
      secretKeyScope: 'overseas-card',
    });
  });

  it('converts PayPal partial ticket cancels into provider-currency cancel requests', () => {
    const payment = {
      ...basePayment,
      method: 'FOREIGN_EASY_PAY',
      provider: 'PAYPAL',
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 6800,
    };

    const request = buildTicketItemPaymentCancelRequest({
      payment,
      reason: '티켓 부분 취소',
      cancelAmountKrw: 25000,
      activeTicketItemCount: 4,
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      cancelRequestSeed: 'ticket-item-1',
    });

    expect(request.options).toEqual({
      cancelAmount: 17,
      currency: 'USD',
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
    });
  });

  it('omits cancelAmount for the last active ticket item even on foreign payments', () => {
    const payment = {
      ...basePayment,
      method: 'FOREIGN_EASY_PAY',
      provider: 'PAYPAL',
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 6800,
    };

    const request = buildTicketItemPaymentCancelRequest({
      payment,
      reason: '마지막 티켓 취소',
      cancelAmountKrw: 100000,
      activeTicketItemCount: 1,
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      cancelRequestSeed: 'ticket-item-1',
    });

    expect(request.options).toEqual({
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
    });
  });

  it('uses foreign easy pay scope and cancelRequestId for Alipay cancels', () => {
    const payment = {
      ...basePayment,
      method: 'FOREIGN_EASY_PAY',
      provider: 'ALIPAY_PLUS',
      providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 6800,
    };

    const request = buildTicketItemPaymentCancelRequest({
      payment,
      reason: 'Alipay 부분 취소',
      cancelAmountKrw: 25000,
      activeTicketItemCount: 4,
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      cancelRequestSeed: 'ticket-item-1',
    });

    expect(request.options).toEqual({
      cancelAmount: 17,
      currency: 'USD',
      cancelRequestId: 'cancel_ticket-item-1',
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      secretKeyScope: 'foreign-easy-pay',
    });
  });
});
