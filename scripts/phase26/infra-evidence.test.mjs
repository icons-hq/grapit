import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { estimateConnectionDemand } from '../managed-demo/deploy-guards.mjs';
import { extractDeployPoolEvidence, readWorkflowEnvDefault } from './infra-evidence.mjs';

const deployYaml = await readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const drizzleProvider = await readFile(new URL('../../apps/api/src/database/drizzle.provider.ts', import.meta.url), 'utf8');

function liveApi({ maxScale = '4', env = {} } = {}) {
  return { service: 'grabit-api', state: 'CONFIG_READY_NOT_DRILLED', maxScale, env };
}

test('reads the templated deploy.yml values instead of the literal ${{ text', () => {
  // Before audit #54/#58 follow-up: `--max-instances=(\d+)` never matched
  // `${{ env.API_MAX_INSTANCES }}` and DB_POOL_MAX captured "${{", so the estimate was always null.
  const evidence = extractDeployPoolEvidence(deployYaml, drizzleProvider);
  assert.deepEqual(evidence.deployValues, {
    DB_POOL_MAX: '4',
    DB_POOL_IDLE_TIMEOUT_MS: '30000',
    DB_POOL_CONNECTION_TIMEOUT_MS: '5000',
  });
  assert.deepEqual(evidence.workflowDefaults, {
    API_MAX_INSTANCES: '40',
    DB_POOL_MAX: '4',
    PGBOSS_POOL_MAX: null,
    DB_CONNECTION_RESERVE: '5',
    BACKGROUND_PROCESSING_ENABLED: 'true',
  });
  assert.equal(evidence.apiMaxInstances, 40);
  assert.notEqual(evidence.estimatedApiDbConnections, null);
  assert.equal(evidence.drizzleProviderUsesPoolEnv, true);
});

test('counts the pg-boss pools with the Deploy workflow budget formula', () => {
  // No live service: the warm workflow defaults, with each process's pg-boss code default.
  const warm = extractDeployPoolEvidence(deployYaml, drizzleProvider).connectionEstimate;
  assert.deepEqual(warm.inputs, {
    apiMaxInstances: { value: 40, source: 'workflow-default' },
    dbPoolMax: { value: 4, source: 'workflow-default' },
    backgroundProcessing: { value: true, source: 'workflow-default' },
    apiPgBossPoolMax: { value: 3, source: 'code-default' },
    workerPgBossPoolMax: { value: 3, source: 'code-default' },
    reserve: { value: 5, source: 'workflow-default' },
  });
  assert.equal(warm.api, 40 * (4 + 3));
  assert.equal(warm.worker, 4 + 3);
  assert.equal(warm.required, 280 + 7 + 5);
  assert.equal(
    warm.required,
    estimateConnectionDemand({ apiMaxInstances: 40, dbPoolMax: 4, apiPgBossPoolMax: 3, workerPgBossPoolMax: 3, reserve: 5 })
      .required,
  );

  // Managed demo, read from the live grabit-api service: producer-only API (pg-boss 1).
  const demo = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ maxScale: '4', env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false' } }),
  });
  assert.deepEqual(demo.connectionEstimate.inputs, {
    apiMaxInstances: { value: 4, source: 'live' },
    dbPoolMax: { value: 2, source: 'live' },
    backgroundProcessing: { value: false, source: 'live' },
    apiPgBossPoolMax: { value: 1, source: 'code-default' },
    workerPgBossPoolMax: { value: 3, source: 'code-default' },
    reserve: { value: 5, source: 'workflow-default' },
  });
  assert.equal(demo.estimatedApiDbConnections, 4 * (2 + 1));
  assert.equal(demo.estimatedDbConnections, 12 + (2 + 3) + 5);

  // A runtime PGBOSS_POOL_MAX on the live service is the API's cap. It says nothing about
  // the worker Job, which every deploy rebuilds from the workflow (variable or code default).
  const pinned = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false', PGBOSS_POOL_MAX: '2' } }),
  });
  assert.deepEqual(pinned.connectionEstimate.inputs.apiPgBossPoolMax, { value: 2, source: 'live' });
  assert.deepEqual(pinned.connectionEstimate.inputs.workerPgBossPoolMax, { value: 3, source: 'code-default' });
  assert.equal(pinned.connectionEstimate.required, 4 * (2 + 2) + (2 + 3) + 5);

  // A live service without BACKGROUND_PROCESSING_ENABLED processes jobs (code default).
  const unset = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2' } }),
  });
  assert.deepEqual(unset.connectionEstimate.inputs.backgroundProcessing, { value: true, source: 'code-default' });
  assert.equal(unset.connectionEstimate.inputs.apiPgBossPoolMax.value, 3);
});

test('the worker pg-boss cap never follows the live API value (ops-infra-3)', () => {
  // Repository variable removed, but the API service still has PGBOSS_POOL_MAX=3 from an
  // earlier deploy: the API really runs 3, the freshly deployed worker Job its code default.
  const leftover = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false', PGBOSS_POOL_MAX: '3' } }),
  });
  assert.deepEqual(leftover.connectionEstimate.inputs.apiPgBossPoolMax, { value: 3, source: 'live' });
  assert.deepEqual(leftover.connectionEstimate.inputs.workerPgBossPoolMax, { value: 3, source: 'code-default' });
  assert.equal(leftover.connectionEstimate.required, 4 * (2 + 3) + (2 + 3) + 5);

  const leftoverSix = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false', PGBOSS_POOL_MAX: '6' } }),
  });
  assert.deepEqual(leftoverSix.connectionEstimate.inputs.workerPgBossPoolMax, { value: 3, source: 'code-default' });
  assert.equal(leftoverSix.connectionEstimate.worker, 2 + 3);

  // No live value and no workflow value: API producer default 1, worker 3.
  const clean = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false' } }),
  });
  assert.deepEqual(clean.connectionEstimate.inputs.apiPgBossPoolMax, { value: 1, source: 'code-default' });
  assert.deepEqual(clean.connectionEstimate.inputs.workerPgBossPoolMax, { value: 3, source: 'code-default' });

  // A workflow default (if deploy.yml ever gets one) is the worker's cap and is labelled so.
  const withDefault = deployYaml.replace(
    'RUNTIME_PGBOSS_POOL_MAX: ${{ vars.PGBOSS_POOL_MAX }}',
    "RUNTIME_PGBOSS_POOL_MAX: ${{ vars.PGBOSS_POOL_MAX || '2' }}",
  );
  assert.notEqual(withDefault, deployYaml);
  const workflowValue = extractDeployPoolEvidence(withDefault, drizzleProvider, {
    liveApi: liveApi({ env: { DB_POOL_MAX: '2', BACKGROUND_PROCESSING_ENABLED: 'false', PGBOSS_POOL_MAX: '5' } }),
  });
  assert.deepEqual(workflowValue.connectionEstimate.inputs.apiPgBossPoolMax, { value: 5, source: 'live' });
  assert.deepEqual(workflowValue.connectionEstimate.inputs.workerPgBossPoolMax, { value: 2, source: 'workflow-default' });
});

test('falls back to workflow defaults for unreadable live values and reports missing inputs', () => {
  const blocked = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: { service: 'grabit-api', state: 'BLOCKED', error: 'permission denied' },
  });
  assert.equal(blocked.connectionEstimate.inputs.apiMaxInstances.source, 'workflow-default');

  const secretBound = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: liveApi({ maxScale: null, env: { DB_POOL_MAX: '<secret-bound>' } }),
  });
  assert.deepEqual(secretBound.connectionEstimate.inputs.apiMaxInstances, { value: 40, source: 'workflow-default' });
  assert.deepEqual(secretBound.connectionEstimate.inputs.dbPoolMax, { value: 4, source: 'workflow-default' });

  const bare = [
    'env:',
    "  DB_CONNECTION_RESERVE: ${{ vars.DB_CONNECTION_RESERVE || '5' }}",
    'jobs:',
    '  deploy-api:',
    '    steps:',
    '      - with:',
    '          flags: >-',
    '            --max-instances=${{ env.API_MAX_INSTANCES }}',
    '          env_vars: |',
    '            DB_POOL_MAX=${{ env.DB_POOL_MAX }}',
  ].join('\n');
  const missing = extractDeployPoolEvidence(bare, drizzleProvider);
  assert.equal(missing.deployValues.DB_POOL_MAX, 'missing');
  assert.deepEqual(missing.connectionEstimate.inputs.apiMaxInstances, { value: null, source: 'missing' });
  assert.equal(missing.connectionEstimate.required, null);
  assert.equal(missing.estimatedApiDbConnections, null);
});

test('parses only the workflow env default form', () => {
  const yaml = [
    'env:',
    "  API_MAX_INSTANCES: ${{ vars.API_MAX_INSTANCES || '40' }}",
    '  RUNTIME_PGBOSS_POOL_MAX: ${{ vars.PGBOSS_POOL_MAX }}',
    "  DB_POOL_MAX_NOTE: ${{ vars.DB_POOL_MAX || '9' }}",
  ].join('\n');
  assert.equal(readWorkflowEnvDefault(yaml, 'API_MAX_INSTANCES'), '40');
  assert.equal(readWorkflowEnvDefault(yaml, 'RUNTIME_PGBOSS_POOL_MAX', 'PGBOSS_POOL_MAX'), null);
  assert.equal(readWorkflowEnvDefault(yaml, 'DB_POOL_MAX'), undefined);
});
