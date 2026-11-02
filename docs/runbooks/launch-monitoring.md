# 판매 운영 감시

2026-11-02 현재 `grapit-491806`의 API·예약 작업·4 vCPU/15GiB DB·HA Valkey를 감시한다. 공연과 판매 시작 시각은 아직 미정이다. 이 설정 자체가 판매 오픈 승인이나 실제 알림 수신 검증을 뜻하지 않는다.

기존 `Grapit Web Cloud Run instance spike`는 Web 상한 12대에 맞춰 12개 초과가 5분 지속되는 조건으로 갱신했다. 기존 condition ID·수신 채널·활성 상태를 보존했으며, 아래 스크립트가 소유하는 7개 정책과 구분한다. 기존에 활성화된 이메일 알림 채널을 재사용하며 새 수신처를 만들지 않는다.

| 정책 ID | 조건 | 첫 대응 |
| --- | --- | --- |
| `purchase-http-errors` | 운영 API 5xx, 또는 구매·대기열 경로의 429 로그 | Cloud Run 요청 수용 실패, DB 연결, Valkey 상태 확인 |
| `api-error-ratio` | 5분 구간의 API 5xx/429 비율 >1%가 5분 지속 | 같은 시간의 거래 결과·재시도·로그 대조 |
| `transaction-recovery` | API/worker의 `CRITICAL:`, `QR_REMINDER_REQUIRES_ATTENTION`, QR 복구 sweep/worker 실패, DB pool timeout | PG/DB 대조 및 [QR 메일 복구](qr-reminder-recovery.md) 절차 |
| `worker-failed` | `/Jobs.RunJob` 종료 감사 로그의 failedCount >0 | 실행 로그, pg-boss 대기/재시도, 미완료 환불·QR 확인 |
| `worker-missing-success` | 최근 12분 성공 종료 감사 로그 counter 합계 <1 **또는** 해당 metric 12분 누락 | Scheduler 활성·실행 중 작업·최근 성공 시각 확인 |
| `database-connections` | 운영 DB 연결 >400이 2분 지속 | API/worker/운영 세션 점유 확인. 현재 한도 500·관리자 예약 3과 대조 |
| `valkey-state-loss` | 최근 5분의 운영 Valkey eviction 또는 연결 거절 >0 | noeviction·메모리·복제·재접속 확인 |

`request_count`는 컨테이너에 도달하지 못한 플랫폼 거절을 제외하므로 로그 정책을 함께 사용한다. 기본 completed_execution_count 지표가 성공한 예약 실행도 0으로 보고한 것을 확인해, 성공 감시는 `grabit_launch_worker_success` 로그 기반 counter로 전환했다. `/Jobs.RunJob`의 성공 종료만 세며, 과거 실행 삭제 이벤트는 제외한다. 12분 합계와 지표 누락을 함께 검사한다. 로그 알림은 최대 5분에 한 번, 데이터가 사라진 알림의 자동 종료는 1시간으로 설정한다. 이는 장애 복구의 확인 기준이 아니므로 운영자는 원인을 별도로 확인한다.

## 계획·적용·확인

[`scripts/managed-demo/launch-monitoring.mjs`](../../scripts/managed-demo/launch-monitoring.mjs)는 기본적으로 계획 파일만 만든다. `--apply`는 `managed_by=grabit-launch-monitoring` 및 동일 `policy_id`를 가진 정책만 갱신하고, 없으면 생성한다. 이름만 같은 다른 정책은 변경하지 않는다. 소유 설명을 확인한 전용 성공 로그 지표를 먼저 생성/갱신하고 정책을 적용한다. 다른 소유자의 동명 지표는 거절한다. 쓰기는 Google API 요구대로 순차 실행한다. 재적용 시 기존 condition 식별자를 유지한다.

```bash
node scripts/managed-demo/launch-monitoring.mjs \
  --channel=projects/grapit-491806/notificationChannels/13553506668025796880 \
  --database-max-connections=500 \
  --output=/absolute/private/launch-monitoring-plan.json

# 승인된 운영 작업 범위에서 적용한다. 기존 증거를 덮어쓰지 않는 새 경로를 사용한다.
node scripts/managed-demo/launch-monitoring.mjs \
  --channel=projects/grapit-491806/notificationChannels/13553506668025796880 \
  --database-max-connections=500 \
  --output=/absolute/private/launch-monitoring-applied.json \
  --apply

node --test scripts/managed-demo/launch-monitoring.test.mjs
```

토큰은 `gcloud auth print-access-token`에서 프로세스 메모리로만 전달한다. 채널 주소·전화번호·인증값은 결과에 출력하지 않는다. 적용 뒤 각 정책의 활성 상태·채널·소유 label을 다시 조회한다. 일부 적용에 실패하면 새 경로로 재실행해 이미 생성된 정책을 갱신할 수 있다. 정책과 채널은 서로 다른 프로젝트를 지정할 수 없다.

전용 성공 지표를 처음 도입할 때는 과거 로그가 소급 집계되지 않으므로 다음 실제 worker 성공 표본을 최대 9분 30초 기다린 뒤 정책을 전환한다. Scheduler가 중단돼 있거나 성공이 수집되지 않으면 기존 정책을 변경하지 않고 실패한다. worker를 확인한 뒤 새로운 output 경로로 재실행한다. 이미 해당 지표로 감시 중이면 실제 장애/누락 시에도 정책을 재적용할 수 있다.

오탐이나 구성이 잘못됐으면 결과 파일의 해당 **정책 한 개**를 비활성화하고 원인을 확인한다. 기존 다른 정책이나 수신 채널을 삭제하지 않는다. DB/Valkey 교체 또는 운영 한도 변경 시 resource filter와 임계값을 함께 변경한다. Scheduler를 의도적으로 중단하는 별도 운영 모드라면 worker 누락 알림의 적용 여부도 그 전환 계획에 포함한다.

## 2026-11-02 확인 범위

- 운영 read-only 조회: API/Web `3a5c6d0` 100%, worker 동일 이미지, 5분 Scheduler 활성, 최근 성공 5회. 조회한 최근 24시간 API 5xx/429/ERROR 로그는 0건(조회 상한 1,000, 상한 미도달).
- 설정 적용과 readback: 신규 정책 7개 활성. 문서 안내 수정 후 같은 7개를 중복 생성 없이 갱신하고 condition 식별자를 유지했다.
- 검증: managed-demo 스크립트 49개 통과 후 condition 식별자 보존 회귀를 포함한 변경 파일 5개 재검증 통과.
- 후속 점검에서 운영 Gmail 받은편지함의 실제 알림·복구 메일을 확인했다. 기본 worker 지표의 오탐을 재현해 종료 감사 로그 counter로 수정했고, 다음 예약 성공의 지표 1을 확인했다. 별도 시험 알림을 보내지는 않았다. 당일 장애 대응 담당/연락 경로와 Sentry 별도 알림 검증은 공연 확정 시 인수한다. 박상우는 **현장 리허설 담당자**로 지정됐으며 이를 전체 on-call 배정으로 간주하지 않는다.
- 증거: 작업 산출물 `grapit-launch-readiness/operations-snapshot.json`, `monitoring-plan.json`, `monitoring-final.json`. 계획 파일에는 원본 자격값과 수신 주소가 없다.

공식 계약: [로그 기반 알림 구성](https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts), [AlertPolicy 필드](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies), [프로젝트 내 정책 변경 직렬화](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies/create). 지표 타입·label·최근 값은 적용 전에 해당 프로젝트의 Monitoring API에서 직접 조회했다.

후속 운영 적용·오탐 재현·실제 수신 근거는 [2026-11-02 전환 기록](../research/booking-production-cutover-2026-11-02.md)을 따른다. CLI의 `--database-max-connections`는 필수이며 최근 실측값을 넣는다. 현재 500의 80%는 400이고, 과거 micro의 25/20 값을 재사용하지 않는다.
