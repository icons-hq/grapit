#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateConnectionDemand } from '../managed-demo/deploy-guards.mjs';

const DEFAULT_PROJECT = 'grapit-491806';
const API_SERVICE = 'grabit-api';
// Mirror apps/api/src/modules/jobs/pgboss.provider.ts; the Deploy workflow's
// connection budget (deploy-guards.mjs validateDeployConfig) uses the same rule.
const DEFAULT_PGBOSS_POOL_MAX_PROCESSING = 3;
const DEFAULT_PGBOSS_POOL_MAX_PRODUCER = 1;
const DEFAULT_REGION = 'asia-northeast3';
const DEFAULT_OUTPUT = '.planning/phases/26-m1-canary-cutover-gates/evidence/26-08-dr-infra.json';
const DEFAULT_SERVICES = ['grabit-api', 'grabit-web'];
const GCLOUD_TIMEOUT_MS = 60_000;
const SMOKE_TIMEOUT_MS = 120_000;

const STATES = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  ACCEPTED_RISK: 'ACCEPTED_RISK',
  CONFIG_READY_NOT_DRILLED: 'CONFIG_READY_NOT_DRILLED',
  BLOCKED: 'BLOCKED',
});

const SECRET_PATTERNS = [
  /\brediss?:\/\/[^\s`'")]+/gi,
  /\bpostgres(?:ql)?:\/\/[^\s`'")]+/gi,
  /\bDATABASE_URL\s*[:=]\s*[^\s`'")]+/gi,
  /\bREDIS_URL\s*[:=]\s*[^\s`'")]+/gi,
  /\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi,
  /\bCookie:\s*[^`\n\r]+/gi,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  /\b(sk|test_sk|live_sk)_[A-Za-z0-9_=-]{8,}/gi,
  /\b(secret|token|password|key)=\S+/gi,
  /\b(paymentKey|orderId)\s*[:=]\s*["']?[^"',\s)}]+/gi,
];

function usage() {
  return `
Usage:
  node scripts/phase26/infra-evidence.mjs --help
  node scripts/phase26/infra-evidence.mjs --output ${DEFAULT_OUTPUT}
  node scripts/phase26/infra-evidence.mjs --project ${DEFAULT_PROJECT} --region ${DEFAULT_REGION}
  node scripts/phase26/infra-evidence.mjs --run-valkey-smoke health

Defaults:
  --project          ${DEFAULT_PROJECT}
  --region           ${DEFAULT_REGION}
  --output           ${DEFAULT_OUTPUT}
  --services         ${DEFAULT_SERVICES.join(',')}

Optional inputs:
  --cloud-sql-instance NAME       Limit Cloud SQL detail collection to one instance.
  --services NAME[,NAME]          Cloud Run services to inspect.
  --run-valkey-smoke CHECK        Runs scripts/smoke-valkey-production.mjs with --check CHECK.

Approval and drill metadata:
  PHASE26_DR_APPROVED=true        Owner approval for restore target, cost, and timing.
  PHASE26_DR_APPROVER             Approver name or handle.
  PHASE26_RESTORE_TARGET          Safe Cloud SQL restore target name.
  PHASE26_RESTORE_WINDOW          Approved restore/PITR window.
  PHASE26_CLOUD_RUN_ROLLBACK_DRILLED=true
  PHASE26_CLOUD_SQL_RESTORE_DRILLED=true
  PHASE26_VALKEY_RECONNECT_DRILLED=true
  PHASE26_INFRA_ACCEPTED_RISK=true

Classification rules:
  PASS is used only when an actual successful drill is declared or observed.
  BLOCKED means approval, permissions, safe target, or evidence are missing.
  CONFIG_READY_NOT_DRILLED means configuration was collected but the drill did not run.
  ACCEPTED_RISK requires PHASE26_INFRA_ACCEPTED_RISK=true plus approver metadata.

Security:
  Every gcloud command uses explicit --project=${DEFAULT_PROJECT} and --region=${DEFAULT_REGION} defaults.
  Evidence redacts DATABASE_URL, Redis URLs, cookies, auth headers, JWTs, provider tokens, and payment identifiers.
`;
}

function parseArgs(argv) {
  const args = {
    help: false,
    project: DEFAULT_PROJECT,
    region: DEFAULT_REGION,
    output: DEFAULT_OUTPUT,
    services: [...DEFAULT_SERVICES],
    cloudSqlInstance: process.env.PHASE26_CLOUD_SQL_INSTANCE || '',
    runValkeySmoke: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--project') {
      args.project = readValue(argv, ++index, arg);
    } else if (arg === '--region') {
      args.region = readValue(argv, ++index, arg);
    } else if (arg === '--output') {
      args.output = readValue(argv, ++index, arg);
    } else if (arg === '--services') {
      args.services = readValue(argv, ++index, arg)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === '--cloud-sql-instance') {
      args.cloudSqlInstance = readValue(argv, ++index, arg);
    } else if (arg === '--run-valkey-smoke') {
      args.runValkeySmoke = readValue(argv, ++index, arg);
    } else {
      throw new Error(`Unsupported argument ${arg}. Use --help.`);
    }
  }

  if (!/^[a-z][a-z0-9-]{4,}$/.test(args.project)) {
    throw new Error(`Invalid --project ${args.project}`);
  }
  if (!/^[a-z]+-[a-z]+[0-9]+$/.test(args.region)) {
    throw new Error(`Invalid --region ${args.region}`);
  }
  if (args.services.length === 0) {
    throw new Error('--services must include at least one Cloud Run service');
  }

  return args;
}

function readValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function redact(value) {
  let output = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      if (/^DATABASE_URL/i.test(match)) return 'DATABASE_URL=[redacted]';
      if (/^REDIS_URL/i.test(match)) return 'REDIS_URL=[redacted]';
      if (/^Authorization/i.test(match)) return 'Authorization: Bearer <redacted>';
      if (/^Cookie/i.test(match)) return 'Cookie: <redacted>';
      if (/paymentKey|orderId/i.test(match)) return match.replace(/[:=]\s*["']?.+$/, '=<redacted>');
      if (/secret|token|password|key/i.test(match)) return match.replace(/=.*/, '=[redacted]');
      if (/^postgres/i.test(match)) return '[redacted database url]';
      if (/^redis/i.test(match)) return '[redacted redis url]';
      if (match.includes('.')) return '<jwt:redacted>';
      return '<secret:redacted>';
    });
  }
  return output;
}

function redactedObject(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
}

function runCli(command, args, timeout = GCLOUD_TIMEOUT_MS) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    timeout,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });
  const spawnError = result.error ? String(result.error.message ?? result.error) : '';

  return {
    ok: result.status === 0 && !spawnError,
    status: result.status ?? 1,
    stdout: redact(result.stdout ?? ''),
    stderr: redact(spawnError || result.stderr || ''),
    shape: `${command} ${args.join(' ')}`,
  };
}

function gcloudJson(args) {
  const result = runCli('gcloud', [...args, '--format=json']);
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.stdout || `status ${result.status}`, shape: result.shape };
  }

  try {
    return { ok: true, data: JSON.parse(result.stdout || 'null'), shape: result.shape };
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error.message}`, shape: result.shape };
  }
}

function compactEnv(envEntries = []) {
  const env = {};
  for (const entry of envEntries) {
    const name = entry?.name;
    if (!name) continue;
    const secretName = /(^|_)(SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|SECRET_KEY|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|REDIS_URL|COOKIE)(_|$)/i.test(name);
    if (entry.valueFrom) {
      env[name] = '<secret-bound>';
    } else if (secretName) {
      env[name] = entry.value ? '<redacted>' : '<unset>';
    } else {
      env[name] = redact(entry.value ?? '');
    }
  }
  return env;
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    return `__READ_ERROR__ ${error.message}`;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a workflow-level env entry such as `KEY: ${{ vars.KEY || '4' }}`.
 * Returns the default (`'4'`), `null` for a variable without a default
 * (`${{ vars.KEY }}`), or `undefined` when the entry does not exist.
 */
export function readWorkflowEnvDefault(deployYaml, envName, varName = envName) {
  const entry = new RegExp(
    `^[ \\t]+${escapeRegExp(envName)}:[ \\t]*\\$\\{\\{[ \\t]*vars\\.${escapeRegExp(varName)}`
      + `(?:[ \\t]*\\|\\|[ \\t]*'([^']*)')?[ \\t]*\\}\\}[ \\t]*$`,
    'm',
  ).exec(deployYaml);
  if (!entry) return undefined;
  return entry[1] ?? null;
}

/**
 * Resolves one Cloud Run `env_vars` line (`KEY=value`) of deploy.yml. A
 * `${{ env.NAME }}` template is resolved through the workflow env default.
 */
function readDeployEnvVar(deployYaml, key) {
  const line = new RegExp(`^[ \\t]+${escapeRegExp(key)}=(.+?)[ \\t]*$`, 'm').exec(deployYaml);
  if (!line) return 'missing';
  const template = /^\$\{\{\s*env\.([A-Z0-9_]+)\s*\}\}$/.exec(line[1]);
  if (!template) return redact(line[1]);
  const value = readWorkflowEnvDefault(deployYaml, template[1]);
  return typeof value === 'string' ? redact(value) : 'missing';
}

function integerOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[0-9]+$/.test(text) ? Number(text) : null;
}

function input(value, source) {
  return value === null || value === undefined ? { value: null, source: 'missing' } : { value, source };
}

/**
 * DB pool evidence from deploy.yml plus, when collected, the live grabit-api
 * service. Live values win over workflow defaults (repository variables can
 * differ from them). The connection estimate uses the Deploy workflow's budget
 * formula: API instances x (app pool + API pg-boss cap) + worker (app pool +
 * worker pg-boss cap) + reserve. Every input records where it came from.
 */
export function extractDeployPoolEvidence(deployYaml, drizzleProvider, { liveApi = null } = {}) {
  const poolKeys = ['DB_POOL_MAX', 'DB_POOL_IDLE_TIMEOUT_MS', 'DB_POOL_CONNECTION_TIMEOUT_MS'];
  const deployValues = {};
  for (const key of poolKeys) {
    deployValues[key] = readDeployEnvVar(deployYaml, key);
  }

  const workflowDefaults = {
    API_MAX_INSTANCES: readWorkflowEnvDefault(deployYaml, 'API_MAX_INSTANCES') ?? null,
    DB_POOL_MAX: readWorkflowEnvDefault(deployYaml, 'DB_POOL_MAX') ?? null,
    PGBOSS_POOL_MAX: readWorkflowEnvDefault(deployYaml, 'RUNTIME_PGBOSS_POOL_MAX', 'PGBOSS_POOL_MAX') ?? null,
    DB_CONNECTION_RESERVE: readWorkflowEnvDefault(deployYaml, 'DB_CONNECTION_RESERVE') ?? null,
    BACKGROUND_PROCESSING_ENABLED: readWorkflowEnvDefault(deployYaml, 'BACKGROUND_PROCESSING_ENABLED') ?? null,
  };

  const live = liveApi && liveApi.state !== STATES.BLOCKED ? liveApi : null;
  const liveEnv = live?.env ?? {};
  const pick = (liveValue, workflowValue) => {
    if (liveValue !== null && liveValue !== undefined) return input(liveValue, 'live');
    if (workflowValue !== null && workflowValue !== undefined) return input(workflowValue, 'workflow-default');
    return input(null, 'missing');
  };

  const apiMaxInstances = pick(integerOrNull(live?.maxScale ?? undefined), integerOrNull(workflowDefaults.API_MAX_INSTANCES));
  const dbPoolMax = pick(integerOrNull(liveEnv.DB_POOL_MAX), integerOrNull(workflowDefaults.DB_POOL_MAX));
  const reserve = input(integerOrNull(workflowDefaults.DB_CONNECTION_RESERVE), 'workflow-default');
  // Same parsing as the API: only "false" turns background processing off; unset is on.
  // A live service without the variable runs the code default, not the workflow default.
  const processes = (text) => String(text).trim().toLowerCase() !== 'false';
  let backgroundProcessing = { value: true, source: 'code-default' };
  if (live && typeof liveEnv.BACKGROUND_PROCESSING_ENABLED === 'string') {
    backgroundProcessing = { value: processes(liveEnv.BACKGROUND_PROCESSING_ENABLED), source: 'live' };
  } else if (!live && typeof workflowDefaults.BACKGROUND_PROCESSING_ENABLED === 'string') {
    backgroundProcessing = { value: processes(workflowDefaults.BACKGROUND_PROCESSING_ENABLED), source: 'workflow-default' };
  }
  const runtimePgBoss = live
    ? input(integerOrNull(liveEnv.PGBOSS_POOL_MAX), 'live')
    : input(integerOrNull(workflowDefaults.PGBOSS_POOL_MAX), 'workflow-default');
  const apiPgBossPoolMax = runtimePgBoss.value !== null
    ? runtimePgBoss
    : {
      value: backgroundProcessing.value ? DEFAULT_PGBOSS_POOL_MAX_PROCESSING : DEFAULT_PGBOSS_POOL_MAX_PRODUCER,
      source: 'code-default',
    };
  const workerPgBossPoolMax = runtimePgBoss.value !== null
    ? runtimePgBoss
    : { value: DEFAULT_PGBOSS_POOL_MAX_PROCESSING, source: 'code-default' };

  const inputs = {
    apiMaxInstances,
    dbPoolMax,
    backgroundProcessing,
    apiPgBossPoolMax,
    workerPgBossPoolMax,
    reserve,
  };
  const complete = [apiMaxInstances, dbPoolMax, reserve].every((entry) => entry.value !== null);
  const demand = complete
    ? estimateConnectionDemand({
      apiMaxInstances: apiMaxInstances.value,
      dbPoolMax: dbPoolMax.value,
      apiPgBossPoolMax: apiPgBossPoolMax.value,
      workerPgBossPoolMax: workerPgBossPoolMax.value,
      reserve: reserve.value,
    })
    : null;

  const hasPgBouncer = /pgbouncer|pool_mode|transaction pooling/i.test(deployYaml)
    || /pgbouncer|pool_mode|transaction pooling/i.test(drizzleProvider);

  return {
    deployValues,
    workflowDefaults,
    apiMaxInstances: apiMaxInstances.value,
    drizzleProviderUsesPoolEnv: poolKeys.every((key) => drizzleProvider.includes(key)),
    pgbouncerConfigPresent: hasPgBouncer,
    connectionEstimate: {
      inputs,
      formula: demand?.formula ?? null,
      api: demand?.api ?? null,
      worker: demand?.worker ?? null,
      reserve: demand?.reserve ?? null,
      required: demand?.required ?? null,
      note: 'Same formula as the Deploy workflow database preflight (deploy-guards.mjs). Counts one '
        + 'revision; rollout overlap, migration and operator sessions must fit in the reserve.',
    },
    // API instances x (app pool + pg-boss pool); the full requirement is connectionEstimate.required.
    estimatedApiDbConnections: demand?.api ?? null,
    estimatedDbConnections: demand?.required ?? null,
  };
}

function summarizeBackups(rawBackups) {
  if (!Array.isArray(rawBackups)) return [];
  return rawBackups.map((backup) => ({
    id: backup?.id ?? null,
    status: backup?.status ?? null,
    type: backup?.type ?? null,
    windowStartTime: backup?.windowStartTime ?? null,
    endTime: backup?.endTime ?? null,
  }));
}

async function collectCloudRun(args) {
  const services = [];
  for (const serviceName of args.services) {
    const result = gcloudJson([
      'run',
      'services',
      'describe',
      serviceName,
      `--project=${args.project}`,
      `--region=${args.region}`,
    ]);

    if (!result.ok) {
      services.push({
        service: serviceName,
        state: STATES.BLOCKED,
        command: result.shape,
        error: result.error,
      });
      continue;
    }

    const service = result.data ?? {};
    const container = service?.spec?.template?.spec?.containers?.[0] ?? {};
    const annotations = {
      ...(service?.metadata?.annotations ?? {}),
      ...(service?.spec?.template?.metadata?.annotations ?? {}),
    };

    services.push({
      service: serviceName,
      state: STATES.CONFIG_READY_NOT_DRILLED,
      command: result.shape,
      latestCreatedRevisionName: service?.status?.latestCreatedRevisionName ?? null,
      latestReadyRevisionName: service?.status?.latestReadyRevisionName ?? null,
      traffic: redactedObject(service?.status?.traffic ?? []),
      image: redact(container?.image ?? ''),
      env: compactEnv(container?.env ?? []),
      minInstances: annotations['autoscaling.knative.dev/minScale'] ?? '0',
      maxScale: annotations['autoscaling.knative.dev/maxScale'] ?? null,
      vpcEgress: annotations['run.googleapis.com/vpc-access-egress'] ?? null,
      networkInterfaces: redact(annotations['run.googleapis.com/network-interfaces'] ?? ''),
    });
  }

  return services;
}

async function collectCloudSql(args) {
  const listResult = args.cloudSqlInstance
    ? { ok: true, data: [{ name: args.cloudSqlInstance }] }
    : gcloudJson(['sql', 'instances', 'list', `--project=${args.project}`]);

  if (!listResult.ok) {
    return {
      state: STATES.BLOCKED,
      error: listResult.error,
      command: listResult.shape,
      instances: [],
    };
  }

  const instanceNames = (Array.isArray(listResult.data) ? listResult.data : [])
    .map((instance) => instance?.name)
    .filter(Boolean);

  const instances = [];
  for (const instanceName of instanceNames) {
    const describe = gcloudJson(['sql', 'instances', 'describe', instanceName, `--project=${args.project}`]);
    if (!describe.ok) {
      instances.push({
        instance: instanceName,
        state: STATES.BLOCKED,
        command: describe.shape,
        error: describe.error,
      });
      continue;
    }

    const instance = describe.data ?? {};
    const backupConfig = instance?.settings?.backupConfiguration ?? {};
    const availabilityType = instance?.settings?.availabilityType ?? 'UNKNOWN';
    const backups = gcloudJson([
      'sql',
      'backups',
      'list',
      `--instance=${instanceName}`,
      `--project=${args.project}`,
      '--limit=5',
      '--sort-by=~endTime',
    ]);

    instances.push({
      instance: instanceName,
      state: STATES.CONFIG_READY_NOT_DRILLED,
      command: describe.shape,
      backupListCommand: backups.shape ?? null,
      region: instance?.region ?? null,
      databaseVersion: instance?.databaseVersion ?? null,
      availabilityType,
      replicationType: instance?.settings?.replicationType ?? null,
      instanceType: instance?.instanceType ?? null,
      primaryInstanceName: instance?.masterInstanceName ?? null,
      backupEnabled: Boolean(backupConfig.enabled),
      pitrEnabled: Boolean(backupConfig.pointInTimeRecoveryEnabled),
      transactionLogRetentionDays: backupConfig.transactionLogRetentionDays ?? null,
      retainedBackups: backupConfig.backupRetentionSettings?.retainedBackups ?? null,
      recentBackups: backups.ok ? summarizeBackups(backups.data) : [],
      recentBackupsError: backups.ok ? null : backups.error,
      diskSizeGb: instance?.settings?.dataDiskSizeGb ?? null,
    });
  }

  return {
    state: instances.length ? STATES.CONFIG_READY_NOT_DRILLED : STATES.BLOCKED,
    instances,
  };
}

function approvalMetadata() {
  const approved = process.env.PHASE26_DR_APPROVED === 'true';
  const acceptedRisk = process.env.PHASE26_INFRA_ACCEPTED_RISK === 'true';
  return {
    approved,
    acceptedRisk,
    approver: redact(process.env.PHASE26_DR_APPROVER || ''),
    restoreTarget: redact(process.env.PHASE26_RESTORE_TARGET || ''),
    restoreWindow: redact(process.env.PHASE26_RESTORE_WINDOW || ''),
    cloudRunRollbackDrilled: process.env.PHASE26_CLOUD_RUN_ROLLBACK_DRILLED === 'true',
    cloudSqlRestoreDrilled: process.env.PHASE26_CLOUD_SQL_RESTORE_DRILLED === 'true',
    valkeyReconnectDrilled: process.env.PHASE26_VALKEY_RECONNECT_DRILLED === 'true',
  };
}

function classifyGate({ gateId, defaultBlockedReason, configReadyReason, pass, blocked, acceptedRisk, evidence = [] }) {
  if (pass) {
    return {
      gateId,
      state: STATES.PASS,
      reason: 'Actual successful drill evidence was provided.',
      evidence,
    };
  }

  if (acceptedRisk) {
    return {
      gateId,
      state: STATES.ACCEPTED_RISK,
      reason: 'Owner accepted this non-PASS infrastructure risk with compensating monitoring.',
      evidence,
    };
  }

  if (blocked) {
    return {
      gateId,
      state: STATES.BLOCKED,
      reason: defaultBlockedReason,
      evidence,
    };
  }

  return {
    gateId,
    state: STATES.CONFIG_READY_NOT_DRILLED,
    reason: configReadyReason,
    evidence,
  };
}

function buildClassifications({ cloudRun, cloudSql, poolEvidence, valkeySmoke, approval }) {
  const hasCloudRunConfig = cloudRun.some((service) => service.state !== STATES.BLOCKED);
  const hasCloudSqlConfig = cloudSql.instances?.some((instance) => instance.state !== STATES.BLOCKED);
  const cloudSqlHasPitr = cloudSql.instances?.some((instance) => instance.pitrEnabled);
  const cloudSqlHasHa = cloudSql.instances?.some((instance) => instance.availabilityType === 'REGIONAL');
  const hasReplica = cloudSql.instances?.some((instance) => instance.instanceType === 'READ_REPLICA_INSTANCE');
  const valkeySmokePass = valkeySmoke?.state === STATES.PASS;
  const canUseAcceptedRisk = approval.acceptedRisk && approval.approver;

  return [
    classifyGate({
      gateId: 'DR_CLOUD_RUN_ROLLBACK',
      pass: approval.cloudRunRollbackDrilled && hasCloudRunConfig,
      blocked: !hasCloudRunConfig,
      acceptedRisk: canUseAcceptedRisk,
      defaultBlockedReason: 'Cloud Run service metadata could not be collected.',
      configReadyReason: 'Cloud Run service/revision/traffic metadata collected, but rollback was not drilled.',
      evidence: ['cloudRun.services', 'approval.cloudRunRollbackDrilled'],
    }),
    classifyGate({
      gateId: 'DR_CLOUD_SQL_PITR',
      pass: approval.cloudSqlRestoreDrilled && approval.approved && approval.restoreTarget && cloudSqlHasPitr,
      blocked: !hasCloudSqlConfig || !approval.approved || !approval.restoreTarget,
      acceptedRisk: canUseAcceptedRisk,
      defaultBlockedReason: 'Cloud SQL PITR/restore lacks owner-approved safe target, permissions, or PITR metadata.',
      configReadyReason: 'Cloud SQL backup/PITR configuration was collected, but safe-target restore was not drilled.',
      evidence: ['cloudSql.instances', 'approval.restoreTarget', 'approval.cloudSqlRestoreDrilled'],
    }),
    classifyGate({
      gateId: 'DR_VALKEY_RECONNECT',
      pass: approval.valkeyReconnectDrilled || valkeySmokePass,
      blocked: !valkeySmoke || valkeySmoke.state === STATES.BLOCKED,
      acceptedRisk: canUseAcceptedRisk,
      defaultBlockedReason: 'Valkey reconnect/failure smoke did not run or lacked required credentials/fixtures.',
      configReadyReason: 'Valkey health metadata collected, but reconnect/failure behavior was not drilled.',
      evidence: ['valkeySmoke'],
    }),
    classifyGate({
      gateId: 'INFRA_POOL_PGBOUNCER',
      pass: false,
      blocked: false,
      acceptedRisk: canUseAcceptedRisk,
      defaultBlockedReason: 'DB pool and pgBouncer config could not be inspected.',
      configReadyReason: poolEvidence.pgbouncerConfigPresent
        ? 'DB_POOL_MAX and pgBouncer references were collected, but transaction pooling was not load-drilled.'
        : 'DB_POOL_MAX was collected, but pgBouncer transaction pooling evidence was not found or drilled.',
      evidence: ['poolEvidence.deployValues', 'poolEvidence.pgbouncerConfigPresent'],
    }),
    classifyGate({
      gateId: 'INFRA_HA_REPLICA',
      pass: false,
      blocked: !hasCloudSqlConfig,
      acceptedRisk: canUseAcceptedRisk,
      defaultBlockedReason: 'Cloud SQL HA/read replica metadata could not be collected.',
      configReadyReason: cloudSqlHasHa || hasReplica
        ? 'Cloud SQL HA/read-replica config was collected, but failover/read-replica behavior was not drilled.'
        : 'Cloud SQL HA/read-replica drill evidence is absent; keep non-PASS until approved or drilled.',
      evidence: ['cloudSql.instances.availabilityType', 'cloudSql.instances.instanceType'],
    }),
  ];
}

async function collectValkeySmoke(args) {
  if (!args.runValkeySmoke) {
    return {
      state: STATES.BLOCKED,
      reason: 'Not run. Pass --run-valkey-smoke health|lua|socketio|idle|logs|all with required smoke env.',
      command: 'node scripts/smoke-valkey-production.mjs --check <check>',
    };
  }

  const result = runCli(
    'node',
    ['scripts/smoke-valkey-production.mjs', '--check', args.runValkeySmoke],
    SMOKE_TIMEOUT_MS,
  );

  return {
    state: result.ok ? STATES.PASS : STATES.BLOCKED,
    command: result.shape,
    status: result.status,
    stdout: result.stdout.slice(0, 4000),
    stderr: result.stderr.slice(0, 4000),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const startedAt = new Date().toISOString();
  const [deployYaml, drizzleProvider] = await Promise.all([
    readText('.github/workflows/deploy.yml'),
    readText('apps/api/src/database/drizzle.provider.ts'),
  ]);

  const [cloudRun, cloudSql, valkeySmoke] = await Promise.all([
    collectCloudRun(args),
    collectCloudSql(args),
    collectValkeySmoke(args),
  ]);

  const poolEvidence = extractDeployPoolEvidence(deployYaml, drizzleProvider, {
    liveApi: cloudRun.find((service) => service.service === API_SERVICE) ?? null,
  });
  const approval = approvalMetadata();
  const classifications = buildClassifications({
    cloudRun,
    cloudSql,
    poolEvidence,
    valkeySmoke,
    approval,
  });

  const evidence = redactedObject({
    schemaVersion: 'phase26.dr-infra-evidence.v1',
    generatedAt: new Date().toISOString(),
    startedAt,
    project: args.project,
    region: args.region,
    command: `node scripts/phase26/infra-evidence.mjs --project ${args.project} --region ${args.region}`,
    allowedStates: Object.values(STATES),
    approval,
    classifications,
    cloudRun: { services: cloudRun },
    cloudSql,
    poolEvidence,
    valkeySmoke,
    redactionPolicy: [
      'DATABASE_URL',
      'Redis URLs',
      'Authorization/Cookie headers',
      'JWTs',
      'provider tokens',
      'paymentKey/orderId',
      'secret-like key/value pairs',
    ],
    notes: [
      'PASS is never inferred from configuration alone.',
      'PITR/restore and rollback actions are not executed by this collector.',
      'CONFIG_READY_NOT_DRILLED and ACCEPTED_RISK remain non-PASS cutover states.',
    ],
  });

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Wrote ${args.output}\n`);
}

function isEntrypoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(`FAIL phase26 infra evidence: ${redact(error.message)}`);
    process.exit(1);
  });
}
