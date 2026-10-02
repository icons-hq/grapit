// In-process Toss Payments stub for isolated load tests only.
//
// scripts/revamp/isolated-capacity.mjs starts its disposable API with
// `node --import <this file>`. The stub replaces fetch for api.tosspayments.com
// so prepare/confirm can be measured with an injected PG latency, including the
// showtime row-lock serialization inside confirm, without contacting a payment
// provider. Every other host still uses the real fetch. It refuses to install
// unless explicitly enabled for a non-production process without live keys.
const ENABLE_VALUE = 'isolated-load-test-only';
const TOSS_HOST = 'api.tosspayments.com';

export function assertStubAllowed(env = process.env) {
  if (env.GRABIT_PG_STUB !== ENABLE_VALUE) {
    throw new Error(`pg-stub-preload requires GRABIT_PG_STUB=${ENABLE_VALUE}`);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('pg-stub-preload must never run with NODE_ENV=production');
  }
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith('TOSS_') && /\blive_/.test(String(value))) {
      throw new Error('pg-stub-preload refuses to run next to a live Toss key');
    }
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function createPgStubFetch({ realFetch, latencyMs = 0, now = () => new Date() }) {
  const payments = new Map();
  const delay = () => (latencyMs > 0 ? new Promise((done) => setTimeout(done, latencyMs)) : Promise.resolve());
  async function stubFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== TOSS_HOST) return realFetch(input, init);
    const method = String(init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(String(init.body)) : {}; } catch { body = {}; }
    await delay();

    if (method === 'POST' && url.pathname === '/v1/payments/confirm') {
      if (typeof body.paymentKey !== 'string' || typeof body.orderId !== 'string' || !Number.isInteger(body.amount)) {
        return json(400, { code: 'INVALID_REQUEST', message: 'paymentKey, orderId and integer amount are required' });
      }
      const existing = payments.get(body.paymentKey);
      if (existing) {
        return existing.orderId === body.orderId && existing.totalAmount === body.amount
          ? json(200, existing)
          : json(400, { code: 'ALREADY_PROCESSED_PAYMENT', message: 'payment already processed' });
      }
      const payment = {
        paymentKey: body.paymentKey,
        orderId: body.orderId,
        status: 'DONE',
        method: '카드',
        totalAmount: body.amount,
        balanceAmount: body.amount,
        currency: 'KRW',
        isPartialCancelable: true,
        approvedAt: now().toISOString(),
        card: { settlementStatus: 'INCOMPLETED' },
        cancels: [],
      };
      payments.set(payment.paymentKey, payment);
      return json(200, payment);
    }

    const cancel = /^\/v1\/payments\/([^/]+)\/cancel$/.exec(url.pathname);
    if (method === 'POST' && cancel) {
      const payment = payments.get(decodeURIComponent(cancel[1]));
      if (!payment) return json(404, { code: 'NOT_FOUND_PAYMENT', message: 'payment not found' });
      const cancelAmount = Number.isInteger(body.cancelAmount) ? body.cancelAmount : payment.balanceAmount;
      payment.balanceAmount = Math.max(0, payment.balanceAmount - cancelAmount);
      payment.status = payment.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';
      payment.cancels.push({
        cancelAmount,
        cancelReason: String(body.cancelReason ?? ''),
        canceledAt: now().toISOString(),
        cancelStatus: 'DONE',
        transactionKey: `stub-${payment.cancels.length + 1}`,
        cancelRequestId: body.cancelRequestId ?? null,
      });
      return json(200, payment);
    }

    const lookup = /^\/v1\/payments\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && lookup) {
      const payment = payments.get(decodeURIComponent(lookup[1]));
      return payment ? json(200, payment) : json(404, { code: 'NOT_FOUND_PAYMENT', message: 'payment not found' });
    }

    return json(501, { code: 'PG_STUB_UNSUPPORTED', message: `PG stub does not implement ${method} ${url.pathname}` });
  }
  return { fetch: stubFetch, payments };
}

if (process.env.GRABIT_PG_STUB !== undefined) {
  assertStubAllowed();
  const latencyMs = Number(process.env.GRABIT_PG_STUB_LATENCY_MS ?? 0);
  if (!Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 10_000) {
    throw new Error('GRABIT_PG_STUB_LATENCY_MS must be an integer between 0 and 10000');
  }
  globalThis.fetch = createPgStubFetch({ realFetch: globalThis.fetch.bind(globalThis), latencyMs }).fetch;
}
