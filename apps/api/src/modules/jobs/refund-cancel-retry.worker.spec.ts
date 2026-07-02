import { describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  REFUND_CANCEL_MAX_RETRIES,
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
      queryPayment: vi.fn(),
    } as never, {
      finalizeFullPaymentCancellation: vi.fn(),
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
      queryPayment: vi.fn(),
    } as never, {
      finalizeFullPaymentCancellation: vi.fn(),
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
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', cancels: [] }),
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('INTERNAL_SERVER_ERROR', 'provider 5xx')),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
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

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'default',
    });
    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
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
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', cancels: [] }),
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('INTERNAL_SERVER_ERROR', 'provider 5xx')),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
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
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', cancels: [] }),
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('INTERNAL_SERVER_ERROR', 'provider 5xx')),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
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

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(recordTransientSpy).toHaveBeenCalledWith(
      'refund-1',
      expect.any(TossPaymentError),
      '단순 변심',
      REFUND_CANCEL_MAX_RETRIES,
      null,
    );
    expect(scheduleRetrySpy).not.toHaveBeenCalled();
    expect(exhaustedSpy).toHaveBeenCalledWith('refund-1', '단순 변심');
    expect(result.status).toBe('failed');
  });

  it('finalizes locally when query already shows full payment canceled', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'CARD',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T03:00:00.000Z',
      }),
      cancelPayment: vi.fn(),
    };
    const finalizer = {
      finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({
        releaseJobId: 'release-job-1',
        releaseEnqueued: true,
      }),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'default',
    });
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith({
      source: 'refund_retry',
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
      actor: { kind: 'system' },
    });
    expect(result.status).toBe('completed');
  });

  it('reuses the stored cancellation quote when retrying fee-bearing full-reservation cancels', async () => {
    const cancellationQuote = {
      originalPaymentAmount: 102000,
      ticketSubtotal: 100000,
      ticketServiceFeeTotal: 2000,
      cancellationFeeTotal: 30000,
      serviceFeeRefundTotal: 0,
      refundableAmount: 70000,
      policyCodes: ['SHOW_DAY_2_TO_1'] as const,
      items: [
        {
          ticketItemId: 'ticket-item-1',
          ticketPrice: 100000,
          serviceFee: 2000,
          cancellationFee: 30000,
          serviceFeeRefund: 0,
          refundableAmount: 70000,
          policyCode: 'SHOW_DAY_2_TO_1' as const,
        },
      ],
    };
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        status: 'DONE',
        cancels: [],
      }),
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        totalAmount: 102000,
        status: 'PARTIAL_CANCELED',
        cancels: [
          {
            cancelAmount: 70000,
            cancelReason: '단순 변심',
            cancelStatus: 'DONE',
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
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancellationQuote,
    };
    context.payment.amount = 102000;

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      cancelAmount: 70000,
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        fullReservationCancellationQuote: cancellationQuote,
        providerResponse: expect.objectContaining({ status: 'PARTIAL_CANCELED' }),
      }),
    );
    expect(result.status).toBe('completed');
  });

  it('does not finalize KRW partial cancels from retry pre-query status alone without cancelRequestId', async () => {
    const cancellationQuote = {
      originalPaymentAmount: 102000,
      ticketSubtotal: 100000,
      ticketServiceFeeTotal: 2000,
      cancellationFeeTotal: 30000,
      serviceFeeRefundTotal: 0,
      refundableAmount: 70000,
      policyCodes: ['SHOW_DAY_2_TO_1'] as const,
      items: [
        {
          ticketItemId: 'ticket-item-1',
          ticketPrice: 100000,
          serviceFee: 2000,
          cancellationFee: 30000,
          serviceFeeRefund: 0,
          refundableAmount: 70000,
          policyCode: 'SHOW_DAY_2_TO_1' as const,
        },
      ],
    };
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        status: 'PARTIAL_CANCELED',
        cancels: [
          {
            cancelAmount: 70000,
            cancelReason: '단순 변심',
            cancelStatus: 'DONE',
          },
        ],
      }),
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        totalAmount: 102000,
        status: 'PARTIAL_CANCELED',
        cancels: [
          {
            cancelAmount: 70000,
            cancelReason: '단순 변심',
            cancelStatus: 'DONE',
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
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancellationQuote,
    };
    context.payment.amount = 102000;

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      cancelAmount: 70000,
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'default',
    });
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
  });

  it('reschedules without duplicate cancel when query shows matching async cancel in progress', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'DONE',
        approvedAt: '2026-05-08T03:00:00.000Z',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T03:05:00.000Z',
            cancelStatus: 'IN_PROGRESS',
            cancelRequestId: 'cancel_refund-1',
          },
        ],
      }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const markProcessingSpy = vi
      .spyOn(worker as never, 'markRefundProcessing')
      .mockResolvedValue(undefined as never);
    const scheduleRetrySpy = vi
      .spyOn(worker as never, 'scheduleRetry')
      .mockResolvedValue('refund-retry-job-2' as never);
    const recordScheduleSpy = vi
      .spyOn(worker as never, 'recordRetryScheduleState')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(markProcessingSpy).toHaveBeenCalledWith(
      'refund-1',
      expect.objectContaining({ status: 'DONE' }),
      '단순 변심',
      1,
      null,
    );
    expect(scheduleRetrySpy).toHaveBeenCalledWith('refund-1', 1);
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      'refund-1',
      {
        cancelReason: '단순 변심',
        paymentStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      },
      1,
      'refund-retry-job-2',
    );
    expect(result.status).toBe('processing');
  });

  it('keeps waiting at max retries when provider shows matching async cancel in progress', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'DONE',
        approvedAt: '2026-05-08T03:00:00.000Z',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T03:05:00.000Z',
            cancelStatus: 'IN_PROGRESS',
            cancelRequestId: 'cancel_refund-1',
          },
        ],
      }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.refund.retryCount = REFUND_CANCEL_MAX_RETRIES;
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const markProcessingSpy = vi
      .spyOn(worker as never, 'markRefundProcessing')
      .mockResolvedValue(undefined as never);
    const scheduleRetrySpy = vi
      .spyOn(worker as never, 'scheduleRetry')
      .mockResolvedValue('refund-retry-job-max' as never);
    const recordScheduleSpy = vi
      .spyOn(worker as never, 'recordRetryScheduleState')
      .mockResolvedValue(undefined as never);
    const exhaustedSpy = vi.spyOn(worker as never, 'markRetryExhausted');
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure');

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 4 });

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(markProcessingSpy).toHaveBeenCalledWith(
      'refund-1',
      expect.objectContaining({ status: 'DONE' }),
      '단순 변심',
      REFUND_CANCEL_MAX_RETRIES,
      null,
    );
    expect(scheduleRetrySpy).toHaveBeenCalledWith(
      'refund-1',
      REFUND_CANCEL_MAX_RETRIES,
    );
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      'refund-1',
      {
        cancelReason: '단순 변심',
        paymentStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      },
      REFUND_CANCEL_MAX_RETRIES,
      'refund-retry-job-max',
    );
    expect(exhaustedSpy).not.toHaveBeenCalled();
    expect(finalFailureSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('processing');
  });

  it('marks failed at max retries when matching async cancel is aborted', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'DONE',
        approvedAt: '2026-05-08T03:00:00.000Z',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T03:05:00.000Z',
            cancelStatus: 'ABORTED',
            cancelRequestId: 'cancel_refund-1',
          },
        ],
      }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.refund.retryCount = REFUND_CANCEL_MAX_RETRIES;
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const processingSpy = vi.spyOn(worker as never, 'markRefundProcessing');
    const exhaustedSpy = vi
      .spyOn(worker as never, 'markRetryExhausted')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 4 });

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(processingSpy).not.toHaveBeenCalled();
    expect(exhaustedSpy).toHaveBeenCalledWith('refund-1', '단순 변심');
    expect(result.status).toBe('failed');
  });

  it('reissues retry cancel with the same policy options when query is not terminal', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'DONE',
        approvedAt: '2026-05-08T03:00:00.000Z',
        cancels: [],
      }),
      cancelPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1',
        orderId: 'GRP-20260508-ABCDE',
        method: 'FOREIGN_EASY_PAY',
        totalAmount: 132000,
        status: 'CANCELED',
        approvedAt: '2026-05-08T03:00:00.000Z',
        cancels: [
          {
            cancelAmount: 132000,
            cancelReason: '단순 변심',
            canceledAt: '2026-05-08T03:05:00.000Z',
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
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      finalizer as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    const context = createRetryContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '단순 변심', {
      idempotencyKey: 'refund-cancel:refund-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelRequestId: 'cancel_refund-1',
    });
    expect(tossPaymentsClient.cancelPayment.mock.calls[0]?.[2]).not.toHaveProperty(
      'cancelAmount',
    );
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
  });
});
