# 운영 용량 전환과 공개망 후속 검증 — 2026-11-02

이전 [격리 부하 결과](booking-launch-readiness-2026-11-02.md)의 통과 구성을 운영에 반영했다. 공연·판매 시각은 미정이며, 기술 전환 완료를 공연 오픈 승인으로 사용하지 않는다. 실물 기기·현장·실금전 결과는 별도다.

## 운영 적용

| 항목 | 적용 결과 |
| --- | --- |
| PostgreSQL | 기존 `grabit-db-managed-demo`를 `db-custom-4-15360`으로 변경. 4 vCPU·15GiB, Zonal 유지 |
| API | 최대 8대 × 2 vCPU·512MiB, concurrency 250, heap 256MiB, application pool 8 |
| 예매 입장 | 공연별 활성 입장 최대 150명 |
| Worker | application pool 2, pg-boss 기본 3, 5분 Scheduler 활성 |
| API pg-boss | producer-only, 기본 pool 1 |
| 연결 예산 | 82개, 실측 한도 500−관리자 예약 3 = 497개 |
| 기본/예열 | API minimum 0, 예열 요청 8대. 공연 미정이므로 정기 예열·축소 예약은 PAUSED |
| Web | 공개 조회 시험 후 최대 12대 × 1 vCPU·1GiB. 서비스/리비전 상한을 함께 적용 |

작업 전 미래 공연·진행 중 결제·환불·활성 입장·대기 세션이 모두 0이었다. 운영 연결 대상을 검증한 Cloud SQL Auth Proxy에서 READ ONLY transaction으로 확인했다. 온디맨드 백업 `1793604712605`가 07:33:23 UTC에 성공한 뒤 예매 게이트를 잠시 닫고 worker Scheduler를 중단했다. DB 변경은 07:41:21 UTC 완료됐다.

[Deploy 41408110841](https://github.com/icons-hq/grapit/actions/runs/41408110841)는 기존 운영 소스 `69010b0bb172848fc6185bb54913f75da106bd70`에 새 repository variable을 적용했다. 신규 migration은 없으며 `MIGRATION_FREEZE=true`를 유지했다. 배포 시 `allow_booking_reopen=true`로 유지보수 전 게이트 상태를 복원했다. 새 공연을 생성하거나 판매 상태를 바꾸지 않았다.

- API `grabit-api-00277-srj`, Web `grabit-web-00222-ksb`에 트래픽 100%. API의 서비스/리비전 최대 8대, CPU 2, pool 8, admission 150, prewarm 상한 8을 readback했다.
- 공개 홈·API health·runtime flags HTTP 200, `bookingEnabled=true`, Valkey 정상. 기본 Python User-Agent를 사용한 첫 홈 probe는 403이었고, 명시적인 배포 smoke User-Agent로 세 경로가 모두 200이었다. 이 차이는 브라우저 실기기 성공으로 기록하지 않는다.
- Scheduler 예열은 같은 API 리비전에서 `0 → 8 → 0`으로 동작했다. Monitoring의 07:51 UTC 실제 인스턴스 합계 8을 확인했고, 시험 후 두 예열 Scheduler 모두 다시 PAUSED다. background worker Scheduler는 재개했다.
- 기존 17개 테이블의 구매자·권리·결제·환불 데이터 보존 검사를 통과했다. 유일한 과거 공연 행 차이는 이전 점검에서 이미 설명한 조회수 1 증가이며 이번 전환의 고객 행 변경·누락은 없다. 신규 대기 migration 0, 진행 중 거래 0이다. 과거 migration ledger 51/source journal 52의 차이는 이전 기록과 같고, 이력을 다시 쓰지 않았다.

DB 계산 비용은 기존 가격 조회의 서울 Zonal 단가·월 730시간 기준 약 $256.45, micro 대비 약 $246.45 증가다. API, 저장 공간·백업·네트워크·세금 등은 별도다. [가격과 SKU 근거](booking-launch-readiness-2026-11-02.md#비용과-전환-조건), [Google Cloud SQL 가격](https://cloud.google.com/sql/pricing). 운영 DB의 single-zone 장애 위험은 사양 증설 후에도 남는다.

## 알림 실제 수신과 오탐 수정

기존 운영 이메일 채널의 Gmail 받은편지함에서 Google Cloud Alerting이 보낸 운영 알림과 복구 메일을 확인했다. 별도 수신처나 시험 메일은 만들지 않았다. 수신 성공을 전체 장애 대응 당직 배정으로 해석하지 않는다.

이 과정에서 `worker-missing-success`의 오탐을 확인했다. 07:13–07:25 UTC에 `/Jobs.RunJob` 성공 종료 감사 로그와 실행 상태는 2회 성공이지만, `run.googleapis.com/job/completed_execution_count` 원본과 12분 합계는 0이었다. 라벨 `result=succeeded`가 맞았고, 60초 원본·720초 집계 양쪽에서 같아 단순 필터/집계 문제나 120초 수집 지연으로 설명되지 않았다. 해당 기본 지표의 내부 누락 원인은 이 저장소에서 단정하지 않는다.

성공 신호를 전용 로그 기반 counter `grabit_launch_worker_success`로 전환했다. 대상은 운영 worker의 `cloudaudit.googleapis.com/system_event`, method `/Jobs.RunJob`, completionTime 존재, succeededCount=1, 실패·취소 없음이다. 과거 실행이 정리되는 `/Jobs.UpdateJob` 삭제 이벤트는 세지 않는다. worker 실패도 실제 종료 감사 로그를 직접 감시한다. 기존 7개 정책의 소유 label과 수신 채널을 유지했다. 다음 07:45:55 UTC 예약 실행 성공이 새 지표에 1로 집계되는 것을 확인했다.

DB 연결 감시는 실측 `max_connections`의 80%로 계산한다. 현재는 400개 초과가 2분 지속될 때 알리며, CLI에 `--database-max-connections`를 반드시 지정해야 한다. 임계값 변경 시 기존 condition ID를 보존한다. 다른 운영자가 소유한 동명 로그 지표를 덮어쓰지 않는다.

새 로그 지표는 과거 로그를 소급 집계하지 않는다. 첫 전환 직후 비어 있던 지표가 잠시 알렸다가 실제 성공 수집 후 1분 13초 만에 복구된 메일도 확인했다. 재현된 초기화 경계를 보완해, 스크립트는 첫 성공 표본을 최대 9분 30초 기다린 뒤 이 지표로 정책을 전환한다. 계속 표본이 없으면 기존 정책을 바꾸지 않고 실패한다. 이미 이 신호를 사용하는 정책의 정상적인 실패/누락 알림은 이 준비 대기를 다시 거치지 않는다.

검증: 기존 지표 0·실제 성공 2회의 회귀가 수정 전 실패했고 수정 후 통과했다. 감시 테스트 9개와 배포 guard 30개를 검증했다. 실제 로그 필터 조회·정책 7개 readback·새 지표 수집을 확인했다. [감시 절차](../runbooks/launch-monitoring.md), [로그 기반 counter 공식 계약](https://docs.cloud.google.com/logging/docs/logs-based-metrics/counter-metrics).

## 공개망 시험

운영과 같은 edge 소스를 별도 Worker에 배포하고, 별도 Cloud Run·Cloud SQL·HA Valkey·합성 계정으로 시험한다. 공개 Worker를 통과하되 Cloud Run origin은 시험 Job의 IAM 인증을 요구한다. 운영 DB·기존 관객·실제 PG를 시험에 사용하지 않는다.

첫 실행 `grabit-load-edge-20261102-xd795`는 시험 서비스 설정의 읽기 권한 부족으로 측정 전에 종료했다. 해당 시험 서비스에만 `roles/run.viewer`를 추가해 재실행했다. 요청 부하 실패나 제품 오류율에 섞지 않는다.

실행 `grabit-load-edge-20261102-bgd4m`, 07:53:48–07:55:36 UTC는 **통과**했다. 예열한 API 8대, 입장 150명, 1,500명 방문, 600석을 네 묶음으로 끝까지 구매한 시험이다. PG 응답은 300ms 대역이고 각 묶음의 결제 확정을 동시에 요청했다.

| p95 | 결과 |
| --- | ---: |
| 공연 상세 | 749ms |
| 좌석 조회 | 563ms |
| 대기열 진입 | 1,248ms |
| 좌석 잠금 | 467ms |
| 예매 준비 | 603ms |
| 결제 확정 | 1,648ms |
| 좌석 갱신 수신 | 484ms |

600석 판매·확정 예매·Ticket Item·QR 각각 600, 남은 900명 WAITING 순서, 활성 상한 150을 확인했다. 정상 요청의 예상하지 않은 오류는 0, 좌석 갱신 90,000건·중복 수신 0, 각 묶음의 관찰 소켓 150개가 승인 완료까지 연결되고 최종 판매 상태를 받았다. 최대 관측 RSS는 194MiB다. 실제 worker `grabit-worker-edge-20261102-jgt6g`가 만료 시험 주문 25개를 정리하며 승인과 겹쳤고 새 잠금은 보존됐다. 의도적인 같은 주문 동시 확정은 네 묶음 각각 `201/503` 후 네 번의 재요청이 모두 같은 예매 `201`이었다. 일반 요청의 오류율과 구분한다.

[결과 JSON](booking-production-cutover-2026-11-02/public-edge-warm.json)은 실제 실행의 공개 Worker URL과 private origin URL도 기록한다. 원래 하네스의 설명 필드에는 과거 private-only 문구가 남아 있어, 불변 execution의 실제 환경변수와 원본 지표를 대조해 범위를 명시했다. 이 시험이 운영 도메인의 WAF 규칙·비밀번호/OAuth 로그인 폭주·실제 PG 지연·실금전·실기기를 검증한 것은 아니다.

### 실제 0대에서의 첫 진입

08:15 UTC Monitoring 원본에서 시험 API의 active·idle 인스턴스가 각각 0인 것을 확인했다. 메타데이터 조회와 DB의 합성 계정 준비만 수행한 뒤, API 예열 요청 없이 공개 Worker를 통해 1,500명이 동시에 대기열에 진입했다. `grabit-load-edge-20261102-5hkrw`의 1,500건 모두 HTTP 201, ADMITTED 150/WAITING 1,350, 오류 0이지만 **p95 13,801ms, 최대 14,247ms로 2초 목표 미달**이다. 새 TCP/TLS 연결과 Cloud Run scale-from-zero를 포함한다. 정합성 통과와 지연 실패를 구분하며 예열 없는 판매 시작을 허용하는 근거로 사용하지 않는다. [원본 수치와 0대 증거](booking-production-cutover-2026-11-02/public-edge-cold.json).

### 운영 도메인의 공개 조회와 Web 용량

실제 `api.heygrabit.com/api/v1/performances`와 `heygrabit.com/api/runtime-flags`에 인증 없는 GET만 실행했다. 고객 상세/주문·결제 API를 호출하지 않았고 모든 응답에 Cloudflare 표시를 확인했다. 아래는 서로 다른 발생기/예열 조건의 단일 관측이며, 조건이 다른 행을 코드 개선 배율로 계산하지 않는다.

| 발생기·Web 조건 | Web 응답 p95 | Cloud Run Web p95 | 결과 |
| --- | ---: | ---: | --- |
| 1개 프로세스, Web 자동 확장 | 11,385ms | 3,045ms | 연결 발생기와 서버 지연이 함께 관측됨 |
| 독립 8개 프로세스, Web 4대 예열 | 3,654ms | 2,218ms | 서버·전체 지연 목표 미달 |
| 독립 8개 프로세스, Web 8대·첫 경로 요청 | 4,628ms | 3,383ms | 인스턴스 수만 늘린 예열은 불충분 |
| 독립 8개 프로세스, Web 8대·경로 예열 | 4,528ms | 644ms | 서버는 개선됐지만 TCP/TLS p95 3,434ms |
| 독립 32개 프로세스, Web 8대·경로 예열 | 2,120ms | 1,701ms | 전체 2초 목표 미달 |
| 독립 32개 프로세스, Web 12대·경로 예열 | **1,737ms** | **1,301ms** | **1,500건 전부 200, 목표 통과** |

최종 실행은 `grabit-public-read-probe-20261102-g7mcq`다. 32개 Job task가 최대 10ms 차이로 총 1,500개의 새 TLS 연결을 시작했다. TCP p95 95ms, TLS p95 331ms, 응답 최대 2,034ms, 보안 challenge·오류 0, 서버에서 관측한 Web 인스턴스 12개다. API 공개 목록은 앞선 독립 8개 발생기·API 예열 8대 조건에서 1,500건 전부 200, 응답 p95 1,686ms, Cloud Run p95 79ms였다. [비교 원본 요약](booking-production-cutover-2026-11-02/public-production-reads.json).

이 결과에 따라 Web 최대값을 **12**로 적용했다. Web CPU/메모리는 1 vCPU/1GiB를 유지하고 `WEB_MAX_INSTANCES=12`, `WEB_MIN_INSTANCES=0`으로 기록했다. Deploy가 revision 최대값뿐 아니라 service 최대값도 함께 갱신하도록 보완했다. 기존 Web 인스턴스 감시의 임계값도 10→12로 맞추고 condition ID·수신 채널·활성 상태를 보존했다. 새 기능이나 인증·결제 계약 변경은 없다.

[`warm-web-routes.mjs`](../../scripts/managed-demo/warm-web-routes.mjs)는 운영 설정을 바꾸지 않는 GET 검사다. Web 최소 12대를 먼저 준비한 뒤 홈 128건·runtime flags 256건을 보내고, Cloud Logging에서 **각 경로별로 현행 동일 리비전의 12개 인스턴스가 200을 반환했는지** 확인한다. 서버 시각·예매 게이트 일관성과 검사 전후 revision/minimum도 검증한다. 08:46:47–08:47:12 UTC 실행에서 `grabit-web-00224-nsr`의 두 경로 각각 12개 인스턴스가 성공했다. 판매 전에는 API 8대와 Web 12대의 실제 경로 예열을 모두 완료해야 한다.

## 정리

부하 시험용 Cloud Run API·load/worker Job, Cloud SQL, Valkey, Worker와 시험 이미지 패키지를 삭제했다. 운영 읽기 점검용 임시 Job도 제거했다. 평상시 API/Web minimum은 0으로 복원했으며, 이번 변경은 판매일을 임의로 정하거나 상시 예열을 예약하지 않는다. 시험 실패 결과도 위 JSON과 비공개 원본에 보존한다.

## 남은 실제 인수

- 판매 공연·시각과 공연별 좌석·가격·결제 수단·번역·취소 안내 확정.
- iPhone 실제 결제 앱 복귀·카메라, 미확보 Android, 두 물리 단말·현장 회선·실물 특전 대조. 현장 책임자는 박상우다.
- 지정 소액 live 거래의 결제 소유자 인증, 실제 취소 반영·PG 정산 원본·은행 자료 대조.
- 장애 대응 담당/대체 담당과 판매일 감시 인수. 알림 수신 자체는 이번에 확인했다.

상세 실행 순서는 [실운영 인수](../runbooks/live-opening-handoff-2026-11-02.md)를 따른다. #214/#223은 위 조건이 남아 있으므로 OPEN으로 유지한다. 비공개 원본과 재실행 도구는 로컬 산출물 `grapit-launch-cutover`에 보관하며 자격값·고객 식별자를 저장소에 넣지 않는다.
