# 판매 운영 감시

2026-11-02 현재 `grapit-491806`의 API·예약 작업·4 vCPU/15GiB DB·HA Valkey를 감시한다. 공연과 판매 시작 시각은 아직 미정이다. 이 설정 자체가 판매 오픈 승인이나 실제 알림 수신 검증을 뜻하지 않는다.

기존 `Grapit Web Cloud Run instance spike`는 Web 상한 12대에 맞춰 12개 초과가 5분 지속되는 조건으로 갱신했다. 기존 condition ID·수신 채널·활성 상태를 보존했으며, 아래 스크립트가 소유하는 10개 정책과 구분한다. 기존에 활성화된 이메일 알림 채널을 재사용하며 새 수신처를 만들지 않는다.

| 정책 ID | 조건 | 첫 대응 |
| --- | --- | --- |
| `purchase-http-errors` | 운영 API/플랫폼 5xx 로그 — ERROR | Cloud Run 요청 수용 실패, DB 연결, Valkey 상태 확인 |
| `api-error-ratio` | 5분 구간의 API **5xx** 비율 >1%가 5분 지속 — ERROR | 실제 오류 건수·거래 결과·재시도·로그 대조 |
| `api-request-throttled` | SMS 앱 제한 외의 API 429 또는 플랫폼 `no available instance` — WARNING | 구매·로그인 제한 사유와 인스턴스 수용량 확인. SMS 경로의 플랫폼 거절도 포함 |
| `sms-send-failure` | `sms.send_failed`, `sms.pending_marker_failed`, 전체 분/시간 발송 한도 소진 — WARNING | API 400이어도 감지. provider별 Twilio/SENS 처리 결과와 서비스 전체 발송 한도 확인 |
| `sms-rate-limit-burst` | 10분간 `sms.rate_limited` 5건 이상 — WARNING | 재전송 대기·번호별 한도와 실제 인증 완료 여부 확인. 서버 장애와 구분 |
| `transaction-recovery` | API/worker의 `CRITICAL:`, `QR_REMINDER_REQUIRES_ATTENTION`, QR 복구 sweep/worker 실패, DB pool timeout | PG/DB 대조 및 [QR 메일 복구](qr-reminder-recovery.md) 절차 |
| `worker-failed` | `/Jobs.RunJob` 종료 감사 로그의 failedCount >0 | 실행 로그, pg-boss 대기/재시도, 미완료 환불·QR 확인 |
| `worker-missing-success` | 최근 12분 성공 종료 감사 로그 counter 합계 <1 **또는** 해당 metric 12분 누락 | Scheduler 활성·실행 중 작업·최근 성공 시각 확인 |
| `database-connections` | 운영 DB 연결 >400이 2분 지속 | API/worker/운영 세션 점유 확인. 현재 한도 500·관리자 예약 3과 대조 |
| `valkey-state-loss` | 최근 5분의 운영 Valkey eviction 또는 연결 거절 >0 | noeviction·메모리·복제·재접속 확인 |

`request_count`는 컨테이너에 도달하지 못한 플랫폼 거절을 제외하므로 로그 정책을 함께 사용한다. 기본 completed_execution_count 지표가 성공한 예약 실행도 0으로 보고한 것을 확인해, 성공 감시는 `grabit_launch_worker_success` 로그 기반 counter로 전환했다. `/Jobs.RunJob`의 성공 종료만 세며, 과거 실행 삭제 이벤트는 제외한다. 12분 합계와 지표 누락을 함께 검사한다. 로그 알림은 최대 5분에 한 번, 데이터가 사라진 알림의 자동 종료는 1시간으로 설정한다. 이는 장애 복구의 확인 기준이 아니므로 운영자는 원인을 별도로 확인한다.

## 계획·적용·확인

[`scripts/managed-demo/launch-monitoring.mjs`](../../scripts/managed-demo/launch-monitoring.mjs)는 기본적으로 계획 파일만 만든다. `--apply`는 `managed_by=grabit-launch-monitoring` 및 동일 `policy_id`를 가진 정책만 갱신하고, 없으면 생성한다. 이름만 같은 다른 정책은 변경하지 않는다. 선택한 정책에 필요한 로그 지표만 소유 설명을 확인해 생성/갱신한다. 신규 정책을 먼저 만든 뒤 기존 정책을 좁혀 중간 실패 시 이전 감시가 남도록 한다. 다른 소유자의 동명 지표는 거절한다. 쓰기는 Google API 요구대로 순차 실행한다. 재적용 시 기존 condition 식별자를 유지한다.

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

토큰은 `gcloud auth print-access-token`에서 프로세스 메모리로만 전달한다. 채널 주소·전화번호·인증값은 결과에 출력하지 않는다. 계획/적용 파일에는 갱신 전 정책도 저장한다. 적용 뒤 각 정책의 활성 상태·채널·소유 label·심각도·조건 전체를 다시 조회한다. 일부 적용에 실패하면 새 경로로 재실행해 이미 생성된 정책을 갱신할 수 있다. 정책과 채널은 서로 다른 프로젝트를 지정할 수 없다.

전용 성공 지표를 처음 도입할 때는 과거 로그가 소급 집계되지 않으므로 다음 실제 worker 성공 표본을 최대 9분 30초 기다린 뒤 정책을 전환한다. Scheduler가 중단돼 있거나 성공이 수집되지 않으면 기존 정책을 변경하지 않고 실패한다. worker를 확인한 뒤 새로운 output 경로로 재실행한다. 이미 해당 지표로 감시 중이면 실제 장애/누락 시에도 정책을 재적용할 수 있다.

오탐이나 구성이 잘못됐으면 결과 파일의 해당 **정책 한 개**를 비활성화하고 원인을 확인한다. 기존 다른 정책이나 수신 채널을 삭제하지 않는다. DB/Valkey 교체 또는 운영 한도 변경 시 resource filter와 임계값을 함께 변경한다. Scheduler를 의도적으로 중단하는 별도 운영 모드라면 worker 누락 알림의 적용 여부도 그 전환 계획에 포함한다.

## 2026-11-02 확인 범위

- 운영 read-only 조회: API/Web `3a5c6d0` 100%, worker 동일 이미지, 5분 Scheduler 활성, 최근 성공 5회. 조회한 최근 24시간 API 5xx/429/ERROR 로그는 0건(조회 상한 1,000, 상한 미도달).
- 설정 적용과 readback: 신규 정책 7개 활성. 문서 안내 수정 후 같은 7개를 중복 생성 없이 갱신하고 condition 식별자를 유지했다.
- 검증: managed-demo 스크립트 49개 통과 후 condition 식별자 보존 회귀를 포함한 변경 파일 5개 재검증 통과.
- 후속 점검에서 운영 Gmail 받은편지함의 실제 알림·복구 메일을 확인했다. 기본 worker 지표의 오탐을 재현해 종료 감사 로그 counter로 수정했고, 다음 예약 성공의 지표 1을 확인했다. 별도 시험 알림을 보내지는 않았다. 당일 장애 대응 담당/연락 경로와 Sentry 별도 알림 검증은 공연 확정 시 인수한다. 박상우는 **현장 리허설 담당자**로 지정됐으며 이를 전체 on-call 배정으로 간주하지 않는다.
- 증거: 작업 산출물 `grapit-launch-readiness/operations-snapshot.json`, `monitoring-plan.json`, `monitoring-final.json`. 계획 파일에는 원본 자격값과 수신 주소가 없다.

공식 계약: [로그 기반 알림 구성](https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts), [AlertPolicy 필드](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies), [프로젝트 내 정책 변경 직렬화](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies/create). 지표 타입·label·최근 값은 적용 전에 해당 프로젝트의 Monitoring API에서 직접 조회했다.

후속 운영 적용·오탐 재현·실제 수신 근거는 [2026-11-02 전환 기록](../research/booking-production-cutover-2026-11-02.md)을 따른다. 전체 적용 또는 DB 정책을 포함한 적용에서는 `--database-max-connections`가 필수이며 최근 실측값을 넣는다. 현재 500의 80%는 400이고, 과거 micro의 25/20 값을 재사용하지 않는다.


## 2026-11-16 SMS 경보 분리와 인증 재시도

운영 API의 2026-11-15 20:20–21:00 UTC(한국시간 11월 16일 05:20–06:00) 로그에는 5xx가 없고 `sms/send-code` 429가 3건 있었다. 번호별 시간당 한도를 넘은 6·7·8번째 요청이었다. 해당 시간대 5분 지표의 1/25=4%도 재현했다. 기존 경보는 5xx와 모든 429를 더해 서버 장애와 정상 보호 한도를 혼동시켰다.

Twilio Verify Attempts read-only 조회에서 해당 스페인 번호의 앞선 5건은 `DELIVERED`, 인증 결과는 `unconverted`였다. 전달 실패나 사용자가 문자를 읽었다는 의미로 단정하지 않는다. 별개로 11월 13일 중국 번호의 발송 실패 5건은 `60410`(Fraud Guard 차단)이었다. 정상 번호도 번호 대역 차단의 영향을 받을 수 있으므로 차단을 해제하기 전에 공급자 기록과 고객 제보를 대조한다. `DELIVERY_UNKNOWN` 또는 상태가 없는 중국·말레이시아 건은 실패 확정이 아니다. 계정·전화번호·Verification SID·자격값은 문서에 기록하지 않는다.

- 서버 오류율의 분자는 5xx만 센다. 소수의 문자 재요청 제한은 `grabit_sms_rate_limited` counter에 기록되고 10분 5건 이상에서 경고한다. 이 임계값은 사용자 수가 아닌 거절 요청 수다.
- 문자 발송 실패/서비스 전체 발송 한도는 즉시 별도 경고한다. API가 400을 반환하는 Twilio 거절과 SENS 실패·결과 불명도 포함한다. 전달 후 통신사 실패는 이 앱 로그 정책만으로 감지할 수 없으며 Twilio Attempts 또는 SENS 메시지 결과·공급자 알림도 확인한다. SENS의 `sms.sent`에는 `provider: naver_sens`와 `requestId`가 있고, 실패에는 `providerStatus`/`outcome`이 있다. [중국 SENS 전환·조사 절차](china-sms-sens.md)를 따른다. 경보 설명 텍스트 갱신은 승인된 `--only=sms-send-failure` apply에서 반영하며, 코드 변경만으로 운영 정책이 수정되지는 않는다.
- Nest 텍스트 로그는 event/layer가 서로 다른 줄에 있고 ANSI 색상 문자가 들어 있다. 필터는 이 형식과 `jsonPayload.event/layer` 형식을 모두 처리하며 번호나 계정 label을 만들지 않는다.
- 새 SMS counter는 생성 이전 로그를 소급 집계하지 않는다. 과거 로그에 대한 동일 필터 조회로 분류를 확인하고, 신규 표본은 이후 자연 발생 요청에서 확인한다. 시험 문자·시험 경보를 보내지 않는다.
- 인증 UI는 발송 제한의 종류와 실제 남은 대기시간을 표시하고 버튼을 비활성화한다. 서버의 번호별 대기시간은 Valkey의 남은 TTL을 사용한다. 기존 발송·인증 한도와 Fraud Guard는 유지한다.

DB·worker·Valkey 정책을 건드리지 않고 SMS 관련 정책만 계획/적용한다. `--only`의 오타는 적용 전에 거절된다. 아래 명령은 기본적으로 계획만 만들며 승인된 경보 변경에만 `--apply`를 붙인다.

```bash
node scripts/managed-demo/launch-monitoring.mjs \
  --channel=projects/grapit-491806/notificationChannels/13553506668025796880 \
  --only=purchase-http-errors,api-error-ratio,api-request-throttled,sms-send-failure,sms-rate-limit-burst \
  --output=/absolute/private/sms-monitoring-plan.json
```

작업 시점 검증: 2026-11-16 15:22 KST에 관련 정책 5개(기존 2개 갱신·신규 3개 생성)와 SMS counter를 운영에 적용하고 전체 조건·심각도·수신 채널을 readback했다. API 오류율 정책 ID와 기존 두 정책의 condition ID는 유지했다. 과거 로그 대조는 5xx 3건·문자 발송 실패 5건·SMS 앱 제한 6건, 일반/플랫폼 429 0건이었다. API·화면 재시도 코드는 162개 관련 테스트(실제 Valkey SMS 통합 16개 포함), API/Web 타입 검사, PC 1440×1000·모바일 390×844 렌더링/상호작용을 확인했다. Docker 데몬이 정지돼 통합 테스트의 컨테이너 기동만 독립 로컬 Valkey로 연결했으며 실제 HTTP·서비스·Valkey 로직은 그대로 실행했다. 웹/API 배포와 새 경보의 실제 메일 수신은 이 설정 검증과 별도다.

공식 의미: [Verify Attempts 및 전달 상태](https://www.twilio.com/docs/verify/api/attempts), [Twilio 60410](https://www.twilio.com/docs/api/errors/60410), [Cloud Run 플랫폼 429](https://docs.cloud.google.com/run/docs/troubleshooting#no-available-container-instances).
