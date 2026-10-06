// Phase 26 load-test logic shared by the k6 entry scripts.
//
// This module imports no k6 module, so Node can unit-test it. The entry scripts
// inject k6's http/check/sleep/execution/metrics APIs. Every virtual user (VU)
// is one synthetic buyer browser: a Bearer access token plus its persisted
// refresh-token cookie, and the queue admission cookie the API sets on enter.
// The admission credential is cookie-only (AdmissionGuard); it is never sent
// as a header.
//
// k6 empties each VU's cookie jar after every iteration (noCookiesReset=false
// by default), so the refresh cookie is seeded at the start of every iteration
// and each journey re-enters the queue. While the buyer's admission is still
// active the API reuses the same queue session; once the active window has
// passed, enter returns a new WAITING position and the journey polls until
// ADMITTED again.
//
// The buyer pool comes from scripts/phase26/provision-load-buyers.mjs. k6 never
// refreshes tokens, so every access token must outlive the run.

export const APPROVAL_TOKEN = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';
export const PHASE26_TEST = 'PHASE26_TEST';
// Same positive identification as scripts/phase26/test-event-identity.mjs.
export const PHASE26_MARKER_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]{6,}$/;
export const PHASE26_ORDER_PREFIX_PATTERN = /^PHASE26[_-][A-Za-z0-9_-]*$/;
export const REFRESH_COOKIE = 'refreshToken';
export const ADMISSION_COOKIE = 'grabit_queue_admission';
// Mirrors TICKET_SERVICE_FEE_KRW in @grabit/shared (asserted by the unit test).
export const TICKET_SERVICE_FEE_KRW = 2000;
// The rows the booking checkout records and the current document version of
// each: BOOKING_CONSENT_ITEM_KEYS and CONSENT_DOCUMENT_VERSIONS in @grabit/shared
// (asserted by the unit test). k6 cannot import the shared package. pipa_required
// is captured at signup and is not part of booking.
export const BOOKING_CONSENT_VERSIONS = Object.freeze({ terms: '2026-04-28', privacy: '2026-05-11' });
export const FLOWS = ['read', 'queue', 'lock', 'prepare', 'confirm'];
export const CONFIRM_MODES = ['off', 'pg-stub'];
const CONSENT_VERSION_PATTERN = /^[0-9A-Za-z._-]{1,40}$/;

// Legal documents exist only in Korean and English; mirrors
// resolveConsentDocumentLanguage in @grabit/shared.
export function consentDocumentLanguage(locale) {
  return locale === 'ko' ? 'ko' : 'en';
}

// PHASE26_CONSENT_VERSIONS='terms=2026-04-28,privacy=2026-05-11' overrides the
// version of individual booking rows, for a target that still serves an older
// active document. The single PHASE26_CONSENT_VERSION was removed: one version
// for every row cannot match documents with different effective dates.
export function parseConsentVersions(env) {
  if (String(env.PHASE26_CONSENT_VERSION || '').trim()) {
    throw new Error('PHASE26_CONSENT_VERSION was removed; set per-row versions with '
      + "PHASE26_CONSENT_VERSIONS='terms=<version>,privacy=<version>' or leave it unset for the current documents");
  }
  const versions = { ...BOOKING_CONSENT_VERSIONS };
  const raw = String(env.PHASE26_CONSENT_VERSIONS || '').trim();
  if (!raw) return versions;
  for (const pair of raw.split(',')) {
    const [key, version, extra] = pair.split('=').map((part) => part.trim());
    if (extra !== undefined || !Object.prototype.hasOwnProperty.call(BOOKING_CONSENT_VERSIONS, key)
      || !CONSENT_VERSION_PATTERN.test(version || '')) {
      throw new Error(`PHASE26_CONSENT_VERSIONS must be comma-separated key=version pairs for ${Object.keys(BOOKING_CONSENT_VERSIONS).join(', ')}`);
    }
    versions[key] = version;
  }
  return versions;
}

// Per-buyer API throttles: DEFAULT_THROTTLER (the global `default` throttler)
// and TRAFFIC_POLICIES in traffic-defense.service.ts (asserted by the unit test).
// Every request carries the buyer's access token, so each limit counts per buyer
// account. The public browse budget is stricter than the API: catalog reads are
// not throttled and the seat map read allows 60 per 10 s (SEAT_STATUS_THROTTLE).
export const BUYER_THROTTLES = {
  default: { limit: 60, ttlSeconds: 60 },
  'queue-entry': { limit: 20, ttlSeconds: 60 },
  'lock-seat': { limit: 12, ttlSeconds: 15 },
  'prepare-reservation': { limit: 8, ttlSeconds: 60 },
  'confirm-payment': { limit: 6, ttlSeconds: 60 },
};

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
  const config = {
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
    consentVersions: parseConsentVersions(env),
  };
  assertWithinBuyerThrottles(config);
  return config;
}

// Worst-case requests one buyer sends per throttle window. Every iteration ends
// with PHASE26_THINK_TIME_SECONDS of sleep, so a buyer runs at most
// 1 / thinkTime iterations per second; a WAITING buyer polls every
// PHASE26_QUEUE_POLL_SECONDS. A 429 counts as a failed request, so a mix that
// can exceed a limit would fail the gate's 1% error budget for the wrong reason.
export function buyerThrottleDemand(config) {
  const total = config.weights.browse + config.weights.queue + config.weights.book;
  const book = config.weights.book / total;
  const entering = (config.weights.queue + config.weights.book) / total;
  const prepare = config.prepare ? book : 0;
  const confirm = config.confirmMode === 'pg-stub' ? book : 0;
  const perSecond = config.thinkTimeSeconds > 0 ? 1 / config.thinkTimeSeconds : Infinity;
  const per = (name, requestsPerIteration) =>
    (requestsPerIteration > 0 ? requestsPerIteration * perSecond * BUYER_THROTTLES[name].ttlSeconds : 0);
  // Authenticated calls of one journey: enter, then lock + unlock, prepare +
  // cancel-pending and confirm when booking.
  const authenticated = entering + book * 2 + prepare * 2 + confirm;
  const polling = BUYER_THROTTLES.default.ttlSeconds / config.queuePollSeconds + 6;
  return {
    'default (public browse)': per('default', 2),
    'default (authenticated)': Math.max(per('default', authenticated), polling),
    'queue-entry': per('queue-entry', entering),
    'lock-seat': per('lock-seat', book),
    'prepare-reservation': per('prepare-reservation', prepare),
    'confirm-payment': per('confirm-payment', confirm),
  };
}

export function assertWithinBuyerThrottles(config) {
  const demand = buyerThrottleDemand(config);
  for (const [label, requests] of Object.entries(demand)) {
    const name = label.startsWith('default') ? 'default' : label;
    const { limit, ttlSeconds } = BUYER_THROTTLES[name];
    if (requests > limit) {
      const shown = Number.isFinite(requests) ? Math.ceil(requests) : 'unbounded';
      throw new Error(`One buyer may send ${shown} requests per ${ttlSeconds}s to the API's ${label} throttle, `
        + `which allows ${limit}; raise PHASE26_THINK_TIME_SECONDS or PHASE26_QUEUE_POLL_SECONDS, `
        + 'or lower PHASE26_MUTATION_WEIGHT / PHASE26_QUEUE_WEIGHT');
    }
  }
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

// Seats are partitioned per VU so concurrent buyers never contend for one seat
// and a sold seat is never locked again: VU n owns the seat-pool slice
// [(n - 1) * slots, n * slots). Without confirm every checkout is abandoned and
// its seat released, so one seat per VU is enough; with pg-stub confirm every
// purchase consumes the buyer's next seat.
export function seatSlotsPerVu(config) {
  return config.confirmMode === 'off' ? 1 : config.maxPurchasesPerVu;
}

export function requiredSeatCount(config) {
  return config.weights.book > 0 ? config.targetVus * seatSlotsPerVu(config) : 0;
}

export function seatIndex(config, vuId, seatsUsed) {
  return (vuId - 1) * seatSlotsPerVu(config) + seatsUsed;
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
      throw new Error(`user pool entry ${index} accessToken expires before the run ends; `
        + 'provision a fresh pool with scripts/phase26/provision-load-buyers.mjs');
    }
    if (subjects[claims.sub]) throw new Error(`user pool entry ${index} repeats a buyer; each VU needs a distinct user`);
    if (refreshTokens[user.refreshToken]) throw new Error(`user pool entry ${index} repeats a refresh token`);
    subjects[claims.sub] = true;
    refreshTokens[user.refreshToken] = true;
    return { sub: claims.sub, accessToken: user.accessToken, refreshToken: user.refreshToken, expMs: claims.exp * 1000 };
  });
}

export function runValidUntilMs(config, nowMs) {
  return nowMs + config.runDurationMs + RUN_END_MARGIN_MS;
}

// Initialising 10K/20K VUs takes time after the pool was parsed and k6 never
// refreshes tokens, so setup() re-checks expiry right before the load starts
// instead of trusting the init-time check alone.
export function assertUsersOutliveRun(users, config, nowMs) {
  const validUntilMs = runValidUntilMs(config, nowMs);
  for (let index = 0; index < users.length; index += 1) {
    if (!(users[index].expMs >= validUntilMs)) {
      throw new Error(`Phase 26 setup failed: user pool entry ${index} accessToken expires before the run ends `
        + '(VU initialisation included); provision a fresh pool with scripts/phase26/provision-load-buyers.mjs '
        + 'and a longer --valid-for');
    }
  }
}

// The API decides from the user row, so a pool minted with another target's
// secret, or for unverified or admin accounts, would turn the run into 401/403s.
export function assertBuyerProfile(profile, user) {
  if (!profile || profile.id !== user.sub || profile.role !== 'user'
    || profile.isEmailVerified !== true || profile.isPhoneVerified !== true) {
    throw new Error('Phase 26 setup failed: a pool buyer is not an email- and phone-verified `user` of this target; '
      + 'provision the pool against the database and JWT secret of GRABIT_API_URL');
  }
}

const SEAT_FIELDS = ['seatId', 'seatKey', 'floorKey', 'floorLabel', 'tierName', 'row', 'number'];

export function parseSeatPool(raw, { minSeats = 1 } = {}) {
  const seats = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('PHASE26_SEAT_POOL_FILE must contain a non-empty JSON array');
  if (seats.length < minSeats) {
    throw new Error(`PHASE26_SEAT_POOL_FILE has ${seats.length} seats; each VU needs its own seats `
      + `(target VUs, times PHASE26_MAX_PURCHASES_PER_VU in pg-stub mode), so at least ${minSeats} are required`);
  }
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
    consentItems: Object.keys(config.consentVersions).map((key) => ({
      key,
      version: config.consentVersions[key],
      language: consentDocumentLanguage(config.locale),
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

  // One browser per VU: the refresh cookie identifies the device slot, and the
  // jar keeps the admission cookie set by POST /queue/.../enter for the rest of
  // the iteration. k6 replaces the jar before every iteration, so the persisted
  // refresh cookie is seeded again each time, like a browser that kept it.
  function startBrowser() {
    if (!buyer) {
      const user = users[(exec.vu.idInTest - 1) % users.length];
      buyer = { accessToken: user.accessToken, refreshToken: user.refreshToken, seatsUsed: 0 };
    }
    http.cookieJar().set(base, REFRESH_COOKIE, buyer.refreshToken, { path: '/' });
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
    const seat = seats[seatIndex(config, exec.vu.idInTest, buyer.seatsUsed)];
    if (!seat) throw new Error('Phase 26 seat pool is smaller than the per-VU seat partition');
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
        // A confirm the server may have applied (2xx, timeout, 5xx) may have sold
        // the seat, so the buyer moves to its next own seat. A clean 4xx
        // rejection is released below and the same seat is reused.
        if (confirmed || !(confirm.status >= 400 && confirm.status < 500)) buyer.seatsUsed += 1;
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
    assertUsersOutliveRun(users, config, now().getTime());
    const probes = users.length > 1 ? [users[0], users[users.length - 1]] : [users[0]];
    const profiles = http.batch(probes.map((user) =>
      ['GET', `${base}/users/me`, null, params('setup', 'setup:buyer', { body: true, user })]));
    probes.forEach((user, index) => {
      assertBuyerProfile(isSuccess(profiles[index]) ? parseJson(profiles[index]) : null, user);
    });
    return { bookingPolicy: toBookingPolicy(performance?.bookingPolicy) };
  }

  function iteration(setupData) {
    startBrowser();
    let depth = chooseDepth(config.weights, Math.random());
    // A buyer whose own seats are used up (purchased, or possibly sold by an
    // unanswered confirm) keeps browsing/queueing but does not buy again.
    if (depth === 'book' && buyer.seatsUsed >= seatSlotsPerVu(config)) depth = 'queue';
    browse();
    if (depth !== 'browse' && enterQueue() && depth === 'book') book(setupData);
    if (config.thinkTimeSeconds > 0) sleep(config.thinkTimeSeconds);
  }

  return { setup, iteration };
}
