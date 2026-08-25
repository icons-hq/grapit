import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBackgroundWorkerJob,
  deployBackgroundWorkerJob,
} from './deploy-background-worker-v2.mjs';

const validEnv = {
  GCP_PROJECT_ID: 'grapit-491806',
  GCP_REGION: 'asia-northeast3',
  AR_REPO: 'grabit',
  API_SERVICE: 'grabit-api',
  BACKGROUND_WORKER_JOB: 'grabit-background-worker',
  DEPLOY_SHA: '5e2f263d0875a7688a16edfba012f49b26015a3e',
  VALKEY_MODE: 'standalone',
  CLOUD_RUN_WEB_URL: 'https://heygrabit.com',
  PAYPAL_KRW_USD_RATE: '0.00068',
  DB_POOL_MAX: '2',
  CLOUD_SQL_CONNECTION_NAME: 'grapit-491806:asia-northeast3:grabit-db-managed-demo',
};

test('renders one bounded v2 Job with secret references and managed-demo settings', () => {
  const job = buildBackgroundWorkerJob(validEnv);
  const task = job.template.template;
  const container = task.containers[0];

  assert.equal(
    container.image,
    'asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:5e2f263d0875a7688a16edfba012f49b26015a3e',
  );
  assert.equal(container.resources.cpuIdle, false);
  assert.equal(task.maxRetries, 1);
  assert.equal(task.timeout, '120s');
  assert.deepEqual(task.volumes[0].cloudSqlInstance.instances, [
    'grapit-491806:asia-northeast3:grabit-db-managed-demo',
  ]);

  const redisUrl = container.env.find(({ name }) => name === 'REDIS_URL');
  assert.deepEqual(redisUrl, {
    name: 'REDIS_URL',
    valueSource: {
      secretKeyRef: {
        secret: 'redis-url',
        version: 'latest',
      },
    },
  });
  assert.equal(container.env.find(({ name }) => name === 'VALKEY_MODE').value, 'standalone');
  assert.equal(container.env.find(({ name }) => name === 'DB_POOL_MAX').value, '2');
  assert.equal(
    container.env.find(({ name }) => name === 'BACKGROUND_PROCESSING_ENABLED').value,
    'true',
  );
});

test('rejects drift-prone or unsafe deployment inputs', () => {
  assert.throws(
    () => buildBackgroundWorkerJob({ ...validEnv, VALKEY_MODE: 'pico' }),
    /VALKEY_MODE must be cluster or standalone/,
  );
  assert.throws(
    () => buildBackgroundWorkerJob({ ...validEnv, CLOUD_RUN_WEB_URL: 'https://heygrabit.com/path' }),
    /CLOUD_RUN_WEB_URL must be an HTTPS origin/,
  );
  assert.throws(
    () => buildBackgroundWorkerJob({ ...validEnv, CLOUD_SQL_CONNECTION_NAME: 'other:region:db' }),
    /CLOUD_SQL_CONNECTION_NAME must match/,
  );
});

test('allows validate and apply patches to recreate a missing Job', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const expectedImage = buildBackgroundWorkerJob(validEnv).template.template.containers[0].image;

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method ?? 'GET' });
    const body = options.method === 'PATCH'
      ? { name: 'operations/test', done: true }
      : {
          template: {
            template: {
              containers: [{ image: expectedImage }],
            },
          },
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await deployBackgroundWorkerJob({
      ...validEnv,
      GOOGLE_OAUTH_ACCESS_TOKEN: 'test-token',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const patchRequests = requests.filter(({ method }) => method === 'PATCH');
  assert.equal(patchRequests.length, 2);
  for (const { url } of patchRequests) {
    assert.equal(new URL(url).searchParams.get('allowMissing'), 'true');
  }
  assert.equal(new URL(patchRequests[0].url).searchParams.get('validateOnly'), 'true');
  assert.equal(new URL(patchRequests[1].url).searchParams.has('validateOnly'), false);
});
