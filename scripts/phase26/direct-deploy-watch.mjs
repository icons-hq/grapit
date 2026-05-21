#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const DEFAULT_PROJECT = 'grapit-491806';
const DEFAULT_REGION = 'asia-northeast3';
const DEFAULT_API_SERVICE = 'grabit-api';
const DEFAULT_WEB_SERVICE = 'grabit-web';
const DEFAULT_API_URL = 'https://api.heygrabit.com';
const DEFAULT_WEB_URL = 'https://heygrabit.com';
const DEFAULT_DURATION_MINUTES = 15;
const DEFAULT_POLL_SECONDS = 60;
const DEFAULT_EVIDENCE_PATH =
  '.planning/phases/26-m1-canary-cutover-gates/evidence/26-07-direct-deploy-watch.json';
const DIRECT_DEPLOY_POLICY =
  'CI/CD green -> 100% direct deploy -> 15-minute strict watch';
const D05_REJECTION =
  'D-05 supersedes Cloud Run traffic-split canary: use 100% direct deploy plus strict watch.';
const COMMAND_TIMEOUT_MS = 90_000;
const HTTP_TIMEOUT_MS = 30_000;
const LOG_LIMIT = 80;
const SECRET_PATTERNS = [
  /\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi,
  /\bCookie:\s*[^`\n\r]+/gi,
  /(["']?\b(accessToken|refreshToken|token|secret|password|paymentKey|orderId|qrToken)["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  /(?:\+[1-9]\d{5,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
];
const CRITICAL_LOG_PATTERNS = [
  /status[=:]\s*5\d\d/i,
  /\b5\d\d\b/,
  /Unhandled|Exception|panic|CROSSSLOT|ECONNRESET|ETIMEDOUT/i,
  /payments?\/confirm|queue|auth\/refresh|health|rollback/i,
];
const REJECTED_TRAFFIC_FLAGS = new Set([
  '--traffic-split',
  '--traffic-split-percent',
  '--traffic-percent',
  '--canary',
  '--canary-percent',
  '--to-revisions',
  '--no-traffic',
  '--tag',
  '--traffic-tag',
]);
const VALUE_FLAGS = new Set([
  '--project',
  '--region',
  '--api-service',
  '--web-service',
  '--api-url',
  '--web-url',
  '--duration-minutes',
  '--poll-seconds',
  '--evidence',
  '--public-detail-url',
  '--github-run-url',
  '--auth-smoke-command',
  '--queue-smoke-command',
  '--payment-safe-command',
  '--rollback-api-revision',
  '--rollback-web-revision',
  '--log-limit',
  '--log-since',
]);
const BOOLEAN_FLAGS = new Set([
  '--help',
  '--dry-run',
  '--once',
  '--skip-github',
  '--skip-gcloud',
  '--skip-http',
  '--skip-logs',
  '--no-write',
]);

function usage() {
  return `
Usage:
  node scripts/phase26/direct-deploy-watch.mjs --help
  node scripts/phase26/direct-deploy-watch.mjs --once --public-detail-url=https://heygrabit.com/performance/<safe-id>
  node scripts/phase26/direct-deploy-watch.mjs --auth-smoke-command="pnpm smoke:auth" --queue-smoke-command="pnpm smoke:queue" --payment-safe-command="pnpm smoke:payment-safe"

Purpose:
  Phase 26 M1 uses ${DIRECT_DEPLOY_POLICY}.
  It does not run Cloud Run traffic-split canary. traffic-split arguments are rejected because ${D05_REJECTION}

Defaults:
  --project=${DEFAULT_PROJECT}
  --region=${DEFAULT_REGION}
  --api-service=${DEFAULT_API_SERVICE}
  --web-service=${DEFAULT_WEB_SERVICE}
  --api-url=${DEFAULT_API_URL}
  --web-url=${DEFAULT_WEB_URL}
  --duration-minutes=${DEFAULT_DURATION_MINUTES}
  --poll-seconds=${DEFAULT_POLL_SECONDS}
  --evidence=${DEFAULT_EVIDENCE_PATH}

Checks:
  - GitHub Actions Deploy run is green or --github-run-url is supplied.
  - Cloud Run latest ready API/Web revisions receive 100% direct deploy traffic.
  - Previous rollback revision IDs are captured in short/redacted form.
  - API /api/v1/health is 2xx.
  - Web /api/runtime-flags returns BOOKING_ENABLED=false.
  - Public event detail URL returns 2xx.
  - Auth/session, queue entry, and payment-safe checks run through explicit smoke command hooks.
  - Cloud Run logs are clipped, redacted, and scanned during the 15-minute strict watch.

Rollback triggers:
  health failure, login/refresh failure, public detail non-2xx, BOOKING_ENABLED=false side effects,
  queue entry 5xx, or unsafe payment confirm behavior.

Security:
  Evidence is redacted. Do not pass commands that print cookies, bearer tokens, Toss keys,
  full paymentKey/orderId values, QR tokens, OTPs, phone numbers, or PII.
`;
}

function parseArgs(argv) {
  const parsed = {
    project: DEFAULT_PROJECT,
    region: DEFAULT_REGION,
    apiService: DEFAULT_API_SERVICE,
    webService: DEFAULT_WEB_SERVICE,
    apiUrl: DEFAULT_API_URL,
    webUrl: DEFAULT_WEB_URL,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    pollSeconds: DEFAULT_POLL_SECONDS,
    evidence: DEFAULT_EVIDENCE_PATH,
    publicDetailUrl: process.env.PHASE26_M1_PUBLIC_DETAIL_URL ?? '',
    githubRunUrl: '',
    authSmokeCommand: '',
    queueSmokeCommand: '',
    paymentSafeCommand: '',
    rollbackApiRevision: '',
    rollbackWebRevision: '',
    logLimit: LOG_LIMIT,
    logSince: '',
    help: false,
    dryRun: false,
    once: false,
    skipGithub: false,
    skipGcloud: false,
    skipHttp: false,
    skipLogs: false,
    noWrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inlineValue] = raw.includes('=')
      ? raw.split(/=(.*)/s, 2)
      : [raw, undefined];

    if (REJECTED_TRAFFIC_FLAGS.has(flag)) {
      throw new Error(`${flag} is rejected. ${D05_REJECTION}`);
    }

    if (BOOLEAN_FLAGS.has(flag)) {
      const key = toCamel(flag);
      parsed[key] = true;
      continue;
    }

    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown argument ${raw}. Use --help for supported options.`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }

    parsed[toCamel(flag)] = value;
  }

  parsed.durationMinutes = parsePositiveNumber(
    '--duration-minutes',
    parsed.durationMinutes,
  );
  parsed.pollSeconds = parsePositiveNumber('--poll-seconds', parsed.pollSeconds);
  parsed.logLimit = parsePositiveNumber('--log-limit', parsed.logLimit);
  parsed.apiUrl = normalizeOrigin('--api-url', parsed.apiUrl);
  parsed.webUrl = normalizeOrigin('--web-url', parsed.webUrl);
  if (!parsed.publicDetailUrl) {
    const performanceId =
      process.env.PHASE26_M1_SMOKE_PERFORMANCE_ID ??
      '00000000-0000-4000-8000-000000000026';
    parsed.publicDetailUrl = `${parsed.webUrl}/performance/${encodeURIComponent(performanceId)}`;
  }

  return parsed;
}

function toCamel(flag) {
  return flag
    .replace(/^--/, '')
    .replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

function parsePositiveNumber(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}

function normalizeOrigin(name, value) {
  const url = new URL(String(value));
  if (url.origin !== String(value).replace(/\/+$/, '')) {
    throw new Error(`${name} must be an origin URL.`);
  }
  return url.origin;
}

function redact(value) {
  const redacted = SECRET_PATTERNS.reduce((next, pattern) => {
    if (pattern.source.includes('accessToken')) {
      return next.replace(pattern, '$1"<redacted>"');
    }
    if (pattern.source.includes('Authorization')) {
      return next.replace(pattern, 'Authorization: Bearer <redacted>');
    }
    if (pattern.source.includes('Cookie')) {
      return next.replace(pattern, 'Cookie: <redacted>');
    }
    if (pattern.source.includes('@')) {
      return next.replace(pattern, '<email:redacted>');
    }
    if (pattern.source.includes('01')) {
      return next.replace(pattern, '<phone:redacted>');
    }
    return next.replace(pattern, '<redacted>');
  }, String(value));

  return redacted
    .replace(
      /(\\?"password\\?"\s*:\s*\\?")[^"\\\s]+(\\?")/gi,
      '$1<redacted>$2',
    )
    .replace(
      /(\\?"email\\?"\s*:\s*\\?")[^"\\]+(\\?")/gi,
      '$1<email:redacted>$2',
    );
}

function clip(value, length = 1600) {
  const redacted = redact(value);
  if (redacted.length <= length) return redacted;
  return `${redacted.slice(0, length)}...<clipped>`;
}

function shortRevision(value) {
  if (!value) return 'not-recorded';
  return String(value).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 48);
}

function nowIso() {
  return new Date().toISOString();
}

function createCheck(name, status, summary, details = {}) {
  return {
    name,
    status,
    summary: clip(summary, 600),
    details: sanitizeJson(details),
    checkedAt: nowIso(),
  };
}

function sanitizeJson(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'string') return clip(item, 1200);
    return item;
  }));
}

function runCli(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 8,
    shell: options.shell ?? false,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });
  const error = result.error ? String(result.error.message ?? result.error) : '';
  return {
    ok: result.status === 0 && !error,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: error || result.stderr || '',
    shape: options.shell ? command : `${command} ${args.join(' ')}`,
  };
}

function runJson(command, args) {
  const result = runCli(command, args);
  if (!result.ok) {
    throw new Error(`${result.shape} failed: ${clip(result.stderr || result.stdout)}`);
  }
  try {
    return JSON.parse(result.stdout || 'null');
  } catch (error) {
    throw new Error(`${result.shape} returned non-JSON: ${error.message}`);
  }
}

async function httpCheck(name, url, validate) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const validation = validate(response, json, text);
    return createCheck(name, validation.status, validation.summary, {
      url,
      statusCode: response.status,
      body: validation.recordBody === true ? text : undefined,
    });
  } catch (error) {
    return createCheck(name, 'FAIL', `${url} failed: ${error.message}`, { url });
  }
}

async function githubCheck(config) {
  if (config.skipGithub) {
    return createCheck('github-actions', 'SKIP', 'GitHub Actions check skipped by operator flag.');
  }
  if (config.githubRunUrl) {
    return createCheck('github-actions', 'PASS', 'Operator supplied green GitHub Actions deploy run URL.', {
      runUrl: config.githubRunUrl,
    });
  }

  const result = runCli('gh', [
    'run',
    'list',
    '--workflow',
    'Deploy',
    '--branch',
    'main',
    '--limit',
    '1',
    '--json',
    'status,conclusion,url,headSha',
  ]);
  if (!result.ok) {
    return createCheck('github-actions', 'BLOCKED', `Unable to read GitHub Actions status: ${result.stderr || result.stdout}`);
  }

  try {
    const runs = JSON.parse(result.stdout || '[]');
    const latest = runs[0];
    if (!latest) {
      return createCheck('github-actions', 'BLOCKED', 'No Deploy workflow runs found for main.');
    }
    const passed = latest.status === 'completed' && latest.conclusion === 'success';
    return createCheck(
      'github-actions',
      passed ? 'PASS' : 'FAIL',
      passed ? 'Latest Deploy workflow is green.' : 'Latest Deploy workflow is not green.',
      {
        status: latest.status,
        conclusion: latest.conclusion,
        url: latest.url,
        headSha: shortRevision(latest.headSha),
      },
    );
  } catch (error) {
    return createCheck('github-actions', 'FAIL', `Unable to parse gh output: ${error.message}`);
  }
}

function cloudRunServiceCheck(config, serviceName) {
  try {
    const service = runJson('gcloud', [
      'run',
      'services',
      'describe',
      serviceName,
      `--project=${config.project}`,
      `--region=${config.region}`,
      '--format=json',
    ]);
    const latestReadyRevision = service?.status?.latestReadyRevisionName ?? '';
    const traffic = Array.isArray(service?.status?.traffic)
      ? service.status.traffic
      : [];
    const directTraffic = traffic.find(
      (entry) => entry.revisionName === latestReadyRevision && Number(entry.percent) === 100,
    );
    const otherLiveTraffic = traffic.filter(
      (entry) => entry.revisionName !== latestReadyRevision && Number(entry.percent) > 0,
    );
    const container = service?.spec?.template?.spec?.containers?.[0] ?? {};
    const env = Array.isArray(container.env) ? container.env : [];
    const bookingEnabledEntry = env.find((entry) => entry.name === 'BOOKING_ENABLED');

    return createCheck(
      `cloud-run-${serviceName}`,
      directTraffic && otherLiveTraffic.length === 0 ? 'PASS' : 'FAIL',
      directTraffic && otherLiveTraffic.length === 0
        ? `${serviceName} latest ready revision has 100% direct deploy traffic.`
        : `${serviceName} is not on 100% direct deploy traffic for latest ready revision.`,
      {
        service: serviceName,
        latestReadyRevision: shortRevision(latestReadyRevision),
        observedTraffic: traffic.map((entry) => ({
          revisionName: shortRevision(entry.revisionName ?? ''),
          percent: entry.percent ?? 0,
          tag: entry.tag ? shortRevision(entry.tag) : undefined,
        })),
        image: shortRevision(container.image ?? ''),
        bookingEnabled: bookingEnabledEntry ? '<present>' : '<absent>',
      },
    );
  } catch (error) {
    return createCheck(`cloud-run-${serviceName}`, 'BLOCKED', error.message, {
      service: serviceName,
    });
  }
}

function rollbackRevisionEvidence(config) {
  return createCheck('rollback-revisions', 'PASS', 'Rollback revision IDs captured in short/redacted form.', {
    apiRollbackRevision: shortRevision(config.rollbackApiRevision),
    webRollbackRevision: shortRevision(config.rollbackWebRevision),
    note:
      config.rollbackApiRevision || config.rollbackWebRevision
        ? 'Operator supplied rollback target revisions.'
        : 'No explicit rollback revisions supplied; use latest known-good from Cloud Run service history before live watch.',
  });
}

async function runtimeFlagsCheck(config) {
  return httpCheck('runtime-flags', `${config.webUrl}/api/runtime-flags`, (_response, json) => {
    const bookingEnabled = json?.bookingEnabled === true;
    return {
      status: bookingEnabled ? 'FAIL' : 'PASS',
      summary: bookingEnabled
        ? 'BOOKING_ENABLED=true observed during direct deploy watch.'
        : 'BOOKING_ENABLED=false observed during direct deploy watch.',
    };
  });
}

async function healthCheck(config) {
  return httpCheck('api-health', `${config.apiUrl}/api/v1/health`, (response) => ({
    status: response.status >= 200 && response.status < 300 ? 'PASS' : 'FAIL',
    summary:
      response.status >= 200 && response.status < 300
        ? 'API health returned 2xx.'
        : `API health returned ${response.status}.`,
  }));
}

async function publicDetailCheck(config) {
  return httpCheck('public-detail', config.publicDetailUrl, (response) => ({
    status: response.status >= 200 && response.status < 300 ? 'PASS' : 'FAIL',
    summary:
      response.status >= 200 && response.status < 300
        ? 'Public event detail returned 2xx.'
        : `Public event detail returned ${response.status}.`,
  }));
}

function commandHookCheck(name, command, failSummary) {
  if (!command) {
    return createCheck(name, 'BLOCKED', `${name} hook command is required for M1 PASS.`);
  }
  const result = runCli(command, [], { shell: true, timeoutMs: COMMAND_TIMEOUT_MS * 2 });
  return createCheck(
    name,
    result.ok ? 'PASS' : 'FAIL',
    result.ok ? `${name} hook passed.` : failSummary,
    {
      commandShape: command,
      exitStatus: result.status,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr),
    },
  );
}

function cloudRunLogsCheck(config, sinceIso) {
  if (config.skipLogs) {
    return createCheck('cloud-run-logs', 'SKIP', 'Cloud Run log scan skipped by operator flag.');
  }
  const filter = `resource.type="cloud_run_revision"
AND resource.labels.service_name=("${config.apiService}" OR "${config.webService}")
AND timestamp>="${sinceIso}"
AND (severity>=WARNING OR "auth/refresh" OR "queue" OR "confirm" OR "health" OR "payment")`;
  const result = runCli('gcloud', [
    'logging',
    'read',
    filter,
    `--project=${config.project}`,
    `--limit=${config.logLimit}`,
    '--format=value(timestamp,severity,resource.labels.service_name,httpRequest.status,textPayload,jsonPayload.message)',
  ]);
  if (!result.ok) {
    return createCheck('cloud-run-logs', 'BLOCKED', result.stderr || result.stdout, {
      filter,
    });
  }
  const output = result.stdout.trim();
  const critical = output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => CRITICAL_LOG_PATTERNS.some((pattern) => pattern.test(line)));
  return createCheck(
    'cloud-run-logs',
    critical.length > 0 ? 'FAIL' : 'PASS',
    critical.length > 0
      ? 'Critical Cloud Run log patterns found during strict watch.'
      : 'No critical Cloud Run log patterns found in clipped scan.',
    {
      filter,
      sample: output.split(/\r?\n/).filter(Boolean).slice(0, 20),
      criticalSample: critical.slice(0, 20),
    },
  );
}

async function runIteration(config, startedAt) {
  const checks = [];
  if (config.dryRun) {
    checks.push(
      createCheck('dry-run', 'PASS', 'Dry run parsed configuration without touching production.'),
    );
    return checks;
  }

  checks.push(await githubCheck(config));
  if (!config.skipGcloud) {
    checks.push(cloudRunServiceCheck(config, config.apiService));
    checks.push(cloudRunServiceCheck(config, config.webService));
    checks.push(rollbackRevisionEvidence(config));
  } else {
    checks.push(createCheck('cloud-run', 'SKIP', 'Cloud Run checks skipped by operator flag.'));
  }

  if (!config.skipHttp) {
    checks.push(await healthCheck(config));
    checks.push(await runtimeFlagsCheck(config));
    checks.push(await publicDetailCheck(config));
  } else {
    checks.push(createCheck('http-smoke', 'SKIP', 'HTTP smoke checks skipped by operator flag.'));
  }

  checks.push(
    commandHookCheck(
      'auth-session',
      config.authSmokeCommand,
      'Auth/session hook failed; rollback trigger is login/refresh failure.',
    ),
  );
  checks.push(
    commandHookCheck(
      'queue-entry',
      config.queueSmokeCommand,
      'Queue entry hook failed; rollback trigger is queue entry 5xx.',
    ),
  );
  checks.push(
    commandHookCheck(
      'payment-safe',
      config.paymentSafeCommand,
      'Payment-safe hook failed; rollback trigger is unsafe payment confirm behavior.',
    ),
  );
  if (!config.skipGcloud) {
    checks.push(cloudRunLogsCheck(config, config.logSince || startedAt));
  }

  return checks;
}

function summarizeStatus(checks) {
  if (checks.some((check) => check.status === 'FAIL')) return 'NO_GO';
  if (checks.some((check) => check.status === 'BLOCKED')) return 'NO_GO';
  if (checks.every((check) => ['PASS', 'SKIP'].includes(check.status))) return 'PASS';
  return 'NO_GO';
}

function buildEvidence(config, checks, startedAt, endedAt) {
  return {
    schemaVersion: 'phase26.direct-deploy-watch.v1',
    phase: '26',
    plan: '26-07',
    requirementIds: ['M1-01'],
    policy: DIRECT_DEPLOY_POLICY,
    sourceDecisions: ['D-05', 'D-06', 'D-07', 'D-08'],
    status: summarizeStatus(checks),
    startedAt,
    endedAt,
    target: {
      project: config.project,
      region: config.region,
      apiService: config.apiService,
      webService: config.webService,
      apiUrl: config.apiUrl,
      webUrl: config.webUrl,
      publicDetailUrl: config.publicDetailUrl,
      durationMinutes: config.durationMinutes,
      pollSeconds: config.pollSeconds,
    },
    rollbackTriggers: [
      'health 5xx',
      'login/refresh failure',
      'public detail non-2xx',
      'BOOKING_ENABLED=false side effects',
      'queue entry 5xx',
      'payment confirm unsafe behavior',
    ],
    trafficSplitCanaryPolicy: D05_REJECTION,
    redaction: {
      rawCookies: 'forbidden',
      bearerTokens: 'forbidden',
      tossKeys: 'forbidden',
      paymentKeys: 'redacted',
      orderIds: 'redacted',
      qrTokens: 'forbidden',
      pii: 'redacted',
    },
    checks,
  };
}

async function writeEvidence(config, evidence) {
  if (config.noWrite) return;
  const path = resolve(config.evidence);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    process.stdout.write(usage());
    return;
  }

  const startedAt = nowIso();
  const deadline = Date.now() + config.durationMinutes * 60_000;
  const allChecks = [];

  do {
    allChecks.push(...await runIteration(config, startedAt));
    if (config.once || config.dryRun) break;
    if (Date.now() + config.pollSeconds * 1000 > deadline) break;
    await sleep(config.pollSeconds * 1000);
  } while (Date.now() < deadline);

  const evidence = buildEvidence(config, allChecks, startedAt, nowIso());
  await writeEvidence(config, evidence);
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    policy: evidence.policy,
    evidence: config.noWrite ? '<not-written>' : config.evidence,
    failedChecks: evidence.checks
      .filter((check) => ['FAIL', 'BLOCKED'].includes(check.status))
      .map((check) => check.name),
  }, null, 2)}\n`);

  if (evidence.status !== 'PASS') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${redact(error.stack || error.message)}\n`);
  process.exitCode = 1;
});
