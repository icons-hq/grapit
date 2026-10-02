#!/usr/bin/env node

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
let socketIoClient;
function io(...args) {
  socketIoClient ??= webRequire('socket.io-client');
  return socketIoClient.io(...args);
}

const defaultArtifactUrl = new URL('../.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md', import.meta.url);
const artifactPath = process.env.GRABIT_SMOKE_ARTIFACT ?? fileURLToPath(defaultArtifactUrl);

const SERVICE_NAME = 'grabit-api';
const EXPECTED_API_ORIGIN = 'https://api.heygrabit.com';
// Operator-declared Valkey topology. The instance name is never defaulted: a
// replaced instance must be named explicitly so the old one cannot pass smoke.
export const VALKEY_MODE_CONTRACTS = {
  cluster: { liveModes: ['CLUSTER'], healthClient: 'ioredis-cluster' },
  standalone: { liveModes: ['CLUSTER_DISABLED', 'STANDALONE'], healthClient: 'ioredis-standalone' },
};
const DEFAULT_MIN_REPLICAS = '1';
const DEFAULT_MAXMEMORY_POLICY = 'noeviction';
const DEFAULT_SALES_PROTECTED_HOURS = '6';
const SALES_PRE_GUARD_MS = 60 * 60 * 1000;
const DEFAULT_MAINTENANCE_DURATION_MS = 60 * 60 * 1000;
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const GCLOUD_TIMEOUT_MS = 60_000;
const HTTP_TIMEOUT_MS = 30_000;
const SOCKET_JOIN_TIMEOUT_MS = 20000;
const INSTANCE_PROOF_TIMEOUT_MS = 90_000;
const MAX_SOCKET_CLIENTS = 8;
const LOG_LOOKUP_TIMEOUT_MS = 60_000;
const LOG_LOOKUP_INTERVAL_MS = 5_000;
// The public seat status read may come from a snapshot up to 1 second old on
// another API instance, so lock/unlock results are confirmed by polling.
const SEAT_STATE_SETTLE_TIMEOUT_MS = 3_000;
const SEAT_STATE_POLL_INTERVAL_MS = 250;
const REDIS_URL_PATTERN = /\brediss?:\/\/[^\s`'")]+/gi;
const PHONE_PATTERN = /(?:\+[1-9]\d{5,14}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g;
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
  GRABIT_VALKEY_INSTANCE                 Memorystore instance that REDIS_URL must point to (no default)
  GRABIT_VALKEY_EXPECTED_MODE            cluster or standalone; must match Cloud Run VALKEY_MODE and the live instance
  GRABIT_SALES_OPEN_AT                   Sales opening as ISO-8601 with offset, or "none" when no opening is scheduled
  GRABIT_SMOKE_AUTH_HEADER_FILE          Local uncommitted file with exactly one Authorization or Cookie header line
  GRABIT_SMOKE_PERFORMANCE_ID            Operator-approved safe fixture performance UUID
  GRABIT_SMOKE_SHOWTIME_ID               Operator-approved safe fixture showtime UUID
  GRABIT_SMOKE_SEAT_ID                   Operator-approved safe fixture seat ID

Optional environment:
  GRABIT_SMOKE_ARTIFACT                  Evidence markdown path. Default: .planning/phases/22-preflight-closure/artifacts/valkey-smoke.md
  GRABIT_SMOKE_IDLE_SECONDS              Idle reconnect wait, default 1800
  GRABIT_SMOKE_LOG_SINCE_UTC             Required for standalone --check logs
  GRABIT_SMOKE_SENTRY_OBSERVATION        Required for --check logs and --check all; record zero-count or redacted event id
  GRABIT_GCP_PROJECT                     Default grapit-491806
  GRABIT_GCP_REGION                      Default asia-northeast3
  GRABIT_VALKEY_MIN_REPLICAS             Minimum replicas per shard, default ${DEFAULT_MIN_REPLICAS} (opening posture)
  GRABIT_VALKEY_MAXMEMORY_POLICY         Required engine maxmemory-policy, default ${DEFAULT_MAXMEMORY_POLICY}
  GRABIT_SALES_PROTECTED_HOURS           Hours after GRABIT_SALES_OPEN_AT that maintenance must avoid, default ${DEFAULT_SALES_PROTECTED_HOURS}

  Security:
  The script records command shape, revision, mode, PASS/FAIL, and sanitized summaries only.
  It redacts redis:// and rediss:// values, Authorization, Cookie, JWT, phone, paymentKey, orderId, and private customer data markers.
  The REDIS_URL secret version bound to Cloud Run is read only to compare its host with the instance endpoints; it is never recorded.
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
    .replace(/(["']\bAuthorization["']\s*:\s*["']?)Bearer\s+[^"',}\]\s]+["']?/gi, '$1Bearer <redacted>"')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/(["']\bCookie["']\s*:\s*["']?)[^"',}\]\r\n]+["']?/gi, '$1<redacted>"')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/(["']?\bJWT["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi, '$1"<redacted>"')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(PHONE_PATTERN, '<phone:redacted>')
    .replace(/(["']?\b(paymentKey|orderId)["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi, '$1"<redacted>"')
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

function parseProductionApiUrl(rawValue) {
  const apiUrl = new URL(rawValue);
  if (
    apiUrl.origin !== EXPECTED_API_ORIGIN
    || apiUrl.pathname !== '/'
    || apiUrl.search
    || apiUrl.hash
  ) {
    throw new Error(`GRABIT_API_URL must be exactly ${EXPECTED_API_ORIGIN}`);
  }
  return apiUrl;
}

function parsePositiveInteger(name, value) {
  const trimmed = String(value).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(trimmed);
}

function parseNonNegativeInteger(name, value) {
  const trimmed = String(value).trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number(trimmed);
}

export function parseValkeyExpectations(env = process.env) {
  const read = (name, fallback) => {
    const value = env[name]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  };
  const instance = read('GRABIT_VALKEY_INSTANCE');
  if (!/^[a-z]([-a-z0-9]*[a-z0-9])?$/.test(instance)) {
    throw new Error('GRABIT_VALKEY_INSTANCE must be a Memorystore instance ID');
  }
  const mode = read('GRABIT_VALKEY_EXPECTED_MODE');
  if (!Object.hasOwn(VALKEY_MODE_CONTRACTS, mode)) {
    throw new Error('GRABIT_VALKEY_EXPECTED_MODE must be cluster or standalone');
  }
  const rawOpenAt = read('GRABIT_SALES_OPEN_AT');
  let salesOpenAt = null;
  if (rawOpenAt !== 'none') {
    // Require an explicit offset so a KST opening is never read as local or UTC by accident.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(rawOpenAt) || Number.isNaN(Date.parse(rawOpenAt))) {
      throw new Error('GRABIT_SALES_OPEN_AT must be ISO-8601 with an offset (for example 2026-10-20T20:00:00+09:00) or "none"');
    }
    salesOpenAt = new Date(rawOpenAt);
  }
  return {
    instance,
    mode,
    liveModes: VALKEY_MODE_CONTRACTS[mode].liveModes,
    healthClient: VALKEY_MODE_CONTRACTS[mode].healthClient,
    minReplicas: parseNonNegativeInteger('GRABIT_VALKEY_MIN_REPLICAS', read('GRABIT_VALKEY_MIN_REPLICAS', DEFAULT_MIN_REPLICAS)),
    maxmemoryPolicy: read('GRABIT_VALKEY_MAXMEMORY_POLICY', DEFAULT_MAXMEMORY_POLICY),
    salesOpenAt,
    protectedHours: parsePositiveInteger('GRABIT_SALES_PROTECTED_HOURS', read('GRABIT_SALES_PROTECTED_HOURS', DEFAULT_SALES_PROTECTED_HOURS)),
  };
}

function commandShape(check) {
  return `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check ${check}`;
}

async function loadConfig(check) {
  const apiUrl = parseProductionApiUrl(getEnv('GRABIT_API_URL'));
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
  const performanceId = getEnv('GRABIT_SMOKE_PERFORMANCE_ID');
  const showtimeId = getEnv('GRABIT_SMOKE_SHOWTIME_ID');
  const seatId = getEnv('GRABIT_SMOKE_SEAT_ID');
  const project = getEnv('GRABIT_GCP_PROJECT', 'grapit-491806');
  const region = getEnv('GRABIT_GCP_REGION', 'asia-northeast3');
  const idleSeconds = parsePositiveInteger('GRABIT_SMOKE_IDLE_SECONDS', getEnv('GRABIT_SMOKE_IDLE_SECONDS', '1800'));
  const valkey = parseValkeyExpectations();

  return {
    check,
    apiUrl,
    valkey,
    authHeaderPath,
    authHeaderName: header.name,
    authHeaders: header.headers,
    performanceId,
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
    timeout: GCLOUD_TIMEOUT_MS,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });
  const spawnError = result.error ? String(result.error.message ?? result.error) : '';

  return {
    ok: result.status === 0 && !spawnError,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: spawnError || result.stderr || '',
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
  const redisSecretRef = env.find((entry) => entry.name === 'REDIS_URL')?.valueFrom?.secretKeyRef;

  return {
    ok: true,
    service: SERVICE_NAME,
    latestReadyRevisionName: service?.status?.latestReadyRevisionName ?? 'unknown',
    traffic: service?.status?.traffic ?? [],
    declaredValkeyMode: envMap.VALKEY_MODE ?? 'missing',
    redisUrlBinding: envMap.REDIS_URL === '<secret>' ? 'secret-bound' : envMap.REDIS_URL ? 'plain-value-present' : 'missing',
    redisUrlSecret: redisSecretRef?.name
      ? { name: redisSecretRef.name, version: redisSecretRef.key || 'latest' }
      : null,
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
    config.valkey.instance,
    `--location=${config.region}`,
    `--project=${config.project}`,
  ]);

  return summarizeMemorystoreInstance(config.valkey.instance, instance);
}

export function summarizeMemorystoreInstance(name, instance) {
  // proto3 omits zero values: an absent replicaCount means zero replicas.
  const replicaCount = Number(instance?.replicaCount ?? 0);
  return {
    ok: true,
    instance: name,
    state: instance?.state ?? 'unknown',
    mode: instance?.mode ?? 'unknown',
    shardCount: String(instance?.shardCount ?? 'unknown'),
    engineVersion: instance?.engineVersion ?? 'unknown',
    replicaCount: Number.isInteger(replicaCount) ? replicaCount : null,
    // Absent means the engine default, which is not an explicit no-eviction policy.
    maxmemoryPolicy: instance?.engineConfigs?.['maxmemory-policy'] ?? null,
    endpoints: instanceEndpoints(instance),
    maintenancePolicy: instance?.maintenancePolicy ?? null,
    maintenanceSchedule: instance?.maintenanceSchedule ?? null,
  };
}

export function instanceEndpoints(instance) {
  const endpoints = [];
  const add = (address, connectionType, port) => {
    if (typeof address === 'string' && address) {
      endpoints.push({ address, connectionType: connectionType ?? 'CONNECTION_TYPE_DISCOVERY', port: port ?? null });
    }
  };
  for (const endpoint of instance?.discoveryEndpoints ?? []) add(endpoint?.address, 'CONNECTION_TYPE_DISCOVERY', endpoint?.port);
  for (const connection of instance?.pscAutoConnections ?? []) add(connection?.ipAddress, connection?.connectionType, connection?.port);
  for (const endpoint of instance?.endpoints ?? []) {
    for (const connection of endpoint?.connections ?? []) {
      const psc = connection?.pscAutoConnection ?? connection?.pscConnection;
      add(psc?.ipAddress, psc?.connectionType, psc?.port);
    }
  }
  return endpoints;
}

export function redisUrlHost(rawValue) {
  try {
    const url = new URL(String(rawValue).trim());
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return null;
    return url.hostname.replace(/^\[|\]$/g, '') || null;
  } catch {
    return null;
  }
}

function readRedisUrlHost(config, cloudRun) {
  if (cloudRun.redisUrlBinding !== 'secret-bound' || !cloudRun.redisUrlSecret) {
    return { host: null, error: 'REDIS_URL is not bound to a Secret Manager secret' };
  }
  const { name, version } = cloudRun.redisUrlSecret;
  const result = runCli('gcloud', [
    'secrets', 'versions', 'access', version, `--secret=${name}`, `--project=${config.project}`,
  ]);
  if (!result.ok) {
    return { host: null, error: `secret ${name}:${version} unreadable (${redact(result.stderr).slice(0, 200)})` };
  }
  const host = redisUrlHost(result.stdout);
  return host ? { host, error: null } : { host: null, error: `secret ${name}:${version} is not a redis:// or rediss:// URL` };
}

// Maintenance must not start inside [openAt - 1h, openAt + protectedHours).
export function maintenanceOverlap(memorystore, salesOpenAt, protectedHours) {
  if (!salesOpenAt) return { evaluated: false, overlaps: [], failures: [] };
  const start = salesOpenAt.getTime() - SALES_PRE_GUARD_MS;
  const end = salesOpenAt.getTime() + protectedHours * 60 * 60 * 1000;
  const overlaps = [];
  const failures = [];
  const scheduled = memorystore.maintenanceSchedule;
  if (scheduled?.startTime) {
    const scheduledStart = Date.parse(scheduled.startTime);
    const scheduledEnd = Date.parse(scheduled.endTime ?? '') || scheduledStart + DEFAULT_MAINTENANCE_DURATION_MS;
    if (scheduledStart < end && scheduledEnd > start) overlaps.push(`scheduled ${scheduled.startTime}`);
  }
  const windows = memorystore.maintenancePolicy?.weeklyMaintenanceWindow ?? [];
  if (windows.length === 0) {
    failures.push('maintenance window is not pinned (no weeklyMaintenanceWindow)');
  }
  for (const window of windows) {
    const weekday = WEEKDAYS.indexOf(window?.day);
    if (weekday < 0) {
      failures.push(`maintenance window day=${window?.day ?? 'missing'} is not recognised`);
      continue;
    }
    const hours = Number(window?.startTime?.hours ?? 0);
    const minutes = Number(window?.startTime?.minutes ?? 0);
    const durationSeconds = Number.parseFloat(String(window?.duration ?? '').replace(/s$/, ''));
    const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds * 1000 : DEFAULT_MAINTENANCE_DURATION_MS;
    // Check every occurrence whose start can fall within a week of the protected interval.
    const firstDay = new Date(start - 8 * 24 * 60 * 60 * 1000);
    firstDay.setUTCHours(0, 0, 0, 0);
    for (let day = firstDay.getTime(); day <= end; day += 24 * 60 * 60 * 1000) {
      if (new Date(day).getUTCDay() !== weekday) continue;
      const windowStart = day + (hours * 60 + minutes) * 60 * 1000;
      if (windowStart < end && windowStart + durationMs > start) {
        overlaps.push(`weekly ${window.day} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} UTC`);
      }
    }
  }
  for (const overlap of new Set(overlaps)) {
    failures.push(`maintenance (${overlap}) overlaps the sales protection window`);
  }
  return { evaluated: true, overlaps: [...new Set(overlaps)], failures };
}

function servingTrafficEntries(cloudRun) {
  return Array.isArray(cloudRun.traffic)
    ? cloudRun.traffic.filter((entry) => Number(entry.percent ?? 0) > 0)
    : [];
}

function isLatestReadyServingAllTraffic(cloudRun) {
  const latest = cloudRun.latestReadyRevisionName;
  const servingTraffic = servingTrafficEntries(cloudRun);
  if (!latest || latest === 'unknown' || servingTraffic.length !== 1) {
    return false;
  }

  const [entry] = servingTraffic;
  return Number(entry.percent ?? 0) === 100
    && (entry.revisionName === latest || entry.latestRevision === true);
}

function formatTraffic(traffic) {
  if (!Array.isArray(traffic) || traffic.length === 0) {
    return 'none';
  }

  return traffic
    .map((entry) => {
      const revision = entry.revisionName ?? (entry.latestRevision ? 'latestRevision' : 'unknown');
      return `${revision}:${entry.percent ?? 0}%`;
    })
    .join(', ');
}

export function runtimeContractFailures(cloudRun, memorystore, expectations, redisTarget = { host: null, error: 'not read' }) {
  const failures = [];
  if (cloudRun.declaredValkeyMode !== expectations.mode) {
    failures.push(`VALKEY_MODE=${cloudRun.declaredValkeyMode} (expected ${expectations.mode})`);
  }
  if (cloudRun.redisUrlBinding !== 'secret-bound') {
    failures.push(`REDIS_URL binding=${cloudRun.redisUrlBinding}`);
  }
  if (redisTarget.error) {
    failures.push(`REDIS_URL target=${redisTarget.error}`);
  } else if (!memorystore.endpoints?.some((endpoint) => endpoint.address === redisTarget.host
    && endpoint.connectionType !== 'CONNECTION_TYPE_READER')) {
    failures.push(`REDIS_URL host is not a writable endpoint of ${memorystore.instance}`);
  }
  if (cloudRun.vpcEgress !== 'private-ranges-only') {
    failures.push(`VPC egress=${cloudRun.vpcEgress}`);
  }
  if (cloudRun.networkInterfaces === 'unknown') {
    failures.push('network interfaces=unknown');
  }
  if (memorystore.state !== 'ACTIVE') {
    failures.push(`Memorystore state=${memorystore.state}`);
  }
  if (!expectations.liveModes.includes(memorystore.mode)) {
    failures.push(`Memorystore mode=${memorystore.mode} (expected ${expectations.liveModes.join('|')})`);
  }
  if (memorystore.replicaCount === null || memorystore.replicaCount < expectations.minReplicas) {
    failures.push(`Memorystore replicaCount=${memorystore.replicaCount} (minimum ${expectations.minReplicas})`);
  }
  if (memorystore.maxmemoryPolicy !== expectations.maxmemoryPolicy) {
    failures.push(`maxmemory-policy=${memorystore.maxmemoryPolicy ?? 'engine-default'} (expected ${expectations.maxmemoryPolicy})`);
  }
  failures.push(...maintenanceOverlap(memorystore, expectations.salesOpenAt, expectations.protectedHours).failures);
  if (!isLatestReadyServingAllTraffic(cloudRun)) {
    failures.push(`traffic is not 100% on latestReadyRevisionName=${cloudRun.latestReadyRevisionName}`);
  }
  return failures;
}

function cloudRunRevisionFilter(config, cloudRun) {
  return [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `resource.labels.location="${config.region}"`,
    `resource.labels.revision_name="${cloudRun.latestReadyRevisionName}"`,
  ];
}

async function fetchWithTimeout(url, options = {}) {
  return await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

async function requestJson(config, path, options = {}) {
  const url = new URL(path, config.apiUrl);
  const response = await fetchWithTimeout(url, {
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

function seatExistsInConfig(seatConfig, seatId) {
  return Array.isArray(seatConfig?.tiers)
    && seatConfig.tiers.some((tier) => Array.isArray(tier.seatIds) && tier.seatIds.includes(seatId));
}

async function validateFixture(config) {
  const response = await requestJson(config, `/api/v1/performances/${encodeURIComponent(config.performanceId)}`);
  const performance = response.body;
  const showtimeOk = Array.isArray(performance?.showtimes)
    && performance.showtimes.some((showtime) => showtime.id === config.showtimeId);
  const seatOk = seatExistsInConfig(performance?.seatMap?.seatConfig, config.seatId);

  if (!showtimeOk || !seatOk) {
    throw new Error(`Smoke fixture is invalid: showtime=${showtimeOk ? 'ok' : 'missing'}, seat=${seatOk ? 'ok' : 'missing'}`);
  }
}

function isObjectRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readSeatState(config) {
  const status = await requestJson(config, `/api/v1/booking/schedules/${encodeURIComponent(config.showtimeId)}/seats`);
  if (!isObjectRecord(status.body)) {
    throw new Error('seat-status response body must be an object');
  }
  if (!isObjectRecord(status.body.seats)) {
    throw new Error('seat-status response must include a seats object');
  }

  const state = status.body.seats[config.seatId];
  if (state === undefined) {
    return 'available';
  }
  if (typeof state !== 'string') {
    throw new Error(`seat-status response has non-string state for ${config.seatId}`);
  }
  return state;
}

async function waitForSeatState(config, isExpected) {
  const deadline = Date.now() + SEAT_STATE_SETTLE_TIMEOUT_MS;
  let state = await readSeatState(config);
  while (!isExpected(state) && Date.now() < deadline) {
    await sleep(SEAT_STATE_POLL_INTERVAL_MS);
    state = await readSeatState(config);
  }
  return state;
}

async function unlockAndVerifySeat(config) {
  const unlock = await fetchWithTimeout(new URL(`/api/v1/booking/seats/lock/${encodeURIComponent(config.showtimeId)}/${encodeURIComponent(config.seatId)}`, config.apiUrl), {
    method: 'DELETE',
    headers: config.authHeaders,
  });

  if (unlock.status !== 204 && unlock.status !== 200) {
    const text = await unlock.text();
    throw new Error(`unlock failed with ${unlock.status}: ${redact(text)}`);
  }

  const afterState = await waitForSeatState(config, (state) => state !== 'locked');
  return {
    ok: afterState !== 'locked',
    status: unlock.status,
    afterState,
  };
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
      && mode === config.valkey.mode
      && client === config.valkey.healthClient
      && configured === true,
    summary: `health=${response.body?.status ?? 'unknown'}, redis=${redis?.status ?? 'unknown'}, mode=${mode ?? 'unknown'}, client=${client ?? 'unknown'}, configured=${configured ?? 'unknown'}`,
  };
}

async function checkLua(config) {
  let locked = false;
  let unlockOk = false;
  let statusSummary = 'not-run';
  let cleanupSummary = 'not-run';

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

    const seatState = await waitForSeatState(config, (state) => state === 'locked');
    const seatLocked = seatState === 'locked';
    statusSummary = `seat=${config.seatId}, state=${seatState}`;

    const cleanup = await unlockAndVerifySeat(config);
    unlockOk = cleanup.ok;
    cleanupSummary = `status=${cleanup.status}, afterState=${cleanup.afterState}`;

    return {
      name: 'Lua Lock Status Unlock Smoke',
      ok: locked && seatLocked && unlockOk,
      summary: `lock=${locked ? 'PASS' : 'FAIL'}, status=${statusSummary}, unlock=${unlockOk ? 'PASS' : 'FAIL'} (${cleanupSummary})`,
    };
  } finally {
    if (locked && !unlockOk) {
      await unlockAndVerifySeat(config).catch(() => undefined);
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

function isJoinedPayload(payload, showtimeId) {
  return payload === showtimeId
    || payload?.data === showtimeId
    || payload?.showtimeId === showtimeId;
}

function isJoinErrorPayload(payload) {
  return payload?.event === 'error' || payload?.error || payload?.message;
}

function summarizeSocketPayload(payload) {
  try {
    return redact(JSON.stringify(payload));
  } catch {
    return redact(String(payload));
  }
}

async function joinShowtime(socket, showtimeId) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settle(reject, new Error(`Timed out waiting for join-showtime acknowledgement: ${showtimeId}`));
    }, SOCKET_JOIN_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('joined', onJoined);
      socket.off('error', onError);
    }

    function settle(done, value) {
      if (settled) return;
      settled = true;
      cleanup();
      done(value);
    }

    function onJoined(payload) {
      if (isJoinedPayload(payload, showtimeId)) {
        settle(resolve, payload);
      }
    }

    function onError(payload) {
      settle(
        reject,
        new Error(`join-showtime failed: ${summarizeSocketPayload(payload)}`),
      );
    }

    socket.on('joined', onJoined);
    socket.on('error', onError);
    socket.emit('join-showtime', showtimeId, (ack) => {
      if (isJoinedPayload(ack, showtimeId)) {
        settle(resolve, ack);
      } else if (isJoinErrorPayload(ack)) {
        settle(
          reject,
          new Error(`join-showtime ack failed: ${summarizeSocketPayload(ack)}`),
        );
      }
    });
  });
}

function readSocketInstanceLogs(config, cloudRun, clientIds, sinceIso) {
  const filter = [
    ...cloudRunRevisionFilter(config, cloudRun),
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

async function lookupSocketInstances(config, cloudRun, clientIds, sinceIso) {
  const deadline = Date.now() + LOG_LOOKUP_TIMEOUT_MS;
  let latest = new Map();

  while (Date.now() < deadline) {
    await sleep(LOG_LOOKUP_INTERVAL_MS);
    latest = readSocketInstanceLogs(config, cloudRun, clientIds, sinceIso);

    if (clientIds.every((clientId) => latest.has(clientId))) {
      return latest;
    }
  }

  return latest;
}

function socketClientIds(sockets) {
  return sockets.map((socket) => socket.id).filter(Boolean);
}

function distinctKnownInstances(instanceMap) {
  return [...new Set([...instanceMap.values()].filter((value) => value !== 'unknown'))];
}

function selectDistinctInstancePair(sockets, instanceMap) {
  const byInstance = new Map();
  for (const socket of sockets) {
    const instanceId = instanceMap.get(socket.id);
    if (!instanceId || instanceId === 'unknown' || byInstance.has(instanceId)) {
      continue;
    }
    byInstance.set(instanceId, socket);
  }

  const entries = [...byInstance.entries()];
  if (entries.length < 2) {
    return null;
  }

  return [
    { instanceId: entries[0][0], socket: entries[0][1] },
    { instanceId: entries[1][0], socket: entries[1][1] },
  ];
}

async function connectUntilDistinctInstancePair(config, cloudRun, sinceIso, sockets) {
  const deadline = Date.now() + INSTANCE_PROOF_TIMEOUT_MS;
  let instanceMap = new Map();
  let pair = null;

  while (!pair && Date.now() < deadline && sockets.length < MAX_SOCKET_CLIENTS) {
    const socket = await connectSocket(config, `client-${sockets.length + 1}`);
    sockets.push(socket);
    await joinShowtime(socket, config.showtimeId);
    instanceMap = await lookupSocketInstances(config, cloudRun, socketClientIds(sockets), sinceIso);
    pair = selectDistinctInstancePair(sockets, instanceMap);
  }

  while (!pair && Date.now() < deadline) {
    instanceMap = await lookupSocketInstances(config, cloudRun, socketClientIds(sockets), sinceIso);
    pair = selectDistinctInstancePair(sockets, instanceMap);
  }

  return { instanceMap, pair };
}

async function checkSocketIo(config, cloudRun) {
  const minInstances = Number.parseInt(String(cloudRun.minInstances ?? '0'), 10);
  const multiInstanceReady = Number.isFinite(minInstances) && minInstances >= 2;
  if (!multiInstanceReady) {
    return {
      name: 'Socket.IO Two-Instance Propagation',
      ok: false,
      summary: `preflight failed: min-instances=${cloudRun.minInstances}; set grabit-api temporary min-instances=2 and restore the recorded pre-state before approval`,
    };
  }
  const sinceIso = new Date().toISOString();
  const sockets = [];
  let lockDone = false;

  try {
    const { instanceMap, pair } = await connectUntilDistinctInstancePair(config, cloudRun, sinceIso, sockets);
    const instances = distinctKnownInstances(instanceMap);
    const instanceProof = Boolean(pair);

    if (!pair) {
      return {
        name: 'Socket.IO Two-Instance Propagation',
        ok: false,
        summary: `opened clients=${sockets.length}; min-instances=${cloudRun.minInstances}; distinct Cloud Run instance IDs=${instances.length}; no cross-instance client pair proven before ${INSTANCE_PROOF_TIMEOUT_MS}ms deadline; D-10=FAIL; D-13=FAIL`,
      };
    }

    const updateA = waitForSeatUpdate(pair[0].socket, config.seatId, 'locked');
    const updateB = waitForSeatUpdate(pair[1].socket, config.seatId, 'locked');

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

    const cleanup = await unlockAndVerifySeat(config);
    lockDone = !cleanup.ok;
    const selectedClients = pair
      .map((entry) => `${entry.socket.id}@${entry.instanceId}`)
      .join(',');

    return {
      name: 'Socket.IO Two-Instance Propagation',
      ok: multiInstanceReady && instanceProof && cleanup.ok,
      summary: `selected clients=${selectedClients}; opened clients=${sockets.length}; received seat-update=PASS; min-instances=${cloudRun.minInstances}; distinct Cloud Run instance IDs=${instances.length}; cleanup=${cleanup.ok ? 'PASS' : 'FAIL'} afterState=${cleanup.afterState}; D-10=${instanceProof ? 'PASS' : 'FAIL'}; D-13=${instanceProof ? 'PASS' : 'FAIL'}`,
    };
  } finally {
    if (lockDone) {
      await unlockAndVerifySeat(config).catch(() => undefined);
    }
    for (const socket of sockets) {
      socket.close();
    }
  }
}

async function checkLogs(config, cloudRun, sinceIso) {
  const keywordFilter = FAILURE_KEYWORDS.map((keyword) => `"${keyword}"`).join(' OR ');
  const filter = [
    ...cloudRunRevisionFilter(config, cloudRun),
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
  const sentryObservation = process.env.GRABIT_SMOKE_SENTRY_OBSERVATION?.trim();
  const sanitizedSentryObservation = sentryObservation
    ? redact(sentryObservation)
    : 'missing';

  return {
    name: 'Log And Sentry Cleanliness',
    ok: count === 0 && Boolean(sentryObservation),
    summary: `revision=${cloudRun.latestReadyRevisionName}; since=${sinceIso}; Cloud Logging failure keyword count=${count}; Sentry observation=${sanitizedSentryObservation}`,
  };
}

async function checkIdle(config, cloudRun) {
  await sleep(config.idleSeconds * 1000);
  const afterHealth = await captureCheck('Health Ping Smoke', () => checkHealth(config));
  const afterLua = await captureCheck('Lua Lock Status Unlock Smoke', () => checkLua(config));
  const afterSocket = await captureCheck('Socket.IO Two-Instance Propagation', () => checkSocketIo(config, cloudRun));
  return {
    name: 'Idle Reconnect Window',
    ok: afterHealth.ok && afterLua.ok && afterSocket.ok,
    summary: `wait=${config.idleSeconds}s; health=${afterHealth.ok ? 'PASS' : 'FAIL'}; lua=${afterLua.ok ? 'PASS' : 'FAIL'}; socketio=${afterSocket.ok ? 'PASS' : 'FAIL'}`,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackCloudRun(error) {
  return {
    ok: false,
    service: SERVICE_NAME,
    latestReadyRevisionName: 'unknown',
    traffic: [],
    declaredValkeyMode: 'unknown',
    redisUrlBinding: 'unknown',
    minInstances: 'unknown',
    vpcEgress: 'unknown',
    networkInterfaces: 'unknown',
    evidenceError: redact(error?.message ?? error),
  };
}

function fallbackMemorystore(config, error) {
  return {
    ok: false,
    instance: config.valkey.instance,
    state: 'unknown',
    mode: 'unknown',
    shardCount: 'unknown',
    engineVersion: 'unknown',
    replicaCount: null,
    maxmemoryPolicy: null,
    endpoints: [],
    maintenancePolicy: null,
    maintenanceSchedule: null,
    evidenceError: redact(error?.message ?? error),
  };
}

function captureEvidence(read, fallback) {
  try {
    return read();
  } catch (error) {
    return fallback(error);
  }
}

async function captureCheck(name, run) {
  try {
    return await run();
  } catch (error) {
    return {
      name,
      ok: false,
      summary: redact(error?.message ?? error),
    };
  }
}

async function runChecks(config) {
  const startedUtc = new Date().toISOString();
  const logSinceOverride = process.env.GRABIT_SMOKE_LOG_SINCE_UTC?.trim();
  if (config.check === 'logs' && !logSinceOverride) {
    throw new Error('GRABIT_SMOKE_LOG_SINCE_UTC is required for standalone --check logs');
  }
  if ((config.check === 'logs' || config.check === 'all') && !process.env.GRABIT_SMOKE_SENTRY_OBSERVATION?.trim()) {
    throw new Error('GRABIT_SMOKE_SENTRY_OBSERVATION is required for --check logs and --check all');
  }
  await validateFixture(config);
  const cloudRun = captureEvidence(() => getCloudRunEvidence(config), fallbackCloudRun);
  const memorystore = captureEvidence(() => getMemorystoreEvidence(config), (error) => fallbackMemorystore(config, error));
  const redisTarget = captureEvidence(() => readRedisUrlHost(config, cloudRun),
    (error) => ({ host: null, error: redact(error?.message ?? error) }));
  const maintenance = maintenanceOverlap(memorystore, config.valkey.salesOpenAt, config.valkey.protectedHours);
  const runtimeFailures = runtimeContractFailures(cloudRun, memorystore, config.valkey, redisTarget);
  if (cloudRun.evidenceError) {
    runtimeFailures.push(`Cloud Run evidence=${cloudRun.evidenceError}`);
  }
  if (memorystore.evidenceError) {
    runtimeFailures.push(`Memorystore evidence=${memorystore.evidenceError}`);
  }
  const modeContractOk = runtimeFailures.length === 0;
  const checks = [];

  if (config.check === 'health' || config.check === 'all') {
    checks.push(await captureCheck('Health Ping Smoke', () => checkHealth(config)));
  }
  if (config.check === 'lua' || config.check === 'all') {
    checks.push(await captureCheck('Lua Lock Status Unlock Smoke', () => checkLua(config)));
  }
  if (config.check === 'socketio' || config.check === 'all') {
    checks.push(await captureCheck('Socket.IO Two-Instance Propagation', () => checkSocketIo(config, cloudRun)));
  }
  if (config.check === 'idle' || config.check === 'all') {
    checks.push(await captureCheck('Idle Reconnect Window', () => checkIdle(config, cloudRun)));
  }
  if (config.check === 'logs' || config.check === 'all') {
    checks.push(await captureCheck('Log And Sentry Cleanliness', () => checkLogs(config, cloudRun, logSinceOverride || startedUtc)));
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
    valkey: config.valkey,
    redisTargetMatched: !redisTarget.error && !runtimeFailures.some((failure) => failure.startsWith('REDIS_URL host')),
    maintenance,
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
    `- Traffic split: ${formatTraffic(evidence.cloudRun.traffic)}`,
    `- latestReadyRevisionName serving 100% traffic: ${isLatestReadyServingAllTraffic(evidence.cloudRun) ? 'PASS' : 'FAIL'}`,
    `- Target URL host: ${evidence.targetHost}`,
    `- Valkey instance: ${evidence.memorystore.instance}`,
    `- Live Memorystore mode: ${evidence.memorystore.mode}`,
    `- Expected live mode: ${evidence.valkey.liveModes.join(' | ')}`,
    `- VALKEY_MODE=${evidence.valkey.mode} observed: ${evidence.cloudRun.declaredValkeyMode === evidence.valkey.mode ? 'PASS' : `FAIL (${evidence.cloudRun.declaredValkeyMode})`}`,
    `- REDIS_URL secret host is a writable endpoint of ${evidence.memorystore.instance}: ${evidence.redisTargetMatched ? 'PASS' : 'FAIL'} (host value not recorded)`,
    `- Replicas per shard: ${evidence.memorystore.replicaCount ?? 'unknown'} (minimum ${evidence.valkey.minReplicas})`,
    `- maxmemory-policy: ${evidence.memorystore.maxmemoryPolicy ?? 'engine-default'} (expected ${evidence.valkey.maxmemoryPolicy})`,
    `- Sales opening: ${evidence.valkey.salesOpenAt ? `${evidence.valkey.salesOpenAt.toISOString()} (protected ${evidence.valkey.protectedHours}h)` : 'none declared'}`,
    `- Maintenance overlap: ${evidence.maintenance.evaluated ? (evidence.maintenance.failures.length ? `FAIL (${evidence.maintenance.failures.join('; ')})` : 'PASS') : 'not evaluated (GRABIT_SALES_OPEN_AT=none)'}`,
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
    `| Production Runtime Contract | ${evidence.modeContractOk ? 'PASS' : 'FAIL'} | ${evidence.runtimeContractFailures.length > 0 ? `failures=${evidence.runtimeContractFailures.join('; ')}` : `instance=${evidence.memorystore.instance}, live=${evidence.memorystore.mode}, declared=${evidence.cloudRun.declaredValkeyMode}, replicas=${evidence.memorystore.replicaCount}, maxmemory-policy=${evidence.memorystore.maxmemoryPolicy}, REDIS_URL=${evidence.cloudRun.redisUrlBinding} (endpoint match), VPC=${evidence.cloudRun.vpcEgress}`} |`,
    ...evidence.checks.map((check) => `| ${check.name} | ${check.ok ? 'PASS' : 'FAIL'} | ${redact(check.summary)} |`),
    `| Final automated smoke result | ${evidence.overallOk ? 'PASS' : 'FAIL'} | Sentry dashboard/API observation must still be recorded by the operator before final phase approval. |`,
    '',
  ];

  await mkdir(dirname(evidence.artifactPath), { recursive: true });
  await appendFile(evidence.artifactPath, redact(lines.join('\n')), 'utf8');
}

function isEntrypoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
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
    valkeyInstance: evidence.memorystore.instance,
    valkeyMode: evidence.memorystore.mode,
    declaredValkeyMode: evidence.cloudRun.declaredValkeyMode,
    replicaCount: evidence.memorystore.replicaCount,
    maxmemoryPolicy: evidence.memorystore.maxmemoryPolicy,
    redisTargetMatched: evidence.redisTargetMatched,
    runtimeContractFailures: evidence.runtimeContractFailures,
    checks: evidence.checks.map((check) => ({ name: check.name, ok: check.ok })),
    overallOk: evidence.overallOk,
  }, null, 2)));
  process.exit(evidence.overallOk ? 0 : 1);
}

if (isEntrypoint()) {
  try {
    await main();
  } catch (error) {
    console.error(redact((error).stack ?? (error).message ?? error));
    process.exit(1);
  }
}
