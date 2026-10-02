import assert from 'node:assert/strict';
import test from 'node:test';
import {
  instanceEndpoints,
  maintenanceOverlap,
  parseValkeyExpectations,
  redisUrlHost,
  runtimeContractFailures,
  summarizeMemorystoreInstance,
} from './smoke-valkey-production.mjs';

const OPEN_AT = '2026-10-20T20:00:00+09:00'; // Tuesday 11:00 UTC

const cloudRun = {
  declaredValkeyMode: 'cluster',
  redisUrlBinding: 'secret-bound',
  vpcEgress: 'private-ranges-only',
  networkInterfaces: '[{"network":"default"}]',
  latestReadyRevisionName: 'grabit-api-00300-abc',
  traffic: [{ revisionName: 'grabit-api-00300-abc', percent: 100 }],
};

function openingInstance(overrides = {}) {
  return {
    state: 'ACTIVE',
    mode: 'CLUSTER',
    shardCount: 3,
    replicaCount: 1,
    engineVersion: 'VALKEY_8_0',
    engineConfigs: { 'maxmemory-policy': 'noeviction' },
    endpoints: [{ connections: [{ pscAutoConnection: { ipAddress: '10.20.0.5', port: 6379, connectionType: 'CONNECTION_TYPE_DISCOVERY' } }] }],
    maintenancePolicy: { weeklyMaintenanceWindow: [{ day: 'SUNDAY', startTime: { hours: 18 }, duration: '3600s' }] },
    ...overrides,
  };
}

function expectations(env = {}) {
  return parseValkeyExpectations({
    GRABIT_VALKEY_INSTANCE: 'grabit-valkey-opening',
    GRABIT_VALKEY_EXPECTED_MODE: 'cluster',
    GRABIT_SALES_OPEN_AT: OPEN_AT,
    ...env,
  });
}

test('requires the operator to name the instance and topology instead of defaulting to the retired one', () => {
  assert.throws(() => parseValkeyExpectations({ GRABIT_VALKEY_EXPECTED_MODE: 'cluster', GRABIT_SALES_OPEN_AT: 'none' }),
    /GRABIT_VALKEY_INSTANCE/);
  assert.throws(() => parseValkeyExpectations({ GRABIT_VALKEY_INSTANCE: 'grapit-valkey', GRABIT_SALES_OPEN_AT: 'none' }),
    /GRABIT_VALKEY_EXPECTED_MODE/);
  assert.throws(() => parseValkeyExpectations({ GRABIT_VALKEY_INSTANCE: 'x', GRABIT_VALKEY_EXPECTED_MODE: 'pico', GRABIT_SALES_OPEN_AT: 'none' }),
    /cluster or standalone/);
  assert.throws(() => expectations({ GRABIT_SALES_OPEN_AT: '2026-10-20 20:00' }), /offset/);
  assert.throws(() => expectations({ GRABIT_SALES_OPEN_AT: undefined }), /GRABIT_SALES_OPEN_AT/);
  const parsed = expectations();
  assert.equal(parsed.minReplicas, 1);
  assert.equal(parsed.maxmemoryPolicy, 'noeviction');
  assert.equal(parsed.healthClient, 'ioredis-cluster');
  assert.equal(parsed.salesOpenAt.toISOString(), '2026-10-20T11:00:00.000Z');
  assert.equal(expectations({ GRABIT_SALES_OPEN_AT: 'none' }).salesOpenAt, null);
  assert.deepEqual(expectations({ GRABIT_VALKEY_EXPECTED_MODE: 'standalone' }).liveModes, ['CLUSTER_DISABLED', 'STANDALONE']);
});

test('passes only when the described instance is the one REDIS_URL actually targets with the opening posture', () => {
  const memorystore = summarizeMemorystoreInstance('grabit-valkey-opening', openingInstance());
  const failures = runtimeContractFailures(cloudRun, memorystore, expectations(), { host: redisUrlHost('redis://10.20.0.5:6379'), error: null });
  assert.deepEqual(failures, []);
});

test('fails when smoke describes a retained old instance after REDIS_URL was cut over', () => {
  const retired = summarizeMemorystoreInstance('grapit-valkey', openingInstance({
    endpoints: undefined,
    discoveryEndpoints: [{ address: '10.9.0.3', port: 6379 }],
  }));
  const failures = runtimeContractFailures(cloudRun, retired, expectations({ GRABIT_VALKEY_INSTANCE: 'grapit-valkey' }),
    { host: '10.20.0.5', error: null });
  assert.ok(failures.includes('REDIS_URL host is not a writable endpoint of grapit-valkey'), failures.join('; '));
  const unread = runtimeContractFailures(cloudRun, retired, expectations(), { host: null, error: 'secret redis-url:7 unreadable' });
  assert.ok(unread.some((failure) => failure.startsWith('REDIS_URL target=')));
});

test('rejects a reader endpoint, zero replicas, an engine-default eviction policy and the wrong live mode', () => {
  const managedDemo = summarizeMemorystoreInstance('grabit-valkey-managed-demo', openingInstance({
    mode: 'CLUSTER_DISABLED',
    replicaCount: undefined,
    engineConfigs: undefined,
    endpoints: [{ connections: [
      { pscAutoConnection: { ipAddress: '10.30.0.2', connectionType: 'CONNECTION_TYPE_PRIMARY' } },
      { pscAutoConnection: { ipAddress: '10.30.0.3', connectionType: 'CONNECTION_TYPE_READER' } },
    ] }],
  }));
  assert.equal(managedDemo.replicaCount, 0);
  assert.equal(managedDemo.maxmemoryPolicy, null);
  const failures = runtimeContractFailures(cloudRun, managedDemo, expectations(), { host: '10.30.0.3', error: null });
  for (const expected of [
    'REDIS_URL host is not a writable endpoint of grabit-valkey-managed-demo',
    'Memorystore mode=CLUSTER_DISABLED (expected CLUSTER)',
    'Memorystore replicaCount=0 (minimum 1)',
    'maxmemory-policy=engine-default (expected noeviction)',
  ]) {
    assert.ok(failures.includes(expected), `${expected} missing from ${failures.join('; ')}`);
  }

  const standalone = runtimeContractFailures({ ...cloudRun, declaredValkeyMode: 'standalone' },
    summarizeMemorystoreInstance('grabit-valkey-managed-demo', openingInstance({
      mode: 'CLUSTER_DISABLED', replicaCount: undefined,
      endpoints: [{ connections: [{ pscAutoConnection: { ipAddress: '10.30.0.2', connectionType: 'CONNECTION_TYPE_PRIMARY' } }] }],
    })),
    expectations({ GRABIT_VALKEY_EXPECTED_MODE: 'standalone', GRABIT_VALKEY_MIN_REPLICAS: '0', GRABIT_SALES_OPEN_AT: 'none' }),
    { host: '10.30.0.2', error: null });
  assert.deepEqual(standalone, []);
});

test('fails when maintenance is unpinned or overlaps the sales protection window', () => {
  const openAt = new Date(OPEN_AT);
  const clear = maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance()), openAt, 6);
  assert.deepEqual(clear, { evaluated: true, overlaps: [], failures: [] });

  const sameDay = maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance({
    maintenancePolicy: { weeklyMaintenanceWindow: [{ day: 'TUESDAY', startTime: { hours: 14 } }] },
  })), openAt, 6);
  assert.deepEqual(sameDay.overlaps, ['weekly TUESDAY 14:00 UTC']);

  const justBefore = maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance({
    maintenancePolicy: { weeklyMaintenanceWindow: [{ day: 'TUESDAY', startTime: { hours: 9, minutes: 30 } }] },
  })), openAt, 6);
  assert.equal(justBefore.failures.length, 1, 'a window ending inside the pre-open hour overlaps');

  const unpinned = maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance({ maintenancePolicy: undefined })), openAt, 6);
  assert.deepEqual(unpinned.failures, ['maintenance window is not pinned (no weeklyMaintenanceWindow)']);

  const scheduled = maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance({
    maintenanceSchedule: { startTime: '2026-10-20T12:00:00Z', endTime: '2026-10-20T13:00:00Z' },
  })), openAt, 6);
  assert.deepEqual(scheduled.overlaps, ['scheduled 2026-10-20T12:00:00Z']);

  assert.deepEqual(maintenanceOverlap(summarizeMemorystoreInstance('i', openingInstance({ maintenancePolicy: undefined })), null, 6),
    { evaluated: false, overlaps: [], failures: [] });
});

test('extracts only the host of a redis URL and every PSC endpoint shape', () => {
  assert.equal(redisUrlHost('rediss://default:secret@10.1.2.3:6378'), '10.1.2.3');
  assert.equal(redisUrlHost('https://10.1.2.3'), null);
  assert.equal(redisUrlHost('not a url'), null);
  assert.deepEqual(instanceEndpoints({
    discoveryEndpoints: [{ address: '10.0.0.1', port: 6379 }],
    pscAutoConnections: [{ ipAddress: '10.0.0.2', connectionType: 'CONNECTION_TYPE_PRIMARY' }],
    endpoints: [{ connections: [{ pscConnection: { ipAddress: '10.0.0.3', connectionType: 'CONNECTION_TYPE_READER' } }] }],
  }).map(({ address, connectionType }) => `${address}:${connectionType}`), [
    '10.0.0.1:CONNECTION_TYPE_DISCOVERY',
    '10.0.0.2:CONNECTION_TYPE_PRIMARY',
    '10.0.0.3:CONNECTION_TYPE_READER',
  ]);
});
