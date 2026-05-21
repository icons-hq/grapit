#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_EVIDENCE =
  '.planning/phases/26-m1-canary-cutover-gates/evidence/26-02-qr-contract.json';
const HTTP_TIMEOUT_MS = 30_000;

const JWT_PATTERN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
const AUTH_PATTERN = /\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi;
const COOKIE_PATTERN = /\bCookie:\s*[^\n\r]+/gi;
const PAYMENT_KEY_PATTERN = /\bpaymentKey\s*[:=]\s*["']?[^\s"',}]+/gi;
const QR_TOKEN_PATTERN = /\bqr(?:Token|_token)?\s*[:=]\s*["']?[^\s"',}]+/gi;

function usage() {
  return `
Usage:
  node scripts/phase26/field-scan-contract-smoke.mjs --help
  GRABIT_API_URL=https://api.heygrabit.com \\
  GRABIT_SMOKE_AUTH_HEADER_FILE=/path/to/auth-header.txt \\
  PHASE26_TEST_RESERVATION_ID=<reservation-id> \\
  PHASE26_TEST_PAYMENT_ID=<payment-id> \\
  node scripts/phase26/field-scan-contract-smoke.mjs

Required environment:
  GRABIT_API_URL                         API origin, for example https://api.heygrabit.com
  GRABIT_SMOKE_AUTH_HEADER_FILE          Local uncommitted file with exactly one Authorization or Cookie header line
  PHASE26_TEST_RESERVATION_ID            Operator-approved confirmed test reservation ID
  PHASE26_TEST_PAYMENT_ID                Operator-approved linked DONE payment ID

Optional environment:
  PHASE26_QR_CONTRACT_EVIDENCE           Evidence JSON path. Default: ${DEFAULT_EVIDENCE}

Security:
  The script validates required envs before network calls.
  Evidence records command shape, status, token version, ticket status, linkage checks, and masked identifiers only.
  It never prints or persists raw QR token/JWT/HMAC, cookies, Authorization headers, paymentKey, or full JTI.
`;
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  if (argv.length > 0) {
    throw new Error(`Unsupported arguments: ${argv.join(' ')}`);
  }

  return { help: false };
}

function redact(value) {
  return String(value)
    .replace(AUTH_PATTERN, 'Authorization: Bearer <redacted>')
    .replace(COOKIE_PATTERN, 'Cookie: <redacted>')
    .replace(JWT_PATTERN, '<jwt:redacted>')
    .replace(PAYMENT_KEY_PATTERN, 'paymentKey=<redacted>')
    .replace(QR_TOKEN_PATTERN, 'qrToken=<redacted>');
}

function getEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function parseApiUrl(rawValue) {
  const apiUrl = new URL(rawValue);
  if (!['http:', 'https:'].includes(apiUrl.protocol)) {
    throw new Error('GRABIT_API_URL must be http or https');
  }
  if (apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
    throw new Error('GRABIT_API_URL must be an origin without path, query, or hash');
  }
  return apiUrl;
}

function parseAuthHeader(line) {
  const authorizationMatch = line.match(/^Authorization:\s*Bearer\s+(.+)$/i);
  if (authorizationMatch) {
    return {
      name: 'Authorization',
      headers: { Authorization: `Bearer ${authorizationMatch[1].trim()}` },
    };
  }

  const cookieMatch = line.match(/^Cookie:\s*(.+)$/i);
  if (cookieMatch) {
    return {
      name: 'Cookie',
      headers: { Cookie: cookieMatch[1].trim() },
    };
  }

  throw new Error('Auth header must be either Authorization: Bearer ... or Cookie: ...');
}

async function loadConfig() {
  const apiUrl = parseApiUrl(getEnv('GRABIT_API_URL'));
  const authHeaderPath = getEnv('GRABIT_SMOKE_AUTH_HEADER_FILE');
  const authHeaderContent = await readFile(authHeaderPath, 'utf8');
  const headerLines = authHeaderContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (headerLines.length !== 1) {
    throw new Error('GRABIT_SMOKE_AUTH_HEADER_FILE must contain exactly one non-empty header line');
  }

  const authHeader = parseAuthHeader(headerLines[0]);
  const reservationId = getEnv('PHASE26_TEST_RESERVATION_ID');
  const paymentId = getEnv('PHASE26_TEST_PAYMENT_ID');
  const evidencePath = optionalEnv('PHASE26_QR_CONTRACT_EVIDENCE', DEFAULT_EVIDENCE);

  return {
    apiUrl,
    authHeaderName: authHeader.name,
    authHeaders: authHeader.headers,
    reservationId,
    paymentId,
    evidencePath,
  };
}

function commandShape() {
  return 'node scripts/phase26/field-scan-contract-smoke.mjs';
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

async function requestJson(config, path) {
  const url = new URL(path, config.apiUrl);
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      ...config.authHeaders,
    },
  });
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text: redact(text).slice(0, 500) };
    }
  }

  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed with ${response.status}: ${redact(JSON.stringify(body))}`);
  }

  return {
    status: response.status,
    body,
  };
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    throw new Error('QR token must be a JWT with three parts');
  }

  const payload = JSON.parse(decodeBase64Url(parts[1]));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('QR token payload must be an object');
  }

  return payload;
}

function maskIdentifier(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.length <= 10) {
    return `${text.slice(0, 2)}...${text.slice(-2)}`;
  }
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertNoSecrets(serializedEvidence) {
  const hits = [];
  if (JWT_PATTERN.test(serializedEvidence)) hits.push('JWT');
  if (AUTH_PATTERN.test(serializedEvidence)) hits.push('Authorization');
  if (COOKIE_PATTERN.test(serializedEvidence)) hits.push('Cookie');
  if (PAYMENT_KEY_PATTERN.test(serializedEvidence)) hits.push('paymentKey');
  if (QR_TOKEN_PATTERN.test(serializedEvidence)) hits.push('QR token');
  JWT_PATTERN.lastIndex = 0;
  AUTH_PATTERN.lastIndex = 0;
  COOKIE_PATTERN.lastIndex = 0;
  PAYMENT_KEY_PATTERN.lastIndex = 0;
  QR_TOKEN_PATTERN.lastIndex = 0;

  if (hits.length > 0) {
    throw new Error(`Evidence contains forbidden sensitive values: ${hits.join(', ')}`);
  }
}

function baseEvidence(config, status) {
  return {
    schemaVersion: 'phase26.qr-contract.v1',
    status,
    generatedAt: new Date().toISOString(),
    commandShape: commandShape(),
    environment: {
      apiOrigin: config.apiUrl.origin,
      authHeaderType: config.authHeaderName,
      reservationId: maskIdentifier(config.reservationId),
      paymentId: maskIdentifier(config.paymentId),
    },
    checks: [],
    redactionNotes:
      'Raw QR token/JWT/HMAC, cookies, Authorization headers, paymentKey, and full JTI are never written.',
  };
}

async function writeEvidence(evidencePath, evidence) {
  const absolutePath = resolve(evidencePath);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoSecrets(serialized);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, serialized, 'utf8');
}

function verifyQrContract(config, reservationDetail, ticket) {
  const detailQr = reservationDetail.qrTicket;
  if (!detailQr || typeof detailQr !== 'object') {
    throw new Error('Reservation detail must include qrTicket');
  }
  if (detailQr.status !== 'ACTIVE' || ticket.status !== 'ACTIVE') {
    throw new Error(`QR status must be ACTIVE, got detail=${detailQr.status}, ticket=${ticket.status}`);
  }

  const token = requireString(ticket.token, 'ticket.token');
  const payload = decodeJwtPayload(token);
  const payloadJti = requireString(payload.jti, 'token.payload.jti');
  const detailJti = requireString(detailQr.jti, 'reservation.qrTicket.jti');
  const ticketJti = requireString(ticket.jti, 'ticket.jti');
  const tokenVersion = requireString(payload.secretVersion, 'token.payload.secretVersion');
  const showtimeId = requireString(payload.showtimeId, 'token.payload.showtimeId');

  if (payload.type !== 'qr-ticket') {
    throw new Error(`Unexpected QR token type: ${payload.type}`);
  }
  if (payload.reservationId !== config.reservationId) {
    throw new Error('QR token reservationId does not match PHASE26_TEST_RESERVATION_ID');
  }
  if (payload.paymentId !== config.paymentId) {
    throw new Error('QR token paymentId does not match PHASE26_TEST_PAYMENT_ID');
  }
  if (payloadJti !== detailJti || payloadJti !== ticketJti) {
    throw new Error('QR token JTI does not match reservation detail and ticket endpoint data');
  }

  return {
    tokenVersion,
    ticketStatus: ticket.status,
    reservationStatus: reservationDetail.status,
    linkage: {
      reservationId: 'MATCH',
      paymentId: 'MATCH',
      showtimeId: showtimeId ? 'PRESENT' : 'MISSING',
    },
    context: {
      performanceTitlePresent: typeof reservationDetail.performanceTitle === 'string'
        && reservationDetail.performanceTitle.length > 0,
      showDateTimePresent: typeof reservationDetail.showDateTime === 'string'
        && reservationDetail.showDateTime.length > 0,
      venuePresent: typeof reservationDetail.venue === 'string'
        && reservationDetail.venue.length > 0,
    },
    maskedJti: maskIdentifier(payloadJti),
  };
}

async function runSmoke(config) {
  const reservationResponse = await requestJson(
    config,
    `/api/v1/reservations/${encodeURIComponent(config.reservationId)}`,
  );
  const ticketResponse = await requestJson(
    config,
    `/api/v1/tickets/reservations/${encodeURIComponent(config.reservationId)}`,
  );
  const contract = verifyQrContract(config, reservationResponse.body, ticketResponse.body);
  const evidence = baseEvidence(config, 'PASS');

  evidence.checks.push(
    {
      name: 'reservation-detail-qr-readiness',
      ok: true,
      httpStatus: reservationResponse.status,
      reservationStatus: reservationResponse.body.status,
      qrStatus: reservationResponse.body.qrTicket?.status ?? 'missing',
    },
    {
      name: 'ticket-endpoint-scanner-contract',
      ok: true,
      httpStatus: ticketResponse.status,
      ...contract,
    },
  );

  return evidence;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage().trim());
    return;
  }

  const config = await loadConfig();
  try {
    const evidence = await runSmoke(config);
    await writeEvidence(config.evidencePath, evidence);
    console.log(`PASS field-scan contract smoke. evidence=${config.evidencePath}`);
  } catch (error) {
    const evidence = {
      ...baseEvidence(config, 'FAIL'),
      failureReason: redact(error instanceof Error ? error.message : String(error)),
    };
    await writeEvidence(config.evidencePath, evidence);
    throw error;
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
