import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildMigrationPgOptions,
  evaluateBookingGate,
  evaluateConnectionBudget,
  evaluateDbPreflight,
  evaluateMigrationFreeze,
  findPendingMigrations,
  formatCloudRunEnvVarLines,
  parseGuardSnapshot,
  parseStrictBoolean,
  postgresSettingToMs,
  readServiceEnvValue,
  readServiceRevision,
  resolveDeployBookingValue,
  resolveOptionalRuntimeEnv,
  runtimeBookingEnabled,
  validateDeployConfig,
} from './deploy-guards.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARDS_CLI = join(REPO_ROOT, 'scripts/managed-demo/deploy-guards.mjs');

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
  BACKGROUND_PROCESSING_ENABLED: 'true',
  DB_CONNECTION_RESERVE: '5',
  DB_CONNECTION_BUDGET_ENFORCE: 'false',
  PREWARM_SCALING_SCOPE: 'service',
};

function describeService(env, revision = 'grabit-api-00001-aaa') {
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    spec: { template: { spec: { containers: [{ image: 'img', env }] } } },
    ...(revision ? { status: { latestCreatedRevisionName: revision } } : {}),
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
    [{ PREWARM_SCALING_SCOPE: 'revision' }, /PREWARM_SCALING_SCOPE must be exactly/],
    [{ PREWARM_SCALING_SCOPE: undefined }, /PREWARM_SCALING_SCOPE must be exactly/],
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
  // An approved reopen is never silent either (audit D6).
  assert.equal(approved.warnings.length, 1);
  assert.match(approved.warnings[0], /^grabit-api: this deploy REOPENS sitewide booking \(live false -> true\)/);
});

test('closing the gate or keeping it open never needs approval', () => {
  const open = [
    { name: 'grabit-api', readable: true, rawValue: 'true' },
    { name: 'grabit-web', readable: true, rawValue: 'true' },
  ];
  const keepOpen = evaluateBookingGate({ target: true, services: open, allowReopen: false });
  assert.equal(keepOpen.ok, true);
  assert.deepEqual(keepOpen.warnings, []);

  // Closing is allowed but never silent: a push that closes live sales is annotated.
  const closing = evaluateBookingGate({ target: false, services: open, allowReopen: false });
  assert.equal(closing.ok, true);
  assert.equal(closing.warnings.length, 2);
  assert.match(closing.warnings[0], /grabit-api: this deploy CLOSES sitewide booking/);

  const unreadable = [{ name: 'grabit-api', readable: false, rawValue: undefined }];
  assert.equal(evaluateBookingGate({ target: false, services: unreadable, allowReopen: false }).ok, true);
  assert.equal(evaluateBookingGate({ target: true, services: unreadable, allowReopen: false }).ok, false);
  // An existing service without the variable runs closed (shared default false).
  const unset = [{ name: 'grabit-web', readable: true, rawValue: undefined }];
  assert.equal(evaluateBookingGate({ target: true, services: unset, allowReopen: false }).ok, false);
});

test('a close made while the deploy is running survives the later API/Web deploy step', () => {
  // The migrate-job guard saw live true. Minutes later, during the image build and worker
  // smoke, an operator ran the gcloud kill switch without changing the variable.
  const closedMidRun = { name: 'grabit-api', readable: true, rawValue: 'false' };
  const preserved = resolveDeployBookingValue({
    target: true,
    service: closedMidRun,
    allowReopen: false,
  });
  assert.equal(preserved.ok, true);
  assert.equal(preserved.value, false);
  assert.match(preserved.warning, /Keeping the service closed/);

  // Unreadable live state right before deploy: fail the step instead of guessing.
  const unreadable = resolveDeployBookingValue({
    target: true,
    service: { name: 'grabit-web', readable: false, rawValue: undefined },
    allowReopen: false,
  });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.value, null);
  assert.match(unreadable.message, /refusing to guess/);
});

const REV_START = 'grabit-api-00001-aaa';
const REV_CLOSED = 'grabit-api-00002-bbb';

test('a close made during an approved reopen run is kept closed (audit D6)', () => {
  // The migrate guard saw the API open; the on-call closed it with gcloud while the
  // images built. allow_booking_reopen=true must not undo that close.
  const closedMidRun = { name: 'grabit-api', readable: true, rawValue: 'false', revision: REV_CLOSED };
  const wasOpen = resolveDeployBookingValue({
    target: true,
    service: closedMidRun,
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: true, revision: REV_START },
  });
  assert.deepEqual([wasOpen.ok, wasOpen.value], [true, false]);
  assert.match(wasOpen.warning, /closed during this run/);

  // Closed at the start, then reopened and closed again (or otherwise updated) mid-run:
  // a new revision means someone changed the service after the guard read it.
  const changedWhileClosed = resolveDeployBookingValue({
    target: true,
    service: closedMidRun,
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: false, revision: REV_START },
  });
  assert.deepEqual([changedWhileClosed.ok, changedWhileClosed.value], [true, false]);
  assert.match(changedWhileClosed.warning, /changed during this run/);
});

test('an unchanged approved reopen opens the gate with a warning', () => {
  const closed = { name: 'grabit-web', readable: true, rawValue: 'false', revision: REV_START };
  const intended = resolveDeployBookingValue({
    target: true,
    service: closed,
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: false, revision: REV_START },
  });
  assert.deepEqual([intended.ok, intended.value], [true, true]);
  assert.match(intended.warning, /REOPENS sitewide booking/);
  assert.match(intended.message, /reopen explicitly approved/);

  // Without a readable snapshot the approved run still reopens, but says it could not verify.
  for (const atGuard of [undefined, parseGuardSnapshot('', ''), parseGuardSnapshot('unreadable', REV_START)]) {
    const unverified = resolveDeployBookingValue({ target: true, service: closed, allowReopen: true, atGuard });
    assert.deepEqual([unverified.ok, unverified.value], [true, true]);
    assert.match(unverified.warning, /could not verify/);
  }
  // A revision missing on either side cannot prove "unchanged" either.
  const noRevision = resolveDeployBookingValue({
    target: true,
    service: { ...closed, revision: null },
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: false, revision: REV_START },
  });
  assert.equal(noRevision.value, true);
  assert.match(noRevision.warning, /could not verify/);

  // Unreadable right before deploy: the approved run keeps its explicit reopen, loudly.
  const unreadableNow = resolveDeployBookingValue({
    target: true,
    service: { name: 'grabit-web', readable: false, rawValue: undefined, revision: null },
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: false, revision: REV_START },
  });
  assert.deepEqual([unreadableNow.ok, unreadableNow.value], [true, true]);
  assert.match(unreadableNow.warning, /could not verify/);

  // An already open service needs no reopen and stays quiet.
  const alreadyOpen = resolveDeployBookingValue({
    target: true,
    service: { ...closed, rawValue: 'true' },
    allowReopen: true,
    atGuard: { readable: true, liveEnabled: true, revision: REV_START },
  });
  assert.deepEqual([alreadyOpen.value, alreadyOpen.warning], [true, null]);
});

test('guard snapshots round-trip through job outputs without trusting arbitrary text', () => {
  assert.deepEqual(parseGuardSnapshot('true', REV_START), { readable: true, liveEnabled: true, revision: REV_START });
  assert.deepEqual(parseGuardSnapshot('false', ''), { readable: true, liveEnabled: false, revision: null });
  assert.deepEqual(parseGuardSnapshot('unreadable', 'Bad Rev'), { readable: false, liveEnabled: false, revision: null });
  assert.equal(parseGuardSnapshot('TRUE', REV_START).readable, false, 'only the guard formats are accepted');
  assert.equal(parseGuardSnapshot('false', 'rev\nEVIL=1').revision, null);
  assert.equal(readServiceRevision(describeService([], REV_CLOSED)), REV_CLOSED);
  assert.equal(readServiceRevision(describeService([], null)), null);
});

test('deploy-time booking value keeps an open gate open and annotates a close', () => {
  const live = { name: 'grabit-web', readable: true, rawValue: 'true' };
  const open = resolveDeployBookingValue({ target: true, service: live, allowReopen: false });
  assert.deepEqual([open.ok, open.value, open.warning], [true, true, null]);

  const close = resolveDeployBookingValue({ target: false, service: live, allowReopen: false });
  assert.deepEqual([close.ok, close.value], [true, false]);
  assert.match(close.warning, /CLOSES sitewide booking/);

  const alreadyClosed = resolveDeployBookingValue({
    target: false,
    service: { name: 'grabit-web', readable: false, rawValue: undefined },
    allowReopen: false,
  });
  assert.deepEqual([alreadyClosed.ok, alreadyClosed.value, alreadyClosed.warning], [true, false, null]);
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

  // Statement-level timeouts do not bound the whole migration transaction.
  assert.equal(evaluateMigrationFreeze({ freeze: false, pending }).warning, null);
  const batch = evaluateMigrationFreeze({
    freeze: false,
    pending: [...pending, { tag: '0100_backfill', when: 2 }],
  });
  assert.equal(batch.ok, true);
  assert.match(batch.warning, /held until the last statement commits/);
});

function preflightInput(overrides = {}) {
  const config = validateDeployConfig({ ...workflowDefaults, ...overrides.env });
  return {
    config,
    settings: {
      // Workflow defaults need 40 * (4 + 3) + (4 + 3) + 5 = 292 > 247 available.
      max_connections: 250,
      superuser_reserved: 3,
      reserved: 0,
      lock_timeout: '5s',
      statement_timeout: '1min',
      ...overrides.settings,
    },
    journal: { entries: [{ tag: '0001_a', when: 100 }, { tag: '0002_b', when: 200 }] },
    lastAppliedMillis: overrides.lastAppliedMillis ?? 200,
  };
}

test('db preflight collects every blocking check before migrations run', () => {
  // Defaults: PGOPTIONS applied, nothing pending, over budget but not enforced.
  const passing = evaluateDbPreflight(preflightInput());
  assert.equal(passing.ok, true);
  assert.deepEqual(passing.failures, []);
  assert.match(passing.annotations.join('\n'), /^::warning::DB connection budget/m);

  const blocked = evaluateDbPreflight(
    preflightInput({
      env: { MIGRATION_FREEZE: 'true', DB_CONNECTION_BUDGET_ENFORCE: 'true' },
      settings: { lock_timeout: '0', statement_timeout: '0' },
      lastAppliedMillis: 100,
    }),
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.failures.length, 3);
  assert.match(blocked.failures[0], /PGOPTIONS was not applied/);
  assert.match(blocked.failures[1], /MIGRATION_FREEZE=true blocks 1 pending migration/);
  assert.match(blocked.failures[2], /DB_CONNECTION_BUDGET_ENFORCE=true/);
  assert.match(blocked.annotations.join('\n'), /^::error::DB connection budget/m);

  const unparsable = evaluateDbPreflight(preflightInput({ settings: { lock_timeout: 'soon' } }));
  assert.equal(unparsable.ok, false);
  assert.match(unparsable.failures[0], /PGOPTIONS was not applied/);
});

test('connection budget counts app pool plus pg-boss pool per API instance and worker', () => {
  const warmDefaults = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: 40,
    dbPoolMax: 4,
    apiPgBossPoolMax: 10,
    workerPgBossPoolMax: 10,
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
    apiPgBossPoolMax: 10,
    workerPgBossPoolMax: 10,
    reserve: 5,
    enforce: true,
  });
  assert.equal(enforced.ok, false);

  const sized = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: 30,
    dbPoolMax: 8,
    apiPgBossPoolMax: 3,
    workerPgBossPoolMax: 3,
    reserve: 10,
    enforce: true,
  });
  assert.equal(sized.required, 30 * 11 + 11 + 10);
  assert.equal(sized.ok, true);
});

test('the deploy budget uses each process pg-boss cap, not one workflow value (x4 deploy-budget)', () => {
  // Managed demo: 4 producer-only API instances (pg-boss 1) plus the worker Job (pg-boss 3).
  // db-f1-micro allows 25 - 3 reserved = 22, so 17 + reserve 5 fits and must not warn.
  const demo = validateDeployConfig({
    ...workflowDefaults,
    API_MIN_INSTANCES: '0',
    API_MAX_INSTANCES: '4',
    DB_POOL_MAX: '2',
    BACKGROUND_PROCESSING_ENABLED: 'false',
  });
  assert.deepEqual([demo.apiPgBossPoolMax, demo.workerPgBossPoolMax], [1, 3]);
  const demoBudget = evaluateConnectionBudget({
    maxConnections: 25,
    reservedConnections: 3,
    apiMaxInstances: demo.apiMaxInstances,
    dbPoolMax: demo.dbPoolMax,
    apiPgBossPoolMax: demo.apiPgBossPoolMax,
    workerPgBossPoolMax: demo.workerPgBossPoolMax,
    reserve: demo.dbConnectionReserve,
    enforce: false,
  });
  assert.equal(demoBudget.required, 4 * (2 + 1) + (2 + 3) + 5);
  assert.equal(demoBudget.overBudget, false);
  assert.match(demoBudget.message, /API 4 x \(2 app \+ 1 pg-boss\) = 12, worker 1 x \(2 app \+ 3 pg-boss\) = 5/);
  const demoPreflight = evaluateDbPreflight({
    config: demo,
    settings: { max_connections: 25, superuser_reserved: 3, reserved: 0, lock_timeout: '5s', statement_timeout: '1min' },
    journal: { entries: [{ tag: '0001_a', when: 100 }] },
    lastAppliedMillis: 100,
  });
  assert.equal(demoPreflight.ok, true);
  assert.deepEqual(demoPreflight.annotations, [], 'no false over-budget warning on every managed-demo deploy');

  // Warm ticket-opening posture: every API instance processes jobs (pg-boss 3).
  const warm = validateDeployConfig(workflowDefaults);
  assert.deepEqual([warm.apiPgBossPoolMax, warm.workerPgBossPoolMax], [3, 3]);
  const warmBudget = evaluateConnectionBudget({
    maxConnections: 400,
    reservedConnections: 3,
    apiMaxInstances: warm.apiMaxInstances,
    dbPoolMax: warm.dbPoolMax,
    apiPgBossPoolMax: warm.apiPgBossPoolMax,
    workerPgBossPoolMax: warm.workerPgBossPoolMax,
    reserve: warm.dbConnectionReserve,
    enforce: false,
  });
  assert.equal(warmBudget.required, 40 * (4 + 3) + (4 + 3) + 5);

  // A set RUNTIME_PGBOSS_POOL_MAX is the real cap of both processes.
  const pinned = validateDeployConfig({
    ...workflowDefaults,
    BACKGROUND_PROCESSING_ENABLED: 'false',
    RUNTIME_PGBOSS_POOL_MAX: '2',
  });
  assert.deepEqual([pinned.apiPgBossPoolMax, pinned.workerPgBossPoolMax], [2, 2]);
  // Same parsing as the API: anything but "false" processes jobs.
  assert.equal(validateDeployConfig({ ...workflowDefaults, BACKGROUND_PROCESSING_ENABLED: ' FALSE ' }).apiPgBossPoolMax, 1);
  assert.equal(validateDeployConfig({ ...workflowDefaults, BACKGROUND_PROCESSING_ENABLED: undefined }).apiPgBossPoolMax, 3);
});

test('pg-boss budget defaults mirror the API code defaults', async () => {
  const source = await readFile(join(REPO_ROOT, 'apps/api/src/modules/jobs/pgboss.provider.ts'), 'utf8');
  const declared = (name) => Number(new RegExp(`\\b${name}\\s*=\\s*(\\d+);`).exec(source)?.[1]);
  const config = validateDeployConfig(workflowDefaults);
  assert.equal(config.apiPgBossPoolMax, declared('DEFAULT_PGBOSS_POOL_MAX_PROCESSING'));
  assert.equal(config.workerPgBossPoolMax, declared('DEFAULT_PGBOSS_POOL_MAX_PROCESSING'));
  assert.equal(
    validateDeployConfig({ ...workflowDefaults, BACKGROUND_PROCESSING_ENABLED: 'false' }).apiPgBossPoolMax,
    declared('DEFAULT_PGBOSS_POOL_MAX_PRODUCER'),
  );
});

test('parses PostgreSQL duration settings returned by current_setting()', () => {
  assert.equal(postgresSettingToMs('0'), 0);
  assert.equal(postgresSettingToMs('5s'), 5_000);
  assert.equal(postgresSettingToMs('1min'), 60_000);
  assert.equal(postgresSettingToMs('500ms'), 500);
  assert.throws(() => postgresSettingToMs('soon'), /Unrecognized/);
});

test('optional runtime settings reach a service only when their variable is set (u18a/u09b handoff)', () => {
  // Unset (workflow passes blank vars): every process keeps its code default, so the
  // producer-only API stays at 1 pg-boss connection instead of the budget input 3.
  assert.deepEqual(resolveOptionalRuntimeEnv(workflowDefaults, 'api'), []);
  assert.deepEqual(
    resolveOptionalRuntimeEnv({ ...workflowDefaults, RUNTIME_PGBOSS_POOL_MAX: '  ' }, 'worker'),
    [],
  );

  const env = {
    ...workflowDefaults,
    RUNTIME_PGBOSS_POOL_MAX: '2',
    RUNTIME_DB_STATEMENT_TIMEOUT_MS: '30000',
    RUNTIME_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: '120000',
    RUNTIME_SMS_ALLOWED_COUNTRIES: 'kr, th,CN',
    RUNTIME_SMS_LOCAL_RATE_LIMITS_ENABLED: 'true',
  };
  assert.deepEqual(resolveOptionalRuntimeEnv(env, 'api'), [
    ['PGBOSS_POOL_MAX', '2'],
    ['DB_STATEMENT_TIMEOUT_MS', '30000'],
    ['DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS', '120000'],
    ['SMS_ALLOWED_COUNTRIES', 'KR,TH,CN'],
    ['SMS_LOCAL_RATE_LIMITS_ENABLED', 'true'],
  ]);
  // SMS settings are API-only; the worker never sends SMS.
  assert.deepEqual(resolveOptionalRuntimeEnv(env, 'worker'), [
    ['PGBOSS_POOL_MAX', '2'],
    ['DB_STATEMENT_TIMEOUT_MS', '30000'],
    ['DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS', '120000'],
  ]);
});

test('optional runtime settings fail validation instead of failing every instance at startup', () => {
  for (const [env, pattern] of [
    [{ RUNTIME_DB_STATEMENT_TIMEOUT_MS: '0' }, /RUNTIME_DB_STATEMENT_TIMEOUT_MS must be between 1/],
    [{ RUNTIME_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: '2m' }, /must be an integer/],
    [{ RUNTIME_PGBOSS_START_MAX_ATTEMPTS: '-1' }, /must be an integer/],
    [{ RUNTIME_SMS_ALLOWED_COUNTRIES: 'KOR' }, /ISO 3166-1 alpha-2/],
    [{ RUNTIME_SMS_LOCAL_RATE_LIMITS_ENABLED: 'off' }, /must be exactly "true" or "false"/],
    [{ RUNTIME_PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED: 'no' }, /must be exactly "true" or "false"/],
    [{ RUNTIME_PGBOSS_POOL_MAX: '0' }, /RUNTIME_PGBOSS_POOL_MAX must be between 1/],
  ]) {
    assert.throws(() => validateDeployConfig({ ...workflowDefaults, ...env }), pattern);
  }
});

test('runtime env lines survive the deploy-cloudrun KEY=VALUE parser', () => {
  assert.equal(formatCloudRunEnvVarLines([]), '');
  assert.equal(
    formatCloudRunEnvVarLines([
      ['DB_STATEMENT_TIMEOUT_MS', '30000'],
      ['SMS_ALLOWED_COUNTRIES', 'KR,TH'],
    ]),
    'DB_STATEMENT_TIMEOUT_MS=30000\nSMS_ALLOWED_COUNTRIES=KR\\,TH',
  );
});

async function runGuards(args, { env = {}, files = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'deploy-guards-'));
  try {
    const paths = {
      GITHUB_ENV: join(dir, 'github-env'),
      GITHUB_OUTPUT: join(dir, 'github-output'),
      GITHUB_STEP_SUMMARY: join(dir, 'step-summary'),
    };
    for (const path of Object.values(paths)) await writeFile(path, '');
    const resolvedArgs = [];
    for (const arg of args) {
      const match = /^(.+)=@(.+)$/.exec(arg);
      if (match) {
        const filePath = join(dir, match[2]);
        await writeFile(filePath, files[match[2]] ?? '');
        resolvedArgs.push(`${match[1]}=${filePath}`);
      } else {
        resolvedArgs.push(arg);
      }
    }
    const result = spawnSync(process.execPath, [GUARDS_CLI, ...resolvedArgs], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...workflowDefaults, ...paths, ...env },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      githubEnv: await readFile(paths.GITHUB_ENV, 'utf8'),
      githubOutput: await readFile(paths.GITHUB_OUTPUT, 'utf8'),
      summary: await readFile(paths.GITHUB_STEP_SUMMARY, 'utf8'),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const liveJson = (value, revision = REV_START) =>
  JSON.stringify(describeService(value === undefined ? [] : [{ name: 'BOOKING_ENABLED', value }], revision));

test('CLI validate-config exports PGOPTIONS through GITHUB_ENV and rejects bad input', async () => {
  const ok = await runGuards(['validate-config']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.githubEnv, 'PGOPTIONS=-c lock_timeout=5s -c statement_timeout=60s\n');
  assert.match(ok.summary, /Prewarm scaling scope service/);

  const bad = await runGuards(['validate-config'], { env: { BOOKING_ENABLED: 'flase' } });
  assert.equal(bad.status, 1);
  assert.equal(bad.githubEnv, '');
  assert.match(bad.stderr, /BOOKING_ENABLED must be exactly/);
});

test('CLI booking-gate exit codes follow the reopen guard', async () => {
  const closedApi = { api: liveJson('false'), web: liveJson('true') };
  const args = ['booking-gate', '--service', 'grabit-api=@api', '--service', 'grabit-web=@web'];

  const refused = await runGuards(args, { files: closedApi });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to reopen sitewide booking on grabit-api/);

  const approved = await runGuards(args, { files: closedApi, env: { ALLOW_BOOKING_REOPEN: 'true' } });
  assert.equal(approved.status, 0, approved.stderr);
  assert.match(approved.stdout, /^::warning::grabit-api: this deploy REOPENS sitewide booking/m);
  assert.match(approved.summary, /REOPENS sitewide booking/);

  // The guard records each service's live state and revision for the deploy jobs.
  const snapshot = await runGuards(
    [...args, '--snapshot', 'api=grabit-api', '--snapshot', 'web=grabit-web'],
    { files: { api: liveJson('false', REV_START), web: liveJson('true', 'grabit-web-00007-xyz') }, env: { ALLOW_BOOKING_REOPEN: 'true' } },
  );
  assert.equal(snapshot.status, 0, snapshot.stderr);
  assert.equal(
    snapshot.githubOutput,
    `api_live=false\napi_revision=${REV_START}\nweb_live=true\nweb_revision=grabit-web-00007-xyz\n`,
  );
  const unreadableSnapshot = await runGuards(
    ['booking-gate', '--service', 'grabit-api=@api', '--snapshot', 'api=grabit-api'],
    { files: { api: '' }, env: { BOOKING_ENABLED: 'false' } },
  );
  assert.equal(unreadableSnapshot.status, 0, unreadableSnapshot.stderr);
  assert.equal(unreadableSnapshot.githubOutput, 'api_live=unreadable\napi_revision=\n');
  const unknownSnapshot = await runGuards([...args, '--snapshot', 'api=grabit-other'], { files: closedApi });
  assert.equal(unknownSnapshot.status, 1);
  assert.match(unknownSnapshot.stderr, /--snapshot names a service without --service/);

  // An empty describe file (gcloud failed) is unreadable, never "open".
  const unreadable = await runGuards(args, { files: { api: '', web: liveJson('true') } });
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /grabit-api \(live state unreadable\)/);

  const closing = await runGuards(args, {
    files: { api: liveJson('true'), web: liveJson('true') },
    env: { BOOKING_ENABLED: 'false' },
  });
  assert.equal(closing.status, 0, closing.stderr);
  assert.match(closing.stdout, /^::warning::grabit-api: this deploy CLOSES sitewide booking/m);
});

test('CLI booking-gate-value writes the deploy value to GITHUB_OUTPUT', async () => {
  const args = ['booking-gate-value', '--service', 'grabit-api=@api'];

  const open = await runGuards(args, { files: { api: liveJson('true') } });
  assert.equal(open.status, 0, open.stderr);
  assert.equal(open.githubOutput, 'booking_enabled=true\n');

  const preserved = await runGuards(args, { files: { api: liveJson('false') } });
  assert.equal(preserved.status, 0, preserved.stderr);
  assert.equal(preserved.githubOutput, 'booking_enabled=false\n');
  assert.match(preserved.stdout, /^::warning::grabit-api: live BOOKING_ENABLED is closed/m);

  const unreadable = await runGuards(args, { files: { api: '{not json' } });
  assert.equal(unreadable.status, 1);
  assert.equal(unreadable.githubOutput, '');

  // Approved reopen run: the guard snapshot decides whether a live close is the
  // intended reopen target or a close made during this run.
  const reopenEnv = { ALLOW_BOOKING_REOPEN: 'true' };
  const closedDuringRun = await runGuards(
    [...args, '--live-at-guard', 'true', '--revision-at-guard', REV_START],
    { files: { api: liveJson('false', REV_CLOSED) }, env: reopenEnv },
  );
  assert.equal(closedDuringRun.status, 0, closedDuringRun.stderr);
  assert.equal(closedDuringRun.githubOutput, 'booking_enabled=false\n');
  assert.match(closedDuringRun.stdout, /^::warning::grabit-api: .*closed during this run/m);

  const intendedReopen = await runGuards(
    [...args, '--live-at-guard', 'false', '--revision-at-guard', REV_START],
    { files: { api: liveJson('false', REV_START) }, env: reopenEnv },
  );
  assert.equal(intendedReopen.status, 0, intendedReopen.stderr);
  assert.equal(intendedReopen.githubOutput, 'booking_enabled=true\n');
  assert.match(intendedReopen.stdout, /^::warning::grabit-api: this deploy REOPENS sitewide booking/m);
  assert.match(intendedReopen.summary, /REOPENS sitewide booking/);

  // Missing job outputs arrive as empty strings.
  const noSnapshot = await runGuards(
    [...args, '--live-at-guard', '', '--revision-at-guard', ''],
    { files: { api: liveJson('false', REV_START) }, env: reopenEnv },
  );
  assert.equal(noSnapshot.status, 0, noSnapshot.stderr);
  assert.equal(noSnapshot.githubOutput, 'booking_enabled=true\n');
  assert.match(noSnapshot.stdout, /^::warning::grabit-api: .*could not verify/m);

  const missingValue = await runGuards([...args, '--live-at-guard'], { files: { api: liveJson('true') } });
  assert.equal(missingValue.status, 1);
  assert.match(missingValue.stderr, /--live-at-guard expects a value/);

  const twoServices = await runGuards([...args, '--service', 'grabit-web=@web'], {
    files: { api: liveJson('true'), web: liveJson('true') },
  });
  assert.equal(twoServices.status, 1);
  assert.match(twoServices.stderr, /exactly one --service/);
});

test('CLI runtime-env writes only the set API settings as a multiline output', async () => {
  const unset = await runGuards(['runtime-env', '--target', 'api']);
  assert.equal(unset.status, 0, unset.stderr);
  assert.match(unset.githubOutput, /^env_vars<<(EOF_[A-Z_0-9]+)\n\n\1\n$/);

  const set = await runGuards(['runtime-env', '--target', 'api'], {
    env: {
      RUNTIME_DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS: '120000',
      RUNTIME_SMS_ALLOWED_COUNTRIES: 'KR,TH',
    },
  });
  assert.equal(set.status, 0, set.stderr);
  assert.match(
    set.githubOutput,
    /^env_vars<<(EOF_[A-Z_0-9]+)\nDB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS=120000\nSMS_ALLOWED_COUNTRIES=KR\\,TH\n\1\n$/,
  );

  const bad = await runGuards(['runtime-env', '--target', 'web']);
  assert.equal(bad.status, 1);
  assert.equal(bad.githubOutput, '');
});

function workflowJob(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} exists`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test('deploy workflow keeps the guarded deploy contract', async () => {
  const workflow = await readFile(join(REPO_ROOT, '.github/workflows/deploy.yml'), 'utf8');

  // #64/#137: one repository variable drives API, Web and worker; no hardcoded open gate.
  assert.doesNotMatch(workflow, /BOOKING_ENABLED=true\b/);
  assert.match(workflow, /BOOKING_ENABLED: \$\{\{ vars\.BOOKING_ENABLED \|\| 'true' \}\}/);
  assert.match(workflow, /deploy-guards\.mjs booking-gate\b/);

  // #64 race: API and Web re-read the live gate immediately before their deploy step.
  for (const [job, service] of [
    ['deploy-api', 'API_SERVICE'],
    ['deploy-web', 'WEB_SERVICE'],
  ]) {
    const block = workflowJob(workflow, job);
    const recheck = block.indexOf('deploy-guards.mjs booking-gate-value');
    const deploy = block.indexOf('google-github-actions/deploy-cloudrun@');
    assert.ok(block.includes('actions/checkout@'), `${job} checks out the guard script`);
    assert.ok(block.includes(`gcloud run services describe "\${${service}}"`), `${job} reads its own service`);
    assert.ok(recheck > 0 && recheck < deploy, `${job} re-checks before deploy-cloudrun`);
    // u20 review: a transient describe error is retried before the guard decides.
    assert.match(block, /for attempt in 1 2 3; do\n\s+if gcloud run services describe/);
    assert.match(block, /BOOKING_ENABLED=\$\{\{ steps\.booking_gate\.outputs\.booking_enabled \}\}/);
    assert.doesNotMatch(block, /BOOKING_ENABLED=\$\{\{ env\.BOOKING_ENABLED \}\}/);
  }

  // Audit D6: the migrate guard snapshots each service's live gate and revision, and both
  // deploy jobs compare against it so an approved reopen run keeps a close made mid-run.
  // `needs` only exposes direct dependencies, so deploy-web must list migrate-production.
  const migrate = workflowJob(workflow, 'migrate-production');
  for (const key of ['api_live', 'api_revision', 'web_live', 'web_revision']) {
    assert.match(migrate, new RegExp(`\\n {6}${key}: \\$\\{\\{ steps\\.booking_guard\\.outputs\\.${key} \\}\\}\\n`));
  }
  assert.match(migrate, /- name: Guard sitewide booking gate\n\s+id: booking_guard\n/);
  assert.match(migrate, /--snapshot "api=\$\{API_SERVICE\}"/);
  assert.match(migrate, /--snapshot "web=\$\{WEB_SERVICE\}"/);
  assert.match(workflowJob(workflow, 'deploy-web'), /needs:\n\s+- migrate-production\n\s+- deploy-api\n/);
  for (const [job, key] of [['deploy-api', 'api'], ['deploy-web', 'web']]) {
    const block = workflowJob(workflow, job);
    assert.match(block, /\n\s+- migrate-production\n/, `${job} needs migrate-production`);
    assert.match(block, new RegExp(`LIVE_AT_GUARD: \\$\\{\\{ needs\\.migrate-production\\.outputs\\.${key}_live \\}\\}`));
    assert.match(block, new RegExp(`REVISION_AT_GUARD: \\$\\{\\{ needs\\.migrate-production\\.outputs\\.${key}_revision \\}\\}`));
    assert.match(block, /--live-at-guard "\$\{LIVE_AT_GUARD\}" --revision-at-guard "\$\{REVISION_AT_GUARD\}"/);
  }

  // #60: migration sessions get lock/statement timeouts before drizzle-kit migrate runs.
  const validateIndex = workflow.indexOf('deploy-guards.mjs validate-config');
  const preflightIndex = workflow.indexOf('deploy-guards.mjs db-preflight');
  const migrateIndex = workflow.indexOf('exec drizzle-kit migrate');
  assert.ok(validateIndex > 0 && validateIndex < preflightIndex && preflightIndex < migrateIndex);

  // #7/#61: liveness on the Redis-only health route and an explicit WebSocket timeout.
  assert.match(workflow, /--liveness-probe=httpGet\.path=\/api\/v1\/health,httpGet\.port=8080,/);
  assert.match(workflow, /--startup-probe=httpGet\.path=\/api\/v1\/health,httpGet\.port=8080,/);
  assert.match(workflow, /--timeout=3600\b/);

  // #150: prewarm can never request more minimum instances than the API maximum, and the
  // service-level scope can be switched back to the template mask without a code change.
  assert.match(workflow, /PREWARM_MAX_MIN_INSTANCES=\$\{\{ env\.API_MAX_INSTANCES \}\}/);
  assert.match(workflow, /PREWARM_SCALING_SCOPE: \$\{\{ vars\.PREWARM_SCALING_SCOPE \|\| 'service' \}\}/);
  assert.match(workflow, /PREWARM_SCALING_SCOPE=\$\{\{ env\.PREWARM_SCALING_SCOPE \}\}/);

  // #54/#58 + x4 deploy-budget: the budget derives each process's pg-boss cap from the
  // runtime value or the API code default, so there is no separate workflow budget input
  // whose default (3) would overcount the producer-only API.
  assert.doesNotMatch(workflow, /\n {2}PGBOSS_POOL_MAX:/);
  assert.match(workflow, /BACKGROUND_PROCESSING_ENABLED: \$\{\{ vars\.BACKGROUND_PROCESSING_ENABLED \|\| 'true' \}\}/);

  // u18a → u20 handoff: the runtime pool and session limits come from the same
  // repository variables with no workflow default, and the API passes them only when set.
  assert.match(workflow, /RUNTIME_PGBOSS_POOL_MAX: \$\{\{ vars\.PGBOSS_POOL_MAX \}\}\n/);
  for (const name of [
    'PGBOSS_START_MAX_ATTEMPTS',
    'DB_STATEMENT_TIMEOUT_MS',
    'DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS',
    'PAYMENT_HANDOFF_ABANDON_SWEEP_ENABLED',
    'SMS_ALLOWED_COUNTRIES',
    'SMS_GLOBAL_SEND_LIMIT_PER_MINUTE',
    'SMS_GLOBAL_SEND_LIMIT_PER_HOUR',
    'SMS_LOCAL_RATE_LIMITS_ENABLED',
  ]) {
    assert.match(workflow, new RegExp(`RUNTIME_${name}: \\$\\{\\{ vars\\.${name} \\}\\}\\n`));
  }
  const api = workflowJob(workflow, 'deploy-api');
  const resolve = api.indexOf('deploy-guards.mjs runtime-env --target api');
  assert.ok(resolve > 0 && resolve < api.indexOf('google-github-actions/deploy-cloudrun@'));
  assert.match(api, /\n {12}\$\{\{ steps\.runtime_env\.outputs\.env_vars \}\}\n {10}secrets: \|/);
  assert.doesNotMatch(api, /\n {12}(PGBOSS_POOL_MAX|DB_STATEMENT_TIMEOUT_MS)=/);

  // #7 follow-up: with the self-reconnecting Valkey client (u07) the liveness probe samples
  // every 10s and tolerates 6 failures (about one minute) before restarting an instance.
  assert.match(
    workflow,
    /--liveness-probe=httpGet\.path=\/api\/v1\/health,httpGet\.port=8080,periodSeconds=10,timeoutSeconds=5,failureThreshold=6\n/,
  );
});
