# 예매 성능 후보 반복 비교와 배포 보류 — 2026-10-28

**결론: 마지막 후보 B의 예매 준비 지연 악화는 재현되지 않았지만, 양쪽 버전에서 가용성 실패가 반복되어 운영 배포를 보류했다.** 같은 물리 DB·Valkey, 기존 API 사양과 입장 상한 200명으로 A/B 각 4회, 총 8회 비교했다. B를 후속 검증 대상으로 보존하되 배포 승인 기준을 통과한 후보로 표시하지 않는다. 추가 애플리케이션 미세 최적화·운영 배포·상한 변경은 하지 않았다. 소스와 증거는 [Draft PR #240](https://github.com/icons-hq/grapit/pull/240)에 보관한다.

## 비교 대상과 사전 판정 기준

- A: 첫 최적화 후 완료된 소스. 기존 관측 `checkout.prepare` p95 4,277ms. 실행 소스 해시 `afb350fc3ee3f1b60ee6d9bae8c1691d869f684463436a90a0c114722792fc1d`.
- B: 마지막 추가 최적화 후보. 기존 관측 5,949ms. 실행 소스 해시 `2cc2970a59462a45c08c4be968e960ea67259f9888f6babbe4174e00ca7a04b9`.
- A와 B 모두 현재 운영 `7ff9d8b5655ca7a34648b9311bc15a2c0984391f` 위의 미배포 변경이다. A를 현재 운영 버전으로 해석하지 않는다. 보관된 빌드와 소스맵으로 두 버전을 고정했으며 B의 439개 소스맵 내용은 작업 디렉터리의 TypeScript와 일치한다.
- 같은 물리 PostgreSQL·Valkey에서 A1 → B1 → B2 → A2 → A3 → B3 순서로 비교한다. 매회 API 새 리비전, 동일한 90초 정착 시간과 연결 예열, 초기화한 합성 데이터 및 캐시를 사용한다.
- 원래 6회에 실패가 섞여 사전 계획의 보충 한 쌍 A4 → B4까지 실행했다. 총 8회 이후 성공할 때까지 반복하지 않고 별도의 원인 진단 1회를 수행했다. 그 진단은 원래 비교 표본에 합치지 않는다.
- 비교 단위는 독립 실행이다. 한 실행의 600건 요청을 600회의 독립 반복 실험으로 취급하지 않는다. 경로별 p95의 실행 간 중앙값·범위와 짝별 차이를 보고한다.
- 정합성 실패나 예상 밖 오류가 있으면 원인을 구분하고 해당 실행을 성공 표본으로 숨기지 않는다. 후보의 예매 준비 p95 중앙값이 A보다 **10% 및 250ms를 모두 초과하여 느리고 짝별 결과도 악화를 지지하면** 후보에서 제외한다. 이는 실무적인 선택 기준이며 통계적 오차범위나 업계 공통 기준이 아니다. 모호하면 추가 한 쌍으로 확인하고 불확실성을 남긴다.
- 기존 지연 목표(좌석 잠금·좌석 알림 p95 1초, 기타 경로 p95 2초)는 그대로다. 후보 선정과 전체 SLO 달성은 별도로 판정한다.

## 고정 조건

API 두 개, 각각 1 vCPU / 512 MiB, heap 256 MiB, concurrency 1,000, application pool 5. 별도 PostgreSQL 16 `db-f1-micro` / SSD 10 GB / 단일 존. 별도 Valkey `CUSTOM_PICO` primary + replica 1개, multi-zone, standalone, `noeviction`.

합성 사용자 1,500명, 600석, 200명씩 세 구간, 초기 대기 소켓 1,300개와 좌석 관찰 소켓 100개. 좌석 잠금·예매 준비는 구간별 동시 요청, PG는 300ms 모의 응답, 결제 확인은 초당 1건이다. 대기 조회는 15–20초 분산 간격이다. 최종 실행은 profiler를 끈다. 운영 고객 데이터·실제 PG·메일·SMS·운영 worker는 이 환경에 연결하지 않는다.

## 반복 결과와 후보 선택

[분석 결과](booking-release-candidate-2026-10-28/repeated-comparison.json)와 실행별 원본 JSON을 보관했다. 이미지 digest·DB·Valkey·pool 5·상한 200·모의 PG·profiler 비활성 조건을 실행마다 대조했다. [예열 증거](booking-release-candidate-2026-10-28/warm-instance-proof.json)에서 8회 모두 인스턴스 2개를 관측했다.

| 실행 | prepare 시도 / 201 | prepare p95 | 전체 600석 판매 | 예상 밖 실패 |
| --- | ---: | ---: | --- | --- |
| [A1](booking-release-candidate-2026-10-28/a1-result.json) | 400 / 400 | 6,346ms, 부분 측정 | 실패 | 일반 confirm 503 1건, 대기 조회 503 22건 |
| [B1](booking-release-candidate-2026-10-28/b1-result.json) | 600 / 600 | 4,406ms | 완료·정합성 통과 | 대기 조회 503 16건 |
| [B2](booking-release-candidate-2026-10-28/b2-result.json) | 600 / 600 | 3,681ms | 완료·정합성 통과 | 없음 |
| [A2](booking-release-candidate-2026-10-28/a2-result.json) | 600 / 600 | 5,546ms | 완료·정합성 통과 | 없음 |
| [A3](booking-release-candidate-2026-10-28/a3-result.json) | 600 / 600 | 5,504ms | 실패, 599석 | 일반 confirm 503 1건, 대기 조회 503 17건 |
| [B3](booking-release-candidate-2026-10-28/b3-result.json) | 600 / 598 | 5,422ms | 실패, 598석 | prepare 30초 timeout 2건, 대기 조회 503 18건·timeout 4건 |
| [A4](booking-release-candidate-2026-10-28/a4-result.json) | 0 / 0 | 측정 없음 | 초기 진입에서 실패 | 기록된 queue.enter 1,017건 중 429 114건, 좌석 조회 500 2건 |
| [B4](booking-release-candidate-2026-10-28/b4-result.json) | 600 / 600 | 2,857ms | 실패, 473석 | 일반 confirm 597건 중 429 127건, 중복 재조회 429 2건, 대기 조회 429 5,962건·503 29건 |

세 구간 **600건의 prepare 시도가 모두 기록된 실행**을 경로별로 비교하면 A2·A3의 p95 중앙값은 **5,525ms**(범위 5,504–5,546), B1–B4는 **4,043.5ms**(2,857–5,422)다. 관측 차이는 −1,481.5ms, **−26.8%**다. B3의 두 timeout도 원래 측정 알고리즘에서 제외하지 않았다. A1의 400건 부분 측정과 A4는 이 중앙값에 넣지 않았다. 전체 판매 완료 실행만의 보조 비교도 A2 5,546ms 대비 B1·B2 중앙값 4,043.5ms로 같은 방향이다.

실행 순서에 가까운 짝 A1/B1, B2/A2, A3/B3의 prepare p95 차이는 각각 B가 −1,940ms(단, A1 부분 측정), −1,865ms, −82ms다. A4/B4는 A4에 prepare 측정이 없어 비교 불가다. **이전의 +39% 악화는 이번에 재현되지 않았지만, 소수 표본·실패에 따른 측정 누락이 있어 통계적 유의성이나 보편적인 개선율을 주장하지 않는다.**

전체 600석 판매 완료는 A **1/4회**, B **2/4회**, 예상 밖 오류가 없는 전체 완료는 각각 **1/4회**다. 이는 시험 시도 수이며 실제 사용자 성공률 추정치가 아니다. B1의 대기 조회 오류율은 16/36,933, 약 0.043%로 기존 경로별 1% 기준 이하지만 오류 0건은 아니다. B4의 일반 confirm 오류율은 21.27%, 대기 조회는 16.74%로 기준을 크게 초과한다. 의도된 중복 진행 중 confirm의 503은 이 예상 밖 오류 집계와 분리했다. 전체 지연 SLO는 완료 실행에서도 미달이다.

[A2](booking-release-candidate-2026-10-28/a2-queue-audit.json)·[B2](booking-release-candidate-2026-10-28/b2-queue-audit.json)의 독립 읽기 전용 감사는 판매·예매·Ticket Item·QR 각 600개, 활성 입장 0, WAITING 900개를 확인했다. [A3 실패 감사](booking-release-candidate-2026-10-28/a3-failed-queue-audit.json)는 각 599개와 활성 입장 1개를 확인했다. [B4 실패 감사](booking-release-candidate-2026-10-28/b4-failed-queue-audit.json)는 각 473개로 일치했으나 판매를 완료하지 못했다. B4 감사는 부하 종료 약 34분 후라 대기 세션 만료가 이미 진행됐으며, 즉시 종료 시점의 대기 상태 증거로 사용하지 않는다.

## 가용성 실패 진단과 배포 차단 근거

503 로그 일부는 Cloud Run의 인스턴스 연결 오류 또는 비정상 응답 분류이며, A4·B4의 429는 `no available instance`다. 정상적인 대기열 입장 제한 응답과 다르다. [B3 서버·클라이언트 대조](booking-release-candidate-2026-10-28/b3-prepare-client-server-comparison.json)에서 서버는 prepare 600건에 최종 201을 기록했지만 최대 38.91초로, 클라이언트의 30초 제한을 넘긴 두 건이 있었다. 서버에서 나중에 성공했다는 이유로 사용자 timeout을 성공으로 바꾸지 않는다.

[B4 Cloud Monitoring](booking-release-candidate-2026-10-28/b4-capacity-diagnostic.json)에서 실패 구간에도 인스턴스 2개가 있었고, 관측 동시 요청 분포는 설정 1,000보다 낮았다. CPU 평균은 후반 9%에서 약 1.4%로, SQL 연결도 0으로 내려갔다. 조사한 lifecycle 로그에 재시작·OOM의 직접 근거는 없었다. 이는 단순한 CPU·DB 포화 가설을 지지하지 않지만, 집계 지표만으로 짧은 급등이나 플랫폼의 실제 수용 한도를 배제하지는 못한다.

Cloud Run의 [Adaptive Concurrency Tuning](https://docs.cloud.google.com/run/docs/about-instance-autoscaling)은 설정 동시성보다 실제 한도를 낮출 수 있고 배포 시 상태가 초기화된다. [scaling driver 지표](booking-release-candidate-2026-10-28/b4-scaling-recommendations.json)의 ACT 권장 수는 이 구간에서 최대 2였다. 따라서 ACT나 session affinity를 이번 실패의 단독 원인으로 확정하지 않는다. [공식 429 안내](https://docs.cloud.google.com/run/docs/troubleshooting#no_available_container_instances)도 가용 인스턴스 부족과 확장 능력을 확인하도록 한다.

같은 B4 API 리비전을 재배포하지 않은 채 쿠키 포함/전체 제거·새 TCP health 요청을 병행한 [별도 진단](booking-release-candidate-2026-10-28/routing-probe-summary.json)을 추가했다. 원래 부하에 약 0.6 RPS의 진단 요청이 더해지고 리비전이 이미 오래 실행된 조건이므로 A/B 표본에 합치지 않는다. `withoutAffinity`라는 하네스 열은 GCLB 이름만 제거하지만 실제 관측된 쿠키 이름은 GAESA여서 유효한 제거 조건이 아니었다. `noCookies` 열만 전체 쿠키 제거 조건으로 해석한다. 이 제한도 결과에 남겼다.

이 [진단 실행](booking-release-candidate-2026-10-28/routing-result.json)은 600석 판매·정합성을 완료했고 prepare p95는 3,460ms였지만, 대기 조회 36,648건 중 503이 9건 남았다. 해당 오류는 [플랫폼 연결 오류 로그](booking-release-candidate-2026-10-28/routing-errors.json)와 일치했다. 128개 probe 시점의 쿠키 포함·전체 제거 health 요청은 각각 모두 200이었다. 429는 재현되지 않았고 짧은 503 구간을 5초 간격 probe가 같은 요청·같은 순간에 포착한 것도 아니므로, affinity나 TCP 재사용의 인과를 확정하지 않는다.

추가 진단 결과와 관계없이, 재현되지 않는 한 번의 실행으로 8회 비교의 실패를 없애거나 수정 완료를 선언하지 않는다. 실제 웹은 `websocket, polling`을 허용하므로, WebSocket 전용 부하 하네스의 결과만으로 운영 affinity를 끄지도 않는다. [Socket.IO 공식 지침](https://socket.io/docs/v4/using-multiple-nodes/#disabling-http-long-polling)은 polling을 쓸 때 Redis adapter와 별개로 sticky routing이 필요하다고 설명한다.

**다음 작업의 대상은 미세 SQL 최적화가 아니라 Cloud Run 앞단의 요청 수용·연결 실패다.** 대기 WebSocket 약 1,400개도 HTTP 동시 요청 예산을 차지하므로, 활성 입장 200명과 전체 플랫폼 연결 수를 구분해야 한다. 동일 실패 구간에서 요청별 routing/connection 증거를 확보하고 원인을 해결한 뒤 원래 조건의 반복 판매를 통과해야 배포를 재개한다. 사양 확대나 운영 상한 변경을 해결책으로 검증했다고 주장하지 않는다.

## 배포 검증

배포 전 현재 운영 설정을 조회했다. API는 `grabit-api-00268-2sd`, 1 vCPU / 512 MiB, 최대 2개, DB pool 5, admission 200, `BOOKING_ENABLED=true`다. GitHub 배포 변수도 이 값과 일치한다. `MIGRATION_FREEZE=true`를 유지한다. 이번 소스에는 migration 변경이 없다.

초기 운영 DB 조회에서 진행 중 예매·PG 처리·취소 대기·환불 대기는 모두 0건이었다. 운영 migration ledger는 50행이며 최신 timestamp는 `0050_venue_layout_templates`와 일치한다. 빈 격리 DB의 51행을 운영의 기대 개수로 잘못 넣은 첫 사전검사는 실패로 보관했고, 실제 ledger 50행과 기존 배포 guard의 timestamp 비교로 pending migration 0건을 확인했다. ledger나 schema를 수정하지 않았다.

후보 커밋 `a3c62fae321f00477b8dc7c4bab1381229aa0865`의 [CI](https://github.com/icons-hq/grapit/actions/runs/40647638115)는 lint·타입 검사·단위 테스트·실제 PostgreSQL/Valkey 통합·운영 스크립트 검사·API 빌드·로그인 smoke 단계·Toss 테스트 E2E를 통과했다. 이 CI의 모의/테스트 결제 검증은 실제 PG 승인 검증을 대신하지 않는다. 코드 변경은 API 내부 읽기 병합과 권한 조회이므로 새로운 화면 변경은 없으며, 실제 단말 UI 검증은 아래 출시 항목에 남긴다. PR에 제출된 리뷰와 코멘트는 조회 시점에 없었다.

**운영 배포는 실행하지 않았다.** PR은 Draft로 유지한다. 가용성 실패를 예외 승인하거나 기존 오류율·지연 목표를 낮추지 않았다. 운영 변경이 없으므로 배포 후 migration·데이터 대조나 결제 smoke를 수행한 것으로 표시하지 않는다. 기존 운영 상태와 읽기 전용 HTTP 확인은 별도 증거로 보관한다.

[종료 전 운영 대조](booking-release-candidate-2026-10-28/production-unchanged.json)에서 API 리비전 `grabit-api-00268-2sd`, API·SQL·Valkey 설정이 작업 전과 일치했다. [읽기 전용 HTTP 확인](booking-release-candidate-2026-10-28/production-http-after.json)은 API health·웹·runtime flags 200, booking enabled, 미인증 사용자 API 401을 확인했다. 이 확인은 기존 운영 상태의 단건 smoke이며 부하 안정성 증거가 아니다.

## 실제 판매 전 남은 출시 검증

| 검증 | 이번 비교가 증명하는 범위 | 남은 확인 |
| --- | --- | --- |
| 판매 정합성 | 합성 600석 판매·예매·Ticket Item·QR 수량, 중복 확정 수렴, 매진 후 입장 종료 | 실제 공연 가격·좌석·판매 시각·구매 제한·약관 검수 |
| 지연·처리량 | warm API, 입장 200명, 잠금·준비 동시 요청, 결제 확인 1건/초 | 실제 도착·체류 분포, 동시 PG 승인, worker와 겹친 부하. 미달 SLO는 그대로 기록 |
| 대기 체감·이탈 | 모든 합성 구매자가 구매를 완료하는 시나리오 | 실제 입장 슬롯 체류시간, 구매 포기·탭 종료·결제 복귀, 만료 슬롯 반환과 다음 구매자 입장 시간 |
| 실제 PG | 모의 승인 300ms만 포함 | 구매 화면의 국내·해외·간편결제 경로별 실제 승인→예매→QR→취소/환불→좌석 복구. 별도 승인된 주문·좌석·증거로 수행 |
| 로그인·휴대기기 | JWT·세션 권한 회귀와 API 계약 | 실제 비밀번호/OAuth 로그인, iOS·Android 및 Kakao/Twitter 등 인앱 브라우저의 쿠키·결제 앱 복귀 |
| 기동·공개 경로 | 예열된 비공개 Cloud Run API | scale-to-zero cold start, 공개 edge·브라우저 경로, 판매 전 prewarm 및 큐가 비운 후 step-down |
| 현장 입장 | 구매 후 QR credential 수량 | 실제 카메라·망·동시 QR 소비·중복 차단·오프라인 복구. 이번 판매 시험은 현장 스캐너 경쟁을 포함하지 않음 |
| 운영 대응 | 기존 운영 설정과 기본 HTTP의 읽기 전용 확인, 배포는 보류 | 가용성 원인 해소 후 배포·live smoke, 판매 당일 담당자, 경보·대기 안내·rollback/booking gate 확인 |

실제 결제·환불과 메시지 전송을 이번 합성 비교나 단순 배포 smoke로 대체하지 않는다. 기존 [재오픈 인수 문서](../runbooks/show-relaunch-reliability.md)와 [운영 runbook](../runbooks/managed-demo-cost-floor.md), [실제 공연 사전 결제 ADR](../adr/0005-use-admin-pre-open-booking-smoke-on-real-performance.md)의 확인 범위를 함께 사용한다.

## 입장 상한과 과거 Girl Rules 판매

2026-06-04 [PR #137](https://github.com/icons-hq/grapit/pull/137)의 squash 전 코드 이력은 [25→150](https://github.com/icons-hq/grapit/commit/eaeade54f3e59cdb1226801265098500e28f29ba), 이어 [150→1,000](https://github.com/icons-hq/grapit/commit/fe23094b208b46f46b83d51a10003392fa7f6f01)이다. 제한이 좁아 확대했던 기억은 코드 기록과 부합한다. 이 PR에서 200을 설정했다는 기록은 확인하지 못했다.

그날 [배포 설정](https://github.com/icons-hq/grapit/commit/93d78a40deb1687ac40f8a4bc29915529f38842c)은 API 최소 30 / 최대 80개, 각각 2 vCPU / 1 GiB였다. 당시 실제 동시 실행 인스턴스를 재현한 측정은 아니며, 현재 최대 2개·1 vCPU / 512 MiB의 안전한 상한을 그 기록으로 추정할 수 없다.

250·300명으로 상한을 바꾸는 것 자체가 고정 자원을 증설하거나 비용을 25%·50% 늘리지는 않는다. [Cloud Run](https://cloud.google.com/run/pricing)·[Cloud SQL](https://cloud.google.com/sql/pricing)은 자원과 실제 사용 등에 따라 과금하며, [대기 WebSocket도 활성 인스턴스 과금](https://docs.cloud.google.com/run/docs/triggering/websockets)에 영향을 준다. 같은 최대 인스턴스 수·DB 사양에서 입장만 늘리면 처리 능력은 늘지 않으므로, 입장 후 DB 대기·좌석 경쟁·timeout이 악화될 수 있다. [Cloud Run 동시성 지침](https://docs.cloud.google.com/run/docs/about-concurrency)도 애플리케이션의 병렬 처리 능력과 실측에 맞춘 조정을 요구한다.

이번 비교와 기존 운영은 200명을 유지한다. **현재는 200명에서도 가용성 검증에 실패했으므로 250·300명 상향을 권하지 않는다.** 원인 해결 후 250명부터 별도 검증할 수 있으나 아직 검증된 운영값은 아니다. 판단 지표는 입장 대기 단축뿐 아니라 총 판매 완료 시간, 잠금·준비·확정 p95, 오류율과 DB pool 대기다. 입장만 빨라지고 구매 완료가 느려지면 상향의 실익이 없다.

현재 `QueueService`의 활성 입장 권한은 기본 10분이며, prepare의 복구 경로는 입장 시점부터 최장 13분이다. 결제 confirm controller는 확정 시 슬롯 반환을 시도하지만, 탭 닫기·Socket.IO room 탈퇴·구매 포기는 즉시 반환하지 않는다. 권한 만료 뒤 reconcile이 정리한다. 반환된 자리에 다음 구매자를 넣는 reconcile은 대기열 진입·상태 조회로 구동되며, 클라이언트의 기본 대기 조회 간격은 15–20초다. 따라서 상한뿐 아니라 슬롯 체류와 이탈도 대기를 좌우한다. 실제 이탈 비중을 측정하지 않았으므로 이것을 현재 대기 불만의 주원인이라고 단정하지 않는다. 이번 작업은 이 정책을 바꾸지 않는다.

## 실험 정리와 재검증

[삭제 확인](booking-release-candidate-2026-10-28/cleanup-verification.json)에서 이 작업 전용 API·부하 Job·PostgreSQL·Valkey 네 자원이 모두 관리 API 404였다. [이미지 정리](booking-release-candidate-2026-10-28/deleted-test-images.json)는 시험용 원격 이미지 5개의 삭제와 전용 이미지 경로가 비어 있음을 확인했다. 운영·rollback 이미지는 삭제하지 않았다. [로컬 정리](booking-release-candidate-2026-10-28/local-credential-cleanup.json)는 이 작업 디렉터리의 임시 비밀 포함 파일과 불필요한 운영 데이터 fingerprint 원본만 제거했다.

실험 정리는 검증 성공 여부와 별개로 수행했다. 실패 결과를 성공으로 바꾸어 정리 조건을 통과시키지 않았다. 기존 사용자의 미커밋 작업 디렉터리는 보존했고, 별도 작업 브랜치에 후보 코드와 이 보고서를 남겼다.

원본·설정·해시는 동명 증거 디렉터리의 `manifest.json`에 있으며, `python3 docs/research/booking-release-candidate-2026-10-28/analyze-comparison.py`로 저장된 8회 결과의 비교 수치를 다시 계산할 수 있다. 이 명령은 로컬 JSON만 읽고 분석 JSON을 갱신하며 클라우드·DB에 연결하지 않는다.
