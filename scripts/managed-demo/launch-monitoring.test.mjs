import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPlan, buildPolicies, planPolicies, planSuccessMetric, planLogMetric, selectPolicies, waitForInitialWorkerSuccess, WORKER_SUCCESS_METRIC, SMS_RATE_LIMIT_METRIC, SMS_ALERT_POLICY_IDS } from './launch-monitoring.mjs';

const channel = 'projects/grapit-491806/notificationChannels/1234';

test('one expected SMS limit among 25 requests does not become a server outage', () => {
  const ratio = buildPolicies(channel).find(item => item.userLabels.policy_id === 'api-error-ratio');
  const condition = ratio.conditions[0].conditionThreshold;
  assert.match(condition.filter, /response_code_class="5xx"/);
  assert.doesNotMatch(condition.filter, /429/);
  assert.equal(ratio.severity, 'ERROR');
  const burst = buildPolicies(channel).find(item => item.userLabels.policy_id === 'sms-rate-limit-burst');
  assert.equal(burst.conditions[0].conditionThreshold.thresholdValue, 4);
  assert.equal(burst.conditions[0].conditionThreshold.aggregations[0].alignmentPeriod, '600s');
  assert.equal(burst.severity, 'WARNING');
});

test('successful scheduled executions do not become missing when the native completion counter stays zero', () => {
  // Production 2026-11-02 07:13–07:25 UTC: two successful RunJob audit
  // events, but the native DELTA counter and its 12-minute sum both read 0.
  const observed = new Map([
    ['run.googleapis.com/job/completed_execution_count', 0],
    ['logging.googleapis.com/user/grabit_launch_worker_success', 2],
  ]);
  const policy = buildPolicies(channel).find(item => item.userLabels.policy_id === 'worker-missing-success');
  const condition = policy.conditions.find(item => item.conditionThreshold).conditionThreshold;
  const metric = /metric.type="([^"]+)"/.exec(condition.filter)[1];
  assert(observed.has(metric), 'The success signal must have production evidence');
  assert.equal(observed.get(metric) < condition.thresholdValue, false,
    'Two successful scheduled executions must keep the missing-worker alert healthy');
});

test('resizes the connection alert without replacing its existing condition identity', () => {
  const before = buildPolicies(channel).find(item => item.userLabels.policy_id === 'database-connections');
  assert.equal(before.conditions[0].conditionThreshold.thresholdValue, 20);
  before.name = 'projects/grapit-491806/alertPolicies/42';
  before.conditions[0].name = before.name + '/conditions/100';
  before.conditions[0].displayName = 'Managed database connections > 20 for 2 minutes';
  const after = buildPolicies(channel, { databaseMaxConnections: 500 }).find(item => item.userLabels.policy_id === 'database-connections');
  const update = planPolicies([after], [before])[0];
  assert.equal(update.action, 'update');
  assert.equal(update.policy.conditions[0].name, before.conditions[0].name);
  assert.equal(update.policy.conditions[0].conditionThreshold.thresholdValue, 400);
  assert.match(update.policy.documentation.content, /max_connections=500/);
  for (const value of [0, 4, -1, NaN, Infinity, 500.5, '500', 100001]) {
    assert.throws(() => buildPolicies(channel, { databaseMaxConnections: value }));
  }
});

test('refuses missing, foreign-project and injected notification destinations', () => {
  for (const value of [undefined, '', 'projects/another-project/notificationChannels/1234', channel + '?x=1', channel + '/extra']) {
    assert.throws(() => buildPolicies(value));
  }
});

test('detects missing scheduled work even when the metric keeps emitting zero', () => {
  const policy = buildPolicies(channel).find(item => item.userLabels.policy_id === 'worker-missing-success');
  const lowCount = policy.conditions.find(item => item.conditionThreshold)?.conditionThreshold;
  const absent = policy.conditions.find(item => item.conditionAbsent)?.conditionAbsent;
  assert.equal(policy.combiner, 'OR');
  assert.equal(lowCount.comparison, 'COMPARISON_LT');
  assert.equal(lowCount.thresholdValue, 1);
  assert.equal(lowCount.aggregations[0].perSeriesAligner, 'ALIGN_SUM');
  assert.equal(lowCount.aggregations[0].alignmentPeriod, '720s');
  assert.equal(absent.duration, '720s');
  assert.match(lowCount.filter, /job_name="grabit-background-worker"/);
  assert.match(lowCount.filter, /logging.googleapis.com\/user\/grabit_launch_worker_success/);
  assert.equal(absent.filter, lowCount.filter);
});

test('success log metric cannot count job starts or old execution deletion and cannot take over an unrelated metric', () => {
  const plan = planSuccessMetric(null);
  assert.equal(plan.action, 'create');
  assert.match(plan.metric.filter, /protoPayload.methodName="\/Jobs.RunJob"/);
  assert.match(plan.metric.filter, /protoPayload.response.status.completionTime:\*/);
  assert.match(plan.metric.filter, /succeededCount=1/);
  assert.match(plan.metric.filter, /NOT protoPayload.response.status.failedCount>0/);
  assert.throws(() => planSuccessMetric({ description: 'unrelated metric' }));
  assert.throws(() => planSuccessMetric({ ...WORKER_SUCCESS_METRIC, metricDescriptor: { metricKind: 'GAUGE', valueType: 'INT64' } }));
  assert.equal(planSuccessMetric({ ...WORKER_SUCCESS_METRIC, metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64' } }).action, 'update');
  const failed = buildPolicies(channel).find(item => item.userLabels.policy_id === 'worker-failed');
  assert.match(failed.conditions[0].conditionMatchedLog.filter, /failedCount>0/);
  assert.match(failed.conditions[0].conditionMatchedLog.filter, /protoPayload.methodName="\/Jobs.RunJob"/);
});

test('new success signal waits through empty and zero samples, and fails closed when the worker never completes', async () => {
  const counter = value => ({ timeSeries: [{ points: [{ value: { int64Value: String(value) } }] }] });
  const samples = [{}, counter(0), counter(1)];
  let pauses = 0;
  await waitForInitialWorkerSuccess(async () => samples.shift(), async () => { pauses++; });
  assert.equal(pauses, 2);
  assert.equal(samples.length, 0);
  await assert.rejects(waitForInitialWorkerSuccess(async () => counter(0), async () => {}), /existing alert policies were not changed/);
});

test('does not update an unrelated policy that happens to share the display name', () => {
  const desired = buildPolicies(channel);
  const other = { ...desired[0], name: 'projects/grapit-491806/alertPolicies/42', userLabels: {} };
  assert.equal(planPolicies(desired, [other])[0].action, 'create');
  const conditionName = other.name + '/conditions/100';
  const owned = { ...desired[0], name: other.name, conditions: [{ ...desired[0].conditions[0], name: conditionName }] };
  const update = planPolicies(desired, [owned])[0].policy;
  assert.equal(update.name, other.name);
  assert.equal(update.conditions[0].name, conditionName);
  assert.throws(() => planPolicies(desired, [owned, { ...owned, name: 'projects/grapit-491806/alertPolicies/43' }]));
});

test('serializes policy writes and preserves the same enabled channel', async () => {
  const desired = buildPolicies(channel);
  let active = 0, calls = 0;
  const result = await applyPlan(planPolicies(desired, []), async (method, path, body) => {
    assert.equal(++active, 1);
    assert.equal(method, 'POST');
    assert.equal(path, 'projects/grapit-491806/alertPolicies');
    assert.deepEqual(body.notificationChannels, [channel]);
    assert.equal(body.enabled, true);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { name: `projects/grapit-491806/alertPolicies/${++calls}`, enabled: true };
  });
  assert.equal(result.length, 10);
});

test('a failed replacement creation leaves the old broader warning unchanged', async () => {
  const desired = buildPolicies(channel);
  const old = { ...desired[0], name: 'projects/grapit-491806/alertPolicies/42' };
  const plan = planPolicies([desired[0], desired[2]], [old]);
  const methods = [];
  await assert.rejects(applyPlan(plan, async method => {
    methods.push(method);
    throw new Error('create failed');
  }), /create failed/);
  assert.deepEqual(methods, ['POST']);
});

test('keeps platform failures covered separately from container request metrics', () => {
  const policies = buildPolicies(channel);
  const platform = policies.find(item => item.userLabels.policy_id === 'purchase-http-errors');
  assert.match(platform.conditions[0].conditionMatchedLog.filter, /httpRequest.status>=500/);
  assert.doesNotMatch(platform.conditions[0].conditionMatchedLog.filter, /httpRequest.status=429/);
  const throttled = policies.find(item => item.userLabels.policy_id === 'api-request-throttled');
  assert.match(throttled.conditions[0].conditionMatchedLog.filter, /httpRequest.status=429/);
  assert.match(throttled.conditions[0].conditionMatchedLog.filter, /no available instance/);
  assert.match(throttled.conditions[0].conditionMatchedLog.filter, /NOT httpRequest.requestUrl/);
  assert.equal(platform.conditions.length, 1);
  assert.equal(platform.alertStrategy.notificationRateLimit.period, '300s');
  const critical = policies.find(item => item.userLabels.policy_id === 'transaction-recovery');
  assert.match(critical.conditions[0].conditionMatchedLog.filter, /QR_REMINDER_REQUIRES_ATTENTION/);
});

test('SMS-only plan preserves existing condition identities without touching database, worker or Valkey', () => {
  const policies = buildPolicies(channel);
  const desired = selectPolicies(policies, SMS_ALERT_POLICY_IDS.join(','));
  assert.equal(desired.length, 5);
  assert(!desired.some(policy => /database|worker|valkey/.test(policy.userLabels.policy_id)));
  assert.throws(() => selectPolicies(policies, 'api-error-ratio,typo'));
  assert.throws(() => selectPolicies(policies, ''));
  const previous = { ...desired[1], name: 'projects/grapit-491806/alertPolicies/42',
    conditions: [{ ...desired[1].conditions[0], displayName: 'API 5xx/429 ratio > 1% for 5 minutes', name: 'projects/grapit-491806/alertPolicies/42/conditions/99' }] };
  const changed = planPolicies(desired, [previous]).find(item => item.policy.name === previous.name);
  assert.equal(changed.policy.conditions[0].name, previous.conditions[0].name);
});

test('SMS failures include provider 400s and global budget exhaustion while expected limits use a counter', () => {
  const failure = buildPolicies(channel).find(item => item.userLabels.policy_id === 'sms-send-failure');
  const filter = failure.conditions[0].conditionMatchedLog.filter;
  assert.match(filter, /jsonPayload.event="sms.send_failed"/);
  assert.match(filter, /jsonPayload.event="sms.pending_marker_failed"/);
  assert.match(filter, /global_hourly_send_budget/);
  assert.doesNotMatch(filter, /sms.rate_limited/);
  const metric = planLogMetric(SMS_RATE_LIMIT_METRIC, null);
  assert.equal(metric.action, 'create');
  assert.match(metric.metric.filter, /jsonPayload.event/);
  assert.match(metric.metric.filter, /textPayload/);
  assert.doesNotMatch(metric.metric.filter, /phone|account/);
  const textRegex = /textPayload=~"([^"]+)"/.exec(metric.metric.filter)[1];
  assert.match("  event: \u001b[32m'sms.rate_limited'\u001b[39m,", new RegExp(textRegex));
  assert.doesNotMatch("  event: 'sms.sent',", new RegExp(textRegex));
});
