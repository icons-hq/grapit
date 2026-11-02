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
const WORKER_METRIC = `metric.type="run.googleapis.com/job/completed_execution_count" AND ${WORKER_RESOURCE}`;
const SUM = { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM' };

export function buildPolicies(channel) {
  assert.match(channel ?? '', /^projects\/grapit-491806\/notificationChannels\/\d+$/, 'An existing channel in the production project is required');
  const policy = (id, name, documentation, conditions, strategy = {}) => ({
    displayName: `Grabit launch: ${name}`, enabled: true, combiner: 'OR',
    userLabels: { managed_by: OWNER, policy_id: id },
    notificationChannels: [channel],
    documentation: { mimeType: 'text/markdown', content: `${documentation}\n\n[장애 대응 절차](${RUNBOOK}). 로그의 주문·계정 식별자와 자격값을 외부 메시지에 복사하지 않는다.` },
    conditions, alertStrategy: { autoClose: '3600s', ...strategy },
  });
  const log = (id, name, filter, documentation) => policy(id, name, documentation,
    [{ displayName: name, conditionMatchedLog: { filter } }],
    { notificationRateLimit: { period: '300s' } });
  const threshold = (displayName, filter, value, extra = {}) => ({ displayName, conditionThreshold: {
    filter, comparison: 'COMPARISON_GT', thresholdValue: value, duration: '0s',
    aggregations: [SUM], trigger: { count: 1 }, ...extra,
  } });
  const apiRequests = 'metric.type="run.googleapis.com/request_count" AND ' + API_RESOURCE;
  const ratioAggregation = [{ alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_RATE', crossSeriesReducer: 'REDUCE_SUM' }];
  return [
    log('purchase-http-errors', 'purchase HTTP or platform failure', `${API_RESOURCE} AND (httpRequest.status>=500 OR (httpRequest.status=429 AND httpRequest.requestUrl=~"/api/v1/(booking/|reservations/prepare|payments/confirm|queue/)"))`,
      'API 5xx 또는 구매/대기열 429가 발생했다. 요청 시각의 Cloud Run 요청 수용·DB 연결·Valkey 상태를 확인한다. 플랫폼에서 거절한 요청은 request_count 지표에서 제외될 수 있어 로그로도 감시한다. 이 정책은 로그 알림이며 오류율 지표와 다르다.'),
    policy('api-error-ratio', 'API error ratio above 1 percent',
      '5분 정렬 구간의 API 5xx/429 비율이 1%를 넘는 상태가 5분 지속됐다. 좌석·예매·결제 원장과 사용자 복구 성공을 함께 확인한다. request_count는 컨테이너에 도달하지 않은 요청을 제외한다.',
      [threshold('API 5xx/429 ratio > 1% for 5 minutes', `${apiRequests} AND (metric.labels.response_code_class="5xx" OR metric.labels.response_code="429")`, .01, {
        duration: '300s', aggregations: ratioAggregation, denominatorFilter: apiRequests, denominatorAggregations: ratioAggregation,
      })]),
    log('transaction-recovery', 'payment or QR recovery requires attention',
      `((${API_RESOURCE}) OR (${WORKER_RESOURCE})) AND ("CRITICAL:" OR "QR_REMINDER_REQUIRES_ATTENTION" OR "QR reminder recovery sweep failed" OR "timeout exceeded when trying to connect" OR "Background worker run failed")`,
      '결제·환불·QR 복구 또는 DB 연결 오류다. PG 상태와 내부 원장을 먼저 대조한다. QR 메일의 미확정 요청은 공급자 수신 내역을 확인하기 전 새 멱등키로 다시 보내지 않는다.'),
    policy('worker-failed', 'background worker execution failed',
      '5분마다 실행하는 예약 작업이 실패했다. 최신 execution 로그와 pg-boss retry/active 작업, 미완료 환불·QR 복구를 확인한다. 사용자 권리나 거래를 임의로 삭제하지 않는다.',
      [threshold('Background worker failed executions > 0', `${WORKER_METRIC} AND metric.labels.result="failed"`, 0)]),
    policy('worker-missing-success', 'background worker has no recent success',
      '최근 12분 동안 정상 종료가 없거나 성공 지표 자체가 12분 누락됐다. Scheduler ENABLED 상태와 진행 중 execution부터 확인한다. 완료 건수 지표는 실패한 주기에도 0을 내보낼 수 있으므로 단순 metric absence만으로 판정하지 않는다.',
      [{ displayName: 'No successful execution in the last 12 minutes', conditionThreshold: {
        filter: `${WORKER_METRIC} AND metric.labels.result="succeeded"`, comparison: 'COMPARISON_LT', thresholdValue: 1, duration: '0s',
        aggregations: [{ ...SUM, alignmentPeriod: '720s' }], trigger: { count: 1 },
      } }, { displayName: 'Success metric absent for 12 minutes', conditionAbsent: {
        filter: `${WORKER_METRIC} AND metric.labels.result="succeeded"`, duration: '720s',
        aggregations: [{ ...SUM, alignmentPeriod: '60s' }], trigger: { count: 1 },
      } }]),
    policy('database-connections', 'database connections near the current limit',
      '현재 max_connections=25인 micro DB의 연결 수가 20개를 넘었다. API 앱/pg-boss·worker·운영 세션별 점유를 확인한다. 판매 중 동시 배포나 worker 중복 실행을 피하고, 사양을 바꾸면 이 임계값도 실측 한도에 맞춰 갱신한다.',
      [threshold('Managed database connections > 20 for 2 minutes', 'metric.type="cloudsql.googleapis.com/database/postgresql/num_backends" AND resource.type="cloudsql_database" AND resource.labels.database_id="grapit-491806:grabit-db-managed-demo"', 20, {
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
        const previous = current.conditions?.find(item => item.displayName === condition.displayName);
        return previous?.name ? { ...condition, name: previous.name } : condition;
      }),
    } : policy };
  });
}

export async function applyPlan(plan, request) {
  const results = [];
  // Cloud Monitoring requires serialized modifications within a project.
  for (const item of plan) {
    const path = item.action === 'create' ? `projects/${PROJECT}/alertPolicies` : item.policy.name;
    assert(path === `projects/${PROJECT}/alertPolicies` || /^projects\/grapit-491806\/alertPolicies\/\d+$/.test(path));
    const result = await request(item.action === 'create' ? 'POST' : 'PATCH', path, item.policy);
    results.push({ id: item.policy.userLabels.policy_id, name: result.name, enabled: result.enabled });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const channel = args.find(value => value.startsWith('--channel='))?.slice(10);
  const output = args.find(value => value.startsWith('--output='))?.slice(9);
  assert(output?.startsWith('/'), 'An absolute --output path is required');
  const desired = buildPolicies(channel);
  const token = execFileSync('gcloud', ['auth', 'print-access-token', `--project=${PROJECT}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const request = async (method, path, body) => {
    const response = await fetch(`https://monitoring.googleapis.com/v3/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Monitoring request failed (${response.status}); credentials suppressed`);
    return response.json();
  };
  const recipient = await request('GET', channel);
  assert.equal(recipient.enabled, true, 'The existing notification channel must be enabled');
  const existing = [];
  let pageToken;
  do {
    const page = await request('GET', `projects/${PROJECT}/alertPolicies?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    existing.push(...(page.alertPolicies ?? [])); pageToken = page.nextPageToken;
  } while (pageToken);
  const plan = planPolicies(desired, existing);
  await mkdir(dirname(output), { recursive: true });
  const result = { generatedAt: new Date().toISOString(), project: PROJECT, channel, mode: args.includes('--apply') ? 'apply' : 'plan', plan };
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (args.includes('--apply')) {
    result.applied = await applyPlan(plan, request);
    result.verified = [];
    for (const item of result.applied) {
      const live = await request('GET', item.name);
      assert.equal(live.enabled, true);
      assert.deepEqual(live.notificationChannels, [channel]);
      assert.equal(live.userLabels?.managed_by, OWNER);
      assert.equal(live.userLabels?.policy_id, item.id);
      result.verified.push({ name: live.name, id: item.id, conditionCount: live.conditions?.length });
    }
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify({ mode: result.mode, policies: plan.length, verified: result.verified?.length ?? 0, output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
