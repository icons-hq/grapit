#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_OUTPUT =
  '.planning/phases/26-m1-canary-cutover-gates/evidence/26-06-load.json';
const APPROVAL_TOKEN = 'PHASE26_DEDICATED_TEST_EVENT_APPROVED';
const P95_THRESHOLD_MS = 2000;
const ERROR_RATE_THRESHOLD = 0.01;
const STATUSES = new Set(['PASS', 'FAIL', 'BLOCKED', 'ACCEPTED_RISK']);

function usage() {
  return `Usage:
  node scripts/phase26/record-k6-evidence.mjs --help
  node scripts/phase26/record-k6-evidence.mjs --record-blocked --blocked-reason "<reason>"
  node scripts/phase26/record-k6-evidence.mjs --baseline <summary.json> --stress <summary.json>

Options:
  --baseline <path>          k6 --summary-export JSON for LOAD_10K_BASELINE
  --stress <path>            k6 --summary-export JSON for LOAD_20K_STRESS
  --out <path>               Evidence path (default: ${DEFAULT_OUTPUT})
  --target <url>             API target URL, recorded redacted
  --performance-id <id>      Dedicated test-event performance ID, recorded masked
  --showtime-id <id>         Dedicated test-event showtime ID, recorded masked
  --window <text>            Operator-approved load window, for example "2026-05-20 16:00 KST"
  --approved-by <name>       Operator approving the target/window
  --approval-token <token>   Must equal ${APPROVAL_TOKEN} for PASS evidence
  --record-blocked           Write BLOCKED/NOT_RUN evidence without reading summary files
  --blocked-reason <reason>  Why the load gate did not run
  --accepted-risk            Convert FAIL/BLOCKED to ACCEPTED_RISK only with --approved-by

The recorder preserves non-PASS states. Missing summaries, missing approval, or
threshold failures never become PASS. Evidence is metadata-only and redacted.`;
}

function parseArgs(argv) {
  const args = {
    baseline: '',
    stress: '',
    out: DEFAULT_OUTPUT,
    target: process.env.GRABIT_API_URL || '',
    performanceId: process.env.PHASE26_TEST_PERFORMANCE_ID || '',
    showtimeId: process.env.PHASE26_TEST_SHOWTIME_ID || '',
    window: process.env.PHASE26_LOAD_WINDOW || '',
    approvedBy: process.env.PHASE26_LOAD_APPROVED_BY || '',
    approvalToken: process.env.PHASE26_LOAD_APPROVED || '',
    blockedReason: '',
    recordBlocked: false,
    acceptedRisk: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--baseline') {
      args.baseline = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--stress') {
      args.stress = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      args.out = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--target') {
      args.target = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--performance-id') {
      args.performanceId = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--showtime-id') {
      args.showtimeId = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--window') {
      args.window = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--approved-by') {
      args.approvedBy = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--approval-token') {
      args.approvalToken = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--blocked-reason') {
      args.blockedReason = readValue(argv, index, arg);
      index += 1;
    } else if (arg === '--record-blocked') {
      args.recordBlocked = true;
    } else if (arg === '--accepted-risk') {
      args.acceptedRisk = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const evidence = args.recordBlocked
    ? buildBlockedEvidence(args)
    : await buildSummaryEvidence(args);

  assertNoForbiddenEvidence(evidence);
  await writeJson(args.out, evidence);
  console.log(`${evidence.status}: wrote ${args.out}`);
}

function buildBlockedEvidence(args) {
  const reason =
    args.blockedReason ||
    'Operator-approved target, credentials, or load window were not available; k6 load was not run.';

  return baseEvidence(args, {
    status: 'BLOCKED',
    checks: [
      loadCheck('LOAD_10K_BASELINE', 'NOT_RUN', { reason }),
      loadCheck('LOAD_20K_STRESS', 'NOT_RUN', { reason }),
    ],
    blockedReason: reason,
  });
}

async function buildSummaryEvidence(args) {
  const approval = validateApproval(args);
  const baseline = await readK6Summary('LOAD_10K_BASELINE', args.baseline);
  const stress = await readK6Summary('LOAD_20K_STRESS', args.stress);
  const checks = [baseline, stress];
  const initialStatus = classifyOverall(checks, approval);
  const status = maybeAcceptedRisk(initialStatus, args);

  return baseEvidence(args, {
    status,
    checks,
    blockedReason: approval.status === 'PASS' ? null : approval.reason,
    acceptance: {
      p95ThresholdMs: P95_THRESHOLD_MS,
      errorRateThreshold: ERROR_RATE_THRESHOLD,
      classification: 'PASS requires both baseline and stress p95/error-rate thresholds plus approval token.',
    },
  });
}

function validateApproval(args) {
  const missing = [];
  if (!args.approvalToken) missing.push('approval token');
  if (!args.approvedBy) missing.push('approved-by');
  if (!args.window) missing.push('load window');
  if (!args.performanceId) missing.push('performance ID');
  if (!args.showtimeId) missing.push('showtime ID');

  if (missing.length > 0) {
    return {
      status: 'BLOCKED',
      reason: `Missing operator approval metadata: ${missing.join(', ')}`,
    };
  }

  if (args.approvalToken !== APPROVAL_TOKEN) {
    return {
      status: 'BLOCKED',
      reason: `PHASE26_LOAD_APPROVED must equal ${APPROVAL_TOKEN}`,
    };
  }

  return { status: 'PASS', reason: null };
}

async function readK6Summary(gateId, path) {
  if (!path) {
    return loadCheck(gateId, 'BLOCKED', { reason: 'Missing k6 summary path' });
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    return loadCheck(gateId, 'BLOCKED', {
      reason: `Unable to read k6 summary: ${safeMessage(error)}`,
      source: maskIdentifier(path),
    });
  }

  const p95 = readMetricNumber(parsed, 'http_req_duration', ['p(95)', 'p95', '95']);
  const errorRate = readMetricNumber(parsed, 'http_req_failed', ['rate', 'value']);
  const samples = readMetricNumber(parsed, 'http_reqs', ['count', 'value'], { optional: true });
  const missing = [];
  if (p95 === null) missing.push('http_req_duration p(95)');
  if (errorRate === null) missing.push('http_req_failed rate');

  if (missing.length > 0) {
    return loadCheck(gateId, 'BLOCKED', {
      reason: `Missing k6 metric(s): ${missing.join(', ')}`,
      source: maskIdentifier(path),
    });
  }

  const status = p95 < P95_THRESHOLD_MS && errorRate < ERROR_RATE_THRESHOLD ? 'PASS' : 'FAIL';
  return loadCheck(gateId, status, {
    p95Ms: roundMetric(p95),
    errorRate: roundMetric(errorRate),
    attempts: samples === null ? null : Math.round(samples),
    thresholds: {
      p95Ms: `<${P95_THRESHOLD_MS}`,
      errorRate: `<${ERROR_RATE_THRESHOLD}`,
    },
    source: maskIdentifier(path),
  });
}

function readMetricNumber(summary, metricName, keys, options = {}) {
  const metric = summary?.metrics?.[metricName];
  if (!metric) return options.optional ? null : null;

  const containers = [metric.values, metric];
  for (const container of containers) {
    if (!container || typeof container !== 'object') continue;
    for (const key of keys) {
      const raw = container[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  return null;
}

function classifyOverall(checks, approval) {
  if (approval.status !== 'PASS') return 'BLOCKED';
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.status !== 'PASS')) return 'BLOCKED';
  return 'PASS';
}

function maybeAcceptedRisk(status, args) {
  if (status === 'PASS' || !args.acceptedRisk) return status;
  if (!args.approvedBy) {
    throw new Error('--accepted-risk requires --approved-by');
  }
  return 'ACCEPTED_RISK';
}

function baseEvidence(args, overrides) {
  const status = overrides.status;
  if (!STATUSES.has(status)) {
    throw new Error(`Invalid evidence status: ${status}`);
  }

  return {
    schemaVersion: 'phase26.k6-load.v1',
    generatedAt: new Date().toISOString(),
    plan: '26-06',
    requirement: 'LOAD-01',
    status,
    target: {
      apiUrl: maskUrl(args.target),
      performanceId: maskIdentifier(args.performanceId),
      showtimeId: maskIdentifier(args.showtimeId),
      dedicatedTestScope: 'PHASE26_TEST',
    },
    operatorApproval: {
      state: args.approvalToken === APPROVAL_TOKEN && args.approvedBy ? 'approved' : 'missing_or_invalid',
      approver: args.approvedBy || null,
      window: args.window || null,
      tokenRecorded: args.approvalToken ? 'redacted' : null,
    },
    commandShapes: {
      baseline:
        'docker run --rm -i grafana/k6 run -e ... --summary-export /out/phase26-baseline-summary.json - < scripts/k6/phase26-baseline.js',
      stress:
        'docker run --rm -i grafana/k6 run -e ... --summary-export /out/phase26-stress-summary.json - < scripts/k6/phase26-stress.js',
      recorder: 'node scripts/phase26/record-k6-evidence.mjs --baseline <json> --stress <json>',
    },
    checks: overrides.checks,
    acceptance: overrides.acceptance ?? {
      p95ThresholdMs: P95_THRESHOLD_MS,
      errorRateThreshold: ERROR_RATE_THRESHOLD,
    },
    blockedReason: overrides.blockedReason ?? null,
    redaction: {
      mode: 'metadata-only',
      notes: [
        'Auth headers, cookies, Toss keys, payment keys, QR tokens, phone numbers, and email addresses are not recorded.',
        'Dedicated event identifiers are masked because this file feeds cutover decisions.',
      ],
    },
  };
}

function loadCheck(gateId, status, details = {}) {
  return {
    gateId,
    status,
    ...details,
  };
}

async function writeJson(path, data) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function assertNoForbiddenEvidence(value) {
  const serialized = JSON.stringify(value);
  const checks = [
    [/Authorization:\s*Bearer\s+(?!<redacted>)[A-Za-z0-9._~+/-]+=*/i, 'raw Authorization header'],
    [/Cookie:\s*(?!<redacted>)[^\n"}]+/i, 'raw Cookie header'],
    [/(paymentKey["'\s:=]+)(?!<redacted>)[A-Za-z0-9._~+/-]{8,}/i, 'raw paymentKey'],
    [/(qrToken["'\s:=]+)(?!<redacted>)[A-Za-z0-9._~+/-]{8,}/i, 'raw QR token'],
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

function maskIdentifier(value) {
  const text = String(value || '');
  if (!text) return '<missing>';
  if (text.length <= 8) return `${text.slice(0, 2)}<redacted>`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function maskUrl(value) {
  const text = String(value || '');
  if (!text) return '<missing>';
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return maskIdentifier(text);
  }
}

function safeMessage(error) {
  return String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240);
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
