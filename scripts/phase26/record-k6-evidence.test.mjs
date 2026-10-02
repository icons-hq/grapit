import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOWS, GATES } from '../k6/lib/phase26-load.js';
import {
  GATE_TARGET_VUS,
  MIN_FLOW_REQUESTS,
  QUEUE_ACTIVE_ADMISSION_LIMIT,
  REQUIRED_FLOWS,
  classifySummary,
  readK6Summary,
} from './record-k6-evidence.mjs';

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

  const thinPurchases = classify('LOAD_20K_STRESS', summary({ peakVus: 20000,
    flows: { read: 60000, queue: 25000, lock: 120, prepare: 110, confirm: 100 } }));
  assert.equal(thinPurchases.status, 'BLOCKED');
  assert.match(thinPurchases.reason, /lock requests 120 below 500/);
  assert.match(thinPurchases.reason, /confirm requests 100 below 500/);

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

test('a healthy run bounded by the queue admission cap passes although lock is a tiny share of requests', () => {
  // 10K VUs for 10 minutes: ~1,000 admitted buyers book, ~9,000 WAITING buyers
  // poll the queue every 2s. Lock is ~0.03% of requests, yet every purchase step
  // ran for a full admission wave.
  const queueModel = summary({ flows: { read: 684000, queue: 2515000, lock: 1000, prepare: 1000, confirm: 990 } });
  const result = classify('LOAD_10K_BASELINE', queueModel);
  assert.equal(result.status, 'PASS', result.reason);
  assert.ok(result.flows.lock.share < 0.001);
  assert.deepEqual(result.thresholds.minFlowRequests, { lock: 500, prepare: 500, confirm: 500 });
});

test('keeps gate targets, flows and the admission cap aligned with the k6 script and the API', () => {
  for (const [gateId, gate] of Object.entries(GATES)) assert.equal(GATE_TARGET_VUS[gateId], gate.targetVus, gateId);
  assert.deepEqual(Object.keys(GATE_TARGET_VUS).sort(), Object.keys(GATES).sort());
  assert.deepEqual(REQUIRED_FLOWS, FLOWS);
  const source = readFileSync(fileURLToPath(new URL('../../apps/api/src/modules/queue/queue.service.ts', import.meta.url)), 'utf8');
  const declared = /\bQUEUE_MAX_ACTIVE_ADMISSIONS\s*=\s*([\d_]+)\s*;/.exec(source);
  assert.ok(declared, 'QUEUE_MAX_ACTIVE_ADMISSIONS declaration not found in queue.service.ts');
  assert.equal(QUEUE_ACTIVE_ADMISSION_LIMIT, Number(declared[1].replaceAll('_', '')));
  assert.equal(MIN_FLOW_REQUESTS.lock, QUEUE_ACTIVE_ADMISSION_LIMIT / 2);
});
