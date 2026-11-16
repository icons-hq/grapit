#!/usr/bin/env node
// Plan by default. --apply upserts only policies owned by this script and reuses
// an existing enabled notification channel; it never creates a recipient or
// emits a test alert. Credentials stay in memory.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = 'grapit-491806';
const OWNER = 'grabit-launch-monitoring';
const RUNBOOK = 'https://github.com/icons-hq/grapit/blob/main/docs/runbooks/phase26-cutover-ops.md';
const API_RESOURCE = 'resource.type="cloud_run_revision" AND resource.labels.service_name="grabit-api"';
const WORKER_RESOURCE = 'resource.type="cloud_run_job" AND resource.labels.job_name="grabit-background-worker"';
const WORKER_AUDIT = `${WORKER_RESOURCE} AND log_id("cloudaudit.googleapis.com/system_event") AND protoPayload.methodName="/Jobs.RunJob" AND protoPayload.response.status.completionTime:*`;
export const WORKER_SUCCESS_METRIC = {
  name: 'grabit_launch_worker_success',
  description: `Managed by ${OWNER}. Successful scheduled worker executions from RunJob completion audit events; excludes execution deletion events.`,
  filter: `${WORKER_AUDIT} AND protoPayload.response.status.succeededCount=1 AND NOT protoPayload.response.status.failedCount>0 AND NOT protoPayload.response.status.cancelledCount>0`,
};
const WORKER_SUCCESS_SIGNAL = `metric.type="logging.googleapis.com/user/${WORKER_SUCCESS_METRIC.name}" AND ${WORKER_RESOURCE}`;
const SUM = { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' };
// Nest's current logger emits object properties as separate text lines. Match
// the event line itself; also accept structured JSON after a logger migration.
// Text lines contain ANSI color escapes between the property and its value.
const smsEvent = event => `(jsonPayload.event="${event}" OR textPayload=~"event:.*'${event.replaceAll('.', '[.]')}'")`;
export const SMS_RATE_LIMIT_METRIC = {
  name: 'grabit_sms_rate_limited',
  description: `Managed by ${OWNER}. App-side SMS limits; counts events without phone/account labels.`,
  filter: `${API_RESOURCE} AND ${smsEvent('sms.rate_limited')}`,
};
export const SMS_ALERT_POLICY_IDS = ['purchase-http-errors', 'api-error-ratio', 'api-request-throttled', 'sms-send-failure', 'sms-rate-limit-burst'];

export function buildPolicies(channel, { databaseMaxConnections = 25 } = {}) {
  assert.match(channel ?? '', /^projects\/grapit-491806\/notificationChannels\/\d+$/, 'An existing channel in the production project is required');
  assert(Number.isSafeInteger(databaseMaxConnections) && databaseMaxConnections >= 5 && databaseMaxConnections <= 100_000,
    'Measured database max_connections must be an integer between 5 and 100000');
  const databaseConnectionThreshold = Math.floor(databaseMaxConnections * .8);
  const policy = (id, name, documentation, conditions, strategy = {}, severity) => ({
    displayName: `Grabit launch: ${name}`, enabled: true, combiner: 'OR',
    ...(severity ? { severity } : {}),
    userLabels: { managed_by: OWNER, policy_id: id },
    notificationChannels: [channel],
    documentation: { mimeType: 'text/markdown', content: `${documentation}\n\n[장애 대응 절차](${RUNBOOK}). 로그의 주문·계정 식별자와 자격값을 외부 메시지에 복사하지 않는다.` },
    conditions, alertStrategy: { autoClose: '3600s', ...strategy },
  });
  const log = (id, name, filter, documentation, severity) => policy(id, name, documentation,
    [{ displayName: name, conditionMatchedLog: { filter } }],
    { notificationRateLimit: { period: '300s' } }, severity);
  const threshold = (displayName, filter, value, extra = {}) => ({ displayName, conditionThreshold: {
    filter, comparison: 'COMPARISON_GT', thresholdValue: value, duration: '0s',
    aggregations: [SUM], trigger: { count: 1 }, ...extra,
  } });
  const apiRequests = 'metric.type="run.googleapis.com/request_count" AND ' + API_RESOURCE;
  const ratioAggregation = [{ alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_RATE', crossSeriesReducer: 'REDUCE_SUM' }];
  return [
    log('purchase-http-errors', 'API HTTP 5xx or platform failure', `${API_RESOURCE} AND httpRequest.status>=500`,
      'API 또는 Cloud Run 플랫폼이 5xx를 반환했다. 좌석·예매·결제 영향과 Cloud Run·DB·Valkey 상태를 확인한다. 컨테이너에 도달하지 않은 요청도 로그로 감시한다. 429는 요청 제한 경보에서 별도로 확인한다.', 'ERROR'),
    policy('api-error-ratio', 'API server error ratio above 1 percent',
      '5분 정렬 구간의 API 5xx 비율이 1%를 넘는 상태가 5분 지속됐다. 429는 이 비율에서 제외하고 요청 제한·SMS 경보로 분리한다. 좌석·예매·결제 영향과 실제 오류 건수를 확인한다. request_count는 컨테이너에 도달하지 않은 요청을 제외한다.',
      [threshold('API 5xx ratio > 1% for 5 minutes', `${apiRequests} AND metric.labels.response_code_class="5xx"`, .01, {
        duration: '300s', aggregations: ratioAggregation, denominatorFilter: apiRequests, denominatorAggregations: ratioAggregation,
      })], {}, 'ERROR'),
    log('api-request-throttled', 'API request throttling or unavailable instance',
      `${API_RESOURCE} AND httpRequest.status=429 AND (NOT httpRequest.requestUrl=~"(?i)/api/v1/sms/(send-code|verify-code)/?([?]|$)" OR textPayload:"no available instance")`,
      'SMS 앱 제한 외의 API 429 또는 Cloud Run 수용량 부족이다. 구매·로그인 요청의 제한 사유와 인스턴스 한도를 확인한다. SMS URL이라도 플랫폼의 no available instance 오류는 이 경보에 포함한다.', 'WARNING'),
    log('sms-send-failure', 'SMS provider failure or service send quota exhausted',
      `${API_RESOURCE} AND (${smsEvent('sms.send_failed')} OR ${smsEvent('sms.pending_marker_failed')} OR jsonPayload.layer=("global_send_budget" OR "global_hourly_send_budget") OR textPayload=~"layer:.*'global(_hourly)?_send_budget'")`,
      '인증문자 발송이 실패했거나 서비스 전체 발송 한도가 소진됐다. Twilio providerCode와 전달 기록을 확인한다. 60410은 Fraud Guard 차단이며 정상 번호도 영향을 받을 수 있다. sms.sent는 접수이지 수신 완료가 아니다. 발송 실패가 API 400이어도 이 경보로 감지한다. 보호 한도와 Fraud Guard를 임의로 해제하지 않는다.', 'WARNING'),
    policy('sms-rate-limit-burst', 'SMS request limits reached repeatedly',
      '10분 동안 SMS 앱 제한이 5건 이상 발생했다. 번호별 재전송 대기·시간당 발송 한도·인증 시도 한도와 서비스 전체 한도를 확인한다. 서버 전체 장애를 뜻하지 않는다. 소수의 정상 재요청 제한은 집계만 하고 메일을 보내지 않는다.',
      [threshold('At least 5 SMS limit rejections in 10 minutes', `metric.type="logging.googleapis.com/user/${SMS_RATE_LIMIT_METRIC.name}" AND ${API_RESOURCE}`, 4, {
        aggregations: [{ ...SUM, alignmentPeriod: '600s' }],
      })], {}, 'WARNING'),
    log('transaction-recovery', 'payment or QR recovery requires attention',
      `((${API_RESOURCE}) OR (${WORKER_RESOURCE})) AND ("CRITICAL:" OR "QR_REMINDER_REQUIRES_ATTENTION" OR "QR reminder recovery sweep failed" OR "timeout exceeded when trying to connect" OR "Background worker run failed")`,
      '결제·환불·QR 복구 또는 DB 연결 오류다. PG 상태와 내부 원장을 먼저 대조한다. QR 메일의 미확정 요청은 공급자 수신 내역을 확인하기 전 새 멱등키로 다시 보내지 않는다.'),
    log('worker-failed', 'background worker execution failed',
      `${WORKER_AUDIT} AND protoPayload.response.status.failedCount>0`,
      '5분마다 실행하는 예약 작업이 실패했다. 최신 execution 로그와 pg-boss retry/active 작업, 미완료 환불·QR 복구를 확인한다. 사용자 권리나 거래를 임의로 삭제하지 않는다.',
    ),
    policy('worker-missing-success', 'background worker has no recent success',
      '최근 12분 동안 성공 종료 감사 로그가 없거나 해당 로그 기반 지표가 12분 누락됐다. Scheduler ENABLED 상태와 진행 중 execution부터 확인한다. 기본 completed_execution_count가 성공한 예약 실행을 0으로 보고한 사례가 있어 /Jobs.RunJob 성공 종료 로그를 별도 계수한다. 의도적으로 Scheduler를 중단한 유지보수와 실제 실패를 구분한다.',
      [{ displayName: 'No successful execution in the last 12 minutes', conditionThreshold: {
        filter: WORKER_SUCCESS_SIGNAL, comparison: 'COMPARISON_LT', thresholdValue: 1, duration: '0s',
        aggregations: [{ ...SUM, alignmentPeriod: '720s' }], trigger: { count: 1 },
      } }, { displayName: 'Success metric absent for 12 minutes', conditionAbsent: {
        filter: WORKER_SUCCESS_SIGNAL, duration: '720s',
        aggregations: [{ ...SUM, alignmentPeriod: '60s' }], trigger: { count: 1 },
      } }]),
    policy('database-connections', 'database connections near the current limit',
      `실측 max_connections=${databaseMaxConnections}인 DB의 연결 수가 ${databaseConnectionThreshold}개(80%)를 넘었다. API 앱/pg-boss·worker·운영 세션별 점유를 확인한다. 판매 중 동시 배포나 worker 중복 실행을 피하고, 사양을 바꾸면 이 임계값도 실측 한도에 맞춰 갱신한다.`,
      [threshold('Managed database connections above 80% for 2 minutes', 'metric.type="cloudsql.googleapis.com/database/postgresql/num_backends" AND resource.type="cloudsql_database" AND resource.labels.database_id="grapit-491806:grabit-db-managed-demo"', databaseConnectionThreshold, {
        duration: '120s', aggregations: [{ alignmentPeriod: '60s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_SUM' }],
      })]),
    policy('valkey-state-loss', 'Valkey eviction or connection rejection',
      '운영 Valkey에서 메모리 퇴거나 연결 거절이 발생했다. 좌석 잠금·대기열·확정 lease가 영향을 받을 수 있다. noeviction, 메모리, 복제·failover와 앱 연결 복구를 확인한다.',
      ['total_evicted_keys_count', 'total_rejected_connections_count'].map(metric => threshold(metric + ' > 0',
        `metric.type="memorystore.googleapis.com/instance/stats/${metric}" AND resource.type="memorystore.googleapis.com/Instance" AND resource.labels.instance_id="grabit-valkey-600-ha"`, 0))),
  ];
}

export function planPolicies(desired, existing) {
  return desired.map(policy => {
    const matches = existing.filter(item => item.userLabels?.managed_by === OWNER && item.userLabels?.policy_id === policy.userLabels.policy_id);
    assert(matches.length <= 1, `Duplicate managed policy: ${policy.userLabels.policy_id}`);
    const current = matches[0];
    return { action: current ? 'update' : 'create', policy: current ? {
      ...policy, name: current.name,
      conditions: policy.conditions.map(condition => {
        const previous = current.conditions?.find(item => item.displayName === condition.displayName)
          ?? (current.conditions?.length === 1 && policy.conditions.length === 1
            && ['conditionThreshold', 'conditionMatchedLog'].some(key => current.conditions[0][key] && condition[key])
            ? current.conditions[0] : undefined);
        return previous?.name ? { ...condition, name: previous.name } : condition;
      }),
    } : policy };
  });
}

export async function applyPlan(plan, request) {
  const results = [];
  // Cloud Monitoring requires serialized modifications within a project.
  // Install replacement coverage before narrowing an existing policy. A failed
  // create must leave the older, broader warning in place.
  const ordered = [...plan.filter(item => item.action === 'create'), ...plan.filter(item => item.action === 'update')];
  for (const item of ordered) {
    const path = item.action === 'create' ? `projects/${PROJECT}/alertPolicies` : item.policy.name;
    assert(path === `projects/${PROJECT}/alertPolicies` || /^projects\/grapit-491806\/alertPolicies\/\d+$/.test(path));
    const result = await request(item.action === 'create' ? 'POST' : 'PATCH', path, item.policy);
    results.push({ id: item.policy.userLabels.policy_id, name: result.name, enabled: result.enabled });
  }
  return results;
}

export function planLogMetric(metric, existing) {
  if (existing) {
    assert(existing.description?.startsWith(`Managed by ${OWNER}.`), 'Refusing to change a log metric owned by another operator');
    assert.equal(existing.metricDescriptor?.metricKind, 'DELTA', 'Success metric must be a counter');
    assert.equal(existing.metricDescriptor?.valueType, 'INT64', 'Success metric must count events');
  }
  return { action: existing ? 'update' : 'create', metric };
}

export const planSuccessMetric = existing => planLogMetric(WORKER_SUCCESS_METRIC, existing);

export function selectPolicies(desired, only) {
  if (only === undefined) return desired;
  const ids = only.split(',');
  assert(ids.length > 0 && ids.every(id => desired.some(policy => policy.userLabels.policy_id === id)), 'Unknown --only policy id');
  return desired.filter(policy => ids.includes(policy.userLabels.policy_id));
}

export async function waitForInitialWorkerSuccess(read, pause) {
  // A new logs metric has no backfill. Do not turn its initial zero into a
  // missing-worker incident before one real scheduled completion is collected.
  for (let attempt = 0; attempt < 20; attempt++) {
    const data = await read();
    if (data.timeSeries?.some(series => series.points?.some(point => Number(point.value?.int64Value ?? point.value?.doubleValue) > 0))) return;
    if (attempt < 19) await pause();
  }
  throw new Error('Success log metric has no initial completed execution; existing alert policies were not changed. Verify the worker and retry.');
}

async function main() {
  const args = process.argv.slice(2);
  const channel = args.find(value => value.startsWith('--channel='))?.slice(10);
  const output = args.find(value => value.startsWith('--output='))?.slice(9);
  assert(output?.startsWith('/'), 'An absolute --output path is required');
  const only = args.find(value => value.startsWith('--only='))?.slice(7);
  const measuredLimit = args.find(value => value.startsWith('--database-max-connections='))?.split('=')[1];
  const includesDatabase = !only || only.split(',').includes('database-connections');
  assert(!includesDatabase || measuredLimit, 'An explicit measured --database-max-connections value is required');
  const desired = selectPolicies(buildPolicies(channel, {
    databaseMaxConnections: measuredLimit ? Number(measuredLimit) : 25,
  }), only);
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--project=${PROJECT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const googleRequest = async (service, method, path, body, allowMissing = false) => {
    const response = await fetch(`https://${service}.googleapis.com/${service === 'logging' ? 'v2' : 'v3'}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`${service} request failed (${response.status}); credentials suppressed`);
    return response.json();
  };
  const request = (method, path, body) => googleRequest('monitoring', method, path, body);
  const recipient = await request('GET', channel);
  assert.equal(recipient.enabled, true, 'The existing notification channel must be enabled');
  const existing = [];
  let pageToken;
  do {
    const page = await request('GET', `projects/${PROJECT}/alertPolicies?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    existing.push(...(page.alertPolicies ?? [])); pageToken = page.nextPageToken;
  } while (pageToken);
  const plan = planPolicies(desired, existing);
  const hasPolicy = id => desired.some(policy => policy.userLabels.policy_id === id);
  const metrics = [
    ...(hasPolicy('worker-missing-success') ? [WORKER_SUCCESS_METRIC] : []),
    ...(hasPolicy('sms-rate-limit-burst') ? [SMS_RATE_LIMIT_METRIC] : []),
  ];
  const metricPlans = [];
  for (const metric of metrics) {
    metricPlans.push(planLogMetric(metric, await googleRequest('logging', 'GET', `projects/${PROJECT}/metrics/${metric.name}`, undefined, true)));
  }
  await mkdir(dirname(output), { recursive: true });
  const previousPolicies = existing.filter(policy => plan.some(item => item.policy.name === policy.name))
    .map(policy => Object.fromEntries(['name', 'displayName', 'enabled', 'combiner', 'userLabels', 'notificationChannels', 'documentation', 'conditions', 'alertStrategy', 'severity']
      .filter(key => policy[key] !== undefined).map(key => [key, policy[key]])));
  const result = { generatedAt: new Date().toISOString(), project: PROJECT, channel, mode: args.includes('--apply') ? 'apply' : 'plan', metricPlans, previousPolicies, plan };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (args.includes('--apply')) {
    result.verifiedMetrics = [];
    for (const metricPlan of metricPlans) {
      const metricPath = `projects/${PROJECT}/metrics/${metricPlan.metric.name}`;
      await googleRequest('logging', metricPlan.action === 'create' ? 'POST' : 'PUT',
        metricPlan.action === 'create' ? `projects/${PROJECT}/metrics` : metricPath, metricPlan.metric);
      const metric = await googleRequest('logging', 'GET', metricPath);
      assert.equal(metric.filter, metricPlan.metric.filter);
      assert.notEqual(metric.disabled, true, 'Log metric must be enabled');
      result.verifiedMetrics.push(metric.name);
    }
    const alreadyInitialized = existing.some(policy => policy.userLabels?.managed_by === OWNER
      && policy.userLabels?.policy_id === 'worker-missing-success'
      && policy.conditions?.some(condition => condition.conditionThreshold?.filter === WORKER_SUCCESS_SIGNAL));
    if (hasPolicy('worker-missing-success') && !alreadyInitialized) {
      await writeFile(output, JSON.stringify(result, null, 2) + '\n');
      await waitForInitialWorkerSuccess(() => {
        const query = new URLSearchParams({
          filter: WORKER_SUCCESS_SIGNAL,
          'interval.startTime': new Date(Date.now() - 12 * 60_000).toISOString(),
          'interval.endTime': new Date().toISOString(), view: 'FULL',
        });
        return request('GET', `projects/${PROJECT}/timeSeries?${query}`);
      }, () => new Promise(resolve => setTimeout(resolve, 30_000)));
      result.initialSuccessVerified = true;
    }
    result.applied = await applyPlan(plan, request);
    result.verified = [];
    for (const item of result.applied) {
      const live = await request('GET', item.name);
      assert.equal(live.enabled, true);
      assert.deepEqual(live.notificationChannels, [channel]);
      assert.equal(live.userLabels?.managed_by, OWNER);
      assert.equal(live.userLabels?.policy_id, item.id);
      const desiredPolicy = plan.find(entry => entry.policy.userLabels.policy_id === item.id).policy;
      assert.equal(live.displayName, desiredPolicy.displayName);
      if (desiredPolicy.severity) assert.equal(live.severity, desiredPolicy.severity);
      const conditions = policy => policy.conditions.map(({ name, ...condition }) => condition);
      assert.deepEqual(conditions(live), conditions(desiredPolicy));
      result.verified.push({ name: live.name, id: item.id, conditionCount: live.conditions?.length });
    }
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify({ mode: result.mode, policies: plan.length, verified: result.verified?.length ?? 0, output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
