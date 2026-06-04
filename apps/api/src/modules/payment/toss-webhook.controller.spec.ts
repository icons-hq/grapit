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
import type { TossPaymentsClient, TossPaymentResponse } from './toss-payments.client.js';

function createMockPaymentService() {
  return {
    recordWebhookEvent: vi.fn<PaymentService['recordWebhookEvent']>(),
    findAsyncPaymentProgress: vi.fn<PaymentService['findAsyncPaymentProgress']>(),
    findProviderQueryOptions: vi.fn<PaymentService['findProviderQueryOptions']>(),
    upsertAsyncPaymentProgress: vi.fn<PaymentService['upsertAsyncPaymentProgress']>(),
    markWebhookEventProcessed: vi.fn<PaymentService['markWebhookEventProcessed']>(),
    markWebhookEventFailed: vi.fn<PaymentService['markWebhookEventFailed']>(),
  };
}

function createMockTossClient() {
  return {
    queryPayment: vi.fn<TossPaymentsClient['queryPayment']>(),
  };
}

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let paymentService: ReturnType<typeof createMockPaymentService>;
  let tossClient: ReturnType<typeof createMockTossClient>;

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
    tossClient = createMockTossClient();
    tossClient.queryPayment.mockResolvedValue(makeQueriedPayment());
    controller = new PaymentWebhookController(
      paymentService as unknown as PaymentService,
      tossClient as unknown as TossPaymentsClient,
    );
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

  function makeQueriedPayment(
    overrides: Partial<TossPaymentResponse> = {},
  ): TossPaymentResponse {
    return {
      paymentKey: 'pay_async_1',
      orderId: 'GRP-ASYNC-1',
      method: 'FOREIGN_EASY_PAY',
      totalAmount: 150000,
      status: 'DONE',
      approvedAt: '2026-05-08T07:00:05.000Z',
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

  it('accepts Toss Alipay webhook provider code before service-level normalization', () => {
    const parsed = tossWebhookSchema.parse({
      ...paymentStatusChangedEvent,
      data: {
        ...paymentStatusChangedEvent.data,
        provider: 'ALIPAY',
      },
    });

    expect(parsed.data.provider).toBe('ALIPAY');
  });

  it('accepts live Toss nullable fields and decimal foreign easy-pay totals', () => {
    const parsed = tossWebhookSchema.parse({
      eventType: 'PAYMENT_STATUS_CHANGED',
      createdAt: '2026-06-04T10:17:34.772742',
      data: {
        mId: 'heygramkfw',
        paymentKey: 'pay_live_alipay',
        orderId: 'GRP-LIVE-ALIPAY',
        status: 'ABORTED',
        method: '해외간편결제',
        provider: null,
        easyPay: '알리페이',
        currency: 'USD',
        totalAmount: 55.76,
        approvedAt: null,
        canceledAt: null,
        cancelReason: null,
      },
    });

    expect(parsed.data.provider).toBeUndefined();
    expect(parsed.data.easyPay).toBe('알리페이');
    expect(parsed.data.totalAmount).toBe(55.76);
    expect(parsed.data.approvedAt).toBeUndefined();
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

  it('queries Toss before applying a DONE webhook and uses provider state as authority', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(makeLedgerResult());
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());
    tossClient.queryPayment.mockResolvedValueOnce(
      makeQueriedPayment({
        approvedAt: '2026-05-08T07:00:06.000Z',
      }),
    );

    await controller.handleTossWebhook({
      ...paymentStatusChangedEvent,
      data: {
        ...paymentStatusChangedEvent.data,
        approvedAt: '2026-05-08T07:00:05.000Z',
      },
    });

    expect(tossClient.queryPayment).toHaveBeenCalledWith('pay_async_1', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(paymentService.upsertAsyncPaymentProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DONE',
          approvedAt: '2026-05-08T07:00:06.000Z',
        }),
      }),
      'DONE',
      'payment_status_changed:done',
    );
  });

  it('uses the foreign easy pay secret scope for Toss Alipay provider verification', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(makeLedgerResult());
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());

    await controller.handleTossWebhook({
      ...paymentStatusChangedEvent,
      data: {
        ...paymentStatusChangedEvent.data,
        provider: 'ALIPAY',
      },
    });

    expect(tossClient.queryPayment).toHaveBeenCalledWith('pay_async_1', {
      secretKeyScope: 'foreign-easy-pay',
    });
  });

  it('uses the foreign easy pay secret scope for live Alipay easyPay webhooks without provider', async () => {
    const liveAlipayWebhook: TossWebhookRequestBody = {
      eventId: 'evt-live-alipay-aborted',
      eventType: 'PAYMENT_STATUS_CHANGED',
      createdAt: '2026-06-04T10:17:34.772742',
      data: {
        paymentKey: 'pay_live_alipay',
        orderId: 'GRP-LIVE-ALIPAY',
        status: 'ABORTED',
        method: '해외간편결제',
        easyPay: '알리페이',
        currency: 'USD',
        totalAmount: 55.76,
      },
    };
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({ eventId: liveAlipayWebhook.eventId }),
    );
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());
    tossClient.queryPayment.mockResolvedValueOnce(
      makeQueriedPayment({
        paymentKey: 'pay_live_alipay',
        orderId: 'GRP-LIVE-ALIPAY',
        status: 'ABORTED',
        method: '해외간편결제',
        totalAmount: 55.76,
        approvedAt: null,
      }),
    );

    await controller.handleTossWebhook(liveAlipayWebhook);

    expect(tossClient.queryPayment).toHaveBeenCalledWith('pay_live_alipay', {
      secretKeyScope: 'foreign-easy-pay',
    });
    expect(paymentService.upsertAsyncPaymentProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          easyPay: '알리페이',
          status: 'ABORTED',
        }),
      }),
      'ABORTED',
      'payment_status_changed:aborted',
    );
  });

  it('fails closed when a DONE webhook disagrees with queried Toss state', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(makeLedgerResult());
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());
    tossClient.queryPayment.mockResolvedValueOnce(
      makeQueriedPayment({
        status: 'CANCELED',
      }),
    );

    await expect(controller.handleTossWebhook(paymentStatusChangedEvent)).rejects.toThrow(
      'Toss provider state mismatch',
    );

    expect(paymentService.upsertAsyncPaymentProgress).not.toHaveBeenCalled();
    expect(paymentService.markWebhookEventFailed).toHaveBeenCalledWith(
      'evt-payment-done-1',
      'PROCESSING_FAILED',
      expect.stringContaining('Toss provider state mismatch'),
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
    tossClient.queryPayment.mockResolvedValueOnce(
      makeQueriedPayment({
        status: 'CANCELED',
        cancels: [
          {
            cancelAmount: 150000,
            cancelReason: 'buyer changed mind',
            canceledAt: '2026-05-08T07:02:05.000Z',
          },
        ],
      }),
    );

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

  it('fails closed when a cancel webhook disagrees with queried Toss state', async () => {
    paymentService.recordWebhookEvent.mockResolvedValueOnce(
      makeLedgerResult({
        eventId: 'evt-cancel-1',
      }),
    );
    paymentService.findAsyncPaymentProgress.mockResolvedValueOnce(makeProgress());
    tossClient.queryPayment.mockResolvedValueOnce(makeQueriedPayment());

    await expect(controller.handleTossWebhook(cancelStatusChangedEvent)).rejects.toThrow(
      'Toss provider state mismatch',
    );

    expect(paymentService.upsertAsyncPaymentProgress).not.toHaveBeenCalled();
    expect(paymentService.markWebhookEventFailed).toHaveBeenCalledWith(
      'evt-cancel-1',
      'PROCESSING_FAILED',
      expect.stringContaining('Toss provider state mismatch'),
    );
  });
});
