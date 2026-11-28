import { describe, expect, it } from 'vitest';
import { readStoredPaymentCancelReceipt } from './payment-cancel-policy.js';
import { providerRefundReason, transactionFromCancelPost } from './toss-cancel-receipt.js';
import { isTossPaymentCancelCompleted, matchesCompletedRefundWebhook, matchesPendingOrAbortedCancel } from './toss-cancel-matcher.js';

describe('Frozen cancellation receipt matching', () => {
  const attempt = '0d345247-d106-4e7b-ba81-bf17d00f3cb4';
  const command = { paymentKey: 'pay-1', reason: `取消预订 [${attempt}]`, options: { idempotencyKey: `refund-cancel:${attempt}` } };
  const metadata = { cancelRequest: command, providerRefund: { currency: 'USD', originalAmountMinor: 25976, balanceBeforeMinor: 25976, amountMinor: 25976 } };
  const cancel = { cancelAmount: 259.76, cancelReason: `取消?? [${attempt}]`, cancelStatus: 'DONE',
    transactionKey: 'tx-1', canceledAt: '2026-11-27T12:23:38Z' };
  const response = { paymentKey: 'pay-1', orderId: 'order-1', status: 'CANCELED', currency: 'USD', totalAmount: 259.76, balanceAmount: 0, cancels: [cancel] };

  it('recovers the complete legacy attempt ID with matching payment, currency, amount and balance', () => {
    const receipt = readStoredPaymentCancelReceipt(metadata);
    const completed = (payment: typeof response) => isTossPaymentCancelCompleted(payment, undefined, receipt);
    expect(completed(response)).toBe(true);
    expect(matchesCompletedRefundWebhook(response, command.options, null, metadata)).toBe(true);
    for (const changed of [{ paymentKey: 'other' }, { currency: 'KRW' }, { balanceAmount: 1 }, { totalAmount: 260 },
      { cancels: [cancel, cancel] }, { cancels: [{ ...cancel, cancelAmount: 259.75 }] },
      { cancels: [{ ...cancel, cancelStatus: 'IN_PROGRESS' }] }, { cancels: [{ ...cancel, transactionKey: '' }] },
      { cancels: [{ ...cancel, cancelReason: `different [${attempt.slice(1)}]` }] }]) {
      expect(completed({ ...response, ...changed })).toBe(false);
    }
    expect(matchesCompletedRefundWebhook(response, {}, null, { ...metadata, cancelRequest: {
      ...command, options: { idempotencyKey: 'unrelated-attempt' },
    } })).toBe(false);
    expect(providerRefundReason(attempt)).toMatch(/^Refund [a-zA-Z0-9_-]{22}$/);
  });

  it('uses the asynchronous request ID and amount even if the reason changes; a pending receipt is never complete', () => {
    const receipt = readStoredPaymentCancelReceipt(metadata);
    const row = { ...cancel, cancelReason: 'provider text', cancelRequestId: 'cancel_123456' };
    const paid = { ...response, cancels: [row] };
    expect(isTossPaymentCancelCompleted(paid, row.cancelRequestId, receipt)).toBe(true);
    expect(isTossPaymentCancelCompleted(paid, 'other', receipt)).toBe(false);
    for (const status of ['IN_PROGRESS', 'ABORTED'] as const) {
      const pending = { ...paid, cancels: [{ ...row, cancelStatus: status }] };
      expect(isTossPaymentCancelCompleted(pending, row.cancelRequestId, receipt)).toBe(false);
      expect(matchesPendingOrAbortedCancel(pending, status, row.cancelRequestId, receipt)).toBe(true);
      expect(matchesPendingOrAbortedCancel(pending, status, 'other', receipt)).toBe(false);
    }
  });

  it.each([
    ['카드', 'KRW', 382000, null], ['해외 카드', 'USD', 259.76, null],
    ['계좌이체', 'KRW', 382000, null], ['가상계좌', 'KRW', 382000, null], ['토스페이', 'KRW', 382000, null],
    ['PayPal', 'USD', 259.76, null], ['ALIPAY_PLUS', 'USD', 259.76, 'cancel_123456'], ['TRUEMONEY', 'USD', 259.76, 'cancel_123456'],
  ] as const)('binds the unique transaction returned for %s', (method, currency, total, requestId) => {
    const scale = currency === 'USD' ? 100 : 1;
    const minor = Math.round(total * scale);
    const before = { ...response, method, currency, totalAmount: total, balanceAmount: total, status: 'DONE', cancels: [] };
    const row = { ...cancel, cancelAmount: total, cancelReason: 'changed', cancelRequestId: requestId };
    const after = { ...before, status: 'CANCELED', balanceAmount: 0, cancels: [row] };
    const sent = { ...command, options: { ...command.options, cancelRequestId: requestId ?? undefined } };
    const snapshot = { currency, originalAmountMinor: minor, balanceBeforeMinor: minor, amountMinor: minor };
    expect(transactionFromCancelPost(after, sent, snapshot, before)).toBe(row.transactionKey);
    expect(transactionFromCancelPost({ ...after, lastTransactionKey: 'other' }, sent, snapshot, before)).toBeUndefined();
    expect(transactionFromCancelPost(after, sent, snapshot, { ...before, cancels: [row] })).toBeUndefined();
    expect(transactionFromCancelPost({ ...after, orderId: 'other' }, sent, snapshot, before)).toBeUndefined();
    expect(transactionFromCancelPost({ ...after, balanceAmount: 1 }, sent, snapshot, before)).toBeUndefined();
  });

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
