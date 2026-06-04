import { describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  isTossCancelCompleted,
  RefundService,
  SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
} from './refund.service.js';
import {
  bookingOperationAuditLogs,
  seatInventories,
  tickets,
} from '../../database/schema/index.js';

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

function createRefundTransactionMock(completedRefund: ReturnType<typeof createRefund>) {
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];

  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          updateCalls.push({ table, values });
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([completedRefund]),
            })),
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: unknown) {
          insertCalls.push({ table, values });
          return Promise.resolve(values);
        },
      };
    },
  };

  return { tx, updateCalls, insertCalls };
}

describe('RefundService', () => {
  it('treats only CANCELED Toss responses as completed refund cancels', () => {
    expect(isTossCancelCompleted({ status: 'CANCELED' } as never)).toBe(true);
    expect(isTossCancelCompleted({ status: 'DONE' } as never)).toBe(false);
    expect(isTossCancelCompleted({ status: 'PARTIAL_CANCELED' } as never)).toBe(false);
  });

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
    const service = new RefundService({} as never, tossPaymentsClient as never, pgBoss as never);
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
      idempotencyKey: 'reservation-cancel:reservation-1:payment-1',
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
    const service = new RefundService({} as never, tossPaymentsClient as never, pgBoss as never);
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

  it('holds refunded seats and writes admin refund audit rows on admin refund completion', async () => {
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'CANCELED',
      resultMessage: 'PG cancel completed',
      completedAt: new Date('2026-05-08T03:10:00.000Z'),
    });
    const transaction = createRefundTransactionMock(completedRefund);
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
    const pgBoss = {
      isAvailable: false,
      send: vi.fn(),
    };
    const service = new RefundService(
      db as never,
      { cancelPayment: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();

    const result = await (service as any).finalizeRefundSuccess(
      context,
      'refund-1',
      '관리자 환불',
      {
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: '카드',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T12:00:00+09:00',
        cancels: [],
      },
      { kind: 'admin', operatorUserId: 'admin-1' },
    );

    expect(result).toBe(completedRefund);
    const seatUpdates = transaction.updateCalls.filter(
      (call) => call.table === seatInventories,
    );
    expect(seatUpdates).toHaveLength(1);
    expect(seatUpdates[0]?.values).toMatchObject({
      status: 'held_cancelled',
      lockedBy: null,
      lockedUntil: null,
      reopenJobId: SEAT_RELEASE_ENQUEUE_FAILED_JOB_ID,
    });
    const ticketUpdates = transaction.updateCalls.filter((call) => call.table === tickets);
    expect(ticketUpdates).toHaveLength(1);
    expect(ticketUpdates[0]?.values).toMatchObject({
      status: 'revoked',
      revokedAt: expect.any(Date),
    });

    expect(transaction.insertCalls).toHaveLength(1);
    expect(transaction.insertCalls[0]?.table).toBe(bookingOperationAuditLogs);
    expect(transaction.insertCalls[0]?.values).toEqual([
      expect.objectContaining({
        operatorUserId: 'admin-1',
        action: 'admin_refund',
        seatKey: '1F:A-10',
        reservationId: 'reservation-1',
      }),
    ]);
    expect(pgBoss.send).not.toHaveBeenCalled();
  });

  it('persists the preallocated release job id with refunded seats when enqueue succeeds', async () => {
    const completedRefund = createRefund({
      status: 'completed',
      resultCode: 'CANCELED',
      resultMessage: 'PG cancel completed',
      completedAt: new Date('2026-05-08T03:10:00.000Z'),
    });
    const transaction = createRefundTransactionMock(completedRefund);
    const db = {
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(transaction.tx),
      ),
    };
    const pgBoss = {
      isAvailable: true,
      send: vi.fn((_queue: unknown, _payload: unknown, options: { id: string }) =>
        Promise.resolve(options.id),
      ),
    };
    const service = new RefundService(
      db as never,
      { cancelPayment: vi.fn() } as never,
      pgBoss as never,
    );
    const context = createContext();

    await (service as any).finalizeRefundSuccess(
      context,
      'refund-1',
      '사용자 환불',
      {
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: '카드',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T12:00:00+09:00',
        cancels: [],
      },
      { kind: 'user' },
    );

    const sendOptions = pgBoss.send.mock.calls[0]?.[2] as { id?: string } | undefined;
    expect(sendOptions).toEqual(expect.objectContaining({ id: expect.any(String) }));

    const seatUpdates = transaction.updateCalls.filter(
      (call) => call.table === seatInventories,
    );
    expect(seatUpdates).toHaveLength(1);
    expect(seatUpdates[0]?.values).toMatchObject({
      status: 'held_cancelled',
      reopenJobId: sendOptions?.id,
    });
  });
});
