import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TossPaymentError } from '../payment/toss-payments.client.js';
import {
  REFUND_CANCEL_ATTENTION_RETRY_COUNT,
  REFUND_CANCEL_POST_WINDOW_MS,
  REFUND_RETRY_WINDOW_EXPIRED_CODE,
  refundCancelRetryDelaySeconds,
} from '../refund/refund.service.js';
import { RefundCancelRetryWorker } from './refund-cancel-retry.worker.js';

const LEGACY_THREE_ATTEMPT_BUDGET = 3;

function createRetryContext() {
  return {
    refund: {
      id: 'refund-1',
      retryCount: 0,
      status: 'sent_to_pg',
      providerMetadata: { cancelReason: '단순 변심' },
      requestedAt: new Date('2026-05-08T03:00:00.000Z'),
      sentToPgAt: new Date('2026-05-08T03:00:00.000Z'),
      processingAtPgAt: null,
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
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-08T04:00:00.000Z'));
    // Attempt claiming is a conditional SQL update; it is covered against PostgreSQL in the integration spec.
    vi.spyOn(RefundCancelRetryWorker.prototype as never, 'claimRetryAttempt').mockResolvedValue(true as never);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
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

  it('does not register the retry worker in producer-only mode', async () => {
    const boss = {
      isAvailable: true,
      processesJobs: false,
      work: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      {} as never,
      {} as never,
      boss as never,
    );

    await worker.onModuleInit();

    expect(boss.work).not.toHaveBeenCalled();
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
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', isPartialCancelable: true, cancels: [] }),
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
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', isPartialCancelable: true, cancels: [] }),
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

  it('keeps retrying an ambiguous provider failure past the former three-attempt budget', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi
        .fn()
        .mockRejectedValue(new TossPaymentError('FAILED_INTERNAL_SYSTEM_PROCESSING', '내부 시스템 처리 작업이 실패했습니다')),
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
        retryCount: LEGACY_THREE_ATTEMPT_BUDGET - 1,
      },
    } as never);
    const recordTransientSpy = vi
      .spyOn(worker as never, 'recordTransientRetryFailure')
      .mockResolvedValue(undefined as never);
    const scheduleRetrySpy = vi
      .spyOn(worker as never, 'scheduleRetry')
      .mockResolvedValue('refund-retry-job-4' as never);
    vi.spyOn(worker as never, 'recordRetryScheduleState').mockResolvedValue(undefined as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure');

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 3 });

    expect(recordTransientSpy).toHaveBeenCalledWith(
      'refund-1',
      expect.any(TossPaymentError),
      '단순 변심',
      LEGACY_THREE_ATTEMPT_BUDGET,
      null,
    );
    expect(scheduleRetrySpy).toHaveBeenCalledWith('refund-1', LEGACY_THREE_ATTEMPT_BUDGET);
    expect(finalFailureSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('rescheduled');
  });

  it.each([
    ['a non-JSON gateway page', new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON")],
    ['an unknown provider code', new TossPaymentError('SOMETHING_NEW', 'unknown')],
    ['a consecutive-request rejection', new TossPaymentError('FORBIDDEN_CONSECUTIVE_REQUEST', '반복적인 요청')],
  ])('treats %s as ambiguous and reschedules instead of failing', async (_label, error) => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn().mockRejectedValue(error),
    };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
    );
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(createRetryContext() as never);
    vi.spyOn(worker as never, 'recordTransientRetryFailure').mockResolvedValue(undefined as never);
    vi.spyOn(worker as never, 'scheduleRetry').mockResolvedValue('refund-retry-job-2' as never);
    vi.spyOn(worker as never, 'recordRetryScheduleState').mockResolvedValue(undefined as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure');
    const restoreSpy = vi.spyOn(worker as never, 'restoreRejectedRights');

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('rescheduled');
    expect(finalFailureSpy).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it('ignores a duplicated job whose attempt was already claimed', async () => {
    vi.mocked((RefundCancelRetryWorker.prototype as unknown as { claimRetryAttempt: () => Promise<boolean> }).claimRetryAttempt)
      .mockResolvedValue(false);
    const tossPaymentsClient = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const worker = new RefundCancelRetryWorker(
      {} as never,
      tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never,
    );
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(createRetryContext() as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('stale_job');
    expect(tossPaymentsClient.queryPayment).not.toHaveBeenCalled();
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('finalizes a zero-amount refund locally without calling the provider', async () => {
    const tossPaymentsClient = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const finalizer = { finalizeFullPaymentCancellation: vi.fn().mockResolvedValue({ releaseJobId: 'job', releaseEnqueued: true }) };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never, finalizer as never);
    const context = createRetryContext();
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      localOnlyCancellation: true,
      cancellationQuote: {
        originalPaymentAmount: 2000, ticketSubtotal: 0, ticketServiceFeeTotal: 2000, cancellationFeeTotal: 0,
        serviceFeeRefundTotal: 0, refundableAmount: 0, policyCodes: ['WITHIN_7_DAYS_AFTER_BOOKING'],
        items: [{ ticketItemId: 'ticket-item-1', ticketPrice: 0, serviceFee: 2000, cancellationFee: 0,
          serviceFeeRefund: 0, refundableAmount: 0, policyCode: 'WITHIN_7_DAYS_AFTER_BOOKING' }],
      },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('completed');
    expect(tossPaymentsClient.queryPayment).not.toHaveBeenCalled();
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true }));
  });

  it('restores rights without a POST when the provider holds more than the frozen ledger balance', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 132000,
        balanceAmount: 132000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancelRequest: { paymentKey: 'pay-key-1', reason: '단순 변심 [refund-1]',
        options: { idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'default', cancelAmount: 50000 } },
      providerRefund: { currency: 'KRW', amountMinor: 50000, originalAmountMinor: 132000, balanceBeforeMinor: 80000 },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const restoreSpy = vi.spyOn(worker as never, 'restoreRejectedRights').mockResolvedValue(undefined as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure');

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalledWith(context.refund, expect.objectContaining({ code: 'BALANCE_RECONCILIATION_REQUIRED' }));
    expect(finalFailureSpy).not.toHaveBeenCalled();
  });

  it('keeps rights revoked for manual review when the provider balance is below the frozen ledger balance', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'PARTIAL_CANCELED', currency: 'KRW', totalAmount: 132000,
        balanceAmount: 60000, isPartialCancelable: true, cancels: [{ cancelAmount: 20000, cancelReason: 'console',
          cancelStatus: 'DONE', canceledAt: '2026-05-08T03:30:00.000Z' }] }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancelRequest: { paymentKey: 'pay-key-1', reason: '단순 변심 [refund-1]',
        options: { idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'default', cancelAmount: 50000 } },
      providerRefund: { currency: 'KRW', amountMinor: 50000, originalAmountMinor: 132000, balanceBeforeMinor: 80000 },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const restoreSpy = vi.spyOn(worker as never, 'restoreRejectedRights');
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure').mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(finalFailureSpy).toHaveBeenCalledWith('refund-1', expect.objectContaining({ code: 'BALANCE_RECONCILIATION_REQUIRED' }));
  });

  it('stops resending a frozen command after the provider idempotency window and records it apart from a balance mismatch', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 132000,
        balanceAmount: 132000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const updates: Array<Record<string, unknown>> = [];
    const db = { update: vi.fn(() => ({ set: (values: Record<string, unknown>) => {
      updates.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    } })) };
    const worker = new RefundCancelRetryWorker(db as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    context.refund.requestedAt = new Date(Date.now() - REFUND_CANCEL_POST_WINDOW_MS);
    // The frozen ledger still matches the PG balance: only the window closed.
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancelRequest: { paymentKey: 'pay-key-1', reason: '단순 변심 [refund-1]',
        options: { idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'default' } },
      providerRefund: { currency: 'KRW', amountMinor: 132000, originalAmountMinor: 132000, balanceBeforeMinor: 132000 },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure');
    const restoreSpy = vi.spyOn(worker as never, 'restoreRejectedRights');

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
    expect(finalFailureSpy).toHaveBeenCalledWith('refund-1', expect.objectContaining({ code: REFUND_RETRY_WINDOW_EXPIRED_CODE }));
    expect(updates).toEqual([expect.objectContaining({
      status: 'failed',
      resultCode: 'REFUND_RETRY_WINDOW_EXPIRED',
      customerServiceCtaVisible: true,
    })]);
  });

  it('keeps a legacy refund without a frozen ledger as a balance reconciliation case after the window', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', currency: 'KRW', totalAmount: 132000,
        balanceAmount: 132000, isPartialCancelable: true, cancels: [] }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    context.refund.requestedAt = new Date(Date.now() - REFUND_CANCEL_POST_WINDOW_MS);
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure').mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(finalFailureSpy).toHaveBeenCalledWith('refund-1', expect.objectContaining({ code: 'BALANCE_RECONCILIATION_REQUIRED' }));
  });

  it('uses a long backoff and surfaces attention after repeated ambiguous attempts', () => {
    expect(refundCancelRetryDelaySeconds(1)).toBe(60);
    expect(refundCancelRetryDelaySeconds(4)).toBe(600);
    expect(refundCancelRetryDelaySeconds(40)).toBe(86400);
    expect(REFUND_CANCEL_ATTENTION_RETRY_COUNT).toBe(3);
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
        isPartialCancelable: true,
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
            canceledAt: '2026-05-08T03:05:00.000Z',
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

  it('finalizes KRW partial cancels from retry pre-query status without cancelRequestId', async () => {
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
            canceledAt: '2026-05-08T03:05:00.000Z',
            cancelStatus: 'DONE',
          },
        ],
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
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancellationQuote,
    };
    context.payment.amount = 102000;

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
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
      { awaitingProvider: true },
    );
    expect(result.status).toBe('processing');
  });

  it('keeps waiting after many attempts when provider shows matching async cancel in progress', async () => {
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
    context.refund.retryCount = LEGACY_THREE_ATTEMPT_BUDGET;
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
      LEGACY_THREE_ATTEMPT_BUDGET + 1,
      null,
    );
    expect(scheduleRetrySpy).toHaveBeenCalledWith(
      'refund-1',
      LEGACY_THREE_ATTEMPT_BUDGET + 1,
    );
    expect(recordScheduleSpy).toHaveBeenCalledWith(
      'refund-1',
      {
        cancelReason: '단순 변심',
        paymentStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      },
      LEGACY_THREE_ATTEMPT_BUDGET + 1,
      'refund-retry-job-max',
      { awaitingProvider: true },
    );
    expect(finalFailureSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('processing');
  });

  it('fails for manual review without another POST when an aborted async cancel has no frozen balance', async () => {
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
    context.refund.retryCount = LEGACY_THREE_ATTEMPT_BUDGET;
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';

    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const processingSpy = vi.spyOn(worker as never, 'markRefundProcessing');
    const finalFailureSpy = vi
      .spyOn(worker as never, 'markFinalFailure')
      .mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 4 });

    expect(tossPaymentsClient.queryPayment).toHaveBeenCalledWith('pay-key-1', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(processingSpy).not.toHaveBeenCalled();
    expect(finalFailureSpy).toHaveBeenCalledWith('refund-1', expect.objectContaining({ code: 'BALANCE_RECONCILIATION_REQUIRED' }));
    expect(result.status).toBe('failed');
  });

  it('restores rights when the provider aborted this exact async cancel and the balance is unchanged', async () => {
    const tossPaymentsClient = {
      queryPayment: vi.fn().mockResolvedValue({
        paymentKey: 'pay-key-1', status: 'DONE', currency: 'USD', totalAmount: 100.5, balanceAmount: 100.5,
        cancels: [{ cancelAmount: 100.5, cancelReason: '단순 변심 [refund-1]', canceledAt: '2026-05-08T03:05:00.000Z',
          cancelStatus: 'ABORTED', cancelRequestId: 'cancel_refund-1' }],
      }),
      cancelPayment: vi.fn(),
    };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    context.payment.method = 'FOREIGN_EASY_PAY';
    context.payment.provider = 'ALIPAY';
    context.payment.currency = 'USD';
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancelRequest: { paymentKey: 'pay-key-1', reason: '단순 변심 [refund-1]', options: {
        idempotencyKey: 'refund-cancel:refund-1', secretKeyScope: 'foreign-easy-pay', cancelRequestId: 'cancel_refund-1' } },
      providerRefund: { currency: 'USD', amountMinor: 10050, originalAmountMinor: 10050, balanceBeforeMinor: 10050 },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const restoreSpy = vi.spyOn(worker as never, 'restoreRejectedRights').mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
    expect(restoreSpy).toHaveBeenCalledWith(context.refund, expect.objectContaining({ code: 'PROVIDER_CANCEL_ABORTED' }));
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

describe('RefundCancelRetryWorker stale refund recovery', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  function staleRows(rows: Array<{ id: string; retryCount: number }>) {
    return {
      select: vi.fn(() => ({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: vi.fn().mockResolvedValue(rows) }) }) }),
      })),
    };
  }

  it('fails a legacy refund for manual review when its cancel command cannot be rebuilt, instead of throwing every run', async () => {
    vi.spyOn(RefundCancelRetryWorker.prototype as never, 'claimRetryAttempt').mockResolvedValue(true as never);
    const tossPaymentsClient = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
    const worker = new RefundCancelRetryWorker({} as never, tossPaymentsClient as never,
      { finalizeFullPaymentCancellation: vi.fn() } as never);
    const context = createRetryContext();
    // No frozen command and a stored quote larger than the payment: the command builder rejects it.
    context.refund.providerMetadata = {
      cancelReason: '단순 변심',
      cancellationQuote: { originalPaymentAmount: 132000, refundableAmount: 500000, items: [], policyCodes: [] },
    } as never;
    vi.spyOn(worker as never, 'loadRetryContext').mockResolvedValue(context as never);
    const finalFailureSpy = vi.spyOn(worker as never, 'markFinalFailure').mockResolvedValue(undefined as never);

    const result = await worker.handleJob({ refundId: 'refund-1', attempt: 1 });

    expect(result.status).toBe('failed');
    expect(finalFailureSpy).toHaveBeenCalledWith('refund-1', expect.objectContaining({ code: 'CANCEL_COMMAND_UNAVAILABLE' }));
    expect(tossPaymentsClient.queryPayment).not.toHaveBeenCalled();
    expect(tossPaymentsClient.cancelPayment).not.toHaveBeenCalled();
  });

  it('defers each stale row before running it and skips rows another sweep already took', async () => {
    const db = staleRows([{ id: 'refund-a', retryCount: 0 }, { id: 'refund-b', retryCount: 2 }]);
    const worker = new RefundCancelRetryWorker(db as never, {} as never, {} as never);
    const deferSpy = vi.spyOn(worker as never, 'deferStaleRefund')
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never);
    const handleSpy = vi.spyOn(worker, 'handleJob').mockResolvedValue({ status: 'missing_refund' });
    const now = new Date('2026-05-08T05:00:00.000Z');

    const result = await worker.recoverStaleRefunds(now);

    expect(deferSpy).toHaveBeenNthCalledWith(1, 'refund-a', now, expect.any(String), expect.any(String));
    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(handleSpy).toHaveBeenCalledWith({ refundId: 'refund-b', attempt: 3 });
    // A row the attempt could not move is counted as found but not attempted; it was already deferred.
    expect(result).toEqual({ found: 1, attempted: 0 });
  });

  it('waits for the row in flight on shutdown and does not start the next one', async () => {
    const db = staleRows([{ id: 'refund-a', retryCount: 0 }, { id: 'refund-b', retryCount: 0 }]);
    const worker = new RefundCancelRetryWorker(db as never, {} as never, {} as never, undefined,
      { get: vi.fn().mockReturnValue(undefined) } as never);
    vi.spyOn(worker as never, 'deferStaleRefund').mockResolvedValue(true as never);
    let finishFirst!: () => void;
    const handleSpy = vi.spyOn(worker, 'handleJob').mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = () => resolve({ status: 'completed' });
    }));

    await worker.onModuleInit();
    await vi.waitFor(() => expect(handleSpy).toHaveBeenCalledTimes(1));
    let destroyed = false;
    const destroy = worker.onModuleDestroy().then(() => { destroyed = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(destroyed).toBe(false);

    finishFirst();
    await destroy;

    expect(destroyed).toBe(true);
    expect(handleSpy).toHaveBeenCalledTimes(1);
  });
});
