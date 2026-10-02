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
  parseStrictBoolean,
  postgresSettingToMs,
  readServiceEnvValue,
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
  PGBOSS_POOL_MAX: '3',
  DB_CONNECTION_RESERVE: '5',
  DB_CONNECTION_BUDGET_ENFORCE: 'false',
  PREWARM_SCALING_SCOPE: 'service',
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

  // Only an explicit reopen dispatch writes true over a live close.
  const reopened = resolveDeployBookingValue({ target: true, service: closedMidRun, allowReopen: true });
  assert.equal(reopened.value, true);

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
    // The runtime pool can never exceed what the connection budget counted.
    [{ RUNTIME_PGBOSS_POOL_MAX: '4' }, /must not exceed the PGBOSS_POOL_MAX budget input/],
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

const liveJson = (value) =>
  JSON.stringify(describeService(value === undefined ? [] : [{ name: 'BOOKING_ENABLED', value }]));

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
    assert.match(block, /BOOKING_ENABLED=\$\{\{ steps\.booking_gate\.outputs\.booking_enabled \}\}/);
    assert.doesNotMatch(block, /BOOKING_ENABLED=\$\{\{ env\.BOOKING_ENABLED \}\}/);
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

  // #54/#58: the budget default matches the pg-boss pool cap the API code sets
  // (3 with background processing, 1 producer-only), not the pg-boss library default 10.
  assert.match(workflow, /PGBOSS_POOL_MAX: \$\{\{ vars\.PGBOSS_POOL_MAX \|\| '3' \}\}/);

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
