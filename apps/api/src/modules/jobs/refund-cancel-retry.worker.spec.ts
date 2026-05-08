import { describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import { RefundCancelRetryWorker } from './refund-cancel-retry.worker.js';

function createRetryContext() {
  return {
    refund: {
      id: 'refund-1',
      retryCount: 0,
      status: 'sent_to_pg',
      providerMetadata: { cancelReason: '단순 변심' },
    },
    reservation: {
      id: 'reservation-1',
      showtimeId: 'showtime-1',
    },
    payment: {
      id: 'payment-1',
      paymentKey: 'pay-key-1',
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

describe('RefundCancelRetryWorker', () => {
  it('registers the refund-cancel-retry worker on module init', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, {
      cancelPayment: vi.fn(),
    } as never, boss as never);

    await worker.onModuleInit();

    expect(boss.work).toHaveBeenCalledWith('refund-cancel-retry', expect.any(Function));
  });

  it('reschedules durable retry work when Toss cancel fails transiently again', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn(),
      send: vi.fn().mockResolvedValue('refund-retry-job-2'),
      stop: vi.fn(),
    };
    const tossPaymentsClient = {
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('INTERNAL_SERVER_ERROR', 'provider 5xx')),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      boss as never,
    );

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(
      createRetryContext() as never,
    );
    const recordTransientSpy = vi
      .spyOn(worker as never, 'recordTransientRetryFailure')
      .mockResolvedValue(undefined as never);
    const scheduleRetrySpy = vi
      .spyOn(worker as never, 'scheduleRetry')
      .mockResolvedValue('refund-retry-job-2' as never);

    const result = await worker.handleJob({
      refundId: 'refund-1',
      attempt: 1,
    });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심');
    expect(recordTransientSpy).toHaveBeenCalled();
    expect(scheduleRetrySpy).toHaveBeenCalledWith('refund-1', 1);
    expect(result.status).toBe('rescheduled');
  });
});
