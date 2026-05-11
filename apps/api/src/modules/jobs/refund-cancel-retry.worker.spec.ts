import { describe, expect, it, vi } from 'vitest';
import { seatInventories, tickets } from '../../database/schema/index.js';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  REFUND_CANCEL_MAX_RETRIES,
  SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
} from '../refund/refund.service.js';
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

function createTransactionMock() {
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updateCalls.push({ table, values });
          return {
            where: vi.fn().mockResolvedValue(undefined),
          };
        },
      };
    },
  };

  return { tx, updateCalls };
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

  it('consumes pg-boss batch payloads when the registered worker runs', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, {
      cancelPayment: vi.fn(),
    } as never, boss as never);
    const handleJobSpy = vi
      .spyOn(worker, 'handleJob')
      .mockResolvedValue({ status: 'processing' });
    const payload = { refundId: 'refund-1', attempt: 1 };

    await worker.onModuleInit();
    const handler = boss.work.mock.calls[0]?.[1] as (
      jobs: Array<{ data: typeof payload }>,
    ) => Promise<void>;
    await handler([{ data: payload }]);

    expect(handleJobSpy).toHaveBeenCalledWith(payload);
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
    const recordScheduleSpy = vi
      .spyOn(worker as never, 'recordRetryScheduleState')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({
      refundId: 'refund-1',
      attempt: 1,
    });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심');
    expect(recordTransientSpy).toHaveBeenCalled();
    expect(scheduleRetrySpy).toHaveBeenCalledWith('refund-1', 1);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      'refund-1',
      {
        cancelReason: '단순 변심',
        lastTransientError: 'provider 5xx',
      },
      1,
      'refund-retry-job-2',
    );
    expect(result.status).toBe('rescheduled');
  });

  it('records retry schedule failure without throwing after transient provider failure', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn(),
      send: vi.fn().mockRejectedValue(new Error('Queue refund-cancel-retry does not exist')),
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
    const recordScheduleSpy = vi
      .spyOn(worker as never, 'recordRetryScheduleState')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({
      refundId: 'refund-1',
      attempt: 1,
    });

    expect(recordTransientSpy).toHaveBeenCalled();
    expect(boss.send).toHaveBeenCalled();
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      'refund-1',
      {
        cancelReason: '단순 변심',
        lastTransientError: 'provider 5xx',
      },
      1,
      null,
    );
    expect(result.status).toBe('retry_schedule_failed');
  });

  it('attempts the configured final retry before marking retry exhausted', async () => {
    const tossPaymentsClient = {
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('INTERNAL_SERVER_ERROR', 'provider 5xx')),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue({
      ...createRetryContext(),
      refund: {
        ...createRetryContext().refund,
        retryCount: REFUND_CANCEL_MAX_RETRIES - 1,
      },
    } as never);
    const recordTransientSpy = vi
      .spyOn(worker as never, 'recordTransientRetryFailure')
      .mockResolvedValue(undefined as never);
    const scheduleRetrySpy = vi.spyOn(worker as never, 'scheduleRetry');
    const exhaustedSpy = vi
      .spyOn(worker as never, 'markRetryExhausted')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 3 });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심');
    expect(recordTransientSpy).toHaveBeenCalledWith(
      'refund-1',
      expect.any(TossPaymentError),
      '단순 변심',
      REFUND_CANCEL_MAX_RETRIES,
    );
    expect(scheduleRetrySpy).not.toHaveBeenCalled();
    expect(exhaustedSpy).toHaveBeenCalledWith('refund-1', '단순 변심');
    expect(result.status).toBe('failed');
  });

  it('revokes issued QR tickets when a delayed refund retry completes', async () => {
    const transaction = createTransactionMock();
    const db = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction.tx),
      ),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    const worker = new RefundCancelRetryWorker(
      db as never,
      { cancelPayment: vi.fn() } as never,
      { isAvailable: false, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    vi.spyOn(worker as never, 'scheduleReleaseJob').mockResolvedValue(false as never);

    await (worker as any).finalizeSuccessfulRetry(
      createRetryContext(),
      { status: 'CANCELED' },
      '단순 변심',
    );

    const ticketUpdates = transaction.updateCalls.filter((call) => call.table === tickets);
    expect(ticketUpdates).toHaveLength(1);
    expect(ticketUpdates[0]?.values).toMatchObject({
      status: 'revoked',
      revokedAt: expect.any(Date),
    });

    const seatUpdates = transaction.updateCalls.filter((call) => call.table === seatInventories);
    expect(seatUpdates).toHaveLength(1);
    expect(seatUpdates[0]?.values).toMatchObject({
      status: 'held_cancelled',
      reopenJobId: SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
    });
  });
});
