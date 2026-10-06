// Deploy-time guards for .github/workflows/deploy.yml.
//
// The pure functions are covered by deploy-guards.test.mjs. The CLI commands are
// the only entry points the workflow uses:
//
//   node scripts/managed-demo/deploy-guards.mjs validate-config
//   node scripts/managed-demo/deploy-guards.mjs booking-gate --service NAME=FILE [...] [--snapshot KEY=NAME ...]
//   node scripts/managed-demo/deploy-guards.mjs booking-gate-value --service NAME=FILE
//        [--live-at-guard true|false|unreadable --revision-at-guard REVISION]
//   node scripts/managed-demo/deploy-guards.mjs db-preflight [--api-service-json FILE]
//   node scripts/managed-demo/deploy-guards.mjs runtime-env --target api
//
// Inputs come from the workflow environment (repository variables with
// defaults). Secret values are never printed.
import { appendFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_PACKAGE_JSON = join(REPO_ROOT, 'apps/api/package.json');
const MIGRATION_JOURNAL = join(
  REPO_ROOT,
  'apps/api/src/database/migrations/meta/_journal.json',
);

const DURATION_PATTERN = /^([1-9][0-9]*)(ms|s|min)$/;
const DURATION_UNIT_MS = { ms: 1, s: 1_000, min: 60_000, h: 3_600_000, d: 86_400_000 };

// Mirrors packages/shared/src/flags.ts parseBooleanFlag(value, false): the API,
// Web and worker treat anything that is not an explicit true value as closed.
const RUNTIME_TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const PREWARM_SCALING_SCOPES = new Set(['service', 'template']);
// Cloud Run revision names: lowercase letters, digits and hyphens. Anything else
// read back from a job output is treated as missing.
const REVISION_NAME_PATTERN = /^[a-z][a-z0-9-]{0,99}$/;
const SNAPSHOT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,30}$/;

// Mirror apps/api/src/modules/jobs/pgboss.provider.ts (asserted by the unit test).
const DEFAULT_PGBOSS_POOL_MAX_PROCESSING = 3;
const DEFAULT_PGBOSS_POOL_MAX_PRODUCER = 1;

/** Same parsing as the API's isBackgroundProcessingEnabled(): only "false" turns it off. */
function backgroundProcessingEnabled(value) {
  return typeof value !== 'string' || value.trim().toLowerCase() !== 'false';
}

export function parseStrictBoolean(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized === 'true' || normalized === true) return true;
  if (normalized === 'false' || normalized === false) return false;
  throw new Error(`${name} must be exactly "true" or "false"`);
}

function parseInteger(value, name, { min, max = Number.MAX_SAFE_INTEGER }) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '');
  if (!/^[0-9]+$/.test(text)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(text);
  if (parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseDuration(value, name, { minMs, maxMs }) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = DURATION_PATTERN.exec(text);
  if (!match) {
    throw new Error(`${name} must be a PostgreSQL duration such as 5s, 500ms or 2min`);
  }
  const ms = Number(match[1]) * DURATION_UNIT_MS[match[2]];
  if (ms < minMs || ms > maxMs) {
    throw new Error(`${name} must be between ${minMs}ms and ${maxMs}ms`);
  }
  return { text, ms };
}

const ISO_COUNTRY_LIST_PATTERN = /^[A-Za-z]{2}(\s*,\s*[A-Za-z]{2})*$/;

function parsePositiveIntegerText(value, name) {
  return String(parseInteger(value, name, { min: 1 }));
}

function parseNonNegativeIntegerText(value, name) {
  return String(parseInteger(value, name, { min: 0 }));
}

function parseStrictBooleanText(value, name) {
  return String(parseStrictBoolean(value, name));
}

function parseCountryListText(value, name) {
  const text = value.trim();
  if (!ISO_COUNTRY_LIST_PATTERN.test(text)) {
    throw new Error(`${name} must be comma-separated ISO 3166-1 alpha-2 codes`);
  }
  return text.split(',').map((country) => country.trim().toUpperCase()).join(',');
}

/**
 * Runtime settings the services read but the workflow passes only when the
 * repository variable is set (as `RUNTIME_<NAME>` in the workflow env). Unset
 * keeps the code default, which can differ per process: the pg-boss pool is 3
 * with background processing and 1 for a producer-only API, so a fixed
 * workflow default would change the managed-demo API's connection count. The
 * connection budget derives each process's pg-boss cap the same way.
 */
export const OPTIONAL_RUNTIME_ENV = [
  { name: 'PGBOSS_POOL_MAX', targets: ['api', 'worker'], parse: parsePositiveIntegerText },
  { name: 'PGBOSS_START_MAX_ATTEMPTS', targets: ['api', 'worker'], parse: parsePositiveIntegerText },
  { name: 'DB_STATEMENT_TIMEOUT_MS', targets: ['api', 'worker'], parse: parsePositiveIntegerText },
  {
    name: 'DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS',
    targets: ['api', 'worker'],
    parse: parsePositiveIntegerText,
  },
  // w2a abandoned handoff review (on unless 'false'); the first rollout runbook stages it.
  {
    name: 'PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED',
    targets: ['api', 'worker'],
    parse: parseStrictBooleanText,
  },
  { name: 'SMS_ALLOWED_COUNTRIES', targets: ['api'], parse: parseCountryListText },
  { name: 'SMS_GLOBAL_SEND_LIMIT_PER_MINUTE', targets: ['api'], parse: parseNonNegativeIntegerText },
  { name: 'SMS_GLOBAL_SEND_LIMIT_PER_HOUR', targets: ['api'], parse: parseNonNegativeIntegerText },
  { name: 'SMS_LOCAL_RATE_LIMITS_ENABLED', targets: ['api'], parse: parseStrictBooleanText },
];

const RUNTIME_ENV_TARGETS = new Set(['api', 'worker']);

/**
 * `[name, value]` pairs of the optional runtime settings that are set for a
 * target. Blank means unset. Invalid values fail the deploy here instead of
 * failing every new instance at startup.
 */
export function resolveOptionalRuntimeEnv(env, target) {
  if (!RUNTIME_ENV_TARGETS.has(target)) {
    throw new Error('runtime env target must be "api" or "worker"');
  }
  const pairs = [];
  for (const setting of OPTIONAL_RUNTIME_ENV) {
    if (!setting.targets.includes(target)) continue;
    const raw = env[`RUNTIME_${setting.name}`];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    pairs.push([setting.name, setting.parse(String(raw), `RUNTIME_${setting.name}`)]);
  }
  return pairs;
}

/**
 * `env_vars` lines for google-github-actions/deploy-cloudrun. Its parser splits
 * on newlines and unescaped commas, so `\` and `,` in values are escaped.
 */
export function formatCloudRunEnvVarLines(pairs) {
  return pairs
    .map(([name, value]) => `${name}=${String(value).replace(/[\\,]/g, (ch) => `\\${ch}`)}`)
    .join('\n');
}

/**
 * Validates every repository-variable driven deploy input before any job
 * mutates the database or Cloud Run.
 */
export function validateDeployConfig(env) {
  const bookingEnabled = parseStrictBoolean(env.BOOKING_ENABLED, 'BOOKING_ENABLED');
  const migrationLockTimeout = parseDuration(
    env.MIGRATION_LOCK_TIMEOUT,
    'MIGRATION_LOCK_TIMEOUT',
    { minMs: 1_000, maxMs: 30_000 },
  );
  const migrationStatementTimeout = parseDuration(
    env.MIGRATION_STATEMENT_TIMEOUT,
    'MIGRATION_STATEMENT_TIMEOUT',
    { minMs: 5_000, maxMs: 15 * 60_000 },
  );
  if (migrationLockTimeout.ms >= migrationStatementTimeout.ms) {
    throw new Error('MIGRATION_LOCK_TIMEOUT must be shorter than MIGRATION_STATEMENT_TIMEOUT');
  }

  const apiMinInstances = parseInteger(env.API_MIN_INSTANCES, 'API_MIN_INSTANCES', { min: 0 });
  const apiMaxInstances = parseInteger(env.API_MAX_INSTANCES, 'API_MAX_INSTANCES', { min: 1 });
  if (apiMinInstances > apiMaxInstances) {
    throw new Error('API_MIN_INSTANCES must not exceed API_MAX_INSTANCES');
  }

  const prewarmScalingScope =
    typeof env.PREWARM_SCALING_SCOPE === 'string' ? env.PREWARM_SCALING_SCOPE.trim() : '';
  if (!PREWARM_SCALING_SCOPES.has(prewarmScalingScope)) {
    throw new Error('PREWARM_SCALING_SCOPE must be exactly "service" or "template"');
  }

  const runtimeEnv = {
    api: resolveOptionalRuntimeEnv(env, 'api'),
    worker: resolveOptionalRuntimeEnv(env, 'worker'),
  };
  // The pg-boss pool cap each process really uses: the runtime value when the
  // repository variable is set, otherwise the code default. The managed-demo API
  // is producer-only (1); the worker Job always processes jobs (3). With the
  // variable unset, db-preflight also reads the live API service, which can still
  // carry a value from an earlier deploy (resolveApiPgBossPoolCap).
  const runtimePgBossPoolMax = (target) => {
    const pair = runtimeEnv[target].find(([name]) => name === 'PGBOSS_POOL_MAX');
    return pair ? Number(pair[1]) : null;
  };
  const apiPgBossPoolMaxFromVariable = runtimePgBossPoolMax('api') !== null;
  const apiPgBossPoolMax =
    runtimePgBossPoolMax('api') ??
    (backgroundProcessingEnabled(env.BACKGROUND_PROCESSING_ENABLED)
      ? DEFAULT_PGBOSS_POOL_MAX_PROCESSING
      : DEFAULT_PGBOSS_POOL_MAX_PRODUCER);
  const workerPgBossPoolMax = runtimePgBossPoolMax('worker') ?? DEFAULT_PGBOSS_POOL_MAX_PROCESSING;

  return {
    bookingEnabled,
    prewarmScalingScope,
    runtimeEnv,
    migrationLockTimeout,
    migrationStatementTimeout,
    migrationFreeze: parseStrictBoolean(env.MIGRATION_FREEZE, 'MIGRATION_FREEZE'),
    apiMinInstances,
    apiMaxInstances,
    apiConcurrency: parseInteger(env.API_CONCURRENCY, 'API_CONCURRENCY', { min: 1, max: 1_000 }),
    dbPoolMax: parseInteger(env.DB_POOL_MAX, 'DB_POOL_MAX', { min: 1 }),
    apiPgBossPoolMax,
    apiPgBossPoolMaxFromVariable,
    workerPgBossPoolMax,
    dbConnectionReserve: parseInteger(env.DB_CONNECTION_RESERVE, 'DB_CONNECTION_RESERVE', {
      min: 0,
    }),
    dbConnectionBudgetEnforce: parseStrictBoolean(
      env.DB_CONNECTION_BUDGET_ENFORCE,
      'DB_CONNECTION_BUDGET_ENFORCE',
    ),
  };
}

/**
 * PGOPTIONS for every migration-job session. node-postgres (used by
 * drizzle-kit migrate) reads PGOPTIONS when the connection string has no
 * `options` parameter, so the single migration transaction fails fast instead
 * of queueing hot-table traffic behind an ACCESS EXCLUSIVE lock request.
 */
export function buildMigrationPgOptions(config) {
  return [
    `-c lock_timeout=${config.migrationLockTimeout.text}`,
    `-c statement_timeout=${config.migrationStatementTimeout.text}`,
  ].join(' ');
}

/** Converts a PostgreSQL `current_setting()` duration (e.g. `5s`, `0`) to ms. */
export function postgresSettingToMs(value) {
  const text = String(value ?? '').trim();
  if (text === '0') return 0;
  const match = /^([0-9]+)(ms|s|min|h|d)?$/.exec(text);
  if (!match) {
    throw new Error(`Unrecognized PostgreSQL duration setting: ${text}`);
  }
  return Number(match[1]) * DURATION_UNIT_MS[match[2] ?? 'ms'];
}

/** Reads a plain env value from `gcloud run services describe --format=json`. */
export function readServiceEnvValue(serviceDescription, name) {
  const containers = serviceDescription?.spec?.template?.spec?.containers;
  if (!Array.isArray(containers)) {
    return { found: false, value: undefined };
  }
  for (const container of containers) {
    for (const entry of container?.env ?? []) {
      if (entry?.name !== name) continue;
      return {
        found: true,
        value: typeof entry.value === 'string' ? entry.value : undefined,
        fromSecret: entry.value === undefined && entry.valueFrom !== undefined,
      };
    }
  }
  return { found: false, value: undefined };
}

export function runtimeBookingEnabled(rawValue) {
  return typeof rawValue === 'string' && RUNTIME_TRUE_VALUES.has(rawValue.trim().toLowerCase());
}

/**
 * `status.latestCreatedRevisionName` from the v1 describe JSON. Any env or
 * template update (including a gcloud kill-switch close) creates a revision; a
 * service-level prewarm scaling change does not.
 */
export function readServiceRevision(serviceDescription) {
  const name = serviceDescription?.status?.latestCreatedRevisionName;
  return typeof name === 'string' && REVISION_NAME_PATTERN.test(name) ? name : null;
}

/** Job-output form of one service's state as the migrate guard saw it. */
export function formatGuardSnapshot(service) {
  let live = 'unreadable';
  if (service.readable) live = runtimeBookingEnabled(service.rawValue) ? 'true' : 'false';
  return { live, revision: service.revision ?? '' };
}

/**
 * Reads the snapshot back in a deploy job. Missing job outputs arrive as empty
 * strings, and anything unexpected is treated as unreadable.
 */
export function parseGuardSnapshot(live, revision) {
  const liveText = typeof live === 'string' ? live.trim() : '';
  const revisionText = typeof revision === 'string' ? revision.trim() : '';
  return {
    readable: liveText === 'true' || liveText === 'false',
    liveEnabled: liveText === 'true',
    revision: REVISION_NAME_PATTERN.test(revisionText) ? revisionText : null,
  };
}

/**
 * Decides whether a deploy may apply `target` as the sitewide booking gate.
 *
 * Closing (target=false) is always allowed, but closing a live-open service is
 * reported as a warning because it stops sales sitewide. Opening a service
 * whose live runtime is closed, or whose live state cannot be read, requires
 * an explicit manual dispatch with allow_booking_reopen=true. This keeps a
 * gcloud-only emergency close from being silently undone by the next main push.
 */
export function evaluateBookingGate({ target, services, allowReopen }) {
  const lines = [];
  const warnings = [];
  const reopenBlocked = [];

  for (const service of services) {
    if (!service.readable) {
      lines.push(`${service.name}: live state unreadable -> target ${target}`);
      if (target) reopenBlocked.push({ name: service.name, liveLabel: 'state unreadable' });
      continue;
    }

    const liveEnabled = runtimeBookingEnabled(service.rawValue);
    const liveLabel = service.rawValue === undefined ? 'unset (closed)' : String(liveEnabled);
    lines.push(`${service.name}: live ${liveLabel} -> target ${target}`);
    if (target && !liveEnabled) {
      reopenBlocked.push({ name: service.name, liveLabel });
    }
    if (!target && liveEnabled) {
      warnings.push(closingWarning(service.name));
    }
  }

  const blockedList = reopenBlocked.map(({ name, liveLabel }) => `${name} (live ${liveLabel})`).join(', ');
  if (reopenBlocked.length > 0 && !allowReopen) {
    return {
      ok: false,
      lines,
      warnings,
      message:
        `Refusing to reopen sitewide booking on ${blockedList}. ` +
        'Set repository variable BOOKING_ENABLED=false to keep the gate closed, or ' +
        'reopen deliberately via a manual Deploy dispatch with allow_booking_reopen=true ' +
        'after the opening evidence gates pass.',
    };
  }

  let message = 'Sitewide booking stays open on every service.';
  if (!target) {
    message = 'Sitewide booking gate target is false: this deploy keeps or makes booking closed.';
  } else if (reopenBlocked.length > 0) {
    message = `Sitewide booking reopen explicitly approved for ${blockedList}.`;
    // An approved reopen is as visible as a close.
    for (const { name, liveLabel } of reopenBlocked) {
      warnings.push(
        `${name}: this deploy REOPENS sitewide booking (live ${liveLabel} -> true) because the run ` +
          'was dispatched with allow_booking_reopen=true. A close made on this service later in ' +
          'the run is kept closed.',
      );
    }
  }
  return { ok: true, lines, warnings, message };
}

function closingWarning(name) {
  return (
    `${name}: this deploy CLOSES sitewide booking (live true -> false) because repository ` +
    'variable BOOKING_ENABLED is false. If sales should stay open, cancel this run and set ' +
    'BOOKING_ENABLED=true first.'
  );
}

/**
 * Chooses the BOOKING_ENABLED value one deploy job writes, re-reading the live
 * service immediately before `deploy-cloudrun`. The migrate-job guard runs
 * minutes earlier; an operator may close the gate with gcloud while images
 * build and the worker smoke runs. Without this re-check the API/Web deploy
 * would write the stale `true` and silently reopen sales.
 *
 * - target false: write false (warn when this closes a live-open service).
 * - target true, live open: write true.
 * - target true, live closed, no approval: keep it closed (write false) and
 *   warn, so an in-flight hotfix still ships without undoing the close.
 * - target true, live unreadable, no approval: fail the step without
 *   deploying, because guessing either value is unsafe during a sale.
 * - target true, reopen approved: see resolveApprovedReopen. `atGuard` is the
 *   migrate guard's snapshot of this service from the start of the run.
 */
export function resolveDeployBookingValue({ target, service, allowReopen, atGuard }) {
  if (!target) {
    const liveOpen = service.readable && runtimeBookingEnabled(service.rawValue);
    return {
      ok: true,
      value: false,
      warning: liveOpen ? closingWarning(service.name) : null,
      message: `${service.name}: deploying BOOKING_ENABLED=false.`,
    };
  }

  if (allowReopen) {
    return resolveApprovedReopen({ service, atGuard });
  }

  if (!service.readable) {
    return {
      ok: false,
      value: null,
      warning: null,
      message:
        `${service.name}: live BOOKING_ENABLED is unreadable right before deploy; refusing to ` +
        'guess the sitewide booking gate. Re-run the deploy, or dispatch it with ' +
        'allow_booking_reopen=true after confirming booking may be open.',
    };
  }

  if (!runtimeBookingEnabled(service.rawValue)) {
    return {
      ok: true,
      value: false,
      warning:
        `${service.name}: live BOOKING_ENABLED is closed but repository variable BOOKING_ENABLED ` +
        'is true. Keeping the service closed (deploying false). Set the variable to false, or ' +
        'reopen deliberately with a manual dispatch and allow_booking_reopen=true.',
      message: `${service.name}: deploying BOOKING_ENABLED=false (live close preserved).`,
    };
  }

  return {
    ok: true,
    value: true,
    warning: null,
    message: `${service.name}: deploying BOOKING_ENABLED=true.`,
  };
}

/**
 * allow_booking_reopen=true approves reopening the gate that was closed when
 * the run started. It does not approve undoing a close an operator made while
 * the run was in progress (the gcloud kill switch), so the live value right
 * before deploy is compared with the migrate guard's snapshot:
 *
 * - live open now: write true (nothing to reopen).
 * - live closed now and open at the start: closed during the run, keep false.
 * - live closed now and at the start, but a different latest revision: the
 *   service was updated during the run (for example reopened and closed again),
 *   keep false.
 * - live closed now and at the start, same revision: the intended reopen,
 *   write true with a warning.
 * - live value unreadable now but open at the start: the approval covers only
 *   services that were closed when the run started, so this one has nothing to
 *   reopen and may have been closed during the run. Fail without deploying.
 * - snapshot or revision unreadable, or live value unreadable for a service
 *   closed at the start (or without a readable snapshot): write true as
 *   approved, with a warning that a close during the run could not be ruled out.
 */
function resolveApprovedReopen({ service, atGuard }) {
  const approvedMessage = `${service.name}: deploying BOOKING_ENABLED=true (reopen explicitly approved).`;
  const unverified = (reason) => ({
    ok: true,
    value: true,
    warning:
      `${service.name}: this deploy REOPENS sitewide booking under allow_booking_reopen=true, but it ` +
      `could not verify that the service was not closed during this run (${reason}). Check the ` +
      'runtime flag after the run and close again with the kill switch if needed.',
    message: approvedMessage,
  });

  if (!service.readable) {
    if (atGuard?.readable && atGuard.liveEnabled) {
      return {
        ok: false,
        value: null,
        warning: null,
        message:
          `${service.name}: live BOOKING_ENABLED unreadable right before deploy; it was open when ` +
          "this run started, so this run's reopen approval does not cover it. Refusing to guess. " +
          'Re-run the deploy once the service can be read.',
      };
    }
    return unverified('live value unreadable right before deploy');
  }
  if (runtimeBookingEnabled(service.rawValue)) {
    return {
      ok: true,
      value: true,
      warning: null,
      message: `${service.name}: deploying BOOKING_ENABLED=true (already open).`,
    };
  }
  if (!atGuard?.readable) return unverified('no readable migrate-guard snapshot');

  const keepClosed = (why) => ({
    ok: true,
    value: false,
    warning:
      `${service.name}: live BOOKING_ENABLED is closed and ${why}. Keeping it closed (deploying ` +
      'false) although this run has allow_booking_reopen=true. Dispatch a new reopen run if sales ' +
      'should open.',
    message: `${service.name}: deploying BOOKING_ENABLED=false (close made during the run preserved).`,
  });
  if (atGuard.liveEnabled) return keepClosed('it was open when this run started, so it was closed during this run');
  if (!atGuard.revision || !service.revision) return unverified('revision unknown');
  if (atGuard.revision !== service.revision) {
    return keepClosed(
      `the service changed during this run (revision ${atGuard.revision} -> ${service.revision})`,
    );
  }

  return {
    ok: true,
    value: true,
    warning:
      `${service.name}: this deploy REOPENS sitewide booking (live false -> true) under ` +
      `allow_booking_reopen=true; the service is unchanged since the run started (${service.revision}).`,
    message: approvedMessage,
  };
}

/** Same comparison as drizzle-orm's pg migrator (`created_at < folderMillis`). */
export function findPendingMigrations(journal, lastAppliedMillis) {
  if (!Array.isArray(journal?.entries)) {
    throw new Error('Migration journal has no entries array');
  }
  return journal.entries
    .filter((entry) => lastAppliedMillis === null || lastAppliedMillis < Number(entry.when))
    .map((entry) => ({ tag: String(entry.tag), when: Number(entry.when) }));
}

export function evaluateMigrationFreeze({ freeze, pending }) {
  if (pending.length === 0) {
    return { ok: true, warning: null, message: 'No pending migrations.' };
  }
  const tags = pending.map((entry) => entry.tag).join(', ');
  if (freeze) {
    return {
      ok: false,
      warning: null,
      message:
        `MIGRATION_FREEZE=true blocks ${pending.length} pending migration(s): ${tags}. ` +
        'Merge schema changes outside the ticket-opening window, or lift the freeze ' +
        'deliberately after reviewing hot-table lock impact.',
    };
  }
  // lock_timeout/statement_timeout bound each statement, not the transaction:
  // a lock taken by an earlier migration stays held until the last one commits.
  const warning =
    pending.length > 1
      ? `${pending.length} pending migrations run in one transaction; a lock taken by an ` +
        'earlier migration is held until the last statement commits (PostgreSQL 16 has no ' +
        'transaction_timeout). Deploy hot-table DDL alone, outside sales hours.'
      : null;
  return { ok: true, warning, message: `${pending.length} pending migration(s): ${tags}.` };
}

/**
 * Worst-case PostgreSQL connection demand of the deployed posture.
 * Each API instance and the single worker task own one app pool (DB_POOL_MAX)
 * plus one pg-boss pool. The pg-boss cap differs per process: the runtime
 * PGBOSS_POOL_MAX when set, otherwise 3 with background processing and 1 for a
 * producer-only API (the managed-demo API). The worker Job always processes jobs.
 *
 * The count covers one revision's instances. While a deploy rolls out, old
 * and new revision instances overlap briefly; that headroom must come from
 * DB_CONNECTION_RESERVE (or the deploy must avoid peak traffic).
 */
export function estimateConnectionDemand({
  apiMaxInstances,
  dbPoolMax,
  apiPgBossPoolMax,
  workerPgBossPoolMax,
  workerTasks = 1,
  reserve,
}) {
  const api = apiMaxInstances * (dbPoolMax + apiPgBossPoolMax);
  const worker = workerTasks * (dbPoolMax + workerPgBossPoolMax);
  return {
    api,
    worker,
    reserve,
    required: api + worker + reserve,
    formula:
      `API ${apiMaxInstances} x (${dbPoolMax} app + ${apiPgBossPoolMax} pg-boss) = ${api}, ` +
      `worker ${workerTasks} x (${dbPoolMax} app + ${workerPgBossPoolMax} pg-boss) = ${worker}, ` +
      `reserve ${reserve}`,
  };
}

export function evaluateConnectionBudget({
  maxConnections,
  reservedConnections,
  apiMaxInstances,
  dbPoolMax,
  apiPgBossPoolMax,
  workerPgBossPoolMax,
  workerTasks = 1,
  reserve,
  enforce,
}) {
  const demand = estimateConnectionDemand({
    apiMaxInstances,
    dbPoolMax,
    apiPgBossPoolMax,
    workerPgBossPoolMax,
    workerTasks,
    reserve,
  });
  const { required } = demand;
  const available = maxConnections - reservedConnections;
  const overBudget = required > available;
  const message =
    `DB connection budget: ${demand.formula}, required ${required} / available ${available} ` +
    `(max_connections ${maxConnections} - reserved ${reservedConnections}). ` +
    'Assumes no old/new revision overlap; DB_CONNECTION_RESERVE must cover rollout overlap.';

  return {
    ok: !overBudget || !enforce,
    overBudget,
    required,
    available,
    message,
  };
}

/**
 * The API pg-boss cap the connection budget counts, given the live API service
 * (`gcloud run services describe --format=json`, or null when it could not be
 * read).
 *
 * deploy-cloudrun merges env vars into the API service, so a PGBOSS_POOL_MAX
 * written by an earlier deploy stays after the repository variable is removed,
 * and the API keeps that pool. The worker Job is rebuilt on every deploy, so its
 * cap is the variable or the code default and never this live value.
 *
 * - variable set: the deploy writes it, so it is the cap.
 * - variable unset, live value present: count max(live, code default) and warn.
 *   The warning asks for the live value to be removed, so the budget must hold
 *   both before and after that removal.
 * - variable unset, no live value: the code default.
 * - variable unset, service unreadable (or a secret-bound or invalid live
 *   value): the code default, with a notice that a live value was not ruled out.
 */
export function resolveApiPgBossPoolCap({ config, apiService, serviceName = 'grabit-api', region }) {
  const codeDefault = config.apiPgBossPoolMax;
  if (config.apiPgBossPoolMaxFromVariable) {
    return {
      apiPgBossPoolMax: config.apiPgBossPoolMax,
      source: 'workflow',
      annotation: null,
      line: `API pg-boss cap ${config.apiPgBossPoolMax} (repository variable PGBOSS_POOL_MAX)`,
    };
  }

  const unchecked = (why) => ({
    apiPgBossPoolMax: codeDefault,
    source: 'code-default',
    annotation:
      `::notice::${why}; the connection budget counts the API pg-boss code default ${codeDefault}. ` +
      `A PGBOSS_POOL_MAX left on ${serviceName} by an earlier deploy would raise the real cap ` +
      `(check with gcloud run services describe ${serviceName}).`,
    line: `API pg-boss cap ${codeDefault} (code default; live ${serviceName} value not checked)`,
  });
  if (!apiService) return unchecked(`Could not read the live ${serviceName} service`);

  const live = readServiceEnvValue(apiService, 'PGBOSS_POOL_MAX');
  if (!live.found) {
    return {
      apiPgBossPoolMax: codeDefault,
      source: 'code-default',
      annotation: null,
      line: `API pg-boss cap ${codeDefault} (code default; ${serviceName} has no PGBOSS_POOL_MAX)`,
    };
  }
  const liveText = typeof live.value === 'string' ? live.value.trim() : '';
  if (!/^[1-9][0-9]*$/.test(liveText)) {
    return unchecked(
      live.fromSecret
        ? `Live ${serviceName} PGBOSS_POOL_MAX is secret-bound`
        : `Live ${serviceName} PGBOSS_POOL_MAX is not a positive integer`,
    );
  }

  const liveValue = Number(liveText);
  const counted = Math.max(liveValue, codeDefault);
  const regionFlag = region ? ` --region=${region}` : '';
  return {
    apiPgBossPoolMax: counted,
    source: 'live',
    annotation:
      `::warning::${serviceName} still has PGBOSS_POOL_MAX=${liveValue} from an earlier deploy. ` +
      'Repository variable PGBOSS_POOL_MAX is unset, and deploys merge env vars into the API ' +
      `service, so the API keeps that pool. The connection budget counts the API pg-boss cap as ` +
      `${counted} (the larger of the live value and the code default ${codeDefault}). If the code ` +
      `default is intended, remove it: gcloud run services update ${serviceName}${regionFlag} ` +
      '--remove-env-vars=PGBOSS_POOL_MAX',
    line:
      `API pg-boss cap ${counted} (live ${serviceName} PGBOSS_POOL_MAX=${liveValue} left by an ` +
      `earlier deploy, code default ${codeDefault})`,
  };
}

/**
 * Turns the migration-session readback into the preflight verdict. Every
 * failing check is collected, so one run reports all blockers at once.
 * `apiPgBossPoolCap` is resolveApiPgBossPoolCap()'s result; without it the
 * budget counts `config.apiPgBossPoolMax` as is.
 */
export function evaluateDbPreflight({ config, settings, journal, lastAppliedMillis, apiPgBossPoolCap }) {
  const failures = [];
  const annotations = [];
  const lines = ['### Database preflight'];

  lines.push(
    `- Migration session lock_timeout ${settings.lock_timeout}, statement_timeout ${settings.statement_timeout}`,
  );
  let sessionLockMs = null;
  let sessionStatementMs = null;
  try {
    sessionLockMs = postgresSettingToMs(settings.lock_timeout);
    sessionStatementMs = postgresSettingToMs(settings.statement_timeout);
  } catch {
    // An unrecognized readback is treated like a missing PGOPTIONS.
  }
  if (
    sessionLockMs !== config.migrationLockTimeout.ms ||
    sessionStatementMs !== config.migrationStatementTimeout.ms
  ) {
    failures.push(
      'PGOPTIONS was not applied to the migration session; refusing to run migrations without lock_timeout/statement_timeout.',
    );
  }

  const pending = findPendingMigrations(journal, lastAppliedMillis);
  const freeze = evaluateMigrationFreeze({ freeze: config.migrationFreeze, pending });
  lines.push(`- ${freeze.message}`);
  if (!freeze.ok) failures.push(freeze.message);
  if (freeze.warning) {
    lines.push(`- ${freeze.warning}`);
    annotations.push(`::warning::${freeze.warning}`);
  }

  if (apiPgBossPoolCap) {
    lines.push(`- ${apiPgBossPoolCap.line}`);
    if (apiPgBossPoolCap.annotation) annotations.push(apiPgBossPoolCap.annotation);
  }
  const budget = evaluateConnectionBudget({
    maxConnections: Number(settings.max_connections),
    reservedConnections: Number(settings.superuser_reserved) + Number(settings.reserved),
    apiMaxInstances: config.apiMaxInstances,
    dbPoolMax: config.dbPoolMax,
    apiPgBossPoolMax: apiPgBossPoolCap?.apiPgBossPoolMax ?? config.apiPgBossPoolMax,
    workerPgBossPoolMax: config.workerPgBossPoolMax,
    reserve: config.dbConnectionReserve,
    enforce: config.dbConnectionBudgetEnforce,
  });
  lines.push(`- ${budget.message}`);
  if (budget.overBudget) {
    annotations.push(`${budget.ok ? '::warning::' : '::error::'}${budget.message} Over budget.`);
    if (!budget.ok) failures.push(`${budget.message} DB_CONNECTION_BUDGET_ENFORCE=true.`);
  }

  return { ok: failures.length === 0, failures, annotations, lines, pending };
}

async function writeSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, `${lines.join('\n')}\n`);
}

async function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  await appendFile(outputPath, `${name}=${value}\n`);
}

async function writeMultilineOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}:\n${value}`);
    return;
  }
  const delimiter = `EOF_${name.toUpperCase()}_${Date.now()}`;
  await appendFile(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function exportEnv(name, value) {
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) {
    console.log(`${name}=${value}`);
    return;
  }
  await appendFile(envPath, `${name}=${value}\n`);
}

function parseArgs(args, { allowSnapshot = false, allowGuardSnapshot = false } = {}) {
  const services = [];
  const snapshots = [];
  const guard = { live: undefined, revision: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--service') {
      index += 1;
      const separator = value?.indexOf('=') ?? -1;
      if (!value || separator <= 0) {
        throw new Error('--service expects NAME=DESCRIBE_JSON_PATH');
      }
      services.push({ name: value.slice(0, separator), path: value.slice(separator + 1) });
      continue;
    }
    if (arg === '--snapshot' && allowSnapshot) {
      index += 1;
      const separator = value?.indexOf('=') ?? -1;
      const key = separator > 0 ? value.slice(0, separator) : '';
      if (!SNAPSHOT_KEY_PATTERN.test(key) || !value.slice(separator + 1)) {
        throw new Error('--snapshot expects KEY=SERVICE_NAME with a lowercase output key');
      }
      snapshots.push({ key, name: value.slice(separator + 1) });
      continue;
    }
    if ((arg === '--live-at-guard' || arg === '--revision-at-guard') && allowGuardSnapshot) {
      // Empty strings are valid: a missing job output expands to "".
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} expects a value (may be empty)`);
      }
      index += 1;
      guard[arg === '--live-at-guard' ? 'live' : 'revision'] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { services, snapshots, guard };
}

async function readServiceDescription(path) {
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function commandValidateConfig() {
  const config = validateDeployConfig(process.env);
  await exportEnv('PGOPTIONS', buildMigrationPgOptions(config));
  const lines = [
    '### Deploy configuration',
    `- BOOKING_ENABLED target: ${config.bookingEnabled}`,
    `- Migration lock_timeout ${config.migrationLockTimeout.text}, statement_timeout ${config.migrationStatementTimeout.text}, freeze ${config.migrationFreeze}`,
    `- API instances ${config.apiMinInstances}-${config.apiMaxInstances}, concurrency ${config.apiConcurrency}`,
    `- Prewarm scaling scope ${config.prewarmScalingScope}`,
    `- pg-boss pool cap counted by the connection budget: API ${config.apiPgBossPoolMax}` +
      `${config.apiPgBossPoolMaxFromVariable ? '' : ' (db-preflight also counts a value left on the live API service)'}` +
      `, worker ${config.workerPgBossPoolMax}`,
    `- Optional runtime settings: API ${describeRuntimeEnv(config.runtimeEnv.api)}; worker ${describeRuntimeEnv(config.runtimeEnv.worker)}`,
  ];
  console.log(lines.slice(1).join('\n'));
  await writeSummary(lines);
}

function describeRuntimeEnv(pairs) {
  return pairs.length === 0
    ? 'code defaults'
    : pairs.map(([name, value]) => `${name}=${value}`).join(', ');
}

async function commandRuntimeEnv(args) {
  if (args.length !== 2 || args[0] !== '--target') {
    throw new Error('runtime-env expects --target api|worker');
  }
  const config = validateDeployConfig(process.env);
  const pairs = config.runtimeEnv[args[1]];
  if (!pairs) {
    throw new Error('runtime env target must be "api" or "worker"');
  }
  await writeMultilineOutput('env_vars', formatCloudRunEnvVarLines(pairs));
  console.log(`Optional runtime settings (${args[1]}): ${describeRuntimeEnv(pairs)}`);
}

function readAllowReopen() {
  return parseStrictBoolean(process.env.ALLOW_BOOKING_REOPEN ?? 'false', 'ALLOW_BOOKING_REOPEN');
}

async function readServiceGateInput(service) {
  const description = await readServiceDescription(service.path);
  const envValue = description ? readServiceEnvValue(description, 'BOOKING_ENABLED') : null;
  return {
    name: service.name,
    readable: Boolean(description) && !envValue?.fromSecret,
    rawValue: envValue?.value,
    revision: description ? readServiceRevision(description) : null,
  };
}

async function commandBookingGate(args) {
  const config = validateDeployConfig(process.env);
  const allowReopen = readAllowReopen();
  const { services, snapshots } = parseArgs(args, { allowSnapshot: true });
  if (services.length === 0) {
    throw new Error('booking-gate requires at least one --service');
  }
  for (const snapshot of snapshots) {
    if (!services.some((service) => service.name === snapshot.name)) {
      throw new Error(`--snapshot names a service without --service: ${snapshot.name}`);
    }
  }

  const inputs = [];
  for (const service of services) {
    inputs.push(await readServiceGateInput(service));
  }

  const result = evaluateBookingGate({
    target: config.bookingEnabled,
    services: inputs,
    allowReopen,
  });
  console.log(result.lines.join('\n'));
  for (const warning of result.warnings) {
    console.log(`::warning::${warning}`);
  }
  await writeSummary([
    '### Sitewide booking gate',
    ...result.lines.map((line) => `- ${line}`),
    ...result.warnings.map((warning) => `- **Warning:** ${warning}`),
    result.message,
  ]);
  if (!result.ok) {
    throw new Error(result.message);
  }
  // Start-of-run state for the deploy jobs (job outputs), so an approved reopen
  // can tell its own target from a close made later in the run.
  for (const snapshot of snapshots) {
    const input = inputs.find((service) => service.name === snapshot.name);
    const { live, revision } = formatGuardSnapshot(input);
    await writeOutput(`${snapshot.key}_live`, live);
    await writeOutput(`${snapshot.key}_revision`, revision);
  }
  console.log(result.message);
}

async function commandBookingGateValue(args) {
  const config = validateDeployConfig(process.env);
  const allowReopen = readAllowReopen();
  const { services, guard } = parseArgs(args, { allowGuardSnapshot: true });
  if (services.length !== 1) {
    throw new Error('booking-gate-value requires exactly one --service');
  }

  const service = await readServiceGateInput(services[0]);
  const atGuard =
    guard.live === undefined && guard.revision === undefined
      ? undefined
      : parseGuardSnapshot(guard.live, guard.revision);
  const result = resolveDeployBookingValue({
    target: config.bookingEnabled,
    service,
    allowReopen,
    atGuard,
  });
  if (result.warning) {
    console.log(`::warning::${result.warning}`);
  }
  await writeSummary([
    `### Booking gate at deploy (${service.name})`,
    `- ${result.message}`,
    ...(result.warning ? [`- **Warning:** ${result.warning}`] : []),
  ]);
  if (!result.ok) {
    throw new Error(result.message);
  }
  await writeOutput('booking_enabled', String(result.value));
  console.log(result.message);
}

function loadPg() {
  const requireFromApi = createRequire(API_PACKAGE_JSON);
  return requireFromApi('pg');
}

function parseDbPreflightArgs(args) {
  if (args.length === 0) return { apiServicePath: null };
  if (args.length === 2 && args[0] === '--api-service-json' && args[1] && !args[1].startsWith('--')) {
    return { apiServicePath: args[1] };
  }
  throw new Error('db-preflight accepts only --api-service-json DESCRIBE_JSON_PATH');
}

async function commandDbPreflight(args) {
  const config = validateDeployConfig(process.env);
  const { apiServicePath } = parseDbPreflightArgs(args);
  // Missing or empty (the booking guard could not describe the service) is unreadable.
  const apiService = apiServicePath ? await readServiceDescription(apiServicePath) : null;
  const apiPgBossPoolCap = resolveApiPgBossPoolCap({
    config,
    apiService,
    serviceName: process.env.API_SERVICE || 'grabit-api',
    region: process.env.GCP_REGION,
  });
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const journal = JSON.parse(await readFile(MIGRATION_JOURNAL, 'utf8'));
  const pg = loadPg();
  const client = new pg.Client({ connectionString });
  await client.connect();
  let settings;
  let lastAppliedMillis = null;
  try {
    const settingsResult = await client.query(`
      SELECT current_setting('max_connections')::int AS max_connections,
             current_setting('superuser_reserved_connections')::int AS superuser_reserved,
             coalesce(current_setting('reserved_connections', true), '0')::int AS reserved,
             current_setting('lock_timeout') AS lock_timeout,
             current_setting('statement_timeout') AS statement_timeout,
             to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS has_migrations_table
    `);
    settings = settingsResult.rows[0];
    if (settings.has_migrations_table) {
      const lastResult = await client.query(
        'SELECT max(created_at)::text AS last_applied FROM drizzle.__drizzle_migrations',
      );
      const lastApplied = lastResult.rows[0]?.last_applied;
      lastAppliedMillis = lastApplied === null || lastApplied === undefined ? null : Number(lastApplied);
    }
  } finally {
    await client.end();
  }

  const result = evaluateDbPreflight({ config, settings, journal, lastAppliedMillis, apiPgBossPoolCap });
  for (const annotation of result.annotations) {
    console.log(annotation);
  }
  console.log(result.lines.slice(1).join('\n'));
  await writeSummary(result.lines);
  if (!result.ok) {
    throw new Error(result.failures.join('\n'));
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'validate-config':
      if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(', ')}`);
      return commandValidateConfig();
    case 'booking-gate':
      return commandBookingGate(args);
    case 'booking-gate-value':
      return commandBookingGateValue(args);
    case 'db-preflight':
      return commandDbPreflight(args);
    case 'runtime-env':
      return commandRuntimeEnv(args);
    default:
      throw new Error(
        'Usage: deploy-guards.mjs <validate-config|booking-gate|booking-gate-value|db-preflight|runtime-env>',
      );
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
