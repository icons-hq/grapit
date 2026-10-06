import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateValkeySalePosture,
  parseProtectedWindow,
  weeklyWindowOccurrences,
} from './verify-valkey-sale-posture.mjs';

// 2026-10-20 is a Tuesday. Opening 20:00-23:00 KST = 11:00-14:00 UTC.
const opening = parseProtectedWindow('2026-10-20T20:00:00+09:00/2026-10-20T23:00:00+09:00');

const salePosture = {
  state: 'ACTIVE',
  mode: 'CLUSTER',
  shardCount: 1,
  replicaCount: 1,
  nodeType: 'HIGHMEM_MEDIUM',
  zoneDistributionConfig: { mode: 'MULTI_ZONE' },
  engineConfigs: { 'maxmemory-policy': 'noeviction' },
  maintenancePolicy: {
    weeklyMaintenanceWindow: [{ day: 'SATURDAY', startTime: { hours: 18 } }],
  },
};

function failedChecks(instance, windows = [opening]) {
  return evaluateValkeySalePosture(instance, { protectedWindows: windows })
    .checks.filter((check) => !check.ok)
    .map((check) => check.name);
}

test('accepts a replicated, multi-zone, non-evicting instance with a safe maintenance window', () => {
  const result = evaluateValkeySalePosture(salePosture, { protectedWindows: [opening] });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
});

test('rejects the managed-demo and legacy single-node postures', () => {
  const managedDemo = {
    state: 'ACTIVE',
    mode: 'CLUSTER_DISABLED',
    shardCount: 1,
    nodeType: 'CUSTOM_PICO',
    zoneDistributionConfig: { mode: 'SINGLE_ZONE', zone: 'asia-northeast3-a' },
  };
  assert.deepEqual(failedChecks(managedDemo), [
    'mode',
    'replicas',
    'zone-distribution',
    'maxmemory-policy',
    'maintenance-window-configured',
  ]);

  const legacy = { ...salePosture, replicaCount: 0, nodeType: 'SHARED_CORE_NANO' };
  assert.deepEqual(failedChecks(legacy), ['replicas', 'node-type']);
});

test('rejects volatile eviction policies that can drop seat locks and queue keys', () => {
  const evicting = { ...salePosture, engineConfigs: { 'maxmemory-policy': 'volatile-lru' } };
  assert.deepEqual(failedChecks(evicting), ['maxmemory-policy']);
  const defaulted = { ...salePosture, engineConfigs: {} };
  assert.deepEqual(failedChecks(defaulted), ['maxmemory-policy']);
});

test('rejects a weekly maintenance window inside the opening window plus buffer', () => {
  // Tuesday 10:00 UTC starts one hour before the 11:00 UTC opening.
  const colliding = {
    ...salePosture,
    maintenancePolicy: { weeklyMaintenanceWindow: [{ day: 'TUESDAY', startTime: { hours: 10 } }] },
  };
  assert.deepEqual(failedChecks(colliding), [`weekly-window-vs-${opening.label}`]);
});

test('rejects already scheduled maintenance that collides with a protected window', () => {
  const scheduled = {
    ...salePosture,
    maintenanceSchedule: {
      startTime: '2026-10-20T15:00:00Z',
      endTime: '2026-10-20T16:00:00Z',
    },
  };
  assert.deepEqual(failedChecks(scheduled), [`scheduled-maintenance-vs-${opening.label}`]);

  const deferred = {
    ...salePosture,
    maintenanceSchedule: { startTime: '2026-10-24T18:00:00Z', endTime: '2026-10-24T19:00:00Z' },
  };
  assert.deepEqual(failedChecks(deferred), []);
});

test('requires at least one protected opening or entry window', () => {
  assert.deepEqual(failedChecks(salePosture, []), ['protected-windows']);
  assert.throws(() => parseProtectedWindow('2026-10-20T20:00:00+09:00'), /Invalid --protect window/);
});

test('expands weekly windows in UTC across the protected range', () => {
  const occurrences = weeklyWindowOccurrences(
    { day: 'TUESDAY', startTime: { hours: 10, minutes: 30 } },
    Date.parse('2026-10-19T00:00:00Z'),
    Date.parse('2026-10-21T00:00:00Z'),
  ).map((occurrence) => new Date(occurrence.start).toISOString());
  assert.ok(occurrences.includes('2026-10-20T10:30:00.000Z'));
});

test('legacy provision script refuses to create the zero-replica node without --legacy-demo', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fakeBin = mkdtempSync(join(tmpdir(), 'grabit-fake-gcloud-'));
  const marker = join(fakeBin, 'gcloud-called');
  try {
    writeFileSync(join(fakeBin, 'gcloud'), `#!/usr/bin/env bash\ntouch '${marker}'\n`);
    chmodSync(join(fakeBin, 'gcloud'), 0o755);
    const result = spawnSync('bash', [join(repoRoot, 'scripts/provision-valkey.sh'), 'demo-project'], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /not a ticket-sale posture/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
