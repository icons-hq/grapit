import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifySummary, readK6Summary } from './record-k6-evidence.mjs';

const RECORDER = fileURLToPath(new URL('./record-k6-evidence.mjs', import.meta.url));

// k6 --summary-export shape (legacy format) for a run that exercised the given flows.
function summary({ peakVus = 10000, flows = { read: 6000, queue: 2500, lock: 600, prepare: 550, confirm: 500 }, flowErrors = {}, total } = {}) {
  const requestTotal = total ?? Object.values(flows).reduce((sum, count) => sum + count, 0);
  const metrics = {
    http_req_duration: { avg: 300, 'p(90)': 800, 'p(95)': 1200 },
    http_req_failed: { passes: 2, fails: requestTotal - 2, value: 2 / requestTotal },
    http_reqs: { count: requestTotal, rate: requestTotal / 600 },
    vus: { value: 0, min: 0, max: peakVus },
  };
  for (const [flow, count] of Object.entries(flows)) {
    metrics[`http_reqs{flow:${flow}}`] = { count, rate: count / 600 };
    metrics[`http_req_failed{flow:${flow}}`] = { passes: 0, fails: count, value: flowErrors[flow] ?? 0 };
    metrics[`http_req_duration{flow:${flow}}`] = { avg: 300, 'p(95)': 1100 };
  }
  return { metrics };
}

function classify(gateId, parsed) {
  return classifySummary(gateId, parsed, { p95: 1200, errorRate: 0.001, samples: parsed.metrics.http_reqs.count, source: 'test' });
}

test('a read-only or under-target run cannot become PASS evidence', () => {
  const readOnly = classify('LOAD_10K_BASELINE', summary({ peakVus: 50, flows: { read: 30000 } }));
  assert.equal(readOnly.status, 'BLOCKED');
  assert.match(readOnly.reason, /peak concurrent VUs 50 below gate target 10000/);
  for (const flow of ['queue', 'lock', 'prepare', 'confirm']) {
    assert.match(readOnly.reason, new RegExp(`${flow} path not measured`));
  }

  const underTarget = classify('LOAD_20K_STRESS', summary({ peakVus: 10000 }));
  assert.equal(underTarget.status, 'BLOCKED');
  assert.match(underTarget.reason, /below gate target 20000/);
});

test('PASS requires every purchase flow, the gate peak and per-flow thresholds', () => {
  const pass = classify('LOAD_10K_BASELINE', summary());
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.peakVus, 10000);
  assert.equal(pass.flows.lock.requests, 600);

  const noConfirm = classify('LOAD_10K_BASELINE', summary({ flows: { read: 6000, queue: 2500, lock: 600, prepare: 550 } }));
  assert.equal(noConfirm.status, 'BLOCKED');
  assert.match(noConfirm.reason, /confirm path not measured/);

  const thinQueue = classify('LOAD_10K_BASELINE', summary({ flows: { read: 60000, queue: 100, lock: 400, prepare: 400, confirm: 400 } }));
  assert.equal(thinQueue.status, 'BLOCKED');
  assert.match(thinQueue.reason, /queue share/);

  const failingLocks = classify('LOAD_10K_BASELINE', summary({ flowErrors: { lock: 0.2 } }));
  assert.equal(failingLocks.status, 'FAIL');
  assert.match(failingLocks.reason, /lock error rate 0.2/);
});

test('the CLI records BLOCKED for a read-only summary even with operator approval', async () => {
  const work = await mkdtemp(join(tmpdir(), 'grabit-k6-evidence-'));
  try {
    const baseline = join(work, 'baseline.json');
    const stress = join(work, 'stress.json');
    const out = join(work, 'evidence.json');
    await writeFile(baseline, JSON.stringify(summary({ peakVus: 120, flows: { read: 30000 } })));
    await writeFile(stress, JSON.stringify(summary({ peakVus: 20000 })));
    const parsed = await readK6Summary('LOAD_20K_STRESS', stress);
    assert.equal(parsed.status, 'PASS');
    execFileSync(process.execPath, [RECORDER, '--baseline', baseline, '--stress', stress, '--out', out,
      '--target', 'https://load.example.test/api/v1', '--performance-id', '11111111-1111-4111-8111-111111111111',
      '--showtime-id', '22222222-2222-4222-8222-222222222222', '--window', '2026-10-05 02:00 KST',
      '--approved-by', 'operator', '--approval-token', 'PHASE26_DEDICATED_TEST_EVENT_APPROVED'], { stdio: 'pipe' });
    const evidence = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(evidence.status, 'BLOCKED');
    assert.deepEqual(evidence.checks.map((check) => [check.gateId, check.status]),
      [['LOAD_10K_BASELINE', 'BLOCKED'], ['LOAD_20K_STRESS', 'PASS']]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
