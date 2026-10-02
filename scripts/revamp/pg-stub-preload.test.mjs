import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStubAllowed, createPgStubFetch } from './pg-stub-preload.mjs';

test('installs only for an explicitly isolated, non-production process without live Toss keys', () => {
  assert.throws(() => assertStubAllowed({}), /GRABIT_PG_STUB=isolated-load-test-only/);
  assert.throws(() => assertStubAllowed({ GRABIT_PG_STUB: 'true' }), /isolated-load-test-only/);
  assert.throws(() => assertStubAllowed({ GRABIT_PG_STUB: 'isolated-load-test-only', NODE_ENV: 'production' }), /production/);
  assert.throws(() => assertStubAllowed({ GRABIT_PG_STUB: 'isolated-load-test-only', TOSS_SECRET_KEY: 'live_sk_abc' }), /live Toss key/);
  assert.doesNotThrow(() => assertStubAllowed({ GRABIT_PG_STUB: 'isolated-load-test-only', NODE_ENV: 'test', TOSS_SECRET_KEY: '' }));
});

test('answers confirm, cancel and lookup like Toss with the injected latency and passes other hosts through', async () => {
  const passed = [];
  const realFetch = async (input) => { passed.push(String(input)); return new Response('{}', { status: 200 }); };
  const stub = createPgStubFetch({ realFetch, latencyMs: 20 });
  const started = Date.now();
  const confirm = await stub.fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST', body: JSON.stringify({ paymentKey: 'isolated_stub_1', orderId: 'ORDER-1', amount: 52000 }),
  });
  assert.ok(Date.now() - started >= 15);
  assert.equal(confirm.status, 200);
  const payment = await confirm.json();
  assert.equal(payment.status, 'DONE');
  assert.equal(payment.totalAmount, 52000);

  const replay = await stub.fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST', body: JSON.stringify({ paymentKey: 'isolated_stub_1', orderId: 'ORDER-1', amount: 52000 }) });
  assert.equal(replay.status, 200);
  const mismatched = await stub.fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST', body: JSON.stringify({ paymentKey: 'isolated_stub_1', orderId: 'ORDER-1', amount: 1 }) });
  assert.equal(mismatched.status, 400);

  const cancel = await stub.fetch('https://api.tosspayments.com/v1/payments/isolated_stub_1/cancel', {
    method: 'POST', body: JSON.stringify({ cancelReason: 'test' }) });
  assert.equal((await cancel.json()).status, 'CANCELED');
  const lookup = await stub.fetch('https://api.tosspayments.com/v1/payments/isolated_stub_1');
  assert.equal((await lookup.json()).balanceAmount, 0);
  const unknown = await stub.fetch('https://api.tosspayments.com/v1/settlements?startDate=2026-01-01');
  assert.equal(unknown.status, 501);

  await stub.fetch('http://127.0.0.1:9/elsewhere');
  assert.deepEqual(passed, ['http://127.0.0.1:9/elsewhere']);
});
