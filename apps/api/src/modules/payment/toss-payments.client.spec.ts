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
      get: vi.fn().mockReturnValue(secretKey),
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

    await client.cancelPayment('pay_test_phase26_1', 'phase26 retry-safe cancel', {
      idempotencyKey: 'idem_cancel_phase26_1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/payments/pay_test_phase26_1/cancel',
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
