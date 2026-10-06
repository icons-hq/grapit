import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, register } from 'node:module';
import test from 'node:test';
import {
  ADMISSION_COOKIE,
  BOOKING_CONSENT_VERSIONS,
  BUYER_THROTTLES,
  REFRESH_COOKIE,
  TICKET_SERVICE_FEE_KRW,
  buildOptions,
  buildPrepareBody,
  buyerThrottleDemand,
  consentDocumentLanguage,
  createPhase26Load,
  parseConfig,
  parseSeatPool,
  parseUserPool,
  requiredSeatCount,
} from './lib/phase26-load.js';

// The real request contracts, so the load script cannot drift from the API.
const shared = createRequire(new URL('../../apps/api/package.json', import.meta.url))('@grabit/shared');
const prepareTransportSchema = shared.prepareReservationSchema
  .omit({ queueAdmission: true })
  .extend({ queueAdmission: shared.queueAdmissionSchema.partial().optional() });

// Active consent rows of a target that retired the 2026-04-28 privacy document
// (consent version runbook): only the current version of each booking row, in the
// two document languages. ConsentService answers 400 for any other required row.
const ACTIVE_BOOKING_CONSENT = new Set(shared.BOOKING_CONSENT_ITEM_KEYS.flatMap((key) =>
  shared.CONSENT_DOCUMENT_LANGUAGES.map((language) => `${key}:${shared.CONSENT_DOCUMENT_VERSIONS[key]}:${language}`)));
function bookingConsentOutdated(items) {
  return shared.BOOKING_CONSENT_ITEM_KEYS.some((key) => {
    const item = items.find((candidate) => candidate.key === key);
    return !item?.accepted || !ACTIVE_BOOKING_CONSENT.has(`${key}:${item.version}:${item.language}`);
  });
}

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
// A confirmed seat is sold and can never be locked again.
const VERIFIED_PROFILE = (user) => ({ id: user.sub, role: 'user', isEmailVerified: true, isPhoneVerified: true });

function fakeApi({ users, waitingPolls = 0, confirmOutcome = () => 200, profile = VERIFIED_PROFILE,
  activeWindowMs = null, now = () => 0 }) {
  const calls = [];
  const locks = new Map();
  const sold = new Set();
  const reservations = new Map();
  let confirms = 0;
  let polls = waitingPolls;
  const byToken = new Map(users.map((user) => [user.accessToken, user]));
  // With activeWindowMs, queue sessions follow the API (audit D2): an ADMITTED
  // session is reused only inside its active window; after it, enter starts a new
  // WAITING session, and the admission cookie is set only once admitted.
  const sessions = new Map();
  let sessionSeq = 0;
  const admittedNow = (session) => session?.state === 'ADMITTED' && now() < session.admittedUntil;
  function admit(jar, session) {
    session.state = 'ADMITTED';
    session.admittedUntil = now() + activeWindowMs;
    jar.cookies.set(ADMISSION_COOKIE, `admission-${session.id}`);
  }

  function respond(status, body) {
    return { status, body: body === undefined ? '' : JSON.stringify(body) };
  }

  function route(jar, method, path, body, params) {
    if (method === 'GET' && path === '/health') return respond(200, { status: 'ok' });
    if (method === 'GET' && path === `/performances/${PERFORMANCE_ID}`) {
      return respond(200, { title: `${MARKER} load rehearsal`, showtimes: [{ id: SHOWTIME_ID }],
        bookingPolicy: { maxTicketsPerUser: 4, changePolicyEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 } });
    }
    if (method === 'GET' && path === `/booking/schedules/${SHOWTIME_ID}/seats`) return respond(200, { seats: {} });

    const bearer = /^Bearer (.+)$/.exec(params?.headers?.Authorization ?? '')?.[1];
    const user = bearer ? byToken.get(bearer) : undefined;
    if (!user) return respond(401);
    // GET /users/me needs only the Bearer token; the profile comes from the user row.
    if (method === 'GET' && path === '/users/me') return respond(200, profile(user));
    // QueueService.resolveBrowserIdentity / AdmissionGuard need the refresh cookie on every request.
    if (jar.cookies.get(REFRESH_COOKIE) !== user.refreshToken) return respond(401, { message: '브라우저 세션이 필요합니다' });

    if (activeWindowMs !== null && method === 'POST' && path === `/queue/performances/${PERFORMANCE_ID}/enter`) {
      const current = sessions.get(user.refreshToken);
      if (admittedNow(current)) {
        jar.cookies.set(ADMISSION_COOKIE, `admission-${current.id}`);
        return respond(201, { queueSessionId: current.id, state: 'ADMITTED' });
      }
      if (current) current.state = 'EXPIRED';
      sessionSeq += 1;
      const session = { id: `session-${user.refreshToken}-${sessionSeq}`, state: 'WAITING', pollsLeft: waitingPolls };
      sessions.set(user.refreshToken, session);
      if (session.pollsLeft <= 0) admit(jar, session);
      return respond(201, { queueSessionId: session.id, state: session.state });
    }
    if (activeWindowMs !== null && method === 'GET' && path.startsWith('/queue/sessions/')) {
      const session = sessions.get(user.refreshToken);
      if (!session || path !== `/queue/sessions/${session.id}`) return respond(404);
      if (session.state === 'WAITING') {
        session.pollsLeft -= 1;
        if (session.pollsLeft <= 0) admit(jar, session);
      }
      return respond(200, { state: session.state });
    }
    if (method === 'POST' && path === `/queue/performances/${PERFORMANCE_ID}/enter`) {
      jar.cookies.set(ADMISSION_COOKIE, `admission-${user.refreshToken}`);
      return respond(201, { queueSessionId: `session-${user.refreshToken}`, state: polls > 0 ? 'WAITING' : 'ADMITTED' });
    }
    if (method === 'GET' && path.startsWith('/queue/sessions/')) {
      polls -= 1;
      return respond(200, { state: polls > 0 ? 'WAITING' : 'ADMITTED' });
    }
    const admitted = activeWindowMs === null
      ? jar.cookies.get(ADMISSION_COOKIE) === `admission-${user.refreshToken}`
      : admittedNow(sessions.get(user.refreshToken))
        && jar.cookies.get(ADMISSION_COOKIE) === `admission-${sessions.get(user.refreshToken).id}`;
    if (method === 'POST' && path === '/booking/seats/lock') {
      if (!admitted) return respond(403, { message: '대기열 입장 인증이 필요합니다' });
      const { seatId } = JSON.parse(body);
      if (sold.has(seatId)) return respond(409, { message: '이미 판매된 좌석입니다' });
      if (locks.has(seatId) && locks.get(seatId) !== user.refreshToken) return respond(409);
      locks.set(seatId, user.refreshToken);
      return respond(201, { success: true });
    }
    if (method === 'POST' && path === '/reservations/prepare') {
      if (!admitted) return respond(403);
      const parsed = prepareTransportSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return respond(400, { issues: parsed.error.issues });
      if (bookingConsentOutdated(parsed.data.consentItems)) return respond(400, { message: 'consent document outdated' });
      const seat = parsed.data.seats[0];
      if (locks.get(seat.seatKey) !== user.refreshToken) return respond(409);
      if (parsed.data.amount !== seat.price + shared.TICKET_SERVICE_FEE_KRW) return respond(400);
      reservations.set(parsed.data.orderId, seat.seatKey);
      return respond(201, { reservationId: `reservation-${parsed.data.orderId}` });
    }
    if (method === 'POST' && path === '/payments/confirm') {
      if (!admitted) return respond(403);
      const parsed = shared.confirmPaymentSchema.safeParse(JSON.parse(body));
      if (!parsed.success) return respond(400);
      confirms += 1;
      const outcome = confirmOutcome(confirms);
      // status 0 models a timeout after the server already sold the seat.
      if (outcome === 200 || outcome === 0) {
        const seatKey = reservations.get(parsed.data.orderId);
        sold.add(seatKey);
        locks.delete(seatKey);
      }
      return outcome === 200 ? respond(200, { status: 'CONFIRMED' }) : respond(outcome);
    }
    if (method === 'PUT' && path.endsWith('/cancel-pending')) return respond(204);
    if (method === 'DELETE' && path === `/booking/seats/lock-all/${SHOWTIME_ID}`) {
      for (const [seatId, owner] of locks) if (owner === user.refreshToken) locks.delete(seatId);
      return respond(200, { unlocked: true });
    }
    return respond(404);
  }

  function handle(jar, method, url, body, params) {
    const path = url.slice(API.length);
    const response = route(jar, method, path, body, params);
    calls.push({ method, path, headers: params?.headers ?? {}, tags: params?.tags ?? {}, body, status: response.status,
      responseBody: response.body, vu: jar.vu });
    return response;
  }

  // One k6-like http module per VU. Like k6 (noCookiesReset=false), the VU gets
  // an empty cookie jar at the start of every iteration.
  function httpForVu(vu) {
    const jar = { vu, cookies: new Map(), seeded: 0, set(url, name, value, options) {
      assert.equal(url, API); assert.equal(options.path, '/'); this.cookies.set(name, value); this.seeded += 1;
    } };
    return {
      jar,
      resetCookies: () => { jar.cookies = new Map(); },
      cookieJar: () => jar,
      get: (url, params) => handle(jar, 'GET', url, null, params),
      post: (url, body, params) => handle(jar, 'POST', url, body, params),
      put: (url, body, params) => handle(jar, 'PUT', url, body, params),
      del: (url, body, params) => handle(jar, 'DELETE', url, body, params),
      batch: (requests) => requests.map(([method, url, body, params]) => handle(jar, method, url, body, params)),
    };
  }

  return { calls, locks, sold, httpForVu };
}

function counter() {
  const values = [];
  return { values, add: (value, tags) => values.push({ value, tags }) };
}

function harness({ config, users, seats, waitingPolls = 0, random = 0, confirmOutcome, profile, apiUsers = users,
  activeWindowMs = null }) {
  let clock = NOW_S * 1000;
  const api = fakeApi({ users: apiUsers, waitingPolls, confirmOutcome, profile, activeWindowMs, now: () => clock });
  const metrics = { queueAdmitted: counter(), queueNotAdmitted: counter() };
  const sleeps = [];
  let iterationInTest = 0;
  const vus = new Map();
  function vu(id) {
    if (!vus.has(id)) {
      const http = api.httpForVu(id);
      const exec = { vu: { idInTest: id }, scenario: { get iterationInTest() { return iterationInTest; } } };
      const load = createPhase26Load({ http, check: () => true, exec, metrics, config, users, seats,
        sleep: (seconds) => { sleeps.push(seconds); clock += seconds * 1000; }, now: () => new Date(clock) });
      vus.set(id, { http, load });
    }
    return vus.get(id);
  }
  const originalRandom = Math.random;
  return {
    api, metrics, sleeps,
    advance: (ms) => { clock += ms; },
    jar: (id) => vu(id).http.jar,
    run(id, setupData) {
      const { http, load } = vu(id);
      http.resetCookies();
      Math.random = () => random;
      try { load.iteration(setupData); } finally { Math.random = originalRandom; iterationInTest += 1; }
    },
    setup: () => vu(0).load.setup(),
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

const POLICY = { maxTicketsPerOrder: 1, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false };
const lockCalls = (h) => h.api.calls.filter((call) => call.path === '/booking/seats/lock');

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

test('sizes the seat pool so every VU owns its seats', () => {
  assert.equal(requiredSeatCount(parseConfig(env(), 'LOAD_10K_BASELINE')), 10000);
  assert.equal(requiredSeatCount(parseConfig(env({ PHASE26_CONFIRM_MODE: 'pg-stub', PHASE26_MAX_PURCHASES_PER_VU: '2' }),
    'LOAD_20K_STRESS')), 40000);
  assert.equal(requiredSeatCount(parseConfig(env({ PHASE26_MUTATION_WEIGHT: '0' }), 'LOAD_10K_BASELINE')), 0);
  assert.throws(() => parseSeatPool(seatPool(5), { minSeats: 6 }), /at least 6 are required/);
  assert.equal(parseSeatPool(seatPool(6), { minSeats: 6 }).length, 6);
});

test('setup refuses tokens that would expire during the run once VU initialisation is over', () => {
  const config = parseConfig(env(), 'LOAD_10K_BASELINE');
  // Valid when the pool was parsed, but the 11.5 minute run + 2 minute margin outlasts a 13 minute token.
  const users = parseUserPool(buyers(1, { exp: NOW_S + 13 * 60 }), { minUsers: 1, validUntilMs: NOW_S * 1000 });
  const h = harness({ config, users, seats: parseSeatPool(seatPool(1)) });
  assert.throws(() => h.setup(), /expires before the run ends/);
  const fresh = harness({ config, users: parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 }), seats: parseSeatPool(seatPool(1)) });
  assert.doesNotThrow(() => fresh.setup());
});

test('setup proves the pool belongs to this target before any load', () => {
  const config = parseConfig(env(), 'LOAD_10K_BASELINE');
  const users = parseUserPool(buyers(3), { minUsers: 3, validUntilMs: 0 });
  const seats = parseSeatPool(seatPool(3));
  const ok = harness({ config, users, seats });
  ok.setup();
  const probes = ok.api.calls.filter((call) => call.path === '/users/me');
  assert.deepEqual(probes.map((call) => [call.headers.Authorization, call.status, call.tags.flow]),
    [[`Bearer ${users[0].accessToken}`, 200, 'setup'], [`Bearer ${users[2].accessToken}`, 200, 'setup']]);

  const cases = {
    // The API knows none of the pool tokens: minted with another target's secret.
    'minted for another target (401)': { apiUsers: [] },
    'unverified phone': { profile: (user) => ({ ...VERIFIED_PROFILE(user), isPhoneVerified: false }) },
    'admin in the database': { profile: (user) => ({ ...VERIFIED_PROFILE(user), role: 'admin' }) },
    'token of another account': { profile: (user) => ({ ...VERIFIED_PROFILE(user), id: 'someone-else' }) },
  };
  for (const [name, options] of Object.entries(cases)) {
    const h = harness({ config, users, seats, ...options });
    assert.throws(() => h.setup(), /not an email- and phone-verified `user` of this target/, name);
  }
});

test('refuses a journey mix that one buyer cannot send without hitting the API throttles', () => {
  for (const gate of ['LOAD_10K_BASELINE', 'LOAD_20K_STRESS']) {
    for (const mode of ['off', 'pg-stub']) {
      const config = parseConfig(env({ PHASE26_CONFIRM_MODE: mode }), gate);
      for (const [label, requests] of Object.entries(buyerThrottleDemand(config))) {
        const limit = BUYER_THROTTLES[label.startsWith('default') ? 'default' : label].limit;
        assert.ok(requests <= limit, `${gate}/${mode} ${label} ${requests} <= ${limit}`);
      }
    }
  }
  assert.throws(() => parseConfig(env({ PHASE26_THINK_TIME_SECONDS: '0' }), 'LOAD_10K_BASELINE'), /unbounded requests/);
  assert.throws(() => parseConfig(env({ PHASE26_THINK_TIME_SECONDS: '1' }), 'LOAD_10K_BASELINE'), /default \(public browse\) throttle/);
  assert.throws(() => parseConfig(env({ PHASE26_QUEUE_POLL_SECONDS: '1' }), 'LOAD_10K_BASELINE'), /default \(authenticated\) throttle/);
  // Raising the purchase share to half the journeys exceeds prepare 8/min per buyer.
  assert.throws(() => parseConfig(env({ PHASE26_READ_WEIGHT: '50', PHASE26_QUEUE_WEIGHT: '0', PHASE26_MUTATION_WEIGHT: '50' }),
    'LOAD_10K_BASELINE'), /prepare-reservation throttle, which allows 8/);
  assert.throws(() => parseConfig(env({ PHASE26_READ_WEIGHT: '60', PHASE26_QUEUE_WEIGHT: '0', PHASE26_MUTATION_WEIGHT: '40',
    PHASE26_CONFIRM_MODE: 'pg-stub' }), 'LOAD_10K_BASELINE'), /confirm-payment throttle, which allows 6/);
  assert.doesNotThrow(() => parseConfig(env({ PHASE26_READ_WEIGHT: '60', PHASE26_QUEUE_WEIGHT: '0', PHASE26_MUTATION_WEIGHT: '40',
    PHASE26_THINK_TIME_SECONDS: '5', PHASE26_CONFIRM_MODE: 'pg-stub' }), 'LOAD_10K_BASELINE'));
});

test('keeps the per-buyer throttle model aligned with the API throttles', async () => {
  const policies = await readFile(new URL('../../apps/api/src/modules/traffic/traffic-defense.service.ts', import.meta.url), 'utf8');
  for (const name of ['queue-entry', 'lock-seat', 'prepare-reservation', 'confirm-payment']) {
    const block = new RegExp(`'${name}': \\{\\s*ttl: ([\\d_]+),\\s*limit: (\\d+),`).exec(policies);
    assert.ok(block, `${name} policy found`);
    assert.equal(Number(block[1].replaceAll('_', '')), BUYER_THROTTLES[name].ttlSeconds * 1000, `${name} ttl`);
    assert.equal(Number(block[2]), BUYER_THROTTLES[name].limit, `${name} limit`);
  }
  // The global default throttler is defined with the policies (TrafficDefenseService
  // .getThrottlerModuleConfig, audit #5); comment lines may sit between its fields.
  const fallback = /name: 'default',(?:\s*\/\/[^\n]*)*\s*ttl: ([\d_]+),\s*limit: (\d+),/.exec(policies);
  assert.ok(fallback, 'default throttler found');
  assert.equal(Number(fallback[1].replaceAll('_', '')), BUYER_THROTTLES.default.ttlSeconds * 1000);
  assert.equal(Number(fallback[2]), BUYER_THROTTLES.default.limit);
});

test('a buyer journey authenticates the queue, carries the admission cookie and sends a contract-valid prepare', () => {
  const config = parseConfig(env(), 'LOAD_10K_BASELINE');
  const users = parseUserPool(buyers(2), { minUsers: 2, validUntilMs: 0 });
  const seats = parseSeatPool(seatPool(4));
  const h = harness({ config, users, seats, random: 0 });
  const setupData = h.setup();
  assert.deepEqual(setupData.bookingPolicy, { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY',
    sameGradeChangeEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 });

  h.run(1, setupData);
  h.run(2, setupData);
  h.run(1, setupData);
  assert.deepEqual(lockCalls(h).map((call) => [call.vu, JSON.parse(call.body).seatId, call.status]),
    [[1, '1F:A-1', 201], [2, '1F:A-2', 201], [1, '1F:A-1', 201]], 'each VU locks its own seat; released seats are reused');
  const prepares = h.api.calls.filter((call) => call.path === '/reservations/prepare');
  assert.equal(prepares.length, 3);
  for (const call of prepares) {
    assert.equal(call.status, 201);
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

test('a VU keeps its browser identity across k6 iterations although k6 empties the cookie jar', () => {
  const config = parseConfig(env(), 'LOAD_10K_BASELINE');
  const users = parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 });
  const h = harness({ config, users, seats: parseSeatPool(seatPool(1)), random: 0 });
  const setupData = h.setup();
  for (let iteration = 0; iteration < 4; iteration += 1) h.run(1, setupData);
  const enters = h.api.calls.filter((call) => call.path.endsWith('/enter'));
  assert.deepEqual(enters.map((call) => call.status), [201, 201, 201, 201], 'every iteration re-enters with the refresh cookie');
  assert.deepEqual(lockCalls(h).map((call) => call.status), [201, 201, 201, 201]);
  assert.equal(h.api.calls.some((call) => call.status === 401 || call.status === 403), false);
  assert.equal(h.jar(1).seeded, 4, 'the refresh cookie is seeded into every fresh jar');
});

test('waits in the queue with status polling and books only after ADMITTED', () => {
  const config = parseConfig(env({ PHASE26_QUEUE_POLL_SECONDS: '2', PHASE26_QUEUE_MAX_WAIT_SECONDS: '4' }), 'LOAD_10K_BASELINE');
  const users = buyers(1);
  const seats = parseSeatPool(seatPool(2));
  const waiting = harness({ config, users, seats, waitingPolls: 10, random: 0 });
  waiting.run(1, { bookingPolicy: POLICY });
  assert.equal(waiting.api.calls.filter((call) => call.path.startsWith('/queue/sessions/')).length, 2);
  assert.equal(waiting.api.calls.some((call) => call.path === '/booking/seats/lock'), false);
  assert.equal(waiting.metrics.queueNotAdmitted.values[0].tags.state, 'WAITING');

  const admitted = harness({ config, users, seats, waitingPolls: 2, random: 0 });
  admitted.run(1, { bookingPolicy: POLICY });
  assert.equal(lockCalls(admitted).length, 1);
});

test('pg-stub confirm sends a contract-valid confirm once per buyer and keeps the purchase', () => {
  const config = parseConfig(env({ PHASE26_CONFIRM_MODE: 'pg-stub' }), 'LOAD_20K_STRESS');
  const users = parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 });
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
  assert.equal(lockCalls(h).length, 1);
});

test('pg-stub purchases across VUs and iterations never lock a sold or foreign seat', () => {
  const config = parseConfig(env({ PHASE26_CONFIRM_MODE: 'pg-stub',
    PHASE26_MAX_PURCHASES_PER_VU: '2', PHASE26_STRESS_TARGET_VUS: '3' }), 'LOAD_20K_STRESS');
  const users = parseUserPool(buyers(3), { minUsers: 3, validUntilMs: 0 });
  const seats = parseSeatPool(seatPool(requiredSeatCount(config)), { minSeats: requiredSeatCount(config) });
  const h = harness({ config, users, seats, random: 0 });
  const setupData = h.setup();
  // Interleave VUs like concurrent buyers; each tries to buy on every iteration.
  for (let round = 0; round < 4; round += 1) for (const vu of [1, 2, 3]) h.run(vu, setupData);
  assert.equal(lockCalls(h).filter((call) => call.status === 409).length, 0, 'no lock conflicts on sold or foreign seats');
  assert.equal(h.api.sold.size, 6, 'every buyer bought its two own seats');
  const seatsByVu = (vu) => lockCalls(h).filter((call) => call.vu === vu).map((call) => JSON.parse(call.body).seatId);
  assert.deepEqual(seatsByVu(1), ['1F:A-1', '1F:A-2']);
  assert.deepEqual(seatsByVu(2), ['1F:A-3', '1F:A-4']);
  assert.deepEqual(seatsByVu(3), ['1F:A-5', '1F:A-6']);
  assert.equal(h.api.calls.filter((call) => call.path === '/payments/confirm').length, 6);
});

test('pg-stub reuses a seat after a clean confirm rejection but never after an unanswered confirm', () => {
  const config = parseConfig(env({ PHASE26_CONFIRM_MODE: 'pg-stub',
    PHASE26_MAX_PURCHASES_PER_VU: '2' }), 'LOAD_20K_STRESS');
  const users = parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 });
  // 1st confirm: clean 409 (released, same seat retried); 2nd: timeout after the
  // server sold the seat; 3rd: success.
  const outcomes = [409, 0, 200];
  const h = harness({ config, users, seats: parseSeatPool(seatPool(2)), random: 0, confirmOutcome: (n) => outcomes[n - 1] });
  const setupData = h.setup();
  for (let iteration = 0; iteration < 4; iteration += 1) h.run(1, setupData);
  assert.deepEqual(lockCalls(h).map((call) => [JSON.parse(call.body).seatId, call.status]),
    [['1F:A-1', 201], ['1F:A-1', 201], ['1F:A-2', 201]]);
  assert.equal(h.api.calls.filter((call) => call.path === '/payments/confirm').length, 3);
  assert.deepEqual([...h.api.sold].sort(), ['1F:A-1', '1F:A-2']);
});

test('keeps the k6 service fee and cookie names aligned with the API', () => {
  assert.equal(TICKET_SERVICE_FEE_KRW, shared.TICKET_SERVICE_FEE_KRW);
  assert.equal(REFRESH_COOKIE, shared.AUTH_COOKIE_NAME);
});

test('sends each booking consent row at its current document version and language (audit #65 #106, D7)', () => {
  // Same keys as the booking checkout, each at the shared document version.
  assert.deepEqual(Object.keys(BOOKING_CONSENT_VERSIONS).sort(), [...shared.BOOKING_CONSENT_ITEM_KEYS].sort());
  for (const key of shared.BOOKING_CONSENT_ITEM_KEYS) {
    assert.equal(BOOKING_CONSENT_VERSIONS[key], shared.CONSENT_DOCUMENT_VERSIONS[key], `${key} version`);
  }
  for (const locale of [...shared.SUPPORTED_LOCALES, 'ja']) {
    assert.equal(consentDocumentLanguage(locale), shared.resolveConsentDocumentLanguage(locale), locale);
  }

  const seat = parseSeatPool(seatPool(1))[0];
  for (const [locale, language] of [['ko', 'ko'], ['th', 'en'], ['zh-CN', 'en']]) {
    const config = parseConfig(env({ PHASE26_LOCALE: locale }), 'LOAD_10K_BASELINE');
    const body = buildPrepareBody({ config, seat, orderId: 'PHASE26_ORD-1', bookingPolicy: POLICY, now: new Date(0) });
    assert.deepEqual(body.consentItems, shared.BOOKING_CONSENT_ITEM_KEYS.map((key) => ({
      key, version: shared.CONSENT_DOCUMENT_VERSIONS[key], language, accepted: true, sourceFlow: 'booking',
    })));
    assert.equal(bookingConsentOutdated(body.consentItems), false, `${locale} prepare is accepted`);
  }

  // A non-Korean buyer journey passes the consent check end to end.
  const config = parseConfig(env({ PHASE26_LOCALE: 'th' }), 'LOAD_10K_BASELINE');
  const h = harness({ config, users: parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 }),
    seats: parseSeatPool(seatPool(1)), random: 0 });
  h.run(1, h.setup());
  assert.deepEqual(h.api.calls.filter((call) => call.path === '/reservations/prepare').map((call) => call.status), [201]);
});

test('consent version overrides are per row and the single-version variable is refused', () => {
  assert.throws(() => parseConfig(env({ PHASE26_CONSENT_VERSION: '2026-04-28' }), 'LOAD_10K_BASELINE'),
    /PHASE26_CONSENT_VERSION was removed/);
  assert.deepEqual(parseConfig(env({ PHASE26_CONSENT_VERSIONS: 'privacy=2026-04-28' }), 'LOAD_10K_BASELINE').consentVersions,
    { terms: '2026-04-28', privacy: '2026-04-28' });
  for (const bad of ['pipa_required=2026-05-11', 'terms', 'terms=a=b', 'privacy=']) {
    assert.throws(() => parseConfig(env({ PHASE26_CONSENT_VERSIONS: bad }), 'LOAD_10K_BASELINE'),
      /PHASE26_CONSENT_VERSIONS must be/, bad);
  }
});

test('re-entering after the active window lapsed waits for a new admission instead of failing (audit D2)', () => {
  const config = parseConfig(env({ PHASE26_QUEUE_POLL_SECONDS: '2', PHASE26_QUEUE_MAX_WAIT_SECONDS: '30' }),
    'LOAD_10K_BASELINE');
  const users = parseUserPool(buyers(1), { minUsers: 1, validUntilMs: 0 });
  const h = harness({ config, users, seats: parseSeatPool(seatPool(1)), random: 0, waitingPolls: 2,
    activeWindowMs: 600_000 });
  const setupData = h.setup();
  h.run(1, setupData);
  h.advance(601_000); // the 600 s active admission window has passed
  h.run(1, setupData);
  h.run(1, setupData); // still inside the new window: the same session is reused

  const enters = h.api.calls.filter((call) => call.path.endsWith('/enter'))
    .map((call) => JSON.parse(call.responseBody));
  assert.deepEqual(enters, [
    { queueSessionId: 'session-refresh-0-1', state: 'WAITING' },
    { queueSessionId: 'session-refresh-0-2', state: 'WAITING' },
    { queueSessionId: 'session-refresh-0-2', state: 'ADMITTED' },
  ]);
  const statuses = h.api.calls.filter((call) => call.path.startsWith('/queue/sessions/'));
  assert.deepEqual(statuses.map((call) => call.path), [
    '/queue/sessions/session-refresh-0-1', '/queue/sessions/session-refresh-0-1',
    '/queue/sessions/session-refresh-0-2', '/queue/sessions/session-refresh-0-2',
  ], 'the expired journey polls its new WAITING session until ADMITTED');
  assert.deepEqual(lockCalls(h).map((call) => call.status), [201, 201, 201]);
  assert.equal(h.api.calls.filter((call) => call.status === 401 || call.status === 403).length, 0);
  assert.equal(h.metrics.queueAdmitted.values.length, 3);
});

test('keeps the documented login and refresh throttle figures aligned with ROUTE_THROTTLES', async () => {
  const routeThrottles = await readFile(new URL('../../apps/api/src/modules/traffic/route-throttles.ts', import.meta.url), 'utf8');
  const perMinute = (name) => {
    const match = new RegExp(`\\b${name}: \\{ limit: (\\d+), ttl: MINUTE_MS \\}`).exec(routeThrottles);
    assert.ok(match, `${name} found`);
    return Number(match[1]);
  };
  const login = perMinute('authLogin');
  const refresh = perMinute('authRefresh');
  const policies = await readFile(new URL('../../apps/api/src/modules/traffic/traffic-defense.service.ts', import.meta.url), 'utf8');
  const loginAccount = /'login-account': \{(?:\s*\/\/[^\n]*)*\s*ttl: FIFTEEN_MINUTES_MS,\s*limit: (\d+),/.exec(policies);
  assert.ok(loginAccount, 'login-account policy found');

  const minutes = (buyers) => Math.ceil(buyers / login);
  const expected = [
    `POST /auth/login allows ${login} requests per minute per client IP`,
    `10,000 buyers in about ${minutes(10_000)} minutes and 20,000 in about ${minutes(20_000)} minutes`,
    `${loginAccount[1]} per 15 minutes`,
    `${refresh} requests per minute per client IP`,
  ];
  const provision = (await readFile(new URL('../phase26/provision-load-buyers.mjs', import.meta.url), 'utf8'))
    .split('\n').filter((line) => line.startsWith('//')).map((line) => line.replace(/^\/\/ ?/, '')).join(' ')
    .replace(/\s+/g, ' ');
  const runbook = (await readFile(new URL('../../docs/runbooks/phase26-cutover-ops.md', import.meta.url), 'utf8'))
    .replace(/`/g, '').replace(/\s+/g, ' ');
  for (const text of expected) {
    assert.ok(provision.includes(text), `provision-load-buyers.mjs says "${text}"`);
    assert.ok(runbook.includes(text), `phase26-cutover-ops.md says "${text}"`);
  }
  assert.ok(runbook.includes('DEFAULT_THROTTLER'), 'the runbook names the default throttler definition');
  assert.ok(!/app\.module\.ts/.test(runbook.slice(runbook.indexOf('## Dedicated test-event load gate'))),
    'the load gate section no longer points at app.module.ts');
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
