// Deploy-time guards for .github/workflows/deploy.yml.
//
// The pure functions are covered by deploy-guards.test.mjs. The CLI commands are
// the only entry points the workflow uses:
//
//   node scripts/managed-demo/deploy-guards.mjs validate-config
//   node scripts/managed-demo/deploy-guards.mjs booking-gate --service NAME=FILE [...]
//   node scripts/managed-demo/deploy-guards.mjs db-preflight
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

  return {
    bookingEnabled,
    migrationLockTimeout,
    migrationStatementTimeout,
    migrationFreeze: parseStrictBoolean(env.MIGRATION_FREEZE, 'MIGRATION_FREEZE'),
    apiMinInstances,
    apiMaxInstances,
    apiConcurrency: parseInteger(env.API_CONCURRENCY, 'API_CONCURRENCY', { min: 1, max: 1_000 }),
    dbPoolMax: parseInteger(env.DB_POOL_MAX, 'DB_POOL_MAX', { min: 1 }),
    pgBossPoolMax: parseInteger(env.PGBOSS_POOL_MAX, 'PGBOSS_POOL_MAX', { min: 1 }),
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
 * Decides whether a deploy may apply `target` as the sitewide booking gate.
 *
 * Closing (target=false) is always allowed. Opening a service whose live
 * runtime is closed, or whose live state cannot be read, requires an explicit
 * manual dispatch with allow_booking_reopen=true. This keeps a gcloud-only
 * emergency close from being silently undone by the next main push.
 */
export function evaluateBookingGate({ target, services, allowReopen }) {
  const lines = [];
  const reopenBlocked = [];

  for (const service of services) {
    if (!service.readable) {
      lines.push(`${service.name}: live state unreadable -> target ${target}`);
      if (target) reopenBlocked.push(`${service.name} (live state unreadable)`);
      continue;
    }

    const liveEnabled = runtimeBookingEnabled(service.rawValue);
    const liveLabel = service.rawValue === undefined ? 'unset (closed)' : String(liveEnabled);
    lines.push(`${service.name}: live ${liveLabel} -> target ${target}`);
    if (target && !liveEnabled) {
      reopenBlocked.push(`${service.name} (live ${liveLabel})`);
    }
  }

  if (reopenBlocked.length > 0 && !allowReopen) {
    return {
      ok: false,
      lines,
      message:
        `Refusing to reopen sitewide booking on ${reopenBlocked.join(', ')}. ` +
        'Set repository variable BOOKING_ENABLED=false to keep the gate closed, or ' +
        'reopen deliberately via a manual Deploy dispatch with allow_booking_reopen=true ' +
        'after the opening evidence gates pass.',
    };
  }

  let message = 'Sitewide booking stays open on every service.';
  if (!target) {
    message = 'Sitewide booking gate target is false: this deploy keeps or makes booking closed.';
  } else if (reopenBlocked.length > 0) {
    message = `Sitewide booking reopen explicitly approved for ${reopenBlocked.join(', ')}.`;
  }
  return { ok: true, lines, message };
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
    return { ok: true, message: 'No pending migrations.' };
  }
  const tags = pending.map((entry) => entry.tag).join(', ');
  if (freeze) {
    return {
      ok: false,
      message:
        `MIGRATION_FREEZE=true blocks ${pending.length} pending migration(s): ${tags}. ` +
        'Merge schema changes outside the ticket-opening window, or lift the freeze ' +
        'deliberately after reviewing hot-table lock impact.',
    };
  }
  return { ok: true, message: `${pending.length} pending migration(s): ${tags}.` };
}

/**
 * Worst-case PostgreSQL connection demand of the deployed posture.
 * Each API instance and the single worker task own one app pool (DB_POOL_MAX)
 * plus one pg-boss pool (PGBOSS_POOL_MAX, pg-boss default 10 unless the API
 * code sets a smaller max).
 */
export function evaluateConnectionBudget({
  maxConnections,
  reservedConnections,
  apiMaxInstances,
  dbPoolMax,
  pgBossPoolMax,
  workerTasks = 1,
  reserve,
  enforce,
}) {
  const perProcess = dbPoolMax + pgBossPoolMax;
  const api = apiMaxInstances * perProcess;
  const worker = workerTasks * perProcess;
  const required = api + worker + reserve;
  const available = maxConnections - reservedConnections;
  const overBudget = required > available;
  const message =
    `DB connection budget: API ${apiMaxInstances} x (${dbPoolMax} app + ${pgBossPoolMax} pg-boss) = ${api}, ` +
    `worker ${worker}, reserve ${reserve}, required ${required} / available ${available} ` +
    `(max_connections ${maxConnections} - reserved ${reservedConnections}).`;

  return {
    ok: !overBudget || !enforce,
    overBudget,
    required,
    available,
    message,
  };
}

async function writeSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, `${lines.join('\n')}\n`);
}

async function exportEnv(name, value) {
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) {
    console.log(`${name}=${value}`);
    return;
  }
  await appendFile(envPath, `${name}=${value}\n`);
}

function parseArgs(args) {
  const services = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--service') {
      const spec = args[index + 1];
      index += 1;
      const separator = spec?.indexOf('=') ?? -1;
      if (!spec || separator <= 0) {
        throw new Error('--service expects NAME=DESCRIBE_JSON_PATH');
      }
      services.push({ name: spec.slice(0, separator), path: spec.slice(separator + 1) });
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { services };
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
  ];
  console.log(lines.slice(1).join('\n'));
  await writeSummary(lines);
}

async function commandBookingGate(args) {
  const config = validateDeployConfig(process.env);
  const allowReopen = parseStrictBoolean(
    process.env.ALLOW_BOOKING_REOPEN ?? 'false',
    'ALLOW_BOOKING_REOPEN',
  );
  const { services } = parseArgs(args);
  if (services.length === 0) {
    throw new Error('booking-gate requires at least one --service');
  }

  const inputs = [];
  for (const service of services) {
    const description = await readServiceDescription(service.path);
    const envValue = description ? readServiceEnvValue(description, 'BOOKING_ENABLED') : null;
    inputs.push({
      name: service.name,
      readable: Boolean(description) && !envValue?.fromSecret,
      rawValue: envValue?.value,
    });
  }

  const result = evaluateBookingGate({
    target: config.bookingEnabled,
    services: inputs,
    allowReopen,
  });
  console.log(result.lines.join('\n'));
  await writeSummary(['### Sitewide booking gate', ...result.lines.map((line) => `- ${line}`), result.message]);
  if (!result.ok) {
    throw new Error(result.message);
  }
  console.log(result.message);
}

function loadPg() {
  const requireFromApi = createRequire(API_PACKAGE_JSON);
  return requireFromApi('pg');
}

async function commandDbPreflight() {
  const config = validateDeployConfig(process.env);
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

  const failures = [];
  const lines = ['### Database preflight'];

  const sessionLockMs = postgresSettingToMs(settings.lock_timeout);
  const sessionStatementMs = postgresSettingToMs(settings.statement_timeout);
  lines.push(
    `- Migration session lock_timeout ${settings.lock_timeout}, statement_timeout ${settings.statement_timeout}`,
  );
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

  const budget = evaluateConnectionBudget({
    maxConnections: settings.max_connections,
    reservedConnections: settings.superuser_reserved + settings.reserved,
    apiMaxInstances: config.apiMaxInstances,
    dbPoolMax: config.dbPoolMax,
    pgBossPoolMax: config.pgBossPoolMax,
    reserve: config.dbConnectionReserve,
    enforce: config.dbConnectionBudgetEnforce,
  });
  lines.push(`- ${budget.message}`);
  if (budget.overBudget) {
    const annotation = budget.ok ? '::warning::' : '::error::';
    console.log(`${annotation}${budget.message} Over budget.`);
    if (!budget.ok) failures.push(`${budget.message} DB_CONNECTION_BUDGET_ENFORCE=true.`);
  }

  console.log(lines.slice(1).join('\n'));
  await writeSummary(lines);
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
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
    case 'db-preflight':
      if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(', ')}`);
      return commandDbPreflight();
    default:
      throw new Error('Usage: deploy-guards.mjs <validate-config|booking-gate|db-preflight>');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
