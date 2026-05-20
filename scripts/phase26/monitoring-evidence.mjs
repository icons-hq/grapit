#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUT =
  '.planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json';
const DEFAULT_LEDGER = '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json';
const PROJECT = 'grapit-491806';
const REGION = 'asia-northeast3';
const API_SERVICE = 'grabit-api';
const WEB_SERVICE = 'grabit-web';
const API_URL = 'https://api.heygrabit.com';
const WEB_URL = 'https://heygrabit.com';

const BUSINESS_METRICS = [
  {
    key: 'queue.length',
    label: 'queue length',
    source: 'Valkey queue sorted sets + QueueService snapshots',
    commandShape: 'read waiting queue cardinality and active admission set for dedicated test performance',
    expectedSafeResult: 'queue length is finite, decreasing under admission, and linked to dedicated test performance only',
  },
  {
    key: 'queue.admissionRate',
    label: 'queue admission rate',
    source: 'QueueService admission records + Cloud Run queue logs',
    commandShape: 'query admitted/session state changes and admission token success counts',
    expectedSafeResult: 'admissions continue while remaining seats exist and no queue admission stuck state appears',
  },
  {
    key: 'seat.lockSuccessRate',
    label: 'lock success rate',
    source: 'BookingService lock-seat response and Valkey lock keys',
    commandShape: 'compare lock-seat attempts, 2xx responses, and {showtime}:locked-seats count',
    expectedSafeResult: 'lock success/failure matches available seats and no duplicate seat lock appears',
  },
  {
    key: 'reservation.prepareSuccessRate',
    label: 'prepare success rate',
    source: 'ReservationService prepare records and reservation status counts',
    commandShape: 'count prepare attempts, PENDING_PAYMENT reservations, and rejected validation rows',
    expectedSafeResult: 'prepare success matches valid admitted sessions and owned locks',
  },
  {
    key: 'payment.confirmSuccessRate',
    label: 'confirm success rate',
    source: 'ReservationService confirm path + payments table',
    commandShape: 'count confirm attempts, DONE payments, reservation CONFIRMED rows, and compensating cancels',
    expectedSafeResult: 'payment confirm success always has matching reservation, sold seats, and QR issuance',
  },
  {
    key: 'payment.successFailure',
    label: 'payment success/failure',
    source: 'Toss test/live dashboard, Cloud Run payment logs, payments table',
    commandShape: 'compare Toss status, local payments.status, webhook ledger, and failed/canceled rows',
    expectedSafeResult: 'payment failure spike is absent; failed payments remain recoverable or canceled safely',
  },
  {
    key: 'qr.issuance',
    label: 'QR issuance',
    source: 'QrTicketService, tickets table, complete page, My Page reservation detail',
    commandShape: 'count active tickets for confirmed reservations and verify visible QR surfaces',
    expectedSafeResult: 'each confirmed paid reservation has exactly one active QR ticket visible to the owner',
  },
  {
    key: 'refund.jobFailures',
    label: 'refund job failures',
    source: 'pg-boss refundCancelRetry jobs + refund/payment rows',
    commandShape: 'query retryable/failed refund jobs and latest provider-safe cancel result',
    expectedSafeResult: 'refund/cancel backlog is zero or within reviewed retry policy',
  },
  {
    key: 'inventory.remainingSeats',
    label: 'remaining seats',
    source: 'QueueService remainingSeats + seat inventory DB aggregation',
    commandShape: 'compare total capacity, sold/disabled/held_cancelled seats, and active locks',
    expectedSafeResult: 'remaining seats never goes negative and matches public/queue state',
  },
  {
    key: 'inventory.selloutBehavior',
    label: 'sellout behavior',
    source: 'QueueService, BookingService, performance/showtime state, public booking UI',
    commandShape: 'verify no more admissions/locks/prepare once remaining seats reaches zero',
    expectedSafeResult: 'sellout blocks new booking side effects and keeps existing confirmed reservations intact',
  },
];

const WAF_SMOKES = [
  {
    key: 'cloudflare.normalPass',
    label: 'Cloudflare normal-pass smoke',
    type: 'normal-pass',
    commandShape: `curl -I ${WEB_URL} && curl -I ${API_URL}/api/v1/health`,
    expectedSafeResult: 'normal buyer-like requests pass without challenge/block',
  },
  {
    key: 'cloudflare.suspiciousChallenge',
    label: 'Cloudflare suspicious challenge smoke',
    type: 'suspicious-challenge',
    commandShape: `curl -I ${WEB_URL}/booking -H 'User-Agent: phase26-low-volume-smoke'`,
    expectedSafeResult: 'low-volume suspicious smoke produces managed challenge/block/rate-limit evidence',
    safety: 'run from an operator machine only; stop immediately if real users are challenged or blocked',
  },
  {
    key: 'cloudflare.bookingMutationRateLimit',
    label: 'Cloudflare booking mutation rate-limit smoke',
    type: 'suspicious-rate-limit',
    commandShape: 'send a low-volume dedicated-test-event booking mutation smoke with a tagged user-agent',
    expectedSafeResult: 'booking mutation rule records challenge/block/rate-limit without affecting real buyers',
    safety: 'dedicated test event only; never target the real Girl Rules event or real users',
  },
];

const PROVIDER_CHECKS = [
  {
    key: 'cloudRun.logs',
    label: 'Cloud Run log query status',
    commandShape: `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${API_SERVICE}" AND (severity>=WARNING OR "queue" OR "confirm" OR "payment" OR "refund" OR "qr")' --project=${PROJECT} --limit=100`,
  },
  {
    key: 'sentry.alertDryRun',
    label: 'Sentry alert dry-run status',
    commandShape: 'Sentry alert rule dry-run or issue/metric alert query for API/web error-rate and payment failures',
  },
  {
    key: 'cloudflare.activeRules',
    label: 'Cloudflare active WAF/rate-limit rules',
    commandShape: 'Cloudflare dashboard/API evidence for queue-entry challenge, booking mutation rate-limit, and macro/block rules',
  },
];

function usage() {
  return `
Usage:
  node scripts/phase26/monitoring-evidence.mjs --help
  node scripts/phase26/monitoring-evidence.mjs --write-template
  node scripts/phase26/monitoring-evidence.mjs --write-template --out ${DEFAULT_OUT}
  node scripts/phase26/monitoring-evidence.mjs --from-json /path/to/provider-results.json --out ${DEFAULT_OUT}
  node scripts/phase26/monitoring-evidence.mjs --probe-cloud-run --out ${DEFAULT_OUT}

Options:
  --write-template             Write a redacted pending-evidence artifact with all OPS-01/OPS-02 categories.
  --from-json <path>           Merge operator/provider results into the artifact after redaction.
  --probe-cloud-run            Run safe Cloud Run describe/log command shapes when gcloud credentials are available.
  --out <path>                 Evidence output path. Default: ${DEFAULT_OUT}
  --ledger <path>              Gate Ledger path for gate metadata. Default: ${DEFAULT_LEDGER}

Evidence coverage:
  Cloud Run logs, Sentry alert dry-run, Cloudflare active rules, queue length,
  queue admission rate, lock/prepare/confirm success, payment success/failure,
  QR issuance, refund job failures, remaining seats, sellout behavior, WAF
  normal-pass smoke, and suspicious challenge/block/rate-limit smoke.

Security:
  Redacts tokens, cookies, bearer headers, Toss client/secret keys, paymentKey,
  QR tokens/JWTs, OTPs, e-mail addresses, phone numbers, full IP addresses, and
  common PII labels before writing evidence.
`;
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    ledger: DEFAULT_LEDGER,
    fromJson: null,
    writeTemplate: false,
    probeCloudRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--write-template') {
      args.writeTemplate = true;
    } else if (token === '--probe-cloud-run') {
      args.probeCloudRun = true;
    } else if (token === '--from-json') {
      index += 1;
      if (!argv[index]) throw new Error('Missing value for --from-json');
      args.fromJson = argv[index];
    } else if (token === '--out') {
      index += 1;
      if (!argv[index]) throw new Error('Missing value for --out');
      args.out = argv[index];
    } else if (token === '--ledger') {
      index += 1;
      if (!argv[index]) throw new Error('Missing value for --ledger');
      args.ledger = argv[index];
    } else {
      throw new Error(`Unsupported argument: ${token}`);
    }
  }

  if (!args.help && !args.writeTemplate && !args.fromJson && !args.probeCloudRun) {
    throw new Error('Choose --write-template, --from-json, or --probe-cloud-run. Use --help for examples.');
  }

  return args;
}

function redact(value) {
  return String(value)
    .replace(/\btest_sk_[A-Za-z0-9_-]+|\blive_sk_[A-Za-z0-9_-]+/gi, '<toss-secret:redacted>')
    .replace(/\btest_ck_[A-Za-z0-9_-]+|\blive_ck_[A-Za-z0-9_-]+/gi, '<toss-client:redacted>')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/\bpaymentKey\s*[:=]\s*["']?[^\s"',}]+/gi, 'paymentKey=<redacted>')
    .replace(/\bqr(?:Token|_token)?\s*[:=]\s*["']?[^\s"',}]+/gi, 'qrToken=<redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(/\botp\s*[:=]\s*["']?\d{4,8}\b/gi, 'otp=<redacted>')
    .replace(/(?:\+[1-9]\d{5,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g, '<phone:redacted>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email:redacted>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip:redacted>')
    .replace(/\b(name|customerName|buyerName|userName)\s*[:=]\s*["']?[^"',}\n]+/gi, '$1=<pii:redacted>')
    .replace(/\b(address|shippingAddress)\s*[:=]\s*["']?[^"',}\n]+/gi, '$1=<pii:redacted>');
}

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]),
    );
  }
  return redact(String(value));
}

async function readLedgerGateState(ledgerPath) {
  const raw = await readFile(resolve(ledgerPath), 'utf8');
  const ledger = JSON.parse(raw);
  const gates = new Map((ledger.gates ?? []).map((gate) => [gate.gateId, gate]));
  return {
    WAF_ACTIVE_RULES: gates.get('WAF_ACTIVE_RULES')?.state ?? 'BLOCKED',
    ONCALL_PLAYBOOKS: gates.get('ONCALL_PLAYBOOKS')?.state ?? 'BLOCKED',
    FIRST_24H_WATCH: gates.get('FIRST_24H_WATCH')?.state ?? 'BLOCKED',
  };
}

function evidenceRow(entry) {
  return {
    ...entry,
    classification: 'PENDING_PROVIDER_EVIDENCE',
    status: 'not_collected',
    sourceTimestamp: null,
    sourceRef: null,
    redactedSummary: null,
  };
}

async function buildBaseArtifact(args) {
  return {
    schemaVersion: 'phase26.ops-monitoring.v1',
    phase: '26',
    plan: '09',
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    region: REGION,
    services: {
      api: API_SERVICE,
      web: WEB_SERVICE,
      apiUrl: API_URL,
      webUrl: WEB_URL,
    },
    gateStateAtCollection: await readLedgerGateState(args.ledger),
    classification: 'PENDING_PROVIDER_EVIDENCE',
    evidenceRefs: {
      gateLedger: args.ledger,
      runbook: 'docs/runbooks/phase26-cutover-ops.md',
      first24hWatch: '.planning/phases/26-m1-canary-cutover-gates/26-FIRST-24H-WATCH.md',
    },
    providerChecks: PROVIDER_CHECKS.map(evidenceRow),
    wafSmokes: WAF_SMOKES.map(evidenceRow),
    businessMetrics: BUSINESS_METRICS.map(evidenceRow),
    closeBookingTriggers: [
      'duplicate sale',
      'payment confirm success without reservation/QR',
      'payment failure spike',
      'seat lock/prepare side-effect mismatch',
      'queue admission stuck',
      'refund/cancel job buildup',
    ],
    redactionPolicy: [
      'No raw Toss keys, payment keys, QR tokens, cookies, bearer tokens, OTPs, e-mail addresses, phone numbers, full IPs, or PII.',
      'Cloudflare normal-pass and suspicious challenge/block/rate-limit smokes are recorded separately.',
      'Non-PASS monitoring evidence stays non-PASS until owner approval is explicitly recorded in the Gate Ledger.',
    ],
  };
}

function runCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 5,
    timeout: 30_000,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });

  return {
    commandShape: `${command} ${args.join(' ')}`,
    ok: result.status === 0,
    status: result.status,
    stdout: redact((result.stdout ?? '').slice(0, 4000)),
    stderr: redact((result.stderr ?? '').slice(0, 4000)),
  };
}

function collectCloudRunProbe() {
  return {
    serviceDescribe: runCli('gcloud', [
      'run',
      'services',
      'describe',
      API_SERVICE,
      `--project=${PROJECT}`,
      `--region=${REGION}`,
      '--format=json(status.latestReadyRevisionName,status.traffic)',
    ]),
    recentLogs: runCli('gcloud', [
      'logging',
      'read',
      `resource.type="cloud_run_revision" AND resource.labels.service_name="${API_SERVICE}" AND (severity>=WARNING OR "queue" OR "confirm" OR "payment" OR "refund" OR "qr")`,
      `--project=${PROJECT}`,
      '--limit=25',
      '--format=json',
    ]),
  };
}

async function mergeProviderResults(artifact, fromJsonPath) {
  const raw = await readFile(resolve(fromJsonPath), 'utf8');
  const providerResults = sanitize(JSON.parse(raw));
  return {
    ...artifact,
    classification: 'OPERATOR_RESULTS_RECORDED',
    providerResults,
  };
}

async function writeArtifact(outPath, artifact) {
  const absoluteOut = resolve(outPath);
  await mkdir(dirname(absoluteOut), { recursive: true });
  await writeFile(absoluteOut, `${JSON.stringify(sanitize(artifact), null, 2)}\n`);
  console.log(`Wrote redacted Phase 26 monitoring evidence: ${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage().trim());
    return;
  }

  let artifact = await buildBaseArtifact(args);

  if (args.probeCloudRun) {
    artifact = {
      ...artifact,
      classification: 'CLOUD_RUN_PROBE_RECORDED',
      cloudRunProbe: collectCloudRunProbe(),
    };
  }

  if (args.fromJson) {
    artifact = await mergeProviderResults(artifact, args.fromJson);
  }

  await writeArtifact(args.out, artifact);
}

main().catch((error) => {
  console.error(`FAIL phase26 monitoring evidence: ${redact(error.message)}`);
  process.exit(1);
});
