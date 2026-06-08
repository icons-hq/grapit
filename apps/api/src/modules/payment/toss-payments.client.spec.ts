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

  it('uses the overseas card widget secret when confirming an overseas card payment', async () => {
    const overseasCardSecretKey = 'test_gsk_overseas_card_secret';
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

  it('rejects an API individual secret for overseas card payment confirms', async () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_OVERSEAS_CARD_SECRET_KEY') return 'test_sk_overseas_card_secret';
        return fallback;
      }),
    } as unknown as ConfigService);

    await expect(
      client.confirmPayment({
        paymentKey: 'pay_overseas_card',
        orderId: 'GRP-OVERSEAS-CARD',
        amount: 150000,
        secretKeyScope: 'overseas-card',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_OVERSEAS_CARD_SECRET_KEY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fall back to the default secret for overseas card payment confirms', async () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        return fallback;
      }),
    } as unknown as ConfigService);

    await expect(
      client.confirmPayment({
        paymentKey: 'pay_overseas_card',
        orderId: 'GRP-OVERSEAS-CARD',
        amount: 150000,
        secretKeyScope: 'overseas-card',
      }),
    ).rejects.toMatchObject({
      code: 'MISSING_OVERSEAS_CARD_SECRET_KEY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports overseas card checkout unavailable when its secret is missing', () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        return fallback;
      }),
    } as unknown as ConfigService);

    expect(client.getOverseasCardAvailability()).toEqual({
      enabled: false,
      disabledReason: 'OVERSEAS_CARD_SECRET_KEY_MISSING',
    });
  });

  it('reports overseas card checkout available when its widget secret is configured', () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_OVERSEAS_CARD_SECRET_KEY') return 'test_gsk_overseas_card_secret';
        return fallback;
      }),
    } as unknown as ConfigService);

    expect(client.getOverseasCardAvailability()).toEqual({ enabled: true });
  });

  it('reports overseas card checkout unavailable when its secret is an API individual key', () => {
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_OVERSEAS_CARD_SECRET_KEY') return 'test_sk_overseas_card_secret';
        return fallback;
      }),
    } as unknown as ConfigService);

    expect(client.getOverseasCardAvailability()).toEqual({
      enabled: false,
      disabledReason: 'OVERSEAS_CARD_WIDGET_SECRET_KEY_INVALID',
    });
  });

  it('omits optional cancel fields for full Toss cancellation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        status: 'CANCELED',
        cancels: [
          {
            cancelAmount: 150000,
            cancelReason: 'full cancel',
            canceledAt: '2026-05-20T05:46:00.000Z',
          },
        ],
      }),
    });

    await client.cancelPayment('pay_test_phase26_1', 'full cancel');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      cancelReason: 'full cancel',
    });
    expect(body).not.toHaveProperty('cancelAmount');
    expect(body).not.toHaveProperty('currency');
    expect(body).not.toHaveProperty('cancelRequestId');
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

  it('sends cancelAmount for Toss partial cancellation', async () => {
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
      cancelAmount: 79000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_test_phase26_1/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: authHeader,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          cancelReason: 'ticket item cancel',
          cancelAmount: 79000,
        }),
      }),
    );
  });

  it('sends currency for Toss foreign partial cancellation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        method: 'FOREIGN_EASY_PAY',
        status: 'DONE',
      }),
    });

    await client.cancelPayment('pay_foreign_easy_pay', 'foreign partial cancel', {
      cancelAmount: 10,
      currency: 'USD',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_foreign_easy_pay/cancel',
      expect.objectContaining({
        body: JSON.stringify({
          cancelReason: 'foreign partial cancel',
          cancelAmount: 10,
          currency: 'USD',
        }),
      }),
    );
  });

  it('sends cancelRequestId for Toss async foreign cancellation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...paidResponse,
        method: 'FOREIGN_EASY_PAY',
        status: 'DONE',
      }),
    });

    await client.cancelPayment('pay_alipay_async', 'alipay async cancel', {
      cancelRequestId: 'cancel-request-alipay-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_alipay_async/cancel',
      expect.objectContaining({
        body: JSON.stringify({
          cancelReason: 'alipay async cancel',
          cancelRequestId: 'cancel-request-alipay-1',
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

  it('paginates Toss settlement rows until the final partial page', async () => {
    const firstPage = Array.from({ length: 5_000 }, (_, index) => ({
      paymentKey: `payment-key-${index}`,
      amount: 10_000,
      fee: 300,
      supplyAmount: 273,
      vat: 27,
      payOutAmount: 9_700,
      soldDate: '2026-06-04',
      paidOutDate: '2026-06-15',
      method: '카드',
    }));
    const secondPage = [
      {
        paymentKey: 'payment-key-5000',
        amount: 20_000,
        fee: 600,
        supplyAmount: 545,
        vat: 55,
        payOutAmount: 19_400,
        soldDate: '2026-06-04',
        paidOutDate: '2026-06-15',
        method: '카드',
      },
    ];
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(firstPage),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(secondPage),
      });

    const rows = await client.querySettlements({
      startDate: '2026-06-04',
      endDate: '2026-06-08',
      dateType: 'soldDate',
    });

    expect(rows).toHaveLength(5_001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.tosspayments.com/v1/settlements?startDate=2026-06-04&endDate=2026-06-08&dateType=soldDate&page=1&size=5000',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: authHeader,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.tosspayments.com/v1/settlements?startDate=2026-06-04&endDate=2026-06-08&dateType=soldDate&page=2&size=5000',
      expect.any(Object),
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
