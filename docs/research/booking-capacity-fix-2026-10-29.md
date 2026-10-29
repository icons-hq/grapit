# 300명 예매 입장과 요청 수용 개선 — 2026-10-29

**합성 구매·좌석 복구 검증 통과.** 사용자는 동시 예매 입장 300명을 선택했으며, 좌석 선택 지연과 작은 비용 증가를 함께 요구했다. 200·250·300명 단기 비교의 잠정 250명 권장은 장시간 시험에서 폐기했다. 운영 배포 완료는 별도의 배포 실행·리비전·live smoke 증거로 확인한다.

## 최종 변경

- 대기 페이지는 서버 상태를 15–20초 주기로 읽으며 `/queue` 상시 연결을 열지 않는다. 서버의 순서·입장권·만료·재입장 정책은 유지한다. 입장 안내는 한 조회 주기와 요청/자동 이동 시간만큼 늦어질 수 있다. 좌석 화면의 Socket.IO 실시간 알림과 Redis 다중 인스턴스 전파는 유지한다.
- 수동 입장을 기다리는 `ADMITTED` 화면도 입장권 종료 시점에 서버 상태를 확인한다. 대기 소켓 제거로 이 만료 경로가 사라지지 않도록 회귀 검증했다.
- 기존 후보의 계정/세션/공연 메타데이터 fresh-read 병합과 JWT 키 준비를 포함한다. 완료된 권한 결과를 캐시하지 않으며 좌석 잠금·예매·PG 확인·QR transaction 경계는 변경하지 않는다.
- 최종 검토 프로파일은 API 최대 4개 × 1 vCPU/512MiB, 요청 concurrency 250, 앱 DB pool 2, heap 256MiB, 동시 예매 입장 300명이다. 평소 최소는 0개다. worker pool 2와 DB/Valkey 사양을 유지한다. 시험은 최소 2개로 시작하며 실제 관측 인스턴스 수와 최대 설정은 구분한다.

## 원인 분리와 실패 기록

1. 기존 방식은 대기자 1,300명의 장시간 요청과 구매 HTTP를 같은 API에 유지했다. 1 vCPU × 2개에서 prepare 시간 초과와 플랫폼 503을 재현했다.
2. WebSocket upgrade 쿠키를 브라우저처럼 저장하도록 고쳐도 실패했다. 해당 실행에서 upgrade GAESA 발급은 0건이었으므로 쿠키 누락을 원인으로 채택하지 않는다. 일반 HTTP의 GAESA만 분리한 실행도 429가 재발했다. 시험용 edge 수정은 배포 후보에서 제거했다.
3. 대기 실시간 연결을 앞 200명으로 줄이면 100명 좌석 관찰 시험은 완주했지만 전원 관찰 장시간 시험에서는 429가 다시 발생했다. CPU만 1→2 vCPU로 올려도 일반 confirm 173건이 실패했다. 대기 연결 제한 또는 CPU 증설만으로 해결됐다고 보지 않는다.
4. 같은 2 vCPU × 2개에서 대기 상시 연결만 없앤 200명 시험은 600석 정합성과 좌석 잠금 알림 120,000건을 통과했고 예상 밖 요청 오류가 0건이었다. 300명에서도 원시 요청 오류 없이 판매를 마쳤지만 잠금 p95 8.86초로 느렸다.
5. 4×1 vCPU/동시 요청 250/pool 2 프로파일은 첫 잠금 p95를 2.36초로 줄였다. 다만 확인 요청 1건과 조회 15건에 ECONNRESET, DB 연결 재설정과 조회 500이 있어 원래 도구는 중단했다. SQL 서버 재시작·연결 수 초과를 뒷받침하는 해당 구간 로그는 없었다. 이 실패를 삭제하거나 성공으로 재분류하지 않는다.

Cloud Monitoring에서 설정상 concurrency와 CPU/메모리에 여유가 있어도 429가 발생했다. 내부 라우팅/ACT의 정확한 인과는 확정하지 않았다. [Cloud Run 문서](https://docs.cloud.google.com/run/docs/triggering/websockets)는 WebSocket도 장시간 HTTP 요청이라고 설명하며, [오류 가이드](https://docs.cloud.google.com/run/docs/troubleshooting)는 최대 인스턴스 한도와 요청 수용 실패를 구분하도록 안내한다. 이번 결과는 특정 요청/연결 패턴과 배포 프로파일의 실측이며, Google 내부 원인을 추정으로 단정하지 않는다.

## 실제 브라우저와 시험 도구의 일치

기존 도구는 Socket.IO 재접속과 confirm 재시도를 껐다. 실제 웹은 좌석 연결을 1–5초 간격으로 최대 10회 복구하고 재가입 뒤 상태를 다시 읽는다. `useConfirmPayment()`는 재시도 가능한 실패만 동일 주문/결제 키로 1·2·4초 뒤 최대 3회 재전송한다. 금액/입장권/좌석 만료의 확정 거절은 반복하지 않는다.

최종 도구는 저장소의 `payment-return.ts`를 타입만 제거해 그대로 가져왔다. [도구 보정 계획](booking-capacity-fix-2026-10-29/browser-fidelity-plan.json)에 정책 소스 hash와 판정 기준을 기록했다. 최초 요청·재시도·최종 완료 시간을 각각 기록하며 원시 오류를 숨기지 않는다. 종전 전체 지연 SLO(잠금/알림 p95 1초, 나머지 2초)와 경로별 원시 오류율 1% 기준은 그대로 남긴다. 구매 완료/복구와 전체 SLO 통과는 별개다.

종전 `holdSeatSocketsThroughCheckout`는 도구가 연결을 닫지 않았다는 뜻이며, 원격 단절 후 생존을 검증하지는 않았다. 최종 실행은 연결 재가입·상태 복원과 각 구간 말미의 관찰자 300명 전원의 연결 및 판매 상태를 추가로 검증한다. 단순히 600석을 판매했다는 이유로 실시간 연결 지속을 통과로 판단하지 않는다.

## 비교 수치와 최종 결과

모두 총 1,500명·600석, 300ms 외부 호출 없는 모의 PG, confirm 1건/초다. 200명은 좌석 200개 연결, 300명은 300개 연결이다. 단일 실행들 사이의 작은 차이는 통계적 개선으로 주장하지 않는다. 단기 10건/초 비교는 별도 원본에 남긴다.

| 조건 | 좌석 잠금 p95 | 예매 준비 p95 | 최초 confirm p95 | 판매 결과 |
| --- | ---: | ---: | ---: | --- |
| [200명·2×2 vCPU](booking-capacity-fix-2026-10-29/noqueue-200-result.json) | 1.36초 | 1.80초 | 0.50초 | 600석 정합성 통과 |
| [300명·2×2 vCPU](booking-capacity-fix-2026-10-29/noqueue-300-dwell-result.json) | 8.86초 | 5.45초 | 0.53초 | 600석 정합성 통과 |
| [300명·최대 4×1 vCPU, 복구 없는 도구](booking-capacity-fix-2026-10-29/scale4-300-dwell-result.json) | 2.36초 | 6.88초 | 0.54초 | 완주 실패 |
| [300명·최대 4×1 vCPU, 브라우저 복구 정책](booking-capacity-fix-2026-10-29/browser4-300-valid-result.json) | 2.59초 | 3.06초 | 0.54초 | 600석 정합성 통과 |

상태는 `capacity_limited`다. 판매/예매/좌석 티켓/QR: `{'confirmed': 600, 'credentials': 600, 'items': 600, 'sold': 600}`. 잠금 p95 2590ms, 준비 p95 3061ms, 재시도 시간을 포함한 confirm p95 544ms. 전체 지연 SLO 통과: `False`. 결제 복구 `{'ordersRetried': 0, 'recoveredOrders': 0, 'retryAttempts': 0, 'unrecoveredOrders': 0}`. 좌석 복구 `{'disconnectReasons': {}, 'reconnectFailures': 0, 'reconnections': 0, 'resyncFailures': 0, 'resyncs': 0}`. 마지막 좌석 연결/판매 상태 `[{'clients': 300, 'connectedAtEnd': 300, 'finalSoldStatesComplete': True}, {'clients': 300, 'connectedAtEnd': 300, 'finalSoldStatesComplete': True}]`.

4대를 미리 예열한 별도 [잠금·예매 준비 진단](booking-capacity-fix-2026-10-29/warm4-300-prepare-result.json)에서는 1,500명 공연 조회 p95가 1.44초(2대에서 확장한 전체 판매 실행은 12.33초), 좌석 잠금 2.38초, 예매 준비 3.13초였고 예상 밖 오류는 0건이었다. API revision과 CPU/pool/concurrency는 그대로, 서비스 최소만 2→4로 바꿨다. 이것은 300건 prepare까지의 진단이며 600석 전체 판매의 추가 반복으로 세지 않는다. 계획된 오픈은 4대 예열 후 시작하고 트래픽이 끝나면 최소 0으로 돌린다. 0대에서의 동시 오픈을 검증한 결과는 아니다.

원시 요청 오류, 재접속/재시도, 최종 논리 실패와 latency SLO는 [case-summary.json](booking-capacity-fix-2026-10-29/case-summary.json) 및 각 결과 원본에 분리했다. `capacity_limited`/Job exit 1은 목표 미달로 보존한다.

## 비용과 DB 예산

2026-10-29 Cloud Billing Catalog의 서울 `asia-northeast3` USD 요청 기반 단가: CPU $0.0000336/vCPU초(SKU `085C-A237-027A`), 메모리 $0.0000035/GiB초(SKU `600C-3782-6708`). [공식 가격](https://cloud.google.com/run/pricing)과 [조회한 서울 SKU](booking-capacity-fix-2026-10-29/seoul-cloud-run-pricing.json)를 함께 보관한다.

| API 구성 | 모든 해당 인스턴스가 1시간 활성일 때 | 기존 2×1 vCPU 대비 추가 | 월 10시간 가정 추가 |
| --- | ---: | ---: | ---: |
| 기존 2×1 vCPU/512MiB | $0.25452 | — | — |
| 2×2 vCPU/512MiB | $0.49644 | $0.24192 | $2.4192 |
| 최대 4×1 vCPU/512MiB | $0.50904 | $0.25452 | $2.5452 |

최소 0개를 유지하므로 최대 4개 설정 자체가 월 고정비 4대분을 뜻하지 않는다. 이 계산은 활성 시간의 컴퓨팅 비용이며 무료 구간·세금·환율·요청 수·네트워크·시작 CPU boost는 제외한다. 상시 최대 가동 시 추가 비용은 30일 기준 약 $183.25이므로, 10시간 예시를 실제 월 청구액으로 오해하지 않는다. SQL·Valkey 고정비와 worker 사양은 이번 프로파일에서 변하지 않는다.

DB 예산은 `4 × (앱 2 + API pg-boss 1) + (worker 앱 2 + pg-boss 3) + 운영/겹침 여유 5 = 22`다. 운영의 측정 한도 `25 − superuser 예약 3 = 22`와 같으며 배포 직전 다시 확인한다. 겹친 구/신 리비전 전체 또는 동시 worker 두 개를 감당하는 예산은 아니다. 큐·결제 세션이 비어 있는 시간에 승인된 CI/CD로 배포한다.

## 검증 및 운영 적용

- 대기 회귀 6개는 앞 200명 연결 구현에서 실패했고, 상태 조회 구현 후 전체 50개가 통과했다. 수동 입장 만료 회귀도 실패를 확인한 뒤 수정했다.
- 설치된 Chrome의 1280px/390px 실제 렌더링을 포함한 대기 경로 10개, 타입 검사 통과. Browser 플러그인이 없어 저장소 Playwright를 사용했다. 결제 복구 페이지 12개·정책 15개도 통과했다.
- 코드 커밋 `f52a135e`의 [CI 40824536165](https://github.com/icons-hq/grapit/actions/runs/40824536165) 통과. 서비스/리비전 상한을 함께 갱신하는 배포 회귀를 포함한 운영 스크립트 51개도 통과했다. 문서·증거를 포함한 마지막 PR head의 required check는 merge 전에 별도로 확인한다.
- DB migration은 추가하지 않았다. `MIGRATION_FREEZE=true`, `BOOKING_ENABLED=true`, worker Scheduler 활성 상태를 유지하며, 운영 DB 사전 점검은 read-only transaction이다. 배포 리비전·최종 변수·live smoke·데이터 보존·임시 자원 정리 증거는 완료 기록에서 확인한다.

실제 PG 승인/환불, 로그인 폭주, 모바일 결제 앱 복귀, 공개 edge 동시 도착, scale-to-zero 오픈, 실제 worker와 겹친 결제 부하, 다중 공연 동시 판매, 현장 QR 스캐너 경쟁은 이 합성 시험으로 검증하지 않았다. 좌석 화면의 실제 인간 선택 시간/이탈률도 측정하지 않았다.

## 시험 유효성과 보존

IAM 전파 전 403, 자체 조회 권한 누락 403, 새 retry-policy 모듈의 패키징 누락은 부하 전 시작 실패로 구분했다. 초기 테스트 모드는 Redis adapter 실패를 로컬 adapter로 허용했으므로 해당 알림 미전달 실행을 제외하고, 운영과 같은 fail-closed 준비 조건으로 다시 시작했다. 이후 API 업무 코드 hash는 `2cc2970a59462a45c08c4be968e960ea67259f9888f6babbe4174e00ca7a04b9`로 고정했다.

`harness/`는 검토용 고정 소스이며 전용 DB/Valkey·private Cloud Run identity·유효 기간 guard 없이는 실행되지 않는다. 비밀값·쿠키·토큰·운영 행 데이터는 저장소에 포함하지 않는다. 실패 결과 원본은 유지하고, 큰 플랫폼 로그는 수량과 첫/마지막 표본을 보존한다. 로그 조회 상한에 도달한 경우 표본 수를 전체 오류 수로 주장하지 않는다.
