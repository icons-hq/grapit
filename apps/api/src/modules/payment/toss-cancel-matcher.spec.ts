import { describe, expect, it } from 'vitest';
import { isTossPaymentCancelCompleted } from './toss-cancel-matcher.js';

describe('Frozen cancellation receipt matching', () => {
  it('uses the bound cancellation transaction even when Toss shortens the reason', () => {
    const cancel = { cancelStatus: 'DONE', cancelAmount: 2200, cancelReason: '구매자 요청',
      transactionKey: 'tx-current', canceledAt: '2026-11-24T07:30:00Z' };
    const response = { paymentKey: 'pay-va', orderId: 'order-va', status: 'CANCELED', totalAmount: 2200,
      balanceAmount: 0, cancels: [cancel] };
    const expected = { expectedCancelReason: '구매자 요청에 따른 전액 취소 [unique-attempt]',
      expectedCancelAmount: 2200, expectedTransactionKey: 'tx-current' };
    expect(isTossPaymentCancelCompleted(response, null, expected)).toBe(true);
    expect(isTossPaymentCancelCompleted(response, null, { ...expected, expectedTransactionKey: 'tx-other' })).toBe(false);
    expect(isTossPaymentCancelCompleted(response, null, { ...expected, expectedCancelAmount: 2000 })).toBe(false);
    expect(isTossPaymentCancelCompleted({ ...response, cancels: [cancel, cancel] }, null, expected)).toBe(false);
  });

  it('matches the unique frozen reason and amount even when status-recording time is later than PG completion', () => {
    const response = { paymentKey: 'test-payment', orderId: 'test-order', status: 'PARTIAL_CANCELED',
      totalAmount: 52000, balanceAmount: 6000, cancels: [{ cancelStatus: 'DONE', cancelAmount: 46000,
        cancelReason: 'Cancellation [unique-attempt]', canceledAt: '2026-09-21T10:00:01.000Z' }] };
    expect(isTossPaymentCancelCompleted(response, undefined, { allowPartialStatus: true,
      expectedCancelAmount: 46000, expectedCancelReason: 'Cancellation [unique-attempt]',
      allowUnidentifiedPartialCancel: true, requestedAt: '2026-09-21T10:00:02.000Z' })).toBe(true);
    expect(isTossPaymentCancelCompleted({ ...response, status: 'CANCELED', balanceAmount: 0 }, undefined,
      { expectedCancelReason: 'A different cancellation [another-attempt]' })).toBe(false);
  });
});
