// Phase 26 load-test logic shared by the k6 entry scripts.
//
// This module imports no k6 module, so Node can unit-test it. The entry scripts
// inject k6's http/check/sleep/execution/metrics APIs. Every virtual user (VU)
// is one synthetic buyer browser: a Bearer access token plus its persisted
// refresh-token cookie, and the queue admission cookie the API sets on enter.
// The admission credential is cookie-only (AdmissionGuard); it is never sent
// as a header.

export const APPROVAL_TOKEN = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';
export const PHASE26_TEST = 'PHASE26_TEST';
// Same positive identification as scripts/phase26/test-event-identity.mjs.
export const PHASE26_MARKER_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]{6,}$/;
export const PHASE26_ORDER_PREFIX_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]*$/;
export const REFRESH_COOKIE = 'refreshToken';
export const ADMISSION_COOKIE = 'grabit_queue_admission';
// Mirrors TICKET_SERVICE_FEE_KRW in @grabit/shared (asserted by the unit test).
export const TICKET_SERVICE_FEE_KRW = 2000;
export const BOOKING_CONSENT_KEYS = ['terms', 'privacy', 'pipa_required'];
export const DEFAULT_CONSENT_VERSION = '2026-04-28';
export const FLOWS = ['read', 'queue', 'lock', 'prepare', 'confirm'];
export const CONFIRM_MODES = ['off', 'pg-stub'];

// The gate names promise concurrent buyers, so the default load is that many
// concurrent VUs ramped up like an opening spike. record-k6-evidence.mjs refuses
// PASS when the measured peak VUs are below this target.
export const GATES = {
  LOAD_10K_BASELINE: {
    scenario: 'phase26_10k_baseline',
    envPrefix: 'PHASE26_BASELINE',
    targetVus: 10000,
    weights: { browse: 75, queue: 20, book: 5 },
  },
  LOAD_20K_STRESS: {
    scenario: 'phase26_20k_stress',
    envPrefix: 'PHASE26_STRESS',
    targetVus: 20000,
    weights: { browse: 80, queue: 18, book: 2 },
  },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DURATION_PATTERN = /^(?:\d+(?:ms|h|m|s))+$/;
const RUN_END_MARGIN_MS = 2 * 60 * 1000;

function requireEnv(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function intEnv(env, name, fallback, { min = 1 } = {}) {
  const raw = String(env[name] || '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return Number(raw);
}

function durationEnv(env, name, fallback) {
  const raw = String(env[name] || '').trim() || fallback;
  if (!DURATION_PATTERN.test(raw)) throw new Error(`${name} must be a k6 duration such as 60s or 10m`);
  return raw;
}

export function durationMs(value) {
  let total = 0;
  const parts = String(value).match(/\d+(?:ms|h|m|s)/g) || [];
  for (const part of parts) {
    const amount = Number(part.match(/\d+/)[0]);
    const unit = part.replace(/\d+/, '');
    total += amount * (unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1);
  }
  return total;
}

export function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+\/api\/v1$/.test(trimmed)) {
    throw new Error('GRABIT_API_URL must be an explicit http(s) API base ending in /api/v1');
  }
  return trimmed;
}

export function parseConfig(env, gateId) {
  const gate = GATES[gateId];
  if (!gate) throw new Error(`Unknown gate ${gateId}`);
  const prefix = gate.envPrefix;
  const apiUrl = normalizeBaseUrl(requireEnv(env, 'GRABIT_API_URL'));
  const performanceId = requireEnv(env, 'PHASE26_TEST_PERFORMANCE_ID');
  const showtimeId = requireEnv(env, 'PHASE26_TEST_SHOWTIME_ID');
  const marker = requireEnv(env, 'PHASE26_TEST_MARKER');
  if (requireEnv(env, 'PHASE26_LOAD_APPROVED') !== APPROVAL_TOKEN) {
    throw new Error(`PHASE26_LOAD_APPROVED must equal ${APPROVAL_TOKEN}`);
  }
  if (!UUID_PATTERN.test(performanceId) || !UUID_PATTERN.test(showtimeId) || performanceId === showtimeId) {
    throw new Error('PHASE26_TEST_PERFORMANCE_ID and PHASE26_TEST_SHOWTIME_ID must be distinct UUIDs');
  }
  if (!PHASE26_MARKER_PATTERN.test(marker)) {
    throw new Error(`PHASE26_TEST_MARKER must match ${PHASE26_MARKER_PATTERN.source}`);
  }

  const weights = {
    browse: intEnv(env, 'PHASE26_READ_WEIGHT', gate.weights.browse, { min: 0 }),
    queue: intEnv(env, 'PHASE26_QUEUE_WEIGHT', gate.weights.queue, { min: 0 }),
    book: intEnv(env, 'PHASE26_MUTATION_WEIGHT', gate.weights.book, { min: 0 }),
  };
  if (weights.browse + weights.queue + weights.book <= 0) {
    throw new Error('At least one of PHASE26_READ_WEIGHT, PHASE26_QUEUE_WEIGHT, PHASE26_MUTATION_WEIGHT must be positive');
  }

  const prepare = String(env.PHASE26_PREPARE || '1').trim() !== '0';
  const confirmMode = String(env.PHASE26_CONFIRM_MODE || 'off').trim();
  if (CONFIRM_MODES.indexOf(confirmMode) < 0) {
    throw new Error(`PHASE26_CONFIRM_MODE must be one of ${CONFIRM_MODES.join(', ')}`);
  }
  if (confirmMode !== 'off' && !prepare) {
    throw new Error('PHASE26_CONFIRM_MODE requires PHASE26_PREPARE to stay enabled');
  }
  const orderPrefix = prepare ? requireEnv(env, 'PHASE26_TEST_ORDER_PREFIX') : '';
  if (prepare && !PHASE26_ORDER_PREFIX_PATTERN.test(orderPrefix)) {
    throw new Error('PHASE26_TEST_ORDER_PREFIX must start with PHASE26_ or PHASE26- and use only letters, digits, _ or -');
  }

  const rampUp = durationEnv(env, `${prefix}_RAMP_UP`, '60s');
  const hold = durationEnv(env, `${prefix}_HOLD`, '10m');
  const rampDown = durationEnv(env, `${prefix}_RAMP_DOWN`, '30s');
  return {
    gateId,
    scenario: gate.scenario,
    apiUrl,
    performanceId,
    showtimeId,
    marker,
    orderPrefix,
    userPoolFile: requireEnv(env, 'PHASE26_USER_POOL_FILE'),
    seatPoolFile: weights.book > 0 ? requireEnv(env, 'PHASE26_SEAT_POOL_FILE') : '',
    targetVus: intEnv(env, `${prefix}_TARGET_VUS`, gate.targetVus),
    gateTargetVus: gate.targetVus,
    rampUp,
    hold,
    rampDown,
    runDurationMs: durationMs(rampUp) + durationMs(hold) + durationMs(rampDown),
    weights,
    prepare,
    confirmMode,
    maxPurchasesPerVu: intEnv(env, 'PHASE26_MAX_PURCHASES_PER_VU', 1),
    thinkTimeSeconds: intEnv(env, 'PHASE26_THINK_TIME_SECONDS', 3, { min: 0 }),
    queuePollSeconds: intEnv(env, 'PHASE26_QUEUE_POLL_SECONDS', 2),
    queueMaxWaitSeconds: intEnv(env, 'PHASE26_QUEUE_MAX_WAIT_SECONDS', 120),
    httpTimeout: durationEnv(env, 'PHASE26_HTTP_TIMEOUT', '10s'),
    locale: String(env.PHASE26_LOCALE || 'ko').trim(),
    consentVersion: String(env.PHASE26_CONSENT_VERSION || DEFAULT_CONSENT_VERSION).trim(),
  };
}

export function buildOptions(config) {
  const flows = ['read', 'queue'];
  if (config.weights.book > 0) {
    flows.push('lock');
    if (config.prepare) flows.push('prepare');
    if (config.confirmMode !== 'off') flows.push('confirm');
  }
  const thresholds = {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  };
  // Per-flow sub-metrics make each purchase step visible in --summary-export
  // and fail the run when a step was never exercised.
  for (const flow of flows) {
    thresholds[`http_reqs{flow:${flow}}`] = ['count>0'];
    thresholds[`http_req_failed{flow:${flow}}`] = ['rate<0.01'];
    thresholds[`http_req_duration{flow:${flow}}`] = ['p(95)<2000'];
  }
  return {
    discardResponseBodies: true,
    setupTimeout: '120s',
    thresholds,
    scenarios: {
      [config.scenario]: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: config.rampUp, target: config.targetVus },
          { duration: config.hold, target: config.targetVus },
          { duration: config.rampDown, target: 0 },
        ],
        gracefulRampDown: '30s',
        tags: { phase: '26', gate: config.gateId, PHASE26_TEST },
      },
    },
  };
}

function base64UrlDecode(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const char of String(value).replace(/=+$/, '')) {
    const index = alphabet.indexOf(char === '+' ? '-' : char === '/' ? '_' : char);
    if (index < 0) throw new Error('invalid base64url');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

export function jwtClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('access token is not a JWT');
  return JSON.parse(base64UrlDecode(parts[1]));
}

// Validates the synthetic buyer pool. Tokens are never logged or echoed.
export function parseUserPool(raw, { minUsers, validUntilMs }) {
  const users = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(users)) throw new Error('PHASE26_USER_POOL_FILE must contain a JSON array');
  if (users.length < minUsers) {
    throw new Error(`PHASE26_USER_POOL_FILE has ${users.length} users; one distinct buyer per VU needs at least ${minUsers}`);
  }
  const subjects = {};
  const refreshTokens = {};
  return users.map((user, index) => {
    if (!user || typeof user.accessToken !== 'string' || typeof user.refreshToken !== 'string' || !user.refreshToken) {
      throw new Error(`user pool entry ${index} needs accessToken and refreshToken`);
    }
    let claims;
    try {
      claims = jwtClaims(user.accessToken);
    } catch (error) {
      throw new Error(`user pool entry ${index} accessToken is not a readable JWT`);
    }
    if (typeof claims.sub !== 'string' || !claims.sub) throw new Error(`user pool entry ${index} accessToken has no sub`);
    if (claims.role === 'admin') {
      // Admin requests bypass the queue and admission guard, which hides the path under test.
      throw new Error(`user pool entry ${index} is an admin; use buyer accounts only`);
    }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < validUntilMs) {
      throw new Error(`user pool entry ${index} accessToken expires before the run ends; mint fresh tokens`);
    }
    if (subjects[claims.sub]) throw new Error(`user pool entry ${index} repeats a buyer; each VU needs a distinct user`);
    if (refreshTokens[user.refreshToken]) throw new Error(`user pool entry ${index} repeats a refresh token`);
    subjects[claims.sub] = true;
    refreshTokens[user.refreshToken] = true;
    return { accessToken: user.accessToken, refreshToken: user.refreshToken };
  });
}

export function runValidUntilMs(config, nowMs) {
  return nowMs + config.runDurationMs + RUN_END_MARGIN_MS;
}

const SEAT_FIELDS = ['seatId', 'seatKey', 'floorKey', 'floorLabel', 'tierName', 'row', 'number'];

export function parseSeatPool(raw) {
  const seats = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('PHASE26_SEAT_POOL_FILE must contain a non-empty JSON array');
  const seen = {};
  return seats.map((seat, index) => {
    for (const field of SEAT_FIELDS) {
      if (typeof seat?.[field] !== 'string' || !seat[field]) throw new Error(`seat pool entry ${index} needs ${field}`);
    }
    if (!Number.isInteger(seat.price) || seat.price < 0) throw new Error(`seat pool entry ${index} needs an integer price`);
    if (seen[seat.seatKey]) throw new Error(`seat pool entry ${index} repeats seatKey; each lock needs a distinct seat`);
    seen[seat.seatKey] = true;
    const selection = {};
    for (const field of SEAT_FIELDS) selection[field] = seat[field];
    selection.price = seat.price;
    if (typeof seat.tierColor === 'string' && seat.tierColor) selection.tierColor = seat.tierColor;
    return selection;
  });
}

export function toBookingPolicy(policy) {
  const maxTickets = Number(policy?.maxTicketsPerUser);
  const changeEnabled = Boolean(policy?.changePolicyEnabled);
  const result = {
    maxTicketsPerOrder: Number.isInteger(maxTickets) && maxTickets > 0 ? maxTickets : 1,
    cancellationChangePolicy: changeEnabled ? 'SAME_GRADE_CHANGE' : 'CANCEL_ONLY',
    sameGradeChangeEnabled: changeEnabled,
  };
  if (Number.isInteger(policy?.paymentWindowMinutes) && policy.paymentWindowMinutes > 0) {
    result.paymentWindowMinutes = policy.paymentWindowMinutes;
  }
  if (Number.isInteger(policy?.seatHoldMinutes) && policy.seatHoldMinutes > 0) {
    result.seatHoldMinutes = policy.seatHoldMinutes;
  }
  return result;
}

// Same body the confirm page sends: the server derives price, deadline and
// admission from its own state, but the transport contract still requires them.
export function buildPrepareBody({ config, seat, orderId, bookingPolicy, now }) {
  return {
    orderId,
    showtimeId: config.showtimeId,
    seats: [seat],
    amount: seat.price + TICKET_SERVICE_FEE_KRW,
    consentItems: BOOKING_CONSENT_KEYS.map((key) => ({
      key,
      version: config.consentVersion,
      language: config.locale,
      accepted: true,
      sourceFlow: 'booking',
    })),
    paymentDeadlineAt: now.toISOString(),
    bookingPolicy,
    paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
  };
}

export function chooseDepth(weights, random) {
  const total = weights.browse + weights.queue + weights.book;
  const pick = random * total;
  if (pick < weights.book) return 'book';
  if (pick < weights.book + weights.queue) return 'queue';
  return 'browse';
}

function parseJson(response) {
  try {
    return JSON.parse(String(response?.body || ''));
  } catch (error) {
    return null;
  }
}

function isSuccess(response) {
  return response.status >= 200 && response.status < 300;
}

export function assertTestEvent(performance, config) {
  const title = typeof performance?.title === 'string' ? performance.title : '';
  if (!title.startsWith(config.marker)) {
    throw new Error('Phase 26 setup failed: performance title must start with PHASE26_TEST_MARKER');
  }
  const showtimes = Array.isArray(performance?.showtimes) ? performance.showtimes : [];
  if (!showtimes.some((showtime) => showtime?.id === config.showtimeId)) {
    throw new Error('Phase 26 setup failed: PHASE26_TEST_SHOWTIME_ID is not a showtime of the test performance');
  }
}

export function createPhase26Load({ http, check, sleep, exec, metrics, config, users, seats, now = () => new Date() }) {
  const base = config.apiUrl;
  const performancePath = `/performances/${encodeURIComponent(config.performanceId)}`;
  const seatsPath = `/booking/schedules/${encodeURIComponent(config.showtimeId)}/seats`;
  let buyer = null;

  function params(flow, name, { body = false, user = buyer } = {}) {
    const headers = { 'content-type': 'application/json', 'x-phase26-test': PHASE26_TEST };
    if (user) headers.Authorization = `Bearer ${user.accessToken}`;
    const result = {
      headers,
      tags: { phase: '26', gate: config.gateId, flow, path: name, PHASE26_TEST },
      timeout: config.httpTimeout,
    };
    if (body) result.responseType = 'text';
    return result;
  }

  function currentBuyer() {
    if (buyer) return buyer;
    const vuId = exec.vu.idInTest;
    const user = users[(vuId - 1) % users.length];
    // One browser per VU: the refresh cookie identifies the device slot, and the
    // jar keeps the admission cookie set by POST /queue/.../enter.
    http.cookieJar().set(base, REFRESH_COOKIE, user.refreshToken, { path: '/' });
    buyer = { accessToken: user.accessToken, purchases: 0 };
    return buyer;
  }

  function browse() {
    const responses = http.batch([
      ['GET', `${base}${performancePath}`, null, params('read', 'read:performance')],
      ['GET', `${base}${seatsPath}`, null, params('read', 'read:seats')],
    ]);
    check(responses[0], { 'performance detail returns 2xx': isSuccess });
    check(responses[1], { 'seat status returns 2xx': isSuccess });
  }

  function enterQueue() {
    let response = http.post(`${base}/queue/performances/${encodeURIComponent(config.performanceId)}/enter`, '{}',
      params('queue', 'queue:enter', { body: true }));
    check(response, { 'queue enter returns 2xx': isSuccess });
    if (!isSuccess(response)) return false;
    let session = parseJson(response);
    const sessionId = session?.queueSessionId;
    const deadline = now().getTime() + config.queueMaxWaitSeconds * 1000;
    while (session?.state === 'WAITING' && sessionId && now().getTime() < deadline) {
      sleep(config.queuePollSeconds);
      response = http.get(`${base}/queue/sessions/${encodeURIComponent(sessionId)}`, params('queue', 'queue:status', { body: true }));
      check(response, { 'queue status returns 2xx': isSuccess });
      if (!isSuccess(response)) return false;
      session = parseJson(response);
    }
    if (session?.state === 'ADMITTED') {
      metrics.queueAdmitted.add(1);
      return true;
    }
    metrics.queueNotAdmitted.add(1, { state: String(session?.state || 'unknown') });
    return false;
  }

  function book(setupData) {
    const seat = seats[exec.scenario.iterationInTest % seats.length];
    const lock = http.post(`${base}/booking/seats/lock`, JSON.stringify({ showtimeId: config.showtimeId, seatId: seat.seatKey }),
      params('lock', 'lock:seat'));
    check(lock, { 'seat lock returns 2xx': isSuccess });
    if (!isSuccess(lock)) return;
    let reservationId = null;
    let confirmed = false;
    try {
      if (!config.prepare) return;
      const orderId = `${config.orderPrefix}${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      const body = buildPrepareBody({ config, seat, orderId, bookingPolicy: setupData.bookingPolicy, now: now() });
      const prepare = http.post(`${base}/reservations/prepare`, JSON.stringify(body), params('prepare', 'prepare:reservation', { body: true }));
      check(prepare, { 'prepare returns 2xx': isSuccess });
      if (!isSuccess(prepare)) return;
      reservationId = parseJson(prepare)?.reservationId || null;
      if (config.confirmMode === 'pg-stub') {
        // The target's PG egress is stubbed (scripts/revamp/pg-stub-preload.mjs);
        // never point this mode at an environment that reaches a real PG.
        const confirm = http.post(`${base}/payments/confirm`,
          JSON.stringify({ paymentKey: `phase26_stub_${orderId}`, orderId, amount: body.amount }),
          params('confirm', 'confirm:payment'));
        check(confirm, { 'confirm returns 2xx': isSuccess });
        confirmed = isSuccess(confirm);
        if (confirmed) buyer.purchases += 1;
      }
    } finally {
      // Abandoned checkouts release their hold like a buyer leaving the page.
      if (reservationId && !confirmed) {
        http.put(`${base}/reservations/${encodeURIComponent(reservationId)}/cancel-pending`, null, params('cleanup', 'cleanup:cancel-pending'));
      }
      http.del(`${base}/booking/seats/lock-all/${encodeURIComponent(config.showtimeId)}`, null, params('cleanup', 'cleanup:unlock'));
    }
  }

  function setup() {
    const responses = http.batch([
      ['GET', `${base}/health`, null, params('setup', 'setup:health', { user: null })],
      ['GET', `${base}${performancePath}`, null, params('setup', 'setup:performance', { body: true, user: null })],
      ['GET', `${base}${seatsPath}`, null, params('setup', 'setup:seats', { user: null })],
    ]);
    if (!responses.every(isSuccess)) {
      throw new Error('Phase 26 setup failed: target performance/showtime is not load-test ready');
    }
    const performance = parseJson(responses[1]);
    assertTestEvent(performance, config);
    return { bookingPolicy: toBookingPolicy(performance?.bookingPolicy) };
  }

  function iteration(setupData) {
    currentBuyer();
    let depth = chooseDepth(config.weights, Math.random());
    // A buyer who already purchased keeps browsing/queueing but does not buy again.
    if (depth === 'book' && buyer.purchases >= config.maxPurchasesPerVu) depth = 'queue';
    browse();
    if (depth !== 'browse' && enterQueue() && depth === 'book') book(setupData);
    if (config.thinkTimeSeconds > 0) sleep(config.thinkTimeSeconds);
  }

  return { setup, iteration };
}
