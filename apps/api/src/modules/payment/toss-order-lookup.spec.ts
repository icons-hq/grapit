import { afterEach, describe, expect, it, vi } from 'vitest';
import { TossPaymentsClient } from './toss-payments.client.js';
const response = { paymentKey: 'synthetic-key', orderId: 'order', status: 'EXPIRED', totalAmount: 416.16 };
function client() { return new TossPaymentsClient({ get: (name: string) => name === 'TOSS_FOREIGN_EASY_PAY_SECRET_KEY' ? 'test_sk_synthetic_foreign' : 'test_sk_synthetic_default' } as never); }
afterEach(() => vi.unstubAllGlobals());
it('looks up the exact order with only the foreign account and a bounded timeout', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response }); vi.stubGlobal('fetch', fetch);
  await expect(client().queryPaymentByOrderId('order', { secretKeyScope: 'foreign-easy-pay' })).resolves.toEqual(response);
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe('https://api.tosspayments.com/v1/payments/orders/order');
  expect(options.method).toBe('GET'); expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('test_sk_synthetic_foreign:').toString('base64')}`);
});
describe('order lookup evidence', () => {
  it.each([{ ...response, orderId: 'another-order' }, {}, { ...response, paymentKey: '' }])('rejects mismatched or malformed responses: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    await expect(client().queryPaymentByOrderId('order')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
  it('propagates unsupported merchant lookup without fabricating an unpaid result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ code: 'NOT_FOUND_MERCHANT' }) }));
    await expect(client().queryPaymentByOrderId('order')).rejects.toMatchObject({ code: 'NOT_FOUND_MERCHANT' });
  });
});
