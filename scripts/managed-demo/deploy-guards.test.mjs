import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildMigrationPgOptions,
  evaluateBookingGate,
  evaluateConnectionBudget,
  evaluateMigrationFreeze,
  findPendingMigrations,
  parseStrictBoolean,
  postgresSettingToMs,
  readServiceEnvValue,
  runtimeBookingEnabled,
  validateDeployConfig,
} from './deploy-guards.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Workflow defaults from .github/workflows/deploy.yml when no repository variable is set.
const workflowDefaults = {
  BOOKING_ENABLED: 'true',
  MIGRATION_LOCK_TIMEOUT: '5s',
  MIGRATION_STATEMENT_TIMEOUT: '60s',
  MIGRATION_FREEZE: 'false',
  API_MIN_INSTANCES: '1',
  API_MAX_INSTANCES: '40',
  API_CONCURRENCY: '250',
  DB_POOL_MAX: '4',
  PGBOSS_POOL_MAX: '10',
  DB_CONNECTION_RESERVE: '5',
  DB_CONNECTION_BUDGET_ENFORCE: 'false',
};

function describeService(env) {
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    spec: { template: { spec: { containers: [{ image: 'img', env }] } } },
  };
}

test('validates workflow defaults and builds fail-fast migration session options', () => {
  const config = validateDeployConfig(workflowDefaults);

  assert.equal(config.bookingEnabled, true);
  assert.equal(buildMigrationPgOptions(config), '-c lock_timeout=5s -c statement_timeout=60s');
});

test('rejects unsafe or ambiguous deploy inputs before any mutation', () => {
  const invalid = [
    [{ BOOKING_ENABLED: 'flase' }, /BOOKING_ENABLED must be exactly/],
    [{ BOOKING_ENABLED: 'yes' }, /BOOKING_ENABLED must be exactly/],
    [{ MIGRATION_LOCK_TIMEOUT: '0' }, /MIGRATION_LOCK_TIMEOUT must be a PostgreSQL duration/],
    [{ MIGRATION_LOCK_TIMEOUT: '5s -c search_path=evil' }, /MIGRATION_LOCK_TIMEOUT must be a PostgreSQL duration/],
    [{ MIGRATION_LOCK_TIMEOUT: '10min' }, /MIGRATION_LOCK_TIMEOUT must be between/],
    [{ MIGRATION_LOCK_TIMEOUT: '30s', MIGRATION_STATEMENT_TIMEOUT: '20s' }, /must be shorter/],
    [{ API_MIN_INSTANCES: '5', API_MAX_INSTANCES: '4' }, /API_MIN_INSTANCES must not exceed/],
    [{ API_CONCURRENCY: '0' }, /API_CONCURRENCY must be between/],
    [{ MIGRATION_FREEZE: 'on' }, /MIGRATION_FREEZE must be exactly/],
  ];

  for (const [override, pattern] of invalid) {
    assert.throws(() => validateDeployConfig({ ...workflowDefaults, ...override }), pattern);
  }
  assert.throws(() => parseStrictBoolean(undefined, 'X'), /X must be exactly/);
});

test('reads BOOKING_ENABLED from gcloud describe JSON with runtime semantics', () => {
  assert.deepEqual(
    readServiceEnvValue(describeService([{ name: 'BOOKING_ENABLED', value: 'false' }]), 'BOOKING_ENABLED'),
    { found: true, value: 'false', fromSecret: false },
  );
  assert.equal(
    readServiceEnvValue(describeService([{ name: 'OTHER', value: 'x' }]), 'BOOKING_ENABLED').found,
    false,
  );
  assert.equal(
    readServiceEnvValue(
      describeService([{ name: 'BOOKING_ENABLED', valueFrom: { secretKeyRef: { name: 's' } } }]),
      'BOOKING_ENABLED',
    ).fromSecret,
    true,
  );

  // Same truthy set as packages/shared parseBooleanFlag(value, false).
  assert.equal(runtimeBookingEnabled('TRUE'), true);
  assert.equal(runtimeBookingEnabled('on'), true);
  assert.equal(runtimeBookingEnabled('false'), false);
  assert.equal(runtimeBookingEnabled(undefined), false);
  assert.equal(runtimeBookingEnabled('maybe'), false);
});

test('a push deploy cannot silently reopen a gate an operator closed with gcloud', () => {
  const closedByOperator = [
    { name: 'grabit-api', readable: true, rawValue: 'false' },
    { name: 'grabit-web', readable: true, rawValue: 'true' },
  ];

  const blocked = evaluateBookingGate({ target: true, services: closedByOperator, allowReopen: false });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /Refusing to reopen sitewide booking on grabit-api/);

  const approved = evaluateBookingGate({ target: true, services: closedByOperator, allowReopen: true });
  assert.equal(approved.ok, true);
  assert.match(approved.message, /explicitly approved/);
});

test('closing the gate or keeping it open never needs approval', () => {
  const open = [
    { name: 'grabit-api', readable: true, rawValue: 'true' },
    { name: 'grabit-web', readable: true, rawValue: 'true' },
  ];
  assert.equal(evaluateBookingGate({ target: true, services: open, allowReopen: false }).ok, true);
  assert.equal(evaluateBookingGate({ target: false, services: open, allowReopen: false }).ok, true);

  const unreadable = [{ name: 'grabit-api', readable: false, rawValue: undefined }];
  assert.equal(evaluateBookingGate({ target: false, services: unreadable, allowReopen: false }).ok, true);
  assert.equal(evaluateBookingGate({ target: true, services: unreadable, allowReopen: false }).ok, false);
  // An existing service without the variable runs closed (shared default false).
  const unset = [{ name: 'grabit-web', readable: true, rawValue: undefined }];
  assert.equal(evaluateBookingGate({ target: true, services: unset, allowReopen: false }).ok, false);
});

test('detects pending migrations with the drizzle migrator comparison', async () => {
  const journal = JSON.parse(
    await readFile(join(REPO_ROOT, 'apps/api/src/database/migrations/meta/_journal.json'), 'utf8'),
  );
  const last = journal.entries.at(-1);
  const previous = journal.entries.at(-2);

  assert.deepEqual(findPendingMigrations(journal, Number(last.when)), []);
  assert.deepEqual(findPendingMigrations(journal, Number(previous.when)), [
    { tag: last.tag, when: Number(last.when) },
  ]);
  assert.equal(findPendingMigrations(journal, null).length, journal.entries.length);
});

test('migration freeze blocks only deploys that would apply migrations', () => {
  const pending = [{ tag: '0099_hot_table_ddl', when: 1 }];
  assert.equal(evaluateMigrationFreeze({ freeze: true, pending: [] }).ok, true);
  assert.equal(evaluateMigrationFreeze({ freeze: false, pending }).ok, true);
  const frozen = evaluateMigrationFreeze({ freeze: true, pending });
  assert.equal(frozen.ok, false);
  assert.match(frozen.message, /0099_hot_table_ddl/);
});

test('connection budget counts app pool plus pg-boss pool per API instance and worker', () => {
  const warmDefaults = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: 40,
    dbPoolMax: 4,
    pgBossPoolMax: 10,
    reserve: 5,
    enforce: false,
  });
  // 40 * (4 + 10) + (4 + 10) + 5 = 579 > 397: reported, not enforced by default.
  assert.equal(warmDefaults.required, 579);
  assert.equal(warmDefaults.overBudget, true);
  assert.equal(warmDefaults.ok, true);

  const enforced = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: 40,
    dbPoolMax: 4,
    pgBossPoolMax: 10,
    reserve: 5,
    enforce: true,
  });
  assert.equal(enforced.ok, false);

  const sized = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: 30,
    dbPoolMax: 8,
    pgBossPoolMax: 3,
    reserve: 10,
    enforce: true,
  });
  assert.equal(sized.required, 30 * 11 + 11 + 10);
  assert.equal(sized.ok, true);
});

test('parses PostgreSQL duration settings returned by current_setting()', () => {
  assert.equal(postgresSettingToMs('0'), 0);
  assert.equal(postgresSettingToMs('5s'), 5_000);
  assert.equal(postgresSettingToMs('1min'), 60_000);
  assert.equal(postgresSettingToMs('500ms'), 500);
  assert.throws(() => postgresSettingToMs('soon'), /Unrecognized/);
});

test('deploy workflow keeps the guarded deploy contract', async () => {
  const workflow = await readFile(join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf8');

  // #64/#137: one repository variable drives API, Web and worker; no hardcoded open gate.
  assert.doesNotMatch(workflow, /BOOKING_ENABLED=true\b/);
  assert.match(workflow, /BOOKING_ENABLED: \$\{\{ vars\.BOOKING_ENABLED \|\| 'true' \}\}/);
  assert.equal(workflow.match(/BOOKING_ENABLED=\$\{\{ env\.BOOKING_ENABLED \}\}/g)?.length, 2);
  assert.match(workflow, /deploy-guards\.mjs booking-gate/);

  // #60: migration sessions get lock/statement timeouts before drizzle-kit migrate runs.
  const validateIndex = workflow.indexOf('deploy-guards.mjs validate-config');
  const preflightIndex = workflow.indexOf('deploy-guards.mjs db-preflight');
  const migrateIndex = workflow.indexOf('exec drizzle-kit migrate');
  assert.ok(validateIndex > 0 && validateIndex < preflightIndex && preflightIndex < migrateIndex);

  // #7/#61: liveness on the Redis-only health route and an explicit WebSocket timeout.
  assert.match(workflow, /--liveness-probe=httpGet\.path=\/api\/v1\/health,httpGet\.port=8080,/);
  assert.match(workflow, /--startup-probe=httpGet\.path=\/api\/v1\/health,httpGet\.port=8080,/);
  assert.match(workflow, /--timeout=3600\b/);

  // #150: prewarm can never request more minimum instances than the API maximum.
  assert.match(workflow, /PREWARM_MAX_MIN_INSTANCES=\$\{\{ env\.API_MAX_INSTANCES \}\}/);
});
