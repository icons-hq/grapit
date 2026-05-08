import { describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import { RefundService } from './refund.service.js';

function createRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    reservationId: 'reservation-1',
    paymentId: 'payment-1',
    status: 'requested',
    provider: 'toss_payments',
    providerRefundKey: null,
    resultCode: 'REQUESTED',
    resultMessage: 'Refund requested by user',
    failureReason: null,
    providerMetadata: {},
    retryCount: 0,
    customerServiceCtaVisible: false,
    requestedAt: new Date('2026-05-08T03:00:00.000Z'),
    sentToPgAt: null,
    processingAtPgAt: null,
    completedAt: null,
    failedAt: null,
    expectedDepositAt: new Date('2026-05-11T03:00:00.000Z'),
    createdAt: new Date('2026-05-08T03:00:00.000Z'),
    updatedAt: new Date('2026-05-08T03:00:00.000Z'),
    ...overrides,
  };
}

function createContext() {
  return {
    reservation: {
      id: 'reservation-1',
      reservationNumber: 'GRP-20260508-ABCDE',
      status: 'CONFIRMED',
      showtimeId: 'showtime-1',
    },
    payment: {
      id: 'payment-1',
      paymentKey: 'pay-key-1',
      amount: 132000,
      providerMetadata: null,
    },
    showtime: {
      id: 'showtime-1',
      performanceId: 'performance-1',
      dateTime: new Date('2026-05-15T10:00:00.000Z'),
    },
    bookingPolicy: {
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
    },
    seats: [{ seatId: '1F:A-10' }],
  };
}

describe('RefundService', () => {
  it('returns existing refund state for duplicate requests without calling Toss again', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
    };

    const service = new RefundService({} as never, tossPaymentsClient as never, pgBoss as never);
    const context = createContext();
    const existingRefund = createRefund({
      status: 'processing_at_pg',
      sentToPgAt: new Date('2026-05-08T03:05:00.000Z'),
      processingAtPgAt: new Date('2026-05-08T03:05:00.000Z'),
      resultCode: 'IN_PROGRESS',
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(existingRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(result.idempotent).toBe(true);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
  });

  it('persists sent_to_pg and enqueues refund-cancel-retry on transient Toss cancel failure', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi
        .fn()
        .mockRejectedValue(
          new TossPaymentError('INTERNAL_SERVER_ERROR', 'temporary 5xx from provider'),
        ),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockResolvedValue('job-refund-retry-1'),
    };

    const service = new RefundService({} as never, tossPaymentsClient as never, pgBoss as never);
    const context = createContext();
    const requestedRefund = createRefund();
    const retryableRefund = createRefund({
      status: 'sent_to_pg',
      sentToPgAt: new Date('2026-05-08T03:06:00.000Z'),
      resultCode: 'INTERNAL_SERVER_ERROR',
      resultMessage: 'temporary 5xx from provider',
      failureReason: 'temporary 5xx from provider',
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'markRefundSentToPg').mockResolvedValue(retryableRefund as never);
    const retrySpy = vi
      .spyOn(service as never, 'scheduleRefundCancelRetry')
      .mockResolvedValue('job-refund-retry-1' as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심');
    expect(retrySpy).toHaveBeenCalledWith(requestedRefund.id, requestedRefund.retryCount);
    expect(result.idempotent).toBe(false);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('SENT_TO_PG');
  });
});
