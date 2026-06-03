import { describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  isTossCancelCompleted,
  RefundService,
} from './refund.service.js';

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
      method: 'CARD',
      provider: 'CARD',
      currency: 'KRW',
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
  it('treats only CANCELED Toss responses as completed refund cancels', () => {
    expect(isTossCancelCompleted({ status: 'CANCELED' } as never)).toBe(true);
    expect(isTossCancelCompleted({ status: 'DONE' } as never)).toBe(false);
    expect(isTossCancelCompleted({ status: 'PARTIAL_CANCELED' } as never)).toBe(false);
    expect(isTossCancelCompleted({
      status: 'CANCELED',
      cancels: [{
        cancelAmount: 132000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'IN_PROGRESS',
        cancelRequestId: 'cancel_refund-1',
      }],
    } as never, 'cancel_refund-1')).toBe(false);
    expect(isTossCancelCompleted({
      status: 'CANCELED',
      cancels: [{
        cancelAmount: 132000,
        cancelReason: '단순 변심',
        canceledAt: '2026-05-08T03:05:00.000Z',
        cancelStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      }],
    } as never, 'cancel_refund-1')).toBe(true);
  });

  it('returns existing refund state for duplicate requests without calling Toss again', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
    };

    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const existingRefund = createRefund({
      status: 'processing_at_pg',
      sentToPgAt: new Date('2026-05-08T03:05:00.000Z'),
      processingAtPgAt: new Date('2026-05-08T03:05:00.000Z'),
      resultCode: 'IN_PROGRESS',
      providerMetadata: {
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-existing',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(existingRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(pgBoss.send).not.toHaveBeenCalled();
    expect(result.idempotent).toBe(true);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
  });

  it('reattempts retry enqueue for duplicate non-terminal refunds without a stored retry job', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn(),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn(),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const existingRefund = createRefund({
      status: 'sent_to_pg',
      sentToPgAt: new Date('2026-05-08T03:05:00.000Z'),
      resultCode: 'INTERNAL_SERVER_ERROR',
      providerMetadata: { cancelReason: '단순 변심' },
    });
    const scheduledRefund = createRefund({
      ...existingRefund,
      providerMetadata: {
        cancelReason: '단순 변심',
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-reattempt',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(existingRefund as never);
    const retrySpy = vi
      .spyOn(service as never, 'scheduleRefundCancelRetry')
      .mockResolvedValue('job-refund-retry-reattempt' as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduledRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(retrySpy).toHaveBeenCalledWith(existingRefund.id, existingRefund.retryCount);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      existingRefund,
      'job-refund-retry-reattempt',
    );
    expect(result.idempotent).toBe(true);
    expect(result.retryEnqueued).toBe(true);
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

    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const requestedRefund = createRefund();
    const retryableRefund = createRefund({
      status: 'sent_to_pg',
      sentToPgAt: new Date('2026-05-08T03:06:00.000Z'),
      resultCode: 'INTERNAL_SERVER_ERROR',
      resultMessage: 'temporary 5xx from provider',
      failureReason: 'temporary 5xx from provider',
    });
    const scheduledRefund = createRefund({
      ...retryableRefund,
      providerMetadata: {
        cancelReason: '단순 변심',
        refundCancelRetry: {
          status: 'scheduled',
          jobId: 'job-refund-retry-1',
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'markRefundSentToPg').mockResolvedValue(retryableRefund as never);
    const retrySpy = vi
      .spyOn(service as never, 'scheduleRefundCancelRetry')
      .mockResolvedValue('job-refund-retry-1' as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduledRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(retrySpy).toHaveBeenCalledWith(requestedRefund.id, requestedRefund.retryCount);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      retryableRefund,
      'job-refund-retry-1',
    );
    expect(result.idempotent).toBe(false);
    expect(result.retryEnqueued).toBe(true);
    expect(result.refundTimeline?.currentState).toBe('SENT_TO_PG');
  });

  it('keeps a provider-processing refund non-terminal when retry enqueue fails', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        status: 'IN_PROGRESS',
      }),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn().mockRejectedValue(new Error('Queue refund-cancel-retry does not exist')),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();
    const requestedRefund = createRefund();
    const processingRefund = createRefund({
      status: 'processing_at_pg',
      processingAtPgAt: new Date('2026-05-08T03:06:00.000Z'),
      resultCode: 'IN_PROGRESS',
    });
    const scheduleFailedRefund = createRefund({
      ...processingRefund,
      customerServiceCtaVisible: true,
      providerMetadata: {
        cancelReason: '단순 변심',
        paymentStatus: 'IN_PROGRESS',
        refundCancelRetry: {
          status: 'schedule_failed',
          jobId: null,
          attempt: 1,
        },
      },
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'markRefundProcessing').mockResolvedValue(processingRefund as never);
    const recordScheduleSpy = vi
      .spyOn(service as never, 'recordRefundCancelRetrySchedule')
      .mockResolvedValue(scheduleFailedRefund as never);
    const failedSpy = vi.spyOn(service as never, 'markRefundFailed');

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(pgBoss.send).toHaveBeenCalled();
    expect(recordScheduleSpy).toHaveBeenCalledWith(processingRefund, null);
    expect(failedSpy).not.toHaveBeenCalled();
    expect(result.retryEnqueued).toBe(false);
    expect(result.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
  });

  it('uses policy-built Alipay full-cancel options and finalizes through the shared finalizer', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T12:00:00+09:00',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T12:05:00+09:00',
            cancelStatus: 'DONE',
            cancelRequestId: 'cancel_refund-1',
          },
        ],
      }),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const service = new RefundService(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: false, send: vi.fn() } as never,
    );
    const context = createContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';
    const requestedRefund = createRefund();
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'CANCELED',
      resultMessage: 'PG cancel completed',
      completedAt: new Date('2026-05-08T03:10:00.000Z'),
    });

    vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
    vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);
    vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
    vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

    const result = await service.requestRefund('reservation-1', 'user-1', '단순 변심');

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelRequestId: 'cancel_refund-1',
    });
    expect(tossPaymentsClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty(
      'cancelAmount',
    );
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith({
      source: 'refund_request',
      refundId: 'refund-1',
      context: expect.objectContaining({
        reservation: expect.objectContaining({
          id: 'reservation-1',
          showtimeId: 'showtime-1',
        }),
        payment: expect.objectContaining({
          id: 'payment-1',
          paymentKey: 'pay-key-1',
        }),
        seats: [{ seatId: '1F:A-10' }],
      }),
      reason: '단순 변심',
      providerResponse: expect.objectContaining({ status: 'CANCELED' }),
      actor: { kind: 'user' },
    });
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
  });
});
