#!/usr/bin/env node
// Read-only route warmup after the operator has raised the Web service minimum.
// Does not change scaling, gates, schedules, accounts, or reservations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const project = 'grapit-491806';
const region = 'asia-northeast3';
const serviceName = 'grabit-web';
const expectedInstances = 12;
const runId = `Grabit-Opening-Warmup/${randomUUID()}`;
const startedAt = new Date().toISOString();
function gcloud(args) {
  return JSON.parse(execFileSync('gcloud', [...args, `--project=${project}`, '--format=json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000,
  }));
}

try {
  const service = gcloud(['run', 'services', 'describe', serviceName, `--region=${region}`]);
  const annotations = service.metadata?.annotations ?? {};
  const revision = service.status?.latestReadyRevisionName;
  assert(revision && revision === service.status.latestCreatedRevisionName, 'Web revision must be Ready');
  assert.equal(service.status.conditions?.find(condition => condition.type === 'Ready')?.status, 'True',
    'Web scaling or deployment is still reconciling');
  assert.equal(Number(annotations['run.googleapis.com/minScale'] ?? 0), expectedInstances,
    'Raise the Web service minimum to twelve before warming routes');
  assert.equal(Number(annotations['run.googleapis.com/maxScale']), expectedInstances, 'Unexpected Web service maximum');
  assert.equal(Number(service.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale']), expectedInstances,
    'Unexpected Web revision maximum');

  const paths = [...Array(256).fill('/api/runtime-flags'), ...Array(128).fill('/')];
  const flags = new Set();
  let completed = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let path; (path = paths.pop());) {
      const before = Date.now();
      const response = await fetch(`https://heygrabit.com${path}`, {
        headers: { 'User-Agent': runId }, cache: 'no-store', signal: AbortSignal.timeout(30_000),
      });
      assert.equal(response.status, 200, `Warmup returned HTTP ${response.status}`);
      if (path === '/api/runtime-flags') {
        const payload = await response.json();
        assert.equal(typeof payload.bookingEnabled, 'boolean', 'Missing booking flag');
        assert(Number.isFinite(payload.serverNow) && payload.serverNow >= before - 5000
          && payload.serverNow <= Date.now() + 5000, 'Invalid server clock sample');
        flags.add(payload.bookingEnabled);
      } else await response.arrayBuffer();
      completed++;
    }
  }));
  assert.equal(flags.size, 1, 'Serving Web instances disagree on the booking gate');
  let observed = new Set();
  let byRoute;
  for (let attempt = 0; attempt < 8; attempt++) {
    const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}" AND resource.labels.revision_name="${revision}" AND httpRequest.userAgent="${runId}" AND httpRequest.status=200 AND timestamp>="${startedAt}"`;
    const entries = gcloud(['logging', 'read', filter, '--limit=500']);
    observed = new Set(entries.map(entry => entry.labels?.instanceId).filter(Boolean));
    byRoute = Object.fromEntries(['/', '/api/runtime-flags'].map(path => [path, new Set(entries
      .filter(entry => new URL(entry.httpRequest.requestUrl).pathname === path)
      .map(entry => entry.labels?.instanceId).filter(Boolean)).size]));
    if (Object.values(byRoute).every(count => count >= expectedInstances)) break;
    if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  assert.equal(observed.size, expectedInstances, 'Warmup did not observe successful requests on all twelve Web instances');
  assert(Object.values(byRoute).every(count => count === expectedInstances), 'A Web route did not reach all twelve instances');
  const after = gcloud(['run', 'services', 'describe', serviceName, `--region=${region}`]);
  assert.equal(after.status.latestReadyRevisionName, revision, 'Web revision changed during warmup; repeat after deployment settles');
  assert.equal(after.status.latestCreatedRevisionName, revision, 'A Web deployment started during warmup');
  assert.equal(after.status.conditions?.find(condition => condition.type === 'Ready')?.status, 'True',
    'Web scaling or deployment changed during warmup');
  assert.equal(Number(after.metadata.annotations['run.googleapis.com/minScale']), expectedInstances,
    'Web minimum changed during warmup');
  console.log(JSON.stringify({ readOnly: true, runId, startedAt, completedAt: new Date().toISOString(),
    revision, completedRequests: completed, successfulInstances: observed.size, successfulInstancesByRoute: byRoute,
    bookingEnabled: [...flags][0] }));
} catch (error) {
  // Never echo gcloud output: service descriptions can contain secret bindings.
  console.error(error instanceof assert.AssertionError ? error.message : 'Web warmup failed; private diagnostics suppressed');
  process.exitCode = 1;
}
