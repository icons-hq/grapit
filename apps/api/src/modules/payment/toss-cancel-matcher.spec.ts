import { describe, expect, it } from 'vitest';
import { isTossPaymentCancelCompleted } from './toss-cancel-matcher.js';

describe('Frozen cancellation receipt matching', () => {
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
