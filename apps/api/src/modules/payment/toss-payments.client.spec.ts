import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  TossPaymentError,
  TossPaymentsClient,
  type TossPaymentResponse,
} from './toss-payments.client.js';

describe('TossPaymentsClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: TossPaymentsClient;

  const secretKey = 'test_sk_phase26_redaction_secret';
  const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  const paidResponse: TossPaymentResponse = {
    paymentKey: 'pay_test_phase26_1',
    orderId: 'GRP-PHASE26-1',
    method: 'CARD',
    totalAmount: 150000,
    status: 'DONE',
    approvedAt: '2026-05-20T05:45:00.000Z',
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Idempotency-Key when confirming a Toss payment retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(paidResponse),
    });

    await client.confirmPayment({
      paymentKey: 'pay_test_phase26_1',
      orderId: 'GRP-PHASE26-1',
      amount: 150000,
      idempotencyKey: 'idem_confirm_phase26_1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem_confirm_phase26_1',
        }),
      }),
    );
  });

  it('uses the overseas card secret when confirming an overseas card payment', async () => {
    const overseasCardSecretKey = 'test_sk_overseas_card_secret';
    const overseasCardAuthHeader =
      `Basic ${Buffer.from(`${overseasCardSecretKey}:`).toString('base64')}`;
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_OVERSEAS_CARD_SECRET_KEY') return overseasCardSecretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(paidResponse),
    });

    await client.confirmPayment({
      paymentKey: 'pay_overseas_card',
      orderId: 'GRP-OVERSEAS-CARD',
      amount: 150000,
      secretKeyScope: 'overseas-card',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/confirm',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: overseasCardAuthHeader,
        }),
      }),
    );
  });

  it('falls back to the default secret when the overseas card secret is missing', async () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(paidResponse),
    });

    await client.confirmPayment({
      paymentKey: 'pay_overseas_card',
      orderId: 'GRP-OVERSEAS-CARD',
      amount: 150000,
      secretKeyScope: 'overseas-card',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/confirm',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: authHeader,
        }),
      }),
    );
  });

  it('sends Idempotency-Key when cancelling a Toss payment retry', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        status: 'CANCELED',
        cancels: [
          {
            cancelAmount: 150000,
            cancelReason: 'phase26 retry-safe cancel',
            canceledAt: '2026-05-20T05:46:00.000Z',
          },
        ],
      }),
    });

    await client.cancelPayment('pay_test_phase26_1/unsafe', 'phase26 retry-safe cancel', {
      idempotencyKey: 'idem_cancel_phase26_1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_test_phase26_1%2Funsafe/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem_cancel_phase26_1',
        }),
      }),
    );
  });

  it('sends cancelAmount for Toss partial cancellation while preserving retry idempotency', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        status: 'DONE',
        cancels: [
          {
            cancelAmount: 79000,
            cancelReason: 'ticket item cancel',
            canceledAt: '2026-05-20T05:46:00.000Z',
          },
        ],
      }),
    });

    await client.cancelPayment('pay_test_phase26_1', 'ticket item cancel', {
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      cancelAmount: 79000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_test_phase26_1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'ticket-item-cancel:ticket-item-1',
        }),
        body: JSON.stringify({
          cancelReason: 'ticket item cancel',
          cancelAmount: 79000,
        }),
      }),
    );
  });

  it('sends currency and cancelRequestId for async foreign easy-pay partial cancellation', async () => {
    const foreignEasyPaySecretKey = 'test_sk_foreign_easy_pay_secret';
    const foreignEasyPayAuthHeader =
      `Basic ${Buffer.from(`${foreignEasyPaySecretKey}:`).toString('base64')}`;
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_FOREIGN_EASY_PAY_SECRET_KEY') return foreignEasyPaySecretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        status: 'PARTIAL_CANCELED',
        cancels: [
          {
            cancelAmount: 17,
            cancelReason: 'Alipay ticket cancel',
            canceledAt: '2026-06-04T11:00:00+09:00',
            cancelStatus: 'DONE',
            transactionKey: 'tx_cancel_alipay_1',
            cancelRequestId: 'cancel_ticket-item-1',
            refundableAmount: 51,
          },
        ],
      }),
    });

    await client.cancelPayment('pay_foreign_easy_pay', 'Alipay ticket cancel', {
      idempotencyKey: 'ticket-item-cancel:ticket-item-1',
      secretKeyScope: 'foreign-easy-pay',
      cancelAmount: 17,
      currency: 'USD',
      cancelRequestId: 'cancel_ticket-item-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_foreign_easy_pay/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: foreignEasyPayAuthHeader,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'ticket-item-cancel:ticket-item-1',
        }),
        body: JSON.stringify({
          cancelReason: 'Alipay ticket cancel',
          cancelAmount: 17,
          currency: 'USD',
          cancelRequestId: 'cancel_ticket-item-1',
        }),
      }),
    );
  });

  it('queries Toss payment state with server-side secret auth', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(paidResponse),
    });

    const result = await client.queryPayment('pay_test_phase26_1');

    expect(result).toEqual(paidResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_test_phase26_1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: authHeader,
        }),
      }),
    );
  });

  it('uses the foreign easy pay secret when querying foreign easy pay payment state', async () => {
    const foreignEasyPaySecretKey = 'test_sk_foreign_easy_pay_secret';
    const foreignEasyPayAuthHeader =
      `Basic ${Buffer.from(`${foreignEasyPaySecretKey}:`).toString('base64')}`;
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_FOREIGN_EASY_PAY_SECRET_KEY') return foreignEasyPaySecretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        method: 'FOREIGN_EASY_PAY',
      }),
    });

    await client.queryPayment('pay_foreign_easy_pay', {
      secretKeyScope: 'foreign-easy-pay',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_foreign_easy_pay',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: foreignEasyPayAuthHeader,
        }),
      }),
    );
  });

  it('does not fall back to the default secret for foreign easy pay payment state queries', async () => {
    await expect(
      client.queryPayment('pay_foreign_easy_pay', {
        secretKeyScope: 'foreign-easy-pay',
      }),
    ).rejects.toMatchObject({
      code: 'MISSING_FOREIGN_EASY_PAY_SECRET_KEY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redacts the foreign easy pay secret from query errors', async () => {
    const foreignEasyPaySecretKey = 'test_sk_foreign_easy_pay_redaction_secret';
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_FOREIGN_EASY_PAY_SECRET_KEY') return foreignEasyPaySecretKey;
        return fallback;
      }),
    } as unknown as ConfigService);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: 'UNAUTHORIZED_KEY',
        message: `wrong ${foreignEasyPaySecretKey} for pay_foreign_easy_pay_sensitive`,
      }),
    });

    let caught: unknown;
    try {
      await client.queryPayment('pay_foreign_easy_pay_sensitive', {
        secretKeyScope: 'foreign-easy-pay',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TossPaymentError);
    expect((caught as Error).message).not.toContain(foreignEasyPaySecretKey);
    expect((caught as Error).message).not.toContain('pay_foreign_easy_pay_sensitive');
  });

  it('redacts Toss query errors before surfacing them to callers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: 'NOT_FOUND_PAYMENT',
        message:
          'missing test_sk_phase26_redaction_secret for pay_test_phase26_sensitive_1',
      }),
    });

    let caught: unknown;
    try {
      await client.queryPayment('pay_test_phase26_sensitive_1');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TossPaymentError);
    expect((caught as TossPaymentError).code).toBe('NOT_FOUND_PAYMENT');
    expect((caught as Error).message).not.toContain(secretKey);
    expect((caught as Error).message).not.toContain('pay_test_phase26_sensitive_1');
  });
});
