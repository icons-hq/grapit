// Optional instrumentation for isolated-capacity.mjs only. No credentials,
// payment keys, buyer IDs, request bodies or SQL bind values are retained.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Server } from 'node:http';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStubAllowed } from './pg-stub-preload.mjs';

assertStubAllowed();
const output = process.env.GRABIT_CONFIRM_PROFILE;
const dist = process.env.GRABIT_PROFILE_API_DIST;
if (!output?.startsWith('/') || !dist?.startsWith('/')) throw new Error('Isolated profile paths are required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'apps/api/package.json'));
require('reflect-metadata');
const { Pool } = require('pg');
const context = new AsyncLocalStorage();
const requests = [];
const statements = new Map();
const stages = new Map();
const wrappedClients = new WeakSet();
const now = () => performance.now();
function record(map, key, value) { const list = map.get(key) ?? []; list.push(value); map.set(key, list); }
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, mean: +(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)).toFixed(2),
    p50: +(sorted[Math.ceil(sorted.length * .5) - 1] ?? 0).toFixed(2),
    p95: +(sorted[Math.ceil(sorted.length * .95) - 1] ?? 0).toFixed(2), max: +(sorted.at(-1) ?? 0).toFixed(2) };
}
function flush() {
  writeFileSync(`${output}.${process.pid}.json`, JSON.stringify({ pid: process.pid, requests: requests.length,
    elapsedMs: distribution(requests.map((r) => r.elapsed)),
    dbPoolWaitMs: distribution(requests.map((r) => r.wait)),
    dbQueryMs: distribution(requests.map((r) => r.query)),
    dbQueries: distribution(requests.map((r) => r.count)),
    stages: Object.fromEntries([...stages].map(([name, times]) => [name, distribution(times)])),
    statements: [...statements].map(([sql, times]) => ({ sql, ...distribution(times) })).sort((a, b) => b.mean * b.count - a.mean * a.count),
  }, null, 2), { mode: 0o600 });
}
let flushTimer;
function scheduleFlush() { if (!flushTimer) { flushTimer = setTimeout(() => { flushTimer = undefined; flush(); }, 500); flushTimer.unref(); } }
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  const [req, res] = args;
  if (event !== 'request' || req.method !== 'POST' || req.url?.split('?')[0] !== '/api/v1/payments/confirm') return emit.call(this, event, ...args);
  const sample = { start: now(), wait: 0, query: 0, count: 0 };
  res.once('finish', () => { requests.push({ ...sample, elapsed: now() - sample.start, status: res.statusCode }); scheduleFlush(); });
  return context.run(sample, () => emit.call(this, event, ...args));
};

function instrumentClient(client) {
  if (wrappedClients.has(client)) return;
  wrappedClients.add(client);
  const query = client.query;
  client.query = function (...args) {
    const sample = context.getStore();
    if (!sample) return query.apply(this, args);
    const started = now();
    const sql = String(typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '')
      .replace(/'([^']|'')*'/g, "'?'").replace(/\$\d+/g, '?').replace(/\s+/g, ' ').trim();
    const finish = () => { const elapsed = now() - started; sample.query += elapsed; sample.count++; record(statements, sql, elapsed); };
    if (typeof args.at(-1) === 'function') {
      const callback = args.at(-1); args[args.length - 1] = (...values) => { finish(); return callback(...values); };
      return query.apply(this, args);
    }
    const result = query.apply(this, args);
    return result && typeof result.finally === 'function' ? result.finally(finish) : result;
  };
}
const connect = Pool.prototype.connect;
Pool.prototype.connect = function (callback) {
  const sample = context.getStore(); const started = now();
  const finish = (client) => { if (sample) sample.wait += now() - started; if (client) instrumentClient(client); };
  // pg-pool can invoke a queued callback from the previous borrower's release
  // context. Restore this borrower's sample before Pool.query runs its SQL.
  if (typeof callback === 'function') return connect.call(this, (error, client, release) => {
    finish(client);
    context.run(sample, () => callback(error, client, release));
  });
  return connect.call(this).then((client) => { finish(client); return client; });
};

const targets = [
  ['modules/reservation/reservation-finalization.service.js', 'ReservationFinalizationService',
    ['confirmAndCreateReservationLocked', 'approvePaymentWithProvider', 'commitFinalizationWithRetry', 'commitFinalization', 'runPostCommitSideEffects']],
  ['modules/ticket/qr-ticket.service.js', 'QrTicketService',
    ['ensureIssuedTicketsForReservation', 'issueMissingTicketsUnderReservationLock', 'ensureSingleReminderSchedule']],
  ['modules/reservation/reservation.service.js', 'ReservationService', ['getReservationDetail']],
  ['modules/queue/queue.service.js', 'QueueService', ['assertAdmissionForOrder', 'releaseAdmissionForOrder']],
];
for (const [path, name, methods] of targets) {
  const prototype = require(join(dist, path))[name].prototype;
  for (const method of methods) {
    const original = prototype[method];
    if (typeof original !== 'function') throw new Error(`Profile method missing: ${name}.${method}`);
    prototype[method] = async function (...args) {
      if (!context.getStore()) return original.apply(this, args);
      const started = now();
      try { return await original.apply(this, args); }
      finally { record(stages, `${name}.${method}`, now() - started); }
    };
  }
}
process.on('exit', flush);
