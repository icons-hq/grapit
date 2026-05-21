#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_LEDGER = '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json';

const ALLOWED_STATES = new Set([
  'PASS',
  'FAIL',
  'ACCEPTED_RISK',
  'CONFIG_READY_NOT_DRILLED',
  'BLOCKED',
]);

const REQUIRED_GATE_IDS = [
  'M1_DIRECT_DEPLOY_WATCH',
  'M1_LOCALE_SCOPE',
  'ADMIN_CUTOVER_UI',
  'QR_VISIBILITY',
  'TOSS_TEST_REHEARSAL',
  'TOSS_TEST_SECRET_ROTATION',
  'TOSS_LIVE_KEY_SMOKE',
  'BOOKING_ENABLED_GO_NO_GO',
  'LOAD_10K_BASELINE',
  'LOAD_20K_STRESS',
  'DR_CLOUD_RUN_ROLLBACK',
  'DR_CLOUD_SQL_PITR',
  'DR_VALKEY_RECONNECT',
  'INFRA_POOL_PGBOUNCER',
  'INFRA_HA_REPLICA',
  'WAF_ACTIVE_RULES',
  'ONCALL_PLAYBOOKS',
  'FIRST_24H_WATCH',
  'CLEANUP_ISOLATION',
];

const REQUIRED_FIELDS = [
  'gateId',
  'requirementIds',
  'state',
  'environment',
  'evidenceRefs',
  'failureReason',
  'approvalState',
  'approver',
  'approvalTimestamp',
  'compensatingMonitoring',
  'rollbackOrCloseTrigger',
  'sourceDecisions',
  'redactionNotes',
];

const SECRET_PATTERNS = [
  { name: 'Toss secret key', pattern: /\btest_sk_[A-Za-z0-9_-]{10,}|\blive_sk_[A-Za-z0-9_-]{10,}/i },
  { name: 'Toss client key', pattern: /\btest_ck_[A-Za-z0-9_-]{10,}|\blive_ck_[A-Za-z0-9_-]{10,}/i },
  { name: 'standalone Toss payment key', pattern: /\b(?:pay|tgen)_[A-Za-z0-9_-]{8,}\b/i },
  { name: 'paymentKey value', pattern: /\bpaymentKey\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/i },
  { name: 'QR token', pattern: /\bqr(?:Token|_token)?\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/i },
  { name: 'Authorization bearer', pattern: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { name: 'Cookie header', pattern: /\bCookie:\s*[^\n\r]{12,}/i },
  { name: 'JWT', pattern: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OTP', pattern: /\botp\s*[:=]\s*["']?\d{4,8}\b/i },
  { name: 'Korean phone number', pattern: /(?:\+[1-9]\d{5,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/ },
  { name: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
];

function usage() {
  return `
Usage:
  node scripts/phase26/validate-gate-ledger.mjs --help
  node scripts/phase26/validate-gate-ledger.mjs --ledger ${DEFAULT_LEDGER} --strict
  node scripts/phase26/validate-gate-ledger.mjs --ledger ${DEFAULT_LEDGER} --booking-enabled-check

Options:
  --ledger <path>                 Gate Ledger JSON path. Default: ${DEFAULT_LEDGER}
  --strict                        Validate schema, required rows, allowed states, approval shape, and redaction.
  --booking-enabled-check         Final readiness mode. Fails on missing evidence, FAIL, BLOCKED, or unapproved non-PASS rows.
  --evidence-root <path>          Reserved for downstream evidence checks. Parsed for command compatibility.

Security:
  The validator rejects raw Toss keys, payment keys, QR tokens, cookies, bearer tokens, OTPs, phone numbers, and email addresses in ledger artifacts.
`;
}

function parseArgs(argv) {
  const args = {
    ledger: DEFAULT_LEDGER,
    strict: false,
    bookingEnabledCheck: false,
    evidenceRoot: '.planning/phases/26-m1-canary-cutover-gates/evidence',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--ledger') {
      index += 1;
      if (!argv[index]) throw new Error('Missing value for --ledger');
      args.ledger = argv[index];
    } else if (token === '--strict') {
      args.strict = true;
    } else if (token === '--booking-enabled-check') {
      args.bookingEnabledCheck = true;
    } else if (token === '--evidence-root') {
      index += 1;
      if (!argv[index]) throw new Error('Missing value for --evidence-root');
      args.evidenceRoot = argv[index];
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  if (!args.help && !args.strict && !args.bookingEnabledCheck) {
    throw new Error('Choose --strict or --booking-enabled-check. Use --help for examples.');
  }

  return args;
}

function redact(value) {
  return String(value)
    .replace(/\btest_sk_[A-Za-z0-9_-]+|\blive_sk_[A-Za-z0-9_-]+/gi, '<toss-secret:redacted>')
    .replace(/\btest_ck_[A-Za-z0-9_-]+|\blive_ck_[A-Za-z0-9_-]+/gi, '<toss-client:redacted>')
    .replace(/\b(?:pay|tgen)_[A-Za-z0-9_-]{8,}\b/gi, '<toss-payment-key:redacted>')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/\bpaymentKey\s*[:=]\s*["']?[^\s"',}]+/gi, 'paymentKey=<redacted>')
    .replace(/\bqr(?:Token|_token)?\s*[:=]\s*["']?[^\s"',}]+/gi, 'qrToken=<redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(/(?:\+[1-9]\d{5,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g, '<phone:redacted>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email:redacted>');
}

function fail(message, details = []) {
  const error = new Error(message);
  error.details = details.map(redact);
  throw error;
}

function ensureArray(value, field, gateId) {
  if (!Array.isArray(value)) {
    fail(`Invalid ${field}`, [`${gateId}: ${field} must be an array`]);
  }
}

function isApprovedNonPass(gate) {
  return gate.approvalState === 'approved'
    && typeof gate.approver === 'string'
    && gate.approver.trim().length > 0
    && typeof gate.approvalTimestamp === 'string'
    && gate.approvalTimestamp.trim().length > 0
    && typeof gate.failureReason === 'string'
    && gate.failureReason.trim().length > 0
    && typeof gate.compensatingMonitoring === 'string'
    && gate.compensatingMonitoring.trim().length > 0
    && typeof gate.rollbackOrCloseTrigger === 'string'
    && gate.rollbackOrCloseTrigger.trim().length > 0;
}

function validateTextRedaction(rawText) {
  const hits = SECRET_PATTERNS
    .filter(({ pattern }) => pattern.test(rawText))
    .map(({ name }) => name);

  const forbiddenTrafficPass = /traffic-split\s+canary[^.\n]*(PASS|pass)\s+evidence/i.test(rawText)
    && !/traffic-split\s+canary\s+is\s+not\s+used\s+as[^.\n]*PASS\s+evidence/i.test(rawText);

  if (forbiddenTrafficPass) {
    hits.push('traffic-split canary PASS language');
  }

  if (hits.length > 0) {
    fail('Ledger contains raw secret, PII, or forbidden PASS language', hits);
  }
}

function validateGateShape(gate) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    fail('Invalid gate row', ['gate row must be an object']);
  }

  const gateId = typeof gate.gateId === 'string' ? gate.gateId : '<missing-gate-id>';

  for (const field of REQUIRED_FIELDS) {
    if (!(field in gate)) {
      fail('Missing required gate field', [`${gateId}: missing ${field}`]);
    }
  }

  if (!REQUIRED_GATE_IDS.includes(gate.gateId)) {
    fail('Unexpected gate id', [gateId]);
  }

  if (!ALLOWED_STATES.has(gate.state)) {
    fail('Invalid gate state', [`${gateId}: ${gate.state}`]);
  }

  ensureArray(gate.requirementIds, 'requirementIds', gateId);
  ensureArray(gate.evidenceRefs, 'evidenceRefs', gateId);
  ensureArray(gate.sourceDecisions, 'sourceDecisions', gateId);

  if (typeof gate.environment !== 'string' || !gate.environment.trim()) {
    fail('Invalid environment', [`${gateId}: environment is required`]);
  }

  if (typeof gate.failureReason !== 'string') {
    fail('Invalid failureReason', [`${gateId}: failureReason must be a string`]);
  }

  if (typeof gate.approvalState !== 'string' || !gate.approvalState.trim()) {
    fail('Invalid approvalState', [`${gateId}: approvalState is required`]);
  }

  const approverEmpty = gate.approver === null || gate.approver === '';
  const timestampEmpty = gate.approvalTimestamp === null || gate.approvalTimestamp === '';
  if (gate.approvalState === 'approved' && (approverEmpty || timestampEmpty)) {
    fail('Malformed approved gate', [`${gateId}: approved rows require approver and approvalTimestamp`]);
  }

  if (gate.approvalState !== 'approved' && (!approverEmpty || !timestampEmpty)) {
    fail('Malformed unapproved gate', [`${gateId}: unapproved rows must not carry approver metadata`]);
  }

  if (typeof gate.compensatingMonitoring !== 'string' || !gate.compensatingMonitoring.trim()) {
    fail('Invalid compensatingMonitoring', [`${gateId}: compensatingMonitoring is required`]);
  }

  if (typeof gate.rollbackOrCloseTrigger !== 'string' || !gate.rollbackOrCloseTrigger.trim()) {
    fail('Invalid rollbackOrCloseTrigger', [`${gateId}: rollbackOrCloseTrigger is required`]);
  }

  if (typeof gate.redactionNotes !== 'string' || !gate.redactionNotes.trim()) {
    fail('Invalid redactionNotes', [`${gateId}: redactionNotes is required`]);
  }
}

function validateRequiredRows(ledger) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) {
    fail('Ledger must be a JSON object');
  }

  if (!Array.isArray(ledger.gates)) {
    fail('Ledger gates must be an array');
  }

  const gateIds = ledger.gates.map((gate) => gate.gateId);
  const missing = REQUIRED_GATE_IDS.filter((gateId) => !gateIds.includes(gateId));
  if (missing.length > 0) {
    fail('Missing required gate rows', missing);
  }

  const duplicates = gateIds.filter((gateId, index) => gateIds.indexOf(gateId) !== index);
  if (duplicates.length > 0) {
    fail('Duplicate gate rows', [...new Set(duplicates)]);
  }

  for (const gate of ledger.gates) {
    validateGateShape(gate);
  }
}

function validateBookingEnabledReadiness(ledger) {
  const blockers = [];

  for (const gate of ledger.gates) {
    const gateId = gate.gateId;
    const hasEvidence = gate.evidenceRefs.length > 0;

    if (gate.state === 'PASS') {
      if (!hasEvidence) blockers.push(`${gateId}: PASS requires evidenceRefs`);
      continue;
    }

    if (gate.state === 'FAIL' || gate.state === 'BLOCKED') {
      blockers.push(`${gateId}: ${gate.state} is no-go`);
      continue;
    }

    if (gate.state === 'ACCEPTED_RISK' || gate.state === 'CONFIG_READY_NOT_DRILLED') {
      if (!hasEvidence) blockers.push(`${gateId}: ${gate.state} requires evidenceRefs`);
      if (!isApprovedNonPass(gate)) {
        blockers.push(`${gateId}: ${gate.state} requires owner approval, monitoring, and rollback trigger`);
      }
      continue;
    }

    blockers.push(`${gateId}: unsupported readiness state ${gate.state}`);
  }

  const rotation = ledger.gates.find((gate) => gate.gateId === 'TOSS_TEST_SECRET_ROTATION');
  if (!rotation) {
    blockers.push('TOSS_TEST_SECRET_ROTATION: missing required D-24 gate');
  } else if (rotation.state !== 'PASS' && !isApprovedNonPass(rotation)) {
    blockers.push('TOSS_TEST_SECRET_ROTATION: missing approved rotation evidence');
  }

  if (blockers.length > 0) {
    fail('BOOKING_ENABLED=true readiness check failed', blockers);
  }
}

async function loadLedger(path) {
  const absolutePath = resolve(path);
  const rawText = await readFile(absolutePath, 'utf8');
  validateTextRedaction(rawText);

  try {
    return JSON.parse(rawText);
  } catch (error) {
    fail('Ledger is not valid JSON', [error.message]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage().trim());
    return;
  }

  const ledger = await loadLedger(args.ledger);
  validateRequiredRows(ledger);

  if (args.bookingEnabledCheck) {
    validateBookingEnabledReadiness(ledger);
  }

  const mode = args.bookingEnabledCheck ? 'booking-enabled-check' : 'strict';
  console.log(`PASS phase26 Gate Ledger ${mode}: ${args.ledger}`);
}

main().catch((error) => {
  console.error(`FAIL phase26 Gate Ledger validation: ${redact(error.message)}`);
  if (Array.isArray(error.details) && error.details.length > 0) {
    for (const detail of error.details) {
      console.error(`- ${detail}`);
    }
  }
  process.exit(1);
});
