import { pathToFileURL } from 'node:url';

const SECRET_BINDINGS = [
  ['DATABASE_URL', 'database-url'],
  ['REDIS_URL', 'redis-url'],
  ['RESEND_API_KEY', 'resend-api-key'],
  ['RESEND_FROM_EMAIL', 'resend-from-email'],
  ['SENTRY_DSN', 'sentry-dsn'],
  ['TOSS_SECRET_KEY', 'toss-secret-key'],
  ['TOSS_OVERSEAS_CARD_SECRET_KEY', 'toss-overseas-card-secret-key'],
  ['TOSS_FOREIGN_EASY_PAY_SECRET_KEY', 'toss-foreign-easy-pay-secret-key'],
  ['QR_TICKET_SECRET', 'qr-ticket-secret'],
  ['QR_TICKET_SECRET_VERSION', 'qr-ticket-secret-version'],
  ['QR_TICKET_SECRET_KEYRING_JSON', 'qr-ticket-secret-keyring-json'],
];

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertSlug(value, name) {
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(value)) {
    throw new Error(`${name} must be a lowercase resource slug`);
  }
}

function assertPositiveNumber(value, name) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function assertHttpsOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error(`${name} must be an HTTPS origin`);
  }
}

function plainEnv(name, value) {
  return { name, value };
}

function secretEnv(name, secret) {
  return {
    name,
    valueSource: {
      secretKeyRef: {
        secret,
        version: 'latest',
      },
    },
  };
}

export function buildBackgroundWorkerJob(env) {
  const projectId = required(env, 'GCP_PROJECT_ID');
  const region = required(env, 'GCP_REGION');
  const artifactRepository = required(env, 'AR_REPO');
  const apiService = required(env, 'API_SERVICE');
  const workerJob = required(env, 'BACKGROUND_WORKER_JOB');
  const deploySha = required(env, 'DEPLOY_SHA');
  const valkeyMode = required(env, 'VALKEY_MODE');
  const frontendUrl = required(env, 'CLOUD_RUN_WEB_URL');
  const paypalKrwUsdRate = required(env, 'PAYPAL_KRW_USD_RATE');
  const dbPoolMax = required(env, 'DB_POOL_MAX');
  const cloudSqlConnectionName = required(env, 'CLOUD_SQL_CONNECTION_NAME');

  for (const [value, name] of [
    [projectId, 'GCP_PROJECT_ID'],
    [region, 'GCP_REGION'],
    [artifactRepository, 'AR_REPO'],
    [apiService, 'API_SERVICE'],
    [workerJob, 'BACKGROUND_WORKER_JOB'],
  ]) {
    assertSlug(value, name);
  }
  if (!/^[0-9a-f]{40}$/.test(deploySha)) {
    throw new Error('DEPLOY_SHA must be a full Git commit SHA');
  }
  if (valkeyMode !== 'cluster' && valkeyMode !== 'standalone') {
    throw new Error('VALKEY_MODE must be cluster or standalone');
  }
  assertHttpsOrigin(frontendUrl, 'CLOUD_RUN_WEB_URL');
  assertPositiveNumber(paypalKrwUsdRate, 'PAYPAL_KRW_USD_RATE');
  assertPositiveNumber(dbPoolMax, 'DB_POOL_MAX');
  if (!cloudSqlConnectionName.startsWith(`${projectId}:${region}:`)) {
    throw new Error('CLOUD_SQL_CONNECTION_NAME must match the deployment project and region');
  }

  const image = `${region}-docker.pkg.dev/${projectId}/${artifactRepository}/${apiService}:${deploySha}`;
  const name = `projects/${projectId}/locations/${region}/jobs/${workerJob}`;

  return {
    name,
    client: 'github-actions-deploy',
    clientVersion: deploySha.slice(0, 12),
    template: {
      parallelism: 1,
      taskCount: 1,
      template: {
        containers: [
          {
            name: 'background-worker',
            image,
            command: ['node'],
            args: ['dist/worker-main.js'],
            env: [
              plainEnv('NODE_ENV', 'production'),
              plainEnv('VALKEY_MODE', valkeyMode),
              plainEnv('FRONTEND_URL', frontendUrl),
              plainEnv('BOOKING_ENABLED', 'true'),
              plainEnv('PAYPAL_KRW_USD_RATE', paypalKrwUsdRate),
              plainEnv('DB_POOL_MAX', dbPoolMax),
              plainEnv('DB_POOL_IDLE_TIMEOUT_MS', '30000'),
              plainEnv('DB_POOL_CONNECTION_TIMEOUT_MS', '5000'),
              plainEnv('PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS', '0'),
              plainEnv('BACKGROUND_WORKER_WINDOW_MS', '30000'),
              ...SECRET_BINDINGS.map(([envName, secret]) => secretEnv(envName, secret)),
            ],
            resources: {
              limits: {
                cpu: '1',
                memory: '512Mi',
              },
              cpuIdle: false,
            },
            volumeMounts: [
              {
                name: 'cloudsql',
                mountPath: '/cloudsql',
              },
            ],
          },
        ],
        volumes: [
          {
            name: 'cloudsql',
            cloudSqlInstance: {
              instances: [cloudSqlConnectionName],
            },
          },
        ],
        maxRetries: 1,
        timeout: '120s',
        serviceAccount: `grapit-cloudrun@${projectId}.iam.gserviceaccount.com`,
        executionEnvironment: 'EXECUTION_ENVIRONMENT_GEN2',
        vpcAccess: {
          egress: 'PRIVATE_RANGES_ONLY',
          networkInterfaces: [
            {
              network: 'default',
              subnetwork: 'default',
            },
          ],
        },
      },
    },
  };
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  let parsed;

  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = { message: body.slice(0, 1_000) };
  }

  if (!response.ok) {
    throw new Error(`Cloud Run API ${response.status}: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

function requestHeaders(token, projectId) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Goog-User-Project': projectId,
  };
}

async function waitForOperation(operation, token, projectId) {
  let current = operation;
  const deadline = Date.now() + 180_000;

  while (!current.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    current = await requestJson(`https://run.googleapis.com/v2/${current.name}`, {
      headers: requestHeaders(token, projectId),
    });
  }

  if (!current.done) {
    throw new Error(`Cloud Run operation timed out: ${current.name}`);
  }
  if (current.error) {
    throw new Error(`Cloud Run operation failed: ${JSON.stringify(current.error)}`);
  }

  return current;
}

async function patchJob(job, token, projectId, validateOnly) {
  const query = validateOnly ? '?validateOnly=true' : '';
  const operation = await requestJson(`https://run.googleapis.com/v2/${job.name}${query}`, {
    method: 'PATCH',
    headers: requestHeaders(token, projectId),
    body: JSON.stringify(job),
  });

  // validateOnly operations are ephemeral: the validated Job is returned in
  // metadata, but the operation is not retained for a follow-up GET.
  if (validateOnly) {
    return operation;
  }

  return waitForOperation(operation, token, projectId);
}

export async function deployBackgroundWorkerJob(env, { validateOnly = false } = {}) {
  const job = buildBackgroundWorkerJob(env);
  const projectId = required(env, 'GCP_PROJECT_ID');
  const token = required(env, 'GOOGLE_OAUTH_ACCESS_TOKEN');

  await patchJob(job, token, projectId, true);
  if (validateOnly) {
    return { job, validated: true, deployed: false };
  }

  await patchJob(job, token, projectId, false);
  const current = await requestJson(`https://run.googleapis.com/v2/${job.name}`, {
    headers: requestHeaders(token, projectId),
  });
  const deployedImage = current.template?.template?.containers?.[0]?.image;
  if (deployedImage !== job.template.template.containers[0].image) {
    throw new Error(`Cloud Run Job image read-back mismatch: ${String(deployedImage)}`);
  }

  return { job, validated: true, deployed: true };
}

async function main() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== '--validate-only');
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);
  }

  const result = await deployBackgroundWorkerJob(process.env, {
    validateOnly: args.includes('--validate-only'),
  });
  const action = result.deployed ? 'deployed' : 'validated';
  console.log(`Background worker Job ${action}: ${result.job.name}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
