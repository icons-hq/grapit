import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import {
  PaymentWebhookController,
  tossWebhookSchema,
} from './payment-webhook.controller.js';
import { TossWebhookGuard } from './toss-webhook.guard.js';
import type {
  AsyncPaymentProgressSnapshot,
  PaymentService,
  TossWebhookRecordResult,
  TossWebhookRequestBody,
} from './payment.service.js';

function createMockPaymentService() {
  return {
    recordWebhookEvent: vi.fn<PaymentService['recordWebhookEvent']>(),
    findAsyncPaymentProgress: vi.fn<PaymentService['findAsyncPaymentProgress']>(),
    upsertAsyncPaymentProgress: vi.fn<PaymentService['upsertAsyncPaymentProgress']>(),
    markWebhookEventProcessed: vi.fn<PaymentService['markWebhookEventProcessed']>(),
    markWebhookEventFailed: vi.fn<PaymentService['markWebhookEventFailed']>(),
  };
}

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let paymentService: ReturnType<typeof createMockPaymentService>;

  const paymentStatusChangedEvent: TossWebhookRequestBody = {
    eventId: 'evt-payment-done-1',
    eventType: 'PAYMENT_STATUS_CHANGED',
    createdAt: '2026-05-08T07:00:00.000Z',
    data: {
      paymentKey: 'pay_async_1',
      orderId: 'GRP-ASYNC-1',
      status: 'DONE',
      method: 'FOREIGN_EASY_PAY',
      provider: 'ALIPAY_PLUS',
      currency: 'USD',
      totalAmount: 150000,
      approvedAt: '2026-05-08T07:00:05.000Z',
    },
  };

  const cancelStatusChangedEvent: TossWebhookRequestBody = {
    eventId: 'evt-cancel-1',
    eventType: 'CANCEL_STATUS_CHANGED',
    createdAt: '2026-05-08T07:02:00.000Z',
    data: {
      paymentKey: 'pay_async_1',
      orderId: 'GRP-ASYNC-1',
      status: 'CANCELED',
      method: 'FOREIGN_EASY_PAY',
      provider: 'ALIPAY_PLUS',
      currency: 'USD',
      totalAmount: 150000,
      canceledAt: '2026-05-08T07:02:05.000Z',
      cancelReason: 'buyer changed mind',
    },
  };

  beforeEach(() => {
    paymentService = createMockPaymentService();
    controller = new PaymentWebhookController(paymentService as unknown as PaymentService);
  });

  function makeLedgerResult(
    overrides: Partial<TossWebhookRecordResult> = {},
  ): TossWebhookRecordResult {
    return {
      state: 'inserted',
      eventId: 'evt-payment-done-1',
      ...overrides,
    };
  }

  function makeProgress(
    overrides: Partial<AsyncPaymentProgressSnapshot> = {},
  ): AsyncPaymentProgressSnapshot {
    return {
      reservationId: 'reservation-1',
      reservationStatus: 'PENDING_PAYMENT',
      paymentStatus: 'IN_PROGRESS',
      ...overrides,
    };
  }

  it('marks the Toss webhook endpoint public while requiring provider guard authentication', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        PaymentWebhookController.prototype.handleTossWebhook,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        PaymentWebhookController.prototype.handleTossWebhook,
      ),
    ).toContain(TossWebhookGuard);
  });

  it('accepts Toss webhook timestamps with timezone offsets', () => {
    const parsed = tossWebhookSchema.parse({
      ...paymentStatusChangedEvent,
      createdAt: '2026-05-11T11:25:14+09:00',
      data: {
        ...paymentStatusChangedEvent.data,
        approvedAt: '2026-05-11T11:25:14+09:00',
      },
    });

    expect(parsed.createdAt).toBe('2026-05-11T11:25:14+09:00');
    expect(parsed.data.approvedAt).toBe('2026-05-11T11:25:14+09:00');
  });

  it('accepts Toss webhook timestamps without timezone offsets', () => {
    const parsed = tossWebhookSchema.parse({
      ...paymentStatusChangedEvent,
      createdAt: '2026-05-11T11:25:14.903866',
      data: {
        ...paymentStatusChangedEvent.data,
        approvedAt: '2026-05-11T11:25:14.903866',
        provider: 'TOSS_TRANSFER',
      },
    });

    expect(parsed.createdAt).toBe('2026-05-11T11:25:14.903866');
    expect(parsed.data.approvedAt).toBe('2026-05-11T11:25:14.903866');
    expect(parsed.data.provider).toBeUndefined();
  });

  it('uses Toss transmission header when the payment webhook body has no eventId', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({
        eventId: 'transmission-1',
      }),
    );
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());

    const { eventId: _eventId, ...bodyWithoutEventId } = paymentStatusChangedEvent;
    await controller.handleTossWebhook(bodyWithoutEventId, 'transmission-1');

    expect(paymentService.recordWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'transmission-1',
        eventType: 'PAYMENT_STATUS_CHANGED',
      }),
    );
    expect(paymentService.markWebhookEventProcessed).toHaveBeenCalledWith(
      'transmission-1',
      'PAYMENT_STATUS_CHANGED_DONE_APPLIED',
      undefined,
    );
  });

  it('acknowledges duplicate replay without re-applying an already processed event', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({
        state: 'duplicate-processed',
        processingResultCode: 'PAYMENT_DONE_APPLIED',
      }),
    );

    const result = await controller.handleTossWebhook(paymentStatusChangedEvent);

    expect(result).toEqual({
      acknowledged: true,
      duplicate: true,
      processingResultCode: 'PAYMENT_DONE_APPLIED',
    });
    expect(paymentService.findAsyncPaymentProgress).not.toHaveBeenCalled();
    expect(paymentService.upsertAsyncPaymentProgress).not.toHaveBeenCalled();
    expect(paymentService.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it('ignores stale payment completion after cancel already won', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(makeLedgerResult());
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(
      makeProgress({
        reservationStatus: 'FAILED',
        paymentStatus: 'CANCELED',
      }),
    );

    const result = await controller.handleTossWebhook(paymentStatusChangedEvent);

    expect(result).toEqual({
      acknowledged: true,
      duplicate: false,
      processingResultCode: 'IGNORED_STALE_PAYMENT_EVENT',
    });
    expect(paymentService.upsertAsyncPaymentProgress).not.toHaveBeenCalled();
    expect(paymentService.markWebhookEventProcessed).toHaveBeenCalledWith(
      'evt-payment-done-1',
      'IGNORED_STALE_PAYMENT_EVENT',
      'stale payment event after cancel/failure terminal state',
    );
  });

  it('re-applies DONE webhook replay when payment exists but reservation is still pending', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(makeLedgerResult());
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(
      makeProgress({
        reservationStatus: 'PENDING_PAYMENT',
        paymentStatus: 'DONE',
      }),
    );

    const result = await controller.handleTossWebhook(paymentStatusChangedEvent);

    expect(result).toEqual({
      acknowledged: true,
      duplicate: false,
      processingResultCode: 'PAYMENT_STATUS_CHANGED_DONE_APPLIED',
    });
    expect(paymentService.upsertAsyncPaymentProgress).toHaveBeenCalledWith(
      paymentStatusChangedEvent,
      'DONE',
      'payment_status_changed:done',
    );
  });

  it('re-applies DONE webhook replay when post-commit side effects previously failed', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({
        state: 'duplicate-pending',
        processingResultCode: 'PROCESSING_FAILED',
      }),
    );
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(
      makeProgress({
        reservationStatus: 'CONFIRMED',
        paymentStatus: 'DONE',
      }),
    );

    const result = await controller.handleTossWebhook(paymentStatusChangedEvent);

    expect(result).toEqual({
      acknowledged: true,
      duplicate: false,
      processingResultCode: 'PAYMENT_STATUS_CHANGED_DONE_APPLIED',
    });
    expect(paymentService.upsertAsyncPaymentProgress).toHaveBeenCalledWith(
      paymentStatusChangedEvent,
      'DONE',
      'payment_status_changed:done',
    );
    expect(paymentService.markWebhookEventProcessed).toHaveBeenCalledWith(
      'evt-payment-done-1',
      'PAYMENT_STATUS_CHANGED_DONE_APPLIED',
      undefined,
    );
  });

  it('applies cancel webhook once and marks the ledger row processed', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({
        eventId: 'evt-cancel-1',
      }),
    );
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());

    const result = await controller.handleTossWebhook(cancelStatusChangedEvent);

    expect(result).toEqual({
      acknowledged: true,
      duplicate: false,
      processingResultCode: 'CANCEL_STATUS_CHANGED_APPLIED',
    });
    expect(paymentService.upsertAsyncPaymentProgress).toHaveBeenCalledWith(
      cancelStatusChangedEvent,
      'CANCELED',
      'cancelled_webhook',
    );
    expect(paymentService.markWebhookEventProcessed).toHaveBeenCalledWith(
      'evt-cancel-1',
      'CANCEL_STATUS_CHANGED_APPLIED',
      undefined,
    );
  });
});
