#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const DEFAULT_PROJECT = 'grapit-491806';
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

function extractDeployPoolEvidence(deployYaml, drizzleProvider) {
  const poolKeys = ['DB_POOL_MAX', 'DB_POOL_IDLE_TIMEOUT_MS', 'DB_POOL_CONNECTION_TIMEOUT_MS'];
  const deployValues = {};
  for (const key of poolKeys) {
    const match = deployYaml.match(new RegExp(`\\b${key}=([^\\s]+)`));
    deployValues[key] = match ? redact(match[1]) : 'missing';
  }

  const apiMaxInstancesMatch = deployYaml.match(/--max-instances=(\d+)/);
  const hasPgBouncer = /pgbouncer|pool_mode|transaction pooling/i.test(deployYaml)
    || /pgbouncer|pool_mode|transaction pooling/i.test(drizzleProvider);

  return {
    deployValues,
    apiMaxInstances: apiMaxInstancesMatch ? Number(apiMaxInstancesMatch[1]) : null,
    drizzleProviderUsesPoolEnv: poolKeys.every((key) => drizzleProvider.includes(key)),
    pgbouncerConfigPresent: hasPgBouncer,
    estimatedApiDbConnections:
      apiMaxInstancesMatch && /^\d+$/.test(deployValues.DB_POOL_MAX)
        ? Number(apiMaxInstancesMatch[1]) * Number(deployValues.DB_POOL_MAX)
        : null,
  };
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
    instances.push({
      instance: instanceName,
      state: STATES.CONFIG_READY_NOT_DRILLED,
      command: describe.shape,
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

  const poolEvidence = extractDeployPoolEvidence(deployYaml, drizzleProvider);
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

main().catch((error) => {
  console.error(`FAIL phase26 infra evidence: ${redact(error.message)}`);
  process.exit(1);
});
