import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, register } from 'node:module';
import test from 'node:test';
import {
  ADMISSION_COOKIE,
  REFRESH_COOKIE,
  TICKET_SERVICE_FEE_KRW,
  buildOptions,
  createPhase26Load,
  parseConfig,
  parseSeatPool,
  parseUserPool,
} from './lib/phase26-load.js';

// The real request contracts, so the load script cannot drift from the API.
const shared = createRequire(new URL('../../apps/api/package.json', import.meta.url))('@grabit/shared');
const prepareTransportSchema = shared.prepareReservationSchema
  .omit({ queueAdmission: true })
  .extend({ queueAdmission: shared.queueAdmissionSchema.partial().optional() });

const PERFORMANCE_ID = '11111111-1111-4111-8111-111111111111';
const SHOWTIME_ID = '22222222-2222-4222-8222-222222222222';
const MARKER = 'PHASE26_TEST-20261002';
const API = 'https://load.example.test/api/v1';
const NOW_S = 1_790_000_000;

function jwt(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function buyers(count, { exp = NOW_S + 3600, role = 'user' } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    accessToken: jwt({ sub: `buyer-${index}`, role, exp }),
    refreshToken: `refresh-${index}`,
  }));
}

function seatPool(count) {
  return Array.from({ length: count }, (_, index) => ({
    seatId: `A-${index + 1}`, seatKey: `1F:A-${index + 1}`, floorKey: '1F', floorLabel: '1F',
    tierName: 'VIP', price: 50000, row: 'A', number: String(index + 1),
  }));
}

function env(overrides = {}) {
  return {
    GRABIT_API_URL: API,
    PHASE26_TEST_PERFORMANCE_ID: PERFORMANCE_ID,
    PHASE26_TEST_SHOWTIME_ID: SHOWTIME_ID,
    PHASE26_TEST_MARKER: MARKER,
    PHASE26_LOAD_APPROVED: 'PHASE26_DEDICATED_TEST_EVENT_APPROVED',
    PHASE26_USER_POOL_FILE: '/private/users.json',
    PHASE26_SEAT_POOL_FILE: '/private/seats.json',
    PHASE26_TEST_ORDER_PREFIX: 'PHASE26_ORD-',
    ...overrides,
  };
}

// Minimal API model with the production guards: Bearer JWT + refreshToken cookie
// for the queue, plus the cookie-only grabit_queue_admission for lock/prepare/confirm.
function fakeApi({ users, waitingPolls = 0 }) {
  const calls = [];
  const locks = new Map();
  let polls = waitingPolls;
  const byToken = new Map(users.map((user) => [user.accessToken, user]));

  function respond(status, body) {
    return { status, body: body === undefined ? '' : JSON.stringify(body) };
  }

  function handle(jar, method, url, body, params) {
    const path = url.slice(API.length);
    calls.push({ method, path, headers: params?.headers ?? {}, tags: params?.tags ?? {}, body });
    if (method === 'GET' && path === '/health') return respond(200, { status: 'ok' });
    if (method === 'GET' && path === `/performances/${PERFORMANCE_ID}`) {
      return respond(200, { title: `${MARKER} load rehearsal`, showtimes: [{ id: SHOWTIME_ID }],
        bookingPolicy: { maxTicketsPerUser: 4, changePolicyEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 } });
    }
    if (method === 'GET' && path === `/booking/schedules/${SHOWTIME_ID}/seats`) return respond(200, { seats: {} });

    const bearer = /^Bearer (.+)$/.exec(params?.headers?.Authorization ?? '')?.[1];
    const user = bearer ? byToken.get(bearer) : undefined;
    if (!user) return respond(401);
    if (jar.cookies.get(REFRESH_COOKIE) !== user.refreshToken) return respond(401, { message: '브라우저 세션이 필요합니다' });

    if (method === 'POST' && path === `/queue/performances/${PERFORMANCE_ID}/enter`) {
      jar.cookies.set(ADMISSION_COOKIE, `admission-${user.refreshToken}`);
      return respond(201, { queueSessionId: `session-${user.refreshToken}`, state: polls > 0 ? 'WAITING' : 'ADMITTED' });
    }
    if (method === 'GET' && path.startsWith('/queue/sessions/')) {
      polls -= 1;
      return respond(200, { state: polls > 0 ? 'WAITING' : 'ADMITTED' });
    }
    const admitted = jar.cookies.get(ADMISSION_COOKIE) === `admission-${user.refreshToken}`;
    if (method === 'POST' && path === '/booking/seats/lock') {
      if (!admitted) return respond(403, { message: '대기열 입장 인증이 필요합니다' });
      const { seatId } = JSON.parse(body);
      if (locks.has(seatId) && locks.get(seatId) !== user.refreshToken) return respond(409);
      locks.set(seatId, user.refreshToken);
      return respond(201, { success: true });
    }
    if (method === 'POST' && path === '/reservations/prepare') {
      if (!admitted) return respond(403);
      const parsed = prepareTransportSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return respond(400, { issues: parsed.error.issues });
      const seat = parsed.data.seats[0];
      if (locks.get(seat.seatKey) !== user.refreshToken) return respond(409);
      if (parsed.data.amount !== seat.price + shared.TICKET_SERVICE_FEE_KRW) return respond(400);
      return respond(201, { reservationId: `reservation-${parsed.data.orderId}` });
    }
    if (method === 'POST' && path === '/payments/confirm') {
      if (!admitted) return respond(403);
      return shared.confirmPaymentSchema.safeParse(JSON.parse(body)).success ? respond(200, { status: 'CONFIRMED' }) : respond(400);
    }
    if (method === 'PUT' && path.endsWith('/cancel-pending')) return respond(204);
    if (method === 'DELETE' && path === `/booking/seats/lock-all/${SHOWTIME_ID}`) {
      for (const [seatId, owner] of locks) if (owner === user.refreshToken) locks.delete(seatId);
      return respond(200, { unlocked: true });
    }
    return respond(404);
  }

  // One k6-like http module per VU, each with its own cookie jar.
  function httpForVu() {
    const jar = { cookies: new Map(), set(url, name, value, options) {
      assert.equal(url, API); assert.equal(options.path, '/'); this.cookies.set(name, value);
    } };
    return {
      jar,
      cookieJar: () => jar,
      get: (url, params) => handle(jar, 'GET', url, null, params),
      post: (url, body, params) => handle(jar, 'POST', url, body, params),
      put: (url, body, params) => handle(jar, 'PUT', url, body, params),
      del: (url, body, params) => handle(jar, 'DELETE', url, body, params),
      batch: (requests) => requests.map(([method, url, body, params]) => handle(jar, method, url, body, params)),
    };
  }

  return { calls, locks, httpForVu };
}

function counter() {
  const values = [];
  return { values, add: (value, tags) => values.push({ value, tags }) };
}

function harness({ config, users, seats, waitingPolls = 0, random = 0 }) {
  const api = fakeApi({ users, waitingPolls });
  const metrics = { queueAdmitted: counter(), queueNotAdmitted: counter() };
  const sleeps = [];
  let clock = NOW_S * 1000;
  let iterationInTest = 0;
  const vus = new Map();
  function vu(id) {
    if (!vus.has(id)) {
      const exec = { vu: { idInTest: id }, scenario: { get iterationInTest() { return iterationInTest; } } };
      const load = createPhase26Load({ http: api.httpForVu(), check: () => true, exec, metrics, config, users, seats,
        sleep: (seconds) => { sleeps.push(seconds); clock += seconds * 1000; }, now: () => new Date(clock) });
      vus.set(id, load);
    }
    return vus.get(id);
  }
  const originalRandom = Math.random;
  return {
    api, metrics, sleeps,
    run(id, setupData) {
      Math.random = () => random;
      try { vu(id).iteration(setupData); } finally { Math.random = originalRandom; iterationInTest += 1; }
    },
    setup: () => vu(1).setup(),
  };
}

test('requires an explicit target and a positively identified test event', () => {
  assert.throws(() => parseConfig(env({ GRABIT_API_URL: '' }), 'LOAD_10K_BASELINE'), /GRABIT_API_URL/);
  assert.throws(() => parseConfig(env({ GRABIT_API_URL: 'https://api.heygrabit.com' }), 'LOAD_10K_BASELINE'), /\/api\/v1/);
  assert.throws(() => parseConfig(env({ PHASE26_TEST_MARKER: 'PHASE26_TEST' }), 'LOAD_10K_BASELINE'), /PHASE26_TEST_MARKER/);
  assert.throws(() => parseConfig(env({ PHASE26_USER_POOL_FILE: '' }), 'LOAD_10K_BASELINE'), /PHASE26_USER_POOL_FILE/);
  assert.throws(() => parseConfig(env({ PHASE26_CONFIRM_MODE: 'live' }), 'LOAD_10K_BASELINE'), /PHASE26_CONFIRM_MODE/);
  assert.equal(parseConfig(env({ PHASE26_READ_WEIGHT: '0' }), 'LOAD_10K_BASELINE').weights.browse, 0);
});

test('models the gate names as concurrent buyers ramped like an opening spike, with per-flow coverage thresholds', () => {
  const baseline = buildOptions(parseConfig(env(), 'LOAD_10K_BASELINE'));
  const scenario = baseline.scenarios.phase26_10k_baseline;
  assert.equal(scenario.executor, 'ramping-vus');
  assert.deepEqual(scenario.stages.map((stage) => stage.target), [10000, 10000, 0]);
  assert.equal(scenario.tags.gate, 'LOAD_10K_BASELINE');
  for (const flow of ['read', 'queue', 'lock', 'prepare']) {
    assert.deepEqual(baseline.thresholds[`http_reqs{flow:${flow}}`], ['count>0']);
    assert.deepEqual(baseline.thresholds[`http_req_failed{flow:${flow}}`], ['rate<0.01']);
  }
  assert.equal(baseline.thresholds['http_reqs{flow:confirm}'], undefined);
  const stress = buildOptions(parseConfig(env({ PHASE26_CONFIRM_MODE: 'pg-stub' }), 'LOAD_20K_STRESS'));
  assert.deepEqual(stress.scenarios.phase26_20k_stress.stages.map((stage) => stage.target), [20000, 20000, 0]);
  assert.deepEqual(stress.thresholds['http_reqs{flow:confirm}'], ['count>0']);
});

test('validates one distinct, non-admin buyer per VU whose token outlives the run', () => {
  const validUntilMs = (NOW_S + 600) * 1000;
  assert.equal(parseUserPool(JSON.stringify(buyers(3)), { minUsers: 3, validUntilMs }).length, 3);
  assert.throws(() => parseUserPool(buyers(2), { minUsers: 3, validUntilMs }), /at least 3/);
  assert.throws(() => parseUserPool(buyers(1, { exp: NOW_S + 60 }), { minUsers: 1, validUntilMs }), /expires before the run ends/);
  assert.throws(() => parseUserPool(buyers(1, { role: 'admin' }), { minUsers: 1, validUntilMs }), /admin/);
  const [first] = buyers(1);
  assert.throws(() => parseUserPool([first, { ...first, refreshToken: 'other' }], { minUsers: 2, validUntilMs }), /repeats a buyer/);
  assert.throws(() => parseSeatPool([...seatPool(1), ...seatPool(1)]), /repeats seatKey/);
  assert.throws(() => parseSeatPool([{ seatId: 'A-1' }]), /needs seatKey/);
});

test('a buyer journey authenticates the queue, carries the admission cookie and sends a contract-valid prepare', () => {
  const config = parseConfig(env({ PHASE26_THINK_TIME_SECONDS: '0' }), 'LOAD_10K_BASELINE');
  const users = buyers(2);
  const seats = parseSeatPool(seatPool(4));
  const h = harness({ config, users, seats, random: 0 });
  const setupData = h.setup();
  assert.deepEqual(setupData.bookingPolicy, { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY',
    sameGradeChangeEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 });

  h.run(1, setupData);
  h.run(2, setupData);
  h.run(1, setupData);
  const statusOf = (path) => h.api.calls.filter((call) => call.path === path).map((call) => call.tags.flow);
  assert.deepEqual(statusOf('/booking/seats/lock'), ['lock', 'lock', 'lock']);
  const lockedSeats = h.api.calls.filter((call) => call.path === '/booking/seats/lock').map((call) => JSON.parse(call.body).seatId);
  assert.deepEqual(lockedSeats, ['1F:A-1', '1F:A-2', '1F:A-3'], 'each iteration locks a distinct seat');
  const prepares = h.api.calls.filter((call) => call.path === '/reservations/prepare');
  assert.equal(prepares.length, 3);
  for (const call of prepares) {
    const body = JSON.parse(call.body);
    assert.ok(prepareTransportSchema.safeParse(body).success, 'prepare body satisfies the shared contract');
    assert.ok(body.orderId.startsWith('PHASE26_ORD-'));
    assert.equal(body.amount, 50000 + TICKET_SERVICE_FEE_KRW);
  }
  assert.equal(h.api.calls.filter((call) => call.path.endsWith('/cancel-pending')).length, 3);
  assert.equal(h.api.locks.size, 0, 'abandoned checkouts release their locks');
  for (const call of h.api.calls) {
    assert.equal(call.headers['x-queue-admission-token'], undefined);
    if (call.tags.flow !== 'setup') assert.match(call.headers.Authorization, /^Bearer /);
  }
  assert.deepEqual(h.metrics.queueAdmitted.values.length, 3);
});

test('waits in the queue with status polling and books only after ADMITTED', () => {
  const config = parseConfig(env({ PHASE26_THINK_TIME_SECONDS: '0', PHASE26_QUEUE_POLL_SECONDS: '2', PHASE26_QUEUE_MAX_WAIT_SECONDS: '4' }), 'LOAD_10K_BASELINE');
  const users = buyers(1);
  const seats = parseSeatPool(seatPool(2));
  const waiting = harness({ config, users, seats, waitingPolls: 10, random: 0 });
  waiting.run(1, { bookingPolicy: { maxTicketsPerOrder: 1, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false } });
  assert.equal(waiting.api.calls.filter((call) => call.path.startsWith('/queue/sessions/')).length, 2);
  assert.equal(waiting.api.calls.some((call) => call.path === '/booking/seats/lock'), false);
  assert.equal(waiting.metrics.queueNotAdmitted.values[0].tags.state, 'WAITING');

  const admitted = harness({ config, users, seats, waitingPolls: 2, random: 0 });
  admitted.run(1, { bookingPolicy: { maxTicketsPerOrder: 1, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false } });
  assert.equal(admitted.api.calls.filter((call) => call.path === '/booking/seats/lock').length, 1);
});

test('pg-stub confirm sends a contract-valid confirm once per buyer and keeps the purchase', () => {
  const config = parseConfig(env({ PHASE26_THINK_TIME_SECONDS: '0', PHASE26_CONFIRM_MODE: 'pg-stub' }), 'LOAD_20K_STRESS');
  const users = buyers(1);
  const h = harness({ config, users, seats: parseSeatPool(seatPool(3)), random: 0 });
  const setupData = h.setup();
  h.run(1, setupData);
  h.run(1, setupData);
  const confirms = h.api.calls.filter((call) => call.path === '/payments/confirm');
  assert.equal(confirms.length, 1, 'a buyer that purchased does not buy again');
  const body = JSON.parse(confirms[0].body);
  assert.ok(body.paymentKey.startsWith('phase26_stub_PHASE26_ORD-'));
  assert.equal(body.amount, 52000);
  assert.equal(h.api.calls.filter((call) => call.path.endsWith('/cancel-pending')).length, 0);
  assert.equal(h.api.calls.filter((call) => call.path === '/booking/seats/lock').length, 1);
});

test('keeps the k6 service fee and cookie names aligned with the API', () => {
  assert.equal(TICKET_SERVICE_FEE_KRW, shared.TICKET_SERVICE_FEE_KRW);
  assert.equal(REFRESH_COOKIE, shared.AUTH_COOKIE_NAME);
});

test('the k6 entry scripts wire the shared logic, pools and options', async () => {
  const opened = {
    '/private/users.json': JSON.stringify(buyers(3, { exp: Math.floor(Date.now() / 1000) + 3600 })),
    '/private/seats.json': JSON.stringify(seatPool(3)),
  };
  globalThis.__ENV = env({ PHASE26_BASELINE_TARGET_VUS: '3', PHASE26_STRESS_TARGET_VUS: '3', PHASE26_BASELINE_HOLD: '1m', PHASE26_STRESS_HOLD: '1m' });
  globalThis.open = (path) => opened[path];
  globalThis.__k6 = {
    http: { setResponseCallback() {}, expectedStatuses: () => null },
    exec: { vu: { idInTest: 1 }, scenario: { iterationInTest: 0 } },
  };
  register('data:text/javascript,' + encodeURIComponent(`
    const stubs = {
      'k6': 'export const check = () => true; export const sleep = () => {};',
      'k6/http': 'export default globalThis.__k6.http;',
      'k6/execution': 'export default globalThis.__k6.exec;',
      'k6/data': 'export class SharedArray { constructor(name, factory) { return factory(); } }',
      'k6/metrics': 'export class Counter { add() {} }',
    };
    export async function resolve(specifier, context, next) {
      if (Object.hasOwn(stubs, specifier)) return { url: 'k6-stub:' + specifier, shortCircuit: true };
      return next(specifier, context);
    }
    export async function load(url, context, next) {
      if (url.startsWith('k6-stub:')) return { format: 'module', source: stubs[url.slice(8)], shortCircuit: true };
      return next(url, context);
    }`));
  const baseline = await import('./phase26-baseline.js');
  const stress = await import('./phase26-stress.js');
  assert.deepEqual(baseline.options.scenarios.phase26_10k_baseline.stages.map((stage) => stage.target), [3, 3, 0]);
  assert.deepEqual(stress.options.scenarios.phase26_20k_stress.stages.map((stage) => stage.target), [3, 3, 0]);
  assert.equal(typeof baseline.default, 'function');
  assert.equal(typeof stress.setup, 'function');
  for (const file of ['phase26-baseline.js', 'phase26-stress.js']) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.equal(source.includes('x-queue-admission-token'), false);
    assert.equal(source.includes('constant-arrival-rate'), false);
  }
});
