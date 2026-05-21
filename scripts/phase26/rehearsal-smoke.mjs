#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_EVIDENCE_PATH =
  '.planning/phases/26-m1-canary-cutover-gates/evidence/26-05-rehearsal.json';
const DEFAULT_DRY_RUN_SQL = 'scripts/phase26/cleanup-dry-run.sql';
const DEFAULT_CLEANUP_SQL = 'scripts/phase26/cleanup-test-event.sql';
const HTTP_TIMEOUT_MS = 30_000;
const SQL_TIMEOUT_MS = 120_000;

const REQUIRED_ENV = [
  'GRABIT_API_URL',
  'GRABIT_SMOKE_AUTH_HEADER_FILE',
  'PHASE26_TEST_PERFORMANCE_ID',
  'PHASE26_TEST_SHOWTIME_ID',
  'PHASE26_TEST_SEAT_ID',
  'PHASE26_TEST_ORDER_PREFIX',
  'PHASE26_TEST_MARKER',
  'PHASE26_REHEARSAL_ALLOW_MUTATION',
];

const REQUIRED_MUTATION_APPROVAL = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';

const CLEANUP_CONFIRMATION_ENV = {
  backupConfirmation: 'PHASE26_CLEANUP_BACKUP_CONFIRMATION',
  dryRunReviewed: 'PHASE26_CLEANUP_DRY_RUN_REVIEWED',
  ownerApproval: 'PHASE26_CLEANUP_OWNER_APPROVAL',
  expectedReservations: 'PHASE26_CLEANUP_EXPECTED_RESERVATIONS',
  expectedPayments: 'PHASE26_CLEANUP_EXPECTED_PAYMENTS',
  expectedTickets: 'PHASE26_CLEANUP_EXPECTED_TICKETS',
  expectedRefunds: 'PHASE26_CLEANUP_EXPECTED_REFUNDS',
  expectedWebhookEvents: 'PHASE26_CLEANUP_EXPECTED_WEBHOOK_EVENTS',
  expectedSeatInventories: 'PHASE26_CLEANUP_EXPECTED_SEAT_INVENTORIES',
};

const FINAL_STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED']);

function usage() {
  return `Usage:
  node scripts/phase26/rehearsal-smoke.mjs [--execute-cleanup]
  node scripts/phase26/rehearsal-smoke.mjs --record-blocked --blocked-reason "<reason>"
  node scripts/phase26/rehearsal-smoke.mjs --help

Required environment for live rehearsal:
  GRABIT_API_URL                         API origin, for example https://api.example.com
  GRABIT_SMOKE_AUTH_HEADER_FILE          Local file containing one Authorization: Bearer or Cookie: header
  PHASE26_TEST_PERFORMANCE_ID            Dedicated test-event performance UUID
  PHASE26_TEST_SHOWTIME_ID               Dedicated test-event showtime UUID
  PHASE26_TEST_SEAT_ID                   Dedicated test seat ID or floor-aware seatKey
  PHASE26_TEST_ORDER_PREFIX              Must start with PHASE26_ or PHASE26-
  PHASE26_TEST_MARKER                    Explicit test marker present on the test performance
  PHASE26_REHEARSAL_ALLOW_MUTATION       Must equal ${REQUIRED_MUTATION_APPROVAL}

Optional environment:
  PHASE26_REHEARSAL_EVIDENCE             Evidence JSON path
  PHASE26_DATABASE_URL or DATABASE_URL    Database URL used through PGDATABASE for psql dry-run
  PHASE26_TEST_PAYMENT_KEY               Toss test paymentKey for confirm/refund branch
  PHASE26_TEST_AMOUNT                    Override fixture amount in KRW
  PHASE26_TEST_TIER_NAME                 Override fixture tier name
  PHASE26_TEST_TIER_PRICE                Override fixture tier price in KRW
  PHASE26_TEST_TIER_COLOR                Override fixture tier color
  PHASE26_TEST_FLOOR_KEY                 Override floor key when seat ID is not floor-aware
  PHASE26_TEST_FLOOR_LABEL               Override floor label
  PHASE26_TEST_SEAT_ROW                  Override seat row
  PHASE26_TEST_SEAT_NUMBER               Override seat number

Cleanup execution requires --execute-cleanup and all PHASE26_CLEANUP_* confirmations/counts.
The evidence file stores only redacted metadata.`;
}

function parseArgs(argv) {
  const parsed = {
    executeCleanup: false,
    recordBlocked: false,
    blockedReason: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute-cleanup') {
      parsed.executeCleanup = true;
    } else if (arg === '--record-blocked') {
      parsed.recordBlocked = true;
    } else if (arg === '--blocked-reason') {
      parsed.blockedReason = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function evidencePath() {
  return process.env.PHASE26_REHEARSAL_EVIDENCE || DEFAULT_EVIDENCE_PATH;
}

function isoNow() {
  return new Date().toISOString();
}

function maskIdentifier(value) {
  const text = String(value ?? '');
  if (!text) return '<missing>';
  if (text.length <= 8) return `${text.slice(0, 2)}<redacted>`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskOrderId(value, prefix) {
  const text = String(value ?? '');
  if (!text) return '<missing>';
  if (prefix && text.startsWith(prefix)) return `${prefix}<redacted-suffix>`;
  return `<order-id:${maskIdentifier(text)}>`;
}

function redactText(value, orderPrefix = process.env.PHASE26_TEST_ORDER_PREFIX) {
  let text = String(value ?? '');
  text = text.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Authorization: Bearer <redacted>');
  text = text.replace(/Cookie:\s*[^\n\r]+/gi, 'Cookie: <redacted>');
  text = text.replace(/(paymentKey["'\s:=]+)[A-Za-z0-9._~+/-]+=*/gi, '$1<redacted>');
  text = text.replace(/(qrToken["'\s:=]+)[A-Za-z0-9._~+/-]+=*/gi, '$1<redacted>');
  text = text.replace(/(token["'\s:=]+)[A-Za-z0-9._~+/-]{20,}=*/gi, '$1<redacted>');
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email:redacted>');
  text = text.replace(/(?:\+[1-9]\d{7,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g, '<phone:redacted>');
  if (orderPrefix) {
    const escaped = escapeRegExp(orderPrefix);
    text = text.replace(new RegExp(`${escaped}[A-Za-z0-9._-]+`, 'g'), `${orderPrefix}<redacted-suffix>`);
  }
  text = text.replace(/\b(?:test|live)_[A-Za-z0-9]{12,}\b/g, '<toss-key:redacted>');
  return text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertNoForbiddenEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  const checks = [
    [/Authorization:\s*Bearer\s+(?!<redacted>)[A-Za-z0-9._~+/-]+=*/i, 'raw Authorization header'],
    [/Cookie:\s*(?!<redacted>)[^\n"}]+/i, 'raw Cookie header'],
    [/paymentKey["'\s:=]+(?!<redacted>)[A-Za-z0-9._~+/-]{8,}/i, 'raw paymentKey'],
    [/qrToken["'\s:=]+(?!<redacted>)[A-Za-z0-9._~+/-]{8,}/i, 'raw QR token'],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'email address'],
    [/(?:\+[1-9]\d{7,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/, 'phone number'],
    [/\b(?:test|live)_[A-Za-z0-9]{12,}\b/, 'raw Toss key'],
  ];

  for (const [pattern, label] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`Evidence redaction failed: ${label}`);
    }
  }
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: redactText(error?.message || String(error)),
  };
}

function check(name, status, details = {}) {
  if (!['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(status)) {
    throw new Error(`Invalid check status: ${status}`);
  }
  return {
    name,
    status,
    ...details,
  };
}

async function writeEvidence(evidence) {
  if (!FINAL_STATUSES.has(evidence.status)) {
    throw new Error(`Invalid evidence status: ${evidence.status}`);
  }

  assertNoForbiddenEvidence(evidence);
  const target = resolve(evidencePath());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function baseEvidence(commandShape) {
  return {
    schemaVersion: 'phase26.rehearsal.v1',
    generatedAt: isoNow(),
    plan: '26-05',
    status: 'BLOCKED',
    commandShape,
    redaction: {
      mode: 'metadata-only',
      notes: [
        'Auth headers, cookies, raw Toss keys, payment keys, QR tokens, order suffixes, phone numbers, and email addresses are never written.',
        'Performance title/description values are validated in memory only and are not stored in evidence.',
      ],
    },
    environment: {},
    checks: [],
    cleanup: {
      dryRun: {
        status: 'NOT_RUN',
      },
      execution: {
        status: 'NOT_RUN',
      },
    },
  };
}

function commandShape(args) {
  return {
    script: 'scripts/phase26/rehearsal-smoke.mjs',
    flags: {
      executeCleanup: Boolean(args.executeCleanup),
      recordBlocked: Boolean(args.recordBlocked),
    },
  };
}

function missingRequiredEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function databaseUrl() {
  return process.env.PHASE26_DATABASE_URL || process.env.DATABASE_URL || '';
}

async function recordBlockedEvidence(args) {
  const evidence = baseEvidence(commandShape(args));
  const missing = missingRequiredEnv();
  const reason =
    args.blockedReason
    || 'Dedicated test-event approval, credentials, or fixture environment was not provided.';

  evidence.status = 'BLOCKED';
  evidence.blockedReason = redactText(reason);
  evidence.environment = {
    apiOrigin: process.env.GRABIT_API_URL ? normalizeApiOrigin(process.env.GRABIT_API_URL) : '<missing>',
    authHeaderFileProvided: Boolean(process.env.GRABIT_SMOKE_AUTH_HEADER_FILE),
    databaseUrlProvided: Boolean(databaseUrl()),
    performanceId: process.env.PHASE26_TEST_PERFORMANCE_ID
      ? maskIdentifier(process.env.PHASE26_TEST_PERFORMANCE_ID)
      : '<missing>',
    showtimeId: process.env.PHASE26_TEST_SHOWTIME_ID
      ? maskIdentifier(process.env.PHASE26_TEST_SHOWTIME_ID)
      : '<missing>',
    seatId: process.env.PHASE26_TEST_SEAT_ID
      ? maskIdentifier(process.env.PHASE26_TEST_SEAT_ID)
      : '<missing>',
    orderPrefix: process.env.PHASE26_TEST_ORDER_PREFIX || '<missing>',
    testMarkerProvided: Boolean(process.env.PHASE26_TEST_MARKER),
    mutationApproval:
      process.env.PHASE26_REHEARSAL_ALLOW_MUTATION === REQUIRED_MUTATION_APPROVAL
        ? 'provided'
        : 'missing-or-invalid',
  };
  evidence.checks.push(check('dedicated-test-event-fixtures', 'BLOCKED', {
    missingEnv: missing,
  }));
  evidence.checks.push(check('live-ticketing-rehearsal', 'NOT_RUN', {
    reason: 'No network request was made in --record-blocked mode.',
  }));
  evidence.checks.push(check('cleanup-execution', 'NOT_RUN', {
    reason: 'Cleanup mutation requires dry-run review and explicit owner approval.',
  }));

  await writeEvidence(evidence);
  return evidence;
}

function normalizeApiOrigin(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('GRABIT_API_URL must be an http or https URL');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('GRABIT_API_URL must be an origin without path, query, or hash');
  }
  return parsed.origin;
}

function validateUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID`);
  }
}

function loadConfig() {
  const missing = missingRequiredEnv();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.PHASE26_REHEARSAL_ALLOW_MUTATION !== REQUIRED_MUTATION_APPROVAL) {
    throw new Error(`PHASE26_REHEARSAL_ALLOW_MUTATION must equal ${REQUIRED_MUTATION_APPROVAL}`);
  }

  const apiOrigin = normalizeApiOrigin(process.env.GRABIT_API_URL);
  const performanceId = process.env.PHASE26_TEST_PERFORMANCE_ID;
  const showtimeId = process.env.PHASE26_TEST_SHOWTIME_ID;
  const seatId = process.env.PHASE26_TEST_SEAT_ID;
  const orderPrefix = process.env.PHASE26_TEST_ORDER_PREFIX;
  const testMarker = process.env.PHASE26_TEST_MARKER;

  validateUuid(performanceId, 'PHASE26_TEST_PERFORMANCE_ID');
  validateUuid(showtimeId, 'PHASE26_TEST_SHOWTIME_ID');

  if (!/^PHASE26[_-]/.test(orderPrefix)) {
    throw new Error('PHASE26_TEST_ORDER_PREFIX must start with PHASE26_ or PHASE26-');
  }

  if (testMarker.length < 8 || !/PHASE26|TEST/i.test(testMarker)) {
    throw new Error('PHASE26_TEST_MARKER must be explicit and include PHASE26 or TEST');
  }

  if (!databaseUrl()) {
    throw new Error('PHASE26_DATABASE_URL or DATABASE_URL is required before rehearsal mutations');
  }

  return {
    apiOrigin,
    performanceId,
    showtimeId,
    seatId,
    orderPrefix,
    testMarker,
    authHeaderFile: process.env.GRABIT_SMOKE_AUTH_HEADER_FILE,
    paymentKey: process.env.PHASE26_TEST_PAYMENT_KEY || '',
    amountOverride: optionalInt(process.env.PHASE26_TEST_AMOUNT, 'PHASE26_TEST_AMOUNT'),
    tierNameOverride: process.env.PHASE26_TEST_TIER_NAME || '',
    tierPriceOverride: optionalInt(process.env.PHASE26_TEST_TIER_PRICE, 'PHASE26_TEST_TIER_PRICE'),
    tierColorOverride: process.env.PHASE26_TEST_TIER_COLOR || '',
    floorKeyOverride: process.env.PHASE26_TEST_FLOOR_KEY || '',
    floorLabelOverride: process.env.PHASE26_TEST_FLOOR_LABEL || '',
    rowOverride: process.env.PHASE26_TEST_SEAT_ROW || '',
    numberOverride: process.env.PHASE26_TEST_SEAT_NUMBER || '',
    databaseUrl: databaseUrl(),
    dryRunSql: process.env.PHASE26_CLEANUP_DRY_RUN_SQL || DEFAULT_DRY_RUN_SQL,
    cleanupSql: process.env.PHASE26_CLEANUP_SQL || DEFAULT_CLEANUP_SQL,
  };
}

function optionalInt(value, label) {
  if (value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function loadAuthHeaders(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'authorization' && /^Bearer\s+\S+/i.test(value)) {
      headers.Authorization = value;
    } else if (name === 'cookie' && value) {
      headers.Cookie = value;
    }
  }

  if (!headers.Authorization && !headers.Cookie) {
    throw new Error('GRABIT_SMOKE_AUTH_HEADER_FILE must contain Authorization: Bearer ... or Cookie: ...');
  }

  return headers;
}

function apiUrl(config, path) {
  return new URL(`/api/v1${path}`, config.apiOrigin).toString();
}

async function requestJson(context, name, method, path, body = undefined) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'phase26-rehearsal-smoke/1.0',
    ...context.authHeaders,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (context.cookieJar) headers.Cookie = mergeCookieHeaders(headers.Cookie, context.cookieJar);

  try {
    const response = await fetch(apiUrl(context.config, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    context.captureSetCookie(response);
    const text = await response.text();
    const json = text ? parseJson(text, name) : null;

    return {
      name,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      json,
      safeMessage: response.ok ? undefined : summarizeErrorBody(json, text),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} returned non-JSON response: ${redactText(text.slice(0, 180))}`);
  }
}

function summarizeErrorBody(json, text) {
  const message = json?.message || json?.error || text.slice(0, 180);
  return redactText(Array.isArray(message) ? message.join('; ') : String(message));
}

function mergeCookieHeaders(existing, jar) {
  const parts = [];
  if (existing) parts.push(existing);
  if (jar) parts.push(jar);
  return parts.join('; ');
}

class RehearsalContext {
  constructor(config, authHeaders) {
    this.config = config;
    this.authHeaders = authHeaders;
    this.cookieJar = '';
  }

  captureSetCookie(response) {
    const setCookieValues =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : splitSetCookie(response.headers.get('set-cookie'));

    if (!setCookieValues.length) return;

    const cookiePairs = setCookieValues
      .map((value) => value.split(';')[0]?.trim())
      .filter(Boolean);
    if (!cookiePairs.length) return;

    const jar = new Map();
    for (const cookieHeader of [this.cookieJar, ...cookiePairs]) {
      for (const pair of String(cookieHeader || '').split(';')) {
        const [name, ...rest] = pair.trim().split('=');
        if (!name || rest.length === 0) continue;
        jar.set(name, rest.join('='));
      }
    }
    this.cookieJar = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function unwrapData(json) {
  if (json && typeof json === 'object' && 'data' in json && json.data && typeof json.data === 'object') {
    return json.data;
  }
  return json;
}

function addHttpCheck(evidence, result, requireOk = true) {
  const status = result.ok ? 'PASS' : 'FAIL';
  evidence.checks.push(check(result.name, status, {
    httpStatus: result.status,
    ...(result.safeMessage ? { message: result.safeMessage } : {}),
  }));
  if (requireOk && !result.ok) {
    throw new Error(`${result.name} failed with HTTP ${result.status}: ${result.safeMessage || result.statusText}`);
  }
}

function assertFixtureSafe(performance, config) {
  const title = String(performance?.title || performance?.name || '');
  const description = String(performance?.description || '');
  const salesInfo = String(performance?.salesInfo || performance?.sales_info || '');
  const searchable = `${title}\n${description}\n${salesInfo}`;

  if (/Girl Rules|GIRL RULES|걸룰|걸룰스/i.test(searchable)) {
    throw new Error('Dedicated test-event fixture check failed: real Girl Rules content is in scope');
  }

  if (!searchable.includes(config.testMarker)) {
    throw new Error('Dedicated test-event fixture check failed: PHASE26_TEST_MARKER was not found on the performance metadata');
  }

  const showtimes = [
    ...(Array.isArray(performance?.showtimes) ? performance.showtimes : []),
    ...(Array.isArray(performance?.schedules) ? performance.schedules : []),
  ];
  const hasShowtime =
    showtimes.length === 0
      ? true
      : showtimes.some((showtime) => String(showtime?.id || showtime?.showtimeId) === config.showtimeId);
  if (!hasShowtime) {
    throw new Error('Dedicated test-event fixture check failed: showtime is not attached to performance');
  }
}

function resolveSeatFixture(performance, config) {
  const requested = config.seatId;
  const floorAware = requested.includes(':');
  const [requestedFloor, requestedSeat] = floorAware
    ? requested.split(/:(.+)/).filter(Boolean)
    : [config.floorKeyOverride || '1F', requested];
  const floorKey = config.floorKeyOverride || requestedFloor || '1F';
  const floorLabel = config.floorLabelOverride || floorKey;
  const seatKey = floorAware ? requested : `${floorKey}:${requestedSeat}`;
  const rowAndNumber = deriveRowAndNumber(requestedSeat);

  const tiers = collectSeatTiers(performance);
  const tier = tiers.find((candidate) => {
    const seatIds = Array.isArray(candidate.seatIds) ? candidate.seatIds : [];
    return seatIds.includes(requested) || seatIds.includes(requestedSeat) || seatIds.includes(seatKey);
  });

  const tierName = config.tierNameOverride || tier?.name || 'PHASE26_TEST';
  const price = config.amountOverride ?? config.tierPriceOverride ?? toInt(tier?.price, 1000);

  if (!Number.isInteger(price) || price <= 0) {
    throw new Error('Resolved test seat price must be a positive integer');
  }

  return {
    seatId: requestedSeat,
    tierName,
    tierColor: config.tierColorOverride || tier?.color || '#2563eb',
    price,
    row: config.rowOverride || rowAndNumber.row,
    number: config.numberOverride || rowAndNumber.number,
    floorKey,
    floorLabel,
    seatKey,
  };
}

function collectSeatTiers(performance) {
  const tiers = [];
  const candidates = [
    performance?.seatMap,
    ...(Array.isArray(performance?.seatMaps) ? performance.seatMaps : []),
    ...(Array.isArray(performance?.seat_maps) ? performance.seat_maps : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (Array.isArray(candidate?.tiers)) tiers.push(...candidate.tiers);
    if (Array.isArray(candidate?.config?.tiers)) tiers.push(...candidate.config.tiers);
    const floors = candidate?.config?.floors || candidate?.floors || {};
    for (const floor of Object.values(floors)) {
      if (Array.isArray(floor?.tiers)) tiers.push(...floor.tiers);
    }
  }

  return tiers;
}

function deriveRowAndNumber(seatId) {
  const match = String(seatId).match(/^([A-Za-z0-9]+)[-_ ]?([0-9]+)$/);
  if (match) return { row: match[1], number: match[2] };
  return { row: 'A', number: String(seatId) };
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function makeConsentItems() {
  return ['terms', 'privacy', 'pipa_required'].map((key) => ({
    key,
    version: 'phase26-rehearsal',
    language: 'ko',
    accepted: true,
    sourceFlow: 'booking',
  }));
}

function bookingPolicy() {
  return {
    maxTicketsPerOrder: 1,
    cancellationChangePolicy: 'CANCEL_ONLY',
    sameGradeChangeEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
  };
}

function paymentMethod() {
  return {
    method: 'CARD',
    provider: 'CARD',
    currency: 'KRW',
  };
}

function makeOrderId(config) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
  return `${config.orderPrefix}${Date.now().toString(36)}-${suffix}`;
}

function extractReservationId(value) {
  const json = unwrapData(value);
  return json?.reservationId || json?.reservation?.id || json?.id || null;
}

function extractQueueSessionId(value) {
  const json = unwrapData(value);
  return json?.queueSessionId || json?.session?.id || json?.id || null;
}

function summarizeBranchResponse(json) {
  const body = unwrapData(json) || {};
  return {
    branchType: String(body.branchType || body.type || body.flow || '<unknown>'),
    pendingUrlRequired: Boolean(body.pendingUrlRequired),
    hasSuccessUrl: Boolean(body.successUrl),
    hasFailUrl: Boolean(body.failUrl),
    hasPendingUrl: Boolean(body.pendingUrl),
  };
}

async function runSqlFile(config, scriptPath, variables) {
  const args = [];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-v', `${key}=${value}`);
  }
  args.push('-f', scriptPath);

  const result = spawnSync('psql', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PGDATABASE: config.databaseUrl,
    },
    encoding: 'utf8',
    timeout: SQL_TIMEOUT_MS,
  });

  const stdout = redactText(result.stdout || '', config.orderPrefix);
  const stderr = redactText(result.stderr || result.error?.message || '', config.orderPrefix);

  return {
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-12),
    stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-12),
  };
}

function cleanupVariables(config) {
  return {
    performanceId: config.performanceId,
    showtimeId: config.showtimeId,
    orderPrefix: config.orderPrefix,
    testMarker: config.testMarker,
  };
}

function cleanupExecutionVariables(config) {
  const missing = Object.values(CLEANUP_CONFIRMATION_ENV).filter((envKey) => !process.env[envKey]);
  if (missing.length > 0) {
    throw new Error(`Missing cleanup execution environment variables: ${missing.join(', ')}`);
  }

  return {
    ...cleanupVariables(config),
    backupConfirmation: process.env.PHASE26_CLEANUP_BACKUP_CONFIRMATION,
    dryRunReviewed: process.env.PHASE26_CLEANUP_DRY_RUN_REVIEWED,
    ownerApproval: process.env.PHASE26_CLEANUP_OWNER_APPROVAL,
    expectedReservations: process.env.PHASE26_CLEANUP_EXPECTED_RESERVATIONS,
    expectedPayments: process.env.PHASE26_CLEANUP_EXPECTED_PAYMENTS,
    expectedTickets: process.env.PHASE26_CLEANUP_EXPECTED_TICKETS,
    expectedRefunds: process.env.PHASE26_CLEANUP_EXPECTED_REFUNDS,
    expectedWebhookEvents: process.env.PHASE26_CLEANUP_EXPECTED_WEBHOOK_EVENTS,
    expectedSeatInventories: process.env.PHASE26_CLEANUP_EXPECTED_SEAT_INVENTORIES,
  };
}

async function runRehearsal(args) {
  const config = loadConfig();
  const authHeaders = await loadAuthHeaders(config.authHeaderFile);
  const context = new RehearsalContext(config, authHeaders);
  const evidence = baseEvidence(commandShape(args));
  const orderId = makeOrderId(config);

  evidence.environment = {
    apiOrigin: config.apiOrigin,
    authHeaderType: authHeaders.Authorization ? 'Authorization' : 'Cookie',
    databaseUrlProvided: true,
    performanceId: maskIdentifier(config.performanceId),
    showtimeId: maskIdentifier(config.showtimeId),
    seatId: maskIdentifier(config.seatId),
    orderId: maskOrderId(orderId, config.orderPrefix),
    orderPrefix: config.orderPrefix,
    testMarker: '<provided>',
    mutationApproval: 'provided',
  };

  try {
    const performanceResult = await requestJson(
      context,
      'fixture-performance-read',
      'GET',
      `/performances/${encodeURIComponent(config.performanceId)}`,
    );
    addHttpCheck(evidence, performanceResult);
    const performance = unwrapData(performanceResult.json);
    assertFixtureSafe(performance, config);
    evidence.checks.push(check('dedicated-test-event-guard', 'PASS', {
      titleStored: false,
      markerStored: false,
      realGirlRulesDenied: true,
    }));

    const seat = resolveSeatFixture(performance, config);
    evidence.fixture = {
      seat: {
        seatId: maskIdentifier(seat.seatId),
        seatKey: maskIdentifier(seat.seatKey),
        tierName: seat.tierName,
        price: seat.price,
      },
    };

    const queueResult = await requestJson(
      context,
      'queue-enter',
      'POST',
      `/queue/performances/${encodeURIComponent(config.performanceId)}/enter`,
      { showtimeId: config.showtimeId },
    );
    addHttpCheck(evidence, queueResult);
    const queueSessionId = extractQueueSessionId(queueResult.json);
    evidence.queue = {
      queueSessionId: queueSessionId ? maskIdentifier(queueSessionId) : '<not-returned>',
      admissionCookieCaptured: Boolean(context.cookieJar),
    };

    const lockResult = await requestJson(
      context,
      'seat-lock',
      'POST',
      '/booking/seats/lock',
      {
        showtimeId: config.showtimeId,
        seatId: seat.seatKey,
      },
    );
    addHttpCheck(evidence, lockResult);

    const prepareResult = await requestJson(
      context,
      'reservation-prepare',
      'POST',
      '/reservations/prepare',
      {
        orderId,
        showtimeId: config.showtimeId,
        seats: [seat],
        amount: seat.price,
        consentItems: makeConsentItems(),
        paymentDeadlineAt: new Date(Date.now() + 7 * 60 * 1000).toISOString(),
        bookingPolicy: bookingPolicy(),
        paymentMethod: paymentMethod(),
      },
    );
    addHttpCheck(evidence, prepareResult);
    const preparedReservationId = extractReservationId(prepareResult.json);
    evidence.reservation = {
      preparedReservationId: preparedReservationId ? maskIdentifier(preparedReservationId) : '<not-returned>',
      orderId: maskOrderId(orderId, config.orderPrefix),
    };

    const branchResult = await requestJson(
      context,
      'payment-branch',
      'POST',
      '/payments/branch',
      {
        orderId,
        paymentMethod: paymentMethod(),
        successUrl: `${config.apiOrigin}/phase26/rehearsal/success`,
        failUrl: `${config.apiOrigin}/phase26/rehearsal/fail`,
      },
    );
    addHttpCheck(evidence, branchResult);
    evidence.paymentBranch = summarizeBranchResponse(branchResult.json);

    let confirmedReservationId = null;
    if (config.paymentKey) {
      const confirmResult = await requestJson(
        context,
        'payment-confirm',
        'POST',
        '/payments/confirm',
        {
          paymentKey: config.paymentKey,
          orderId,
          amount: seat.price,
        },
      );
      addHttpCheck(evidence, confirmResult);
      confirmedReservationId = extractReservationId(confirmResult.json) || preparedReservationId;
      evidence.paymentConfirm = {
        status: 'PASS',
        reservationId: confirmedReservationId ? maskIdentifier(confirmedReservationId) : '<not-returned>',
      };
    } else {
      evidence.checks.push(check('payment-confirm', 'NOT_RUN', {
        reason: 'PHASE26_TEST_PAYMENT_KEY was not provided; Toss confirm/refund branch was not executed.',
      }));
      evidence.paymentConfirm = { status: 'NOT_RUN' };
    }

    if (confirmedReservationId) {
      const reservationResult = await requestJson(
        context,
        'reservation-detail-qr-readiness',
        'GET',
        `/reservations/${encodeURIComponent(confirmedReservationId)}`,
      );
      addHttpCheck(evidence, reservationResult);
      const reservationDetail = unwrapData(reservationResult.json) || {};
      evidence.qrReadiness = {
        status: reservationDetail.qrTicket?.status || '<not-returned>',
        tokenStored: false,
      };

      const ticketResult = await requestJson(
        context,
        'ticket-list-qr-readiness',
        'GET',
        `/tickets/reservations/${encodeURIComponent(confirmedReservationId)}`,
      );
      addHttpCheck(evidence, ticketResult);
      const tickets = Array.isArray(unwrapData(ticketResult.json)) ? unwrapData(ticketResult.json) : [];
      evidence.tickets = {
        count: tickets.length,
        statuses: tickets.map((ticket) => String(ticket.status || '<unknown>')).slice(0, 5),
        qrTokensStored: false,
      };

      const cancelResult = await requestJson(
        context,
        'refund-cancel',
        'PUT',
        `/reservations/${encodeURIComponent(confirmedReservationId)}/cancel`,
        { reason: 'phase26 dedicated test-event rehearsal cleanup' },
      );
      addHttpCheck(evidence, cancelResult);
    } else {
      evidence.checks.push(check('reservation-detail-qr-readiness', 'NOT_RUN', {
        reason: 'Requires a confirmed test payment reservation.',
      }));
      evidence.checks.push(check('ticket-list-qr-readiness', 'NOT_RUN', {
        reason: 'Requires a confirmed test payment reservation.',
      }));
      evidence.checks.push(check('refund-cancel', 'NOT_RUN', {
        reason: 'Requires a confirmed test payment reservation.',
      }));
    }

    evidence.cleanup.dryRun = await runSqlFile(config, config.dryRunSql, cleanupVariables(config));
    evidence.checks.push(check('cleanup-dry-run', evidence.cleanup.dryRun.status, {
      exitCode: evidence.cleanup.dryRun.exitCode,
    }));
    if (evidence.cleanup.dryRun.status !== 'PASS') {
      throw new Error('cleanup dry-run failed; cleanup execution is not allowed');
    }

    if (args.executeCleanup) {
      evidence.cleanup.execution = await runSqlFile(
        config,
        config.cleanupSql,
        cleanupExecutionVariables(config),
      );
      evidence.checks.push(check('cleanup-execution', evidence.cleanup.execution.status, {
        exitCode: evidence.cleanup.execution.exitCode,
      }));
      if (evidence.cleanup.execution.status !== 'PASS') {
        throw new Error('cleanup execution failed');
      }
    } else {
      evidence.checks.push(check('cleanup-execution', 'NOT_RUN', {
        reason: '--execute-cleanup was not provided.',
      }));
    }

    evidence.status = evidence.checks.some((entry) => entry.status === 'NOT_RUN')
      ? 'BLOCKED'
      : 'PASS';
    await writeEvidence(evidence);
    return evidence;
  } catch (error) {
    evidence.status = 'FAIL';
    evidence.error = safeError(error);
    await writeEvidence(evidence);
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.recordBlocked) {
    const evidence = await recordBlockedEvidence(args);
    console.log(`BLOCKED phase26 rehearsal smoke. evidence=${evidencePath()}`);
    console.log(redactText(evidence.blockedReason));
    return;
  }

  const evidence = await runRehearsal(args);
  console.log(`${evidence.status} phase26 rehearsal smoke. evidence=${evidencePath()}`);
}

main().catch((error) => {
  console.error(redactText(error?.message || String(error)));
  process.exitCode = 1;
});
