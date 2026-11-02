import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPlan, buildPolicies, planPolicies } from './launch-monitoring.mjs';

const channel = 'projects/grapit-491806/notificationChannels/1234';

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
  assert.match(lowCount.filter, /result="succeeded"/);
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
  assert.equal(result.length, 7);
});

test('keeps platform failures covered separately from container request metrics', () => {
  const policies = buildPolicies(channel);
  const platform = policies.find(item => item.userLabels.policy_id === 'purchase-http-errors');
  assert.match(platform.conditions[0].conditionMatchedLog.filter, /httpRequest.status>=500/);
  assert.match(platform.conditions[0].conditionMatchedLog.filter, /httpRequest.status=429/);
  assert.equal(platform.conditions.length, 1);
  assert.equal(platform.alertStrategy.notificationRateLimit.period, '300s');
  const critical = policies.find(item => item.userLabels.policy_id === 'transaction-recovery');
  assert.match(critical.conditions[0].conditionMatchedLog.filter, /QR_REMINDER_REQUIRES_ATTENTION/);
});
