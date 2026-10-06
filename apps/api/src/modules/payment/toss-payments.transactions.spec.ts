import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS,
  TossPaymentError,
  TossPaymentsClient,
} from './toss-payments.client.js';

function createClient(keys: Record<string, string>) {
  return new TossPaymentsClient({
    get: vi.fn((key: string, fallback?: string) => keys[key] ?? fallback),
  } as unknown as ConfigService);
}

describe('TossPaymentsClient.queryTransactions', () => {
  const secretKey = 'test_sk_transactions_secret';
  const overseasKey = 'test_gsk_overseas_transactions_secret';
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: TossPaymentsClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new TossPaymentsClient({
      get: vi.fn((key: string, fallback?: string) => {
        if (key === 'TOSS_SECRET_KEY') return secretKey;
        if (key === 'TOSS_OVERSEAS_CARD_SECRET_KEY') return overseasKey;
        return fallback;
      }),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads one bounded page of the MID transaction ledger with the scoped secret', async () => {
    const rows = [{ transactionKey: 'tx-1', orderId: 'GRP-1', status: 'DONE' }];
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => rows });

    await expect(client.queryTransactions({
      startDate: '2026-10-02T11:50:00',
      endDate: '2026-10-02T14:00:00',
      limit: 5000,
      startingAfter: 'tx-0',
      secretKeyScope: 'overseas-card',
    })).resolves.toEqual(rows);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tosspayments.com/v1/transactions?startDate=2026-10-02T11%3A50%3A00&endDate=2026-10-02T14%3A00%3A00&limit=5000&startingAfter=tx-0',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: { Authorization: `Basic ${Buffer.from(`${overseasKey}:`).toString('base64')}` },
      }),
    );
  });

  it('waits the documented 60 seconds by default and accepts a shorter caller budget', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

    await client.queryTransactions({ startDate: '2026-10-02', endDate: '2026-10-03' });
    await client.queryTransactions({ startDate: '2026-10-02', endDate: '2026-10-03', timeoutMs: 12_000 });

    expect(TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(timeout).toHaveBeenNthCalledWith(1, TOSS_TRANSACTION_LOOKUP_TIMEOUT_MS);
    expect(timeout).toHaveBeenNthCalledWith(2, 12_000);
    timeout.mockRestore();
  });

  it('lists one lookup scope per distinct configured MID key', () => {
    expect(createClient({
      TOSS_SECRET_KEY: 'live_gsk_shared',
      TOSS_OVERSEAS_CARD_SECRET_KEY: 'live_gsk_shared',
      TOSS_FOREIGN_EASY_PAY_SECRET_KEY: 'live_gsk_shared',
    }).getTransactionLookupScopes()).toEqual(['default']);

    expect(createClient({
      TOSS_SECRET_KEY: 'live_gsk_domestic',
      TOSS_OVERSEAS_CARD_SECRET_KEY: 'live_gsk_uspay',
      TOSS_FOREIGN_EASY_PAY_SECRET_KEY: 'live_gsk_uspay',
    }).getTransactionLookupScopes()).toEqual(['default', 'overseas-card']);

    expect(createClient({
      TOSS_SECRET_KEY: 'live_gsk_domestic',
      TOSS_OVERSEAS_CARD_SECRET_KEY: 'live_sk_not_a_widget_key',
      TOSS_FOREIGN_EASY_PAY_SECRET_KEY: 'live_gsk_foreign',
    }).getTransactionLookupScopes()).toEqual(['default', 'foreign-easy-pay']);

    expect(createClient({}).getTransactionLookupScopes()).toEqual([]);
  });

  it('never turns an error or malformed success into an empty ledger', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'UNAUTHORIZED_KEY', message: `bad key ${secretKey}` }),
    });
    await expect(client.queryTransactions({ startDate: '2026-10-02', endDate: '2026-10-03' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED_KEY', message: 'bad key [redacted toss secret]' });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: true }) });
    await expect(client.queryTransactions({ startDate: '2026-10-02', endDate: '2026-10-03' }))
      .rejects.toBeInstanceOf(TossPaymentError);
  });
});
