#!/usr/bin/env node

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { io } = webRequire('socket.io-client');

const defaultArtifactUrl = new URL('../.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md', import.meta.url);
const artifactPath = process.env.GRABIT_SMOKE_ARTIFACT ?? fileURLToPath(defaultArtifactUrl);

const SERVICE_NAME = 'grabit-api';
const VALKEY_INSTANCE = 'grabit-valkey';
const EXPECTED_LIVE_MODE = 'CLUSTER';
const EXPECTED_VALKEY_MODE = 'cluster';
const REDIS_URL_PATTERN = /\brediss?:\/\/[^\s`'")]+/gi;
const FAILURE_KEYWORDS = [
  'CROSSSLOT',
  'MOVED',
  'ASK',
  'ECONNRESET',
  'ETIMEDOUT',
  'duplicate/subscriber connection loss',
  'persistent adapter fallback',
  'subscription failure',
  'Socket.IO Redis adapter failed to wire in production',
];

function usage() {
  return `
Usage:
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check health
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check lua
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check socketio
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check idle
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check logs
  pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all

Required environment for every --check mode:
  GRABIT_API_URL                         Expected https://api.heygrabit.com
  GRABIT_SMOKE_AUTH_HEADER_FILE          Local uncommitted file with exactly one Authorization or Cookie header line
  GRABIT_SMOKE_SHOWTIME_ID               Operator-approved safe fixture showtime UUID
  GRABIT_SMOKE_SEAT_ID                   Operator-approved safe fixture seat ID

Optional environment:
  GRABIT_SMOKE_ARTIFACT                  Evidence markdown path. Default: script-root 20-HUMAN-UAT.md
  GRABIT_SMOKE_IDLE_SECONDS              Idle reconnect wait, default 1800
  GRABIT_GCP_PROJECT                     Default grapit-491806
  GRABIT_GCP_REGION                      Default asia-northeast3

  Security:
  The script records command shape, revision, mode, PASS/FAIL, and sanitized summaries only.
  It redacts redis:// and rediss:// values, Authorization, Cookie, JWT, phone, paymentKey, orderId, and private customer data markers.
`;
}

function parseArgs(argv) {
  if (argv.includes('--help')) {
    return { help: true, check: 'help' };
  }

  const checkIndex = argv.indexOf('--check');
  if (checkIndex < 0 || !argv[checkIndex + 1]) {
    throw new Error('Missing --check. Use --help for supported checks.');
  }

  const check = argv[checkIndex + 1];
  const valid = new Set(['health', 'lua', 'socketio', 'idle', 'logs', 'all']);
  if (!valid.has(check)) {
    throw new Error(`Unsupported --check ${check}. Use --help for supported checks.`);
  }

  return { help: false, check };
}

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/Cookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(/\+82[0-9]{8,}/g, '+82<redacted>')
    .replace(/\b(paymentKey|orderId)\s*[:=]\s*"?[A-Za-z0-9_-]{12,}"?/gi, '$1=<redacted>')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}

function toKst(isoString) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(isoString)).replace(',', '');
}

function getEnv(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function parsePositiveInteger(name, value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function commandShape(check) {
  return `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check ${check}`;
}

async function loadConfig(check) {
  const apiUrl = new URL(getEnv('GRABIT_API_URL'));
  const authHeaderPath = getEnv('GRABIT_SMOKE_AUTH_HEADER_FILE');
  const authHeaderContent = await readFile(authHeaderPath, 'utf8');
  const headerLines = authHeaderContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (headerLines.length !== 1) {
    throw new Error('GRABIT_SMOKE_AUTH_HEADER_FILE must contain exactly one non-empty header line');
  }

  const header = parseAuthHeader(headerLines[0]);
  const showtimeId = getEnv('GRABIT_SMOKE_SHOWTIME_ID');
  const seatId = getEnv('GRABIT_SMOKE_SEAT_ID');
  const project = getEnv('GRABIT_GCP_PROJECT', 'grapit-491806');
  const region = getEnv('GRABIT_GCP_REGION', 'asia-northeast3');
  const idleSeconds = parsePositiveInteger('GRABIT_SMOKE_IDLE_SECONDS', getEnv('GRABIT_SMOKE_IDLE_SECONDS', '1800'));

  return {
    check,
    apiUrl,
    authHeaderPath,
    authHeaderName: header.name,
    authHeaders: header.headers,
    showtimeId,
    seatId,
    project,
    region,
    idleSeconds,
    artifactPath,
  };
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

function runCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    shape: `${command} ${args.join(' ')}`,
  };
}

function gcloudJson(args) {
  const result = runCli('gcloud', [...args, '--format=json']);
  if (!result.ok) {
    throw new Error(`gcloud failed for ${result.shape}: ${redact(result.stderr || result.stdout)}`);
  }
  try {
    return JSON.parse(result.stdout || 'null');
  } catch (error) {
    throw new Error(`gcloud returned non-JSON output for ${result.shape}: ${(error).message}`);
  }
}

function getCloudRunEvidence(config) {
  const service = gcloudJson([
    'run',
    'services',
    'describe',
    SERVICE_NAME,
    `--region=${config.region}`,
    `--project=${config.project}`,
  ]);

  const templateAnnotations = service?.spec?.template?.metadata?.annotations ?? {};
  const serviceAnnotations = service?.metadata?.annotations ?? {};
  const container = service?.spec?.template?.spec?.containers?.[0] ?? {};
  const env = Array.isArray(container.env) ? container.env : [];
  const envMap = Object.fromEntries(env.map((entry) => [entry.name, entry.value ?? (entry.valueFrom ? '<secret>' : '')]));

  return {
    ok: true,
    service: SERVICE_NAME,
    latestReadyRevisionName: service?.status?.latestReadyRevisionName ?? 'unknown',
    traffic: service?.status?.traffic ?? [],
    declaredValkeyMode: envMap.VALKEY_MODE ?? 'missing',
    redisUrlBinding: envMap.REDIS_URL === '<secret>' ? 'secret-bound' : envMap.REDIS_URL ? 'plain-value-present' : 'missing',
    minInstances: templateAnnotations['autoscaling.knative.dev/minScale']
      ?? serviceAnnotations['autoscaling.knative.dev/minScale']
      ?? '0',
    vpcEgress: templateAnnotations['run.googleapis.com/vpc-access-egress']
      ?? serviceAnnotations['run.googleapis.com/vpc-access-egress']
      ?? 'unknown',
    networkInterfaces: templateAnnotations['run.googleapis.com/network-interfaces']
      ?? serviceAnnotations['run.googleapis.com/network-interfaces']
      ?? 'unknown',
  };
}

function getMemorystoreEvidence(config) {
  const instance = gcloudJson([
    'memorystore',
    'instances',
    'describe',
    VALKEY_INSTANCE,
    `--location=${config.region}`,
    `--project=${config.project}`,
  ]);

  return {
    ok: true,
    instance: VALKEY_INSTANCE,
    state: instance?.state ?? 'unknown',
    mode: instance?.mode ?? 'unknown',
    shardCount: String(instance?.shardCount ?? 'unknown'),
    engineVersion: instance?.engineVersion ?? 'unknown',
  };
}

function runtimeContractFailures(cloudRun, memorystore) {
  const failures = [];
  if (cloudRun.declaredValkeyMode !== EXPECTED_VALKEY_MODE) {
    failures.push(`VALKEY_MODE=${cloudRun.declaredValkeyMode}`);
  }
  if (cloudRun.redisUrlBinding !== 'secret-bound') {
    failures.push(`REDIS_URL binding=${cloudRun.redisUrlBinding}`);
  }
  if (cloudRun.vpcEgress !== 'private-ranges-only') {
    failures.push(`VPC egress=${cloudRun.vpcEgress}`);
  }
  if (cloudRun.networkInterfaces === 'unknown') {
    failures.push('network interfaces=unknown');
  }
  if (memorystore.mode !== EXPECTED_LIVE_MODE) {
    failures.push(`Memorystore mode=${memorystore.mode}`);
  }
  return failures;
}

async function requestJson(config, path, options = {}) {
  const url = new URL(path, config.apiUrl);
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
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
    throw new Error(`${options.method ?? 'GET'} ${url.pathname} failed with ${response.status}: ${redact(JSON.stringify(body))}`);
  }

  return { status: response.status, body };
}

function redisHealthDetail(healthBody) {
  return healthBody?.details?.redis ?? healthBody?.info?.redis ?? healthBody?.redis ?? {};
}

async function checkHealth(config) {
  const response = await requestJson(config, '/api/v1/health');
  const redis = redisHealthDetail(response.body);
  const mode = redis?.mode ?? redis?.metadata?.mode;
  const client = redis?.client ?? redis?.metadata?.client;
  const configured = redis?.configured ?? redis?.metadata?.configured;

  return {
    name: 'Health Ping Smoke',
    ok: response.body?.status === 'ok'
      && redis?.status === 'up'
      && mode === EXPECTED_VALKEY_MODE
      && client === 'ioredis-cluster'
      && configured === true,
    summary: `health=${response.body?.status ?? 'unknown'}, redis=${redis?.status ?? 'unknown'}, mode=${mode ?? 'unknown'}, client=${client ?? 'unknown'}, configured=${configured ?? 'unknown'}`,
  };
}

async function checkLua(config) {
  let locked = false;
  let unlockOk = false;
  let statusSummary = 'not-run';

  try {
    const lock = await requestJson(config, '/api/v1/booking/seats/lock', {
      method: 'POST',
      headers: config.authHeaders,
      body: JSON.stringify({
        showtimeId: config.showtimeId,
        seatId: config.seatId,
      }),
    });
    locked = Boolean(lock.body?.success);

    const status = await requestJson(config, `/api/v1/booking/schedules/${encodeURIComponent(config.showtimeId)}/seats`);
    const seatState = status.body?.seats?.[config.seatId] ?? status.body?.[config.seatId] ?? 'unknown';
    statusSummary = `seat=${config.seatId}, state=${seatState}`;

    const unlock = await fetch(new URL(`/api/v1/booking/seats/lock/${encodeURIComponent(config.showtimeId)}/${encodeURIComponent(config.seatId)}`, config.apiUrl), {
      method: 'DELETE',
      headers: config.authHeaders,
    });
    unlockOk = unlock.status === 204 || unlock.status === 200;
    if (!unlockOk) {
      const text = await unlock.text();
      throw new Error(`unlock failed with ${unlock.status}: ${redact(text)}`);
    }

    return {
      name: 'Lua Lock Status Unlock Smoke',
      ok: locked && statusSummary.includes('locked') && unlockOk,
      summary: `lock=${locked ? 'PASS' : 'FAIL'}, status=${statusSummary}, unlock=${unlockOk ? 'PASS' : 'FAIL'}`,
    };
  } finally {
    if (locked && !unlockOk) {
      await fetch(new URL(`/api/v1/booking/seats/lock/${encodeURIComponent(config.showtimeId)}/${encodeURIComponent(config.seatId)}`, config.apiUrl), {
        method: 'DELETE',
        headers: config.authHeaders,
      }).catch(() => undefined);
    }
  }
}

function connectSocket(config, label) {
  return new Promise((resolve, reject) => {
    const socket = io(`${config.apiUrl.origin}/booking`, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      extraHeaders: config.authHeaders,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 2,
      reconnectionDelay: 500,
      timeout: 15000,
      forceNew: true,
      query: {
        smoke: 'valkey-production',
        label,
        ts: String(Date.now()),
      },
    });

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Socket.IO ${label} connect timeout`));
    }, 20000);

    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error(`Socket.IO ${label} connect_error: ${redact(error.message)}`));
    });

    socket.connect();
  });
}

function waitForSeatUpdate(socket, seatId, status) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('seat-update', onUpdate);
      reject(new Error(`Timed out waiting for seat-update ${seatId}:${status}`));
    }, 20000);

    function onUpdate(payload) {
      if (payload?.seatId === seatId && payload?.status === status) {
        clearTimeout(timeout);
        socket.off('seat-update', onUpdate);
        resolve(payload);
      }
    }

    socket.on('seat-update', onUpdate);
  });
}

async function joinShowtime(socket, showtimeId) {
  socket.emit('join-showtime', showtimeId);
  await sleep(750);
}

async function lookupSocketInstances(config, clientIds, sinceIso) {
  await sleep(5000);
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `resource.labels.location="${config.region}"`,
    `timestamp>="${sinceIso}"`,
    '"Client connected"',
  ].join(' AND ');
  const entries = gcloudJson([
    'logging',
    'read',
    filter,
    `--project=${config.project}`,
    '--limit=100',
  ]);

  const byClient = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const payload = entry.textPayload ?? entry.jsonPayload?.message ?? JSON.stringify(entry.jsonPayload ?? {});
    for (const clientId of clientIds) {
      if (!payload.includes(clientId)) continue;
      const instanceId = entry.labels?.instanceId
        ?? entry.labels?.['run.googleapis.com/instance_id']
        ?? entry.labels?.['instanceId']
        ?? 'unknown';
      byClient.set(clientId, instanceId);
    }
  }

  return byClient;
}

async function checkSocketIo(config, cloudRun) {
  const minInstances = Number.parseInt(String(cloudRun.minInstances ?? '0'), 10);
  const multiInstanceReady = Number.isFinite(minInstances) && minInstances >= 2;
  const sinceIso = new Date().toISOString();
  const socketA = await connectSocket(config, 'a');
  const socketB = await connectSocket(config, 'b');
  let lockDone = false;

  try {
    await Promise.all([
      joinShowtime(socketA, config.showtimeId),
      joinShowtime(socketB, config.showtimeId),
    ]);

    const updateA = waitForSeatUpdate(socketA, config.seatId, 'locked');
    const updateB = waitForSeatUpdate(socketB, config.seatId, 'locked');

    await requestJson(config, '/api/v1/booking/seats/lock', {
      method: 'POST',
      headers: config.authHeaders,
      body: JSON.stringify({
        showtimeId: config.showtimeId,
        seatId: config.seatId,
      }),
    });
    lockDone = true;

    await Promise.all([updateA, updateB]);

    const instanceMap = await lookupSocketInstances(config, [socketA.id, socketB.id], sinceIso);
    const instances = [...new Set([...instanceMap.values()].filter((value) => value !== 'unknown'))];
    const instanceProof = instances.length >= 2;

    return {
      name: 'Socket.IO Two-Instance Propagation',
      ok: multiInstanceReady && instanceProof,
      summary: `clients=${socketA.id},${socketB.id}; received seat-update=PASS; min-instances=${cloudRun.minInstances}; distinct Cloud Run instance IDs=${instances.length}; D-10=${instanceProof ? 'PASS' : 'FAIL'}; D-13=${instanceProof ? 'PASS' : 'FAIL'}`,
    };
  } finally {
    if (lockDone) {
      await fetch(new URL(`/api/v1/booking/seats/lock/${encodeURIComponent(config.showtimeId)}/${encodeURIComponent(config.seatId)}`, config.apiUrl), {
        method: 'DELETE',
        headers: config.authHeaders,
      }).catch(() => undefined);
    }
    socketA.close();
    socketB.close();
  }
}

async function checkLogs(config, sinceIso) {
  const keywordFilter = FAILURE_KEYWORDS.map((keyword) => `"${keyword}"`).join(' OR ');
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `resource.labels.location="${config.region}"`,
    `timestamp>="${sinceIso}"`,
    `(${keywordFilter})`,
  ].join(' AND ');
  const entries = gcloudJson([
    'logging',
    'read',
    filter,
    `--project=${config.project}`,
    '--limit=20',
  ]);
  const count = Array.isArray(entries) ? entries.length : 0;
  const sentryObservation = process.env.GRABIT_SMOKE_SENTRY_OBSERVATION
    ? redact(process.env.GRABIT_SMOKE_SENTRY_OBSERVATION)
    : 'operator-required: record Sentry zero-count or redacted event id in 20-HUMAN-UAT.md';

  return {
    name: 'Log And Sentry Cleanliness',
    ok: count === 0,
    summary: `Cloud Logging failure keyword count=${count}; Sentry observation=${sentryObservation}`,
  };
}

async function checkIdle(config, cloudRun) {
  await sleep(config.idleSeconds * 1000);
  const afterHealth = await checkHealth(config);
  const afterLua = await checkLua(config);
  const afterSocket = await checkSocketIo(config, cloudRun);
  return {
    name: 'Idle Reconnect Window',
    ok: afterHealth.ok && afterLua.ok && afterSocket.ok,
    summary: `wait=${config.idleSeconds}s; health=${afterHealth.ok ? 'PASS' : 'FAIL'}; lua=${afterLua.ok ? 'PASS' : 'FAIL'}; socketio=${afterSocket.ok ? 'PASS' : 'FAIL'}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChecks(config) {
  const startedUtc = new Date().toISOString();
  const cloudRun = getCloudRunEvidence(config);
  const memorystore = getMemorystoreEvidence(config);
  const runtimeFailures = runtimeContractFailures(cloudRun, memorystore);
  const modeContractOk = runtimeFailures.length === 0;
  const checks = [];

  if (config.check === 'health' || config.check === 'all') {
    checks.push(await checkHealth(config));
  }
  if (config.check === 'lua' || config.check === 'all') {
    checks.push(await checkLua(config));
  }
  if (config.check === 'socketio' || config.check === 'all') {
    checks.push(await checkSocketIo(config, cloudRun));
  }
  if (config.check === 'idle' || config.check === 'all') {
    checks.push(await checkIdle(config, cloudRun));
  }
  if (config.check === 'logs' || config.check === 'all') {
    checks.push(await checkLogs(config, startedUtc));
  }

  const allChecksOk = checks.every((check) => check.ok);
  const evidence = {
    startedUtc,
    completedUtc: new Date().toISOString(),
    commandShape: commandShape(config.check),
    targetHost: config.apiUrl.host,
    authHeaderName: config.authHeaderName,
    artifactPath: config.artifactPath,
    cloudRun,
    memorystore,
    modeContractOk,
    runtimeContractFailures: runtimeFailures,
    checks,
    overallOk: modeContractOk && allChecksOk,
  };

  await writeArtifact(evidence);
  return evidence;
}

async function writeArtifact(evidence) {
  const lines = [
    '',
    '<!-- GRABIT_SMOKE_ARTIFACT -->',
    `### Production Smoke Run - ${evidence.startedUtc}`,
    '',
    `- Command shape: \`${evidence.commandShape}\``,
    `- Timestamp UTC: ${evidence.startedUtc}`,
    `- Timestamp KST: ${toKst(evidence.startedUtc)} KST`,
    `- Completed UTC: ${evidence.completedUtc}`,
    `- Cloud Run service: ${evidence.cloudRun.service}`,
    `- latestReadyRevisionName: ${evidence.cloudRun.latestReadyRevisionName}`,
    `- Target URL host: ${evidence.targetHost}`,
    `- Valkey instance: ${evidence.memorystore.instance}`,
    `- Live Memorystore mode: ${evidence.memorystore.mode}`,
    `- Expected live mode: ${EXPECTED_LIVE_MODE}`,
    `- VALKEY_MODE=cluster observed: ${evidence.cloudRun.declaredValkeyMode === EXPECTED_VALKEY_MODE ? 'PASS' : `FAIL (${evidence.cloudRun.declaredValkeyMode})`}`,
    `- REDIS_URL binding: ${evidence.cloudRun.redisUrlBinding}`,
    `- VPC egress: ${evidence.cloudRun.vpcEgress}`,
    `- Network interfaces: ${evidence.cloudRun.networkInterfaces}`,
    `- min-instances evidence: ${evidence.cloudRun.minInstances}`,
    `- Runtime contract failures: ${evidence.runtimeContractFailures.length > 0 ? evidence.runtimeContractFailures.join('; ') : 'none'}`,
    `- Auth input: ${evidence.authHeaderName} header from GRABIT_SMOKE_AUTH_HEADER_FILE, value redacted`,
    `- Redactions applied: redis://, rediss://, Authorization, Cookie, JWT, phone numbers, paymentKey, orderId, private customer data`,
    '',
    '| Check | Result | Summary |',
    '|-------|--------|---------|',
    `| Production Runtime Contract | ${evidence.modeContractOk ? 'PASS' : 'FAIL'} | ${evidence.runtimeContractFailures.length > 0 ? `failures=${evidence.runtimeContractFailures.join('; ')}` : `live=${evidence.memorystore.mode}, declared=${evidence.cloudRun.declaredValkeyMode}, REDIS_URL=${evidence.cloudRun.redisUrlBinding}, VPC=${evidence.cloudRun.vpcEgress}`} |`,
    ...evidence.checks.map((check) => `| ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${redact(check.summary)} |`),
    `| Final automated smoke result | ${evidence.overallOk ? 'PASS' : 'FAIL'} | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |`,
    '',
  ];

  await mkdir(dirname(evidence.artifactPath), { recursive: true });
  await appendFile(evidence.artifactPath, redact(lines.join('\n')), 'utf8');
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    const resolved = webRequire.resolve('socket.io-client');
    console.log(usage());
    console.log(`socket.io-client resolved through apps/web package: ${resolved}`);
    process.exit(0);
  }

  const config = await loadConfig(args.check);
  const evidence = await runChecks(config);
  console.log(redact(JSON.stringify({
    commandShape: evidence.commandShape,
    artifactPath: evidence.artifactPath,
    targetHost: evidence.targetHost,
    latestReadyRevisionName: evidence.cloudRun.latestReadyRevisionName,
    valkeyMode: evidence.memorystore.mode,
    declaredValkeyMode: evidence.cloudRun.declaredValkeyMode,
    checks: evidence.checks.map((check) => ({ name: check.name, ok: check.ok })),
    overallOk: evidence.overallOk,
  }, null, 2)));
  process.exit(evidence.overallOk ? 0 : 1);
} catch (error) {
  console.error(redact((error).stack ?? (error).message ?? error));
  process.exit(1);
}
