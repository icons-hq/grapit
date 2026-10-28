# 예매 폭주 지연 추가 개선 — 2026-10-28

입장 상한 200명과 API·PostgreSQL·Valkey 사양을 유지한 후속 최적화다. 운영 배포·운영 DB 변경은 포함하지 않는다. 아래 전체 실행은 1,500명·600석 정합성과 오류율 검증을 통과했지만 전체 지연 SLO는 미달이다. 추가 원인 분리 실험까지 마쳤으며, 전체 성능 목표 달성은 확인하지 못했다.

## 코드 변경과 검증된 효과

- 같은 공연의 공개 캐시 조회는 캐시 적중도 진행 중인 요청끼리 공유한다. 1,500개 동시 조회에서 payload GET 1,500회가 1회 예산을 초과하던 회귀 테스트를 통과한다. 완료한 값은 보관하지 않으며, 캐시 우회 조회는 별도 경로로 처리한다.
- 좌석 잠금 정책·판매 상태·층별 좌석도, 예매 준비의 공연·가격·레이아웃 메타데이터 조회를 현재 I/O 턴에서 합친다. 쿼리 시작 뒤 들어온 요청은 새 DB 조회를 사용한다. 서로 다른 공연/회차 키는 독립적으로 진행한다.
- 권한·현재 판매 마감 시각·요청 좌석 판정은 각 요청에서 수행한다. 동의 사전 조회만 묶고 트랜잭션 내 동의 기록은 해당 트랜잭션의 스냅샷을 사용한다.
- JWT 검증 키를 `KeyObject`로 한 번 준비한다. 매 요청 서명·알고리즘·만료 검증과 현재 DB의 계정·권한 확인은 유지한다. 공개 조회에서 키가 바뀌면 검증기를 다시 만든다.
- 입장·좌석 Lua, 구매 수량 제한, 예매·결제 트랜잭션과 QR 발급 경계는 변경하지 않았다. migration은 없다.

실제 PostgreSQL 회귀 테스트는 시간 대신 SQL 횟수와 최신 값을 확인한다. 잠금 메타데이터 600회, 준비 메타데이터 600회, 동의 사전 조회 200회로 실패하던 호출이 각각 6/6/2회 이하 예산을 만족한다. 가격·좌석도·정책 변경, 관리자/일반 사용자 분리, 마감 시간, 트랜잭션 내부 동의 변경도 검증한다. 이 결과만으로 클라우드 왕복 지연의 개선을 주장하지 않는다.

## 전체 부하 실행

- API: 1 vCPU / 512 MiB, 최대 2개, 비교를 위해 warm 최소 2개, heap 256 MiB, concurrency 1,000, DB 풀 5, 입장 상한 200.
- 별도 PostgreSQL 16 `db-f1-micro` / SSD 10 GB, 별도 Valkey `CUSTOM_PICO` primary + replica 1개. [실제 설정](booking-burst-latency-followup-2026-10-28/measured-resource-config.json)을 확인했다.
- 합성 사용자 1,500명, 600석, 200명씩 세 구간, 대기 소켓 1,300개, 좌석 관찰 소켓 100개. 모의 PG 300 ms, 결제 확인 초당 1건, 대기 조회 15–20초 분산 간격은 이전과 같다.
- 비공개 IAM API와 전용 DB·Valkey·테스트 키만 사용했다. 외부 PG·메일·SMS, 운영 worker와 실제 고객 데이터는 사용하지 않았다.

[전체 결과](booking-burst-latency-followup-2026-10-28/optimized-result.json)의 p95 왕복 시간(ms)이다. 비교 열은 [이전 완료 실행](booking-burst-latency-2026-10-28.md)의 개선안이며 이번 수정 전과 소스 이미지가 같다. 사양·시나리오는 같지만 서로 다른 물리 DB·Valkey와 시점의 단일 실행이므로 순수 코드 효과의 통계적 증명은 아니다.

| 경로 | 이전 완료 실행 | 이번 전체 실행 | 관측 변화 | 목표 | 이번 판정 |
| --- | ---: | ---: | ---: | ---: | --- |
| `queue.enter` | 5,412 | 5,784 | +6.9% | 2,000 | 미달 |
| `seat.lock` | 2,541 | 2,771 | +9.1% | 1,000 | 미달 |
| `checkout.prepare` | 4,277 | 5,949 | +39.1% | 2,000 | 미달 |
| `performance.detail` | 2,805 | 2,655 | -5.3% | 2,000 | 미달 |
| `seat.read` | 2,384 | 2,193 | -8.0% | 2,000 | 미달 |
| `socket.seat-update` | 2,526 | 2,767 | +9.5% | 1,000 | 미달 |
| `checkout.confirm` | 588 | 647 | +10.0% | 2,000 | 통과 |
| `queue.status` | 224 | 281 | +25.4% | 2,000 | 통과 |

이번 전체 실행은 14:33:37–14:44:42 KST이며, 부하 구간 662.4초에 600석 판매를 마쳤다. 확정 예매·판매 좌석·Ticket Item·QR credential은 각각 600개, 최대 입장 200명, 최종 대기 900명이다. 추가 입장 이벤트 400/400건, 좌석 전달 60,000/60,000건, 중복 전달 0건이다. 중복 결제 확인은 같은 예매로 수렴했다. 진행 중 중복 확인의 예상된 503 여섯 건을 제외하면 예상 밖 오류는 0건이다.

[별도 읽기 전용 감사](booking-burst-latency-followup-2026-10-28/optimized-queue-audit.json)도 활성 입장 0명, WAITING 900명과 네 판매 레코드 600개를 확인했다. 관측 프로세스별 최대 RSS는 220/216/184 MiB다. 실행 중 프로세스 ID 3개를 관측했지만 설정상 동시 최대는 2개이며, 3대 동시 운영으로 해석하지 않는다.

공개 조회는 소폭 줄었지만 목표를 넘고, 대기열 진입·잠금·준비는 이전 완료 실행보다 느리다. 따라서 **전체 지연 개선 또는 SLO 달성을 확인했다고 주장하지 않는다.** 결과는 `capacity_limited`다.

[Cloud Monitoring](booking-burst-latency-followup-2026-10-28/rehearsal-full-run-metrics.json)은 전체 실행의 시작·종료 시각으로 구간을 고정해 수집했다. 지표는 수집·집계 지연을 포함하므로 순간 최고치로 해석하지 않는다.

## 실패한 기준 실행과 진단

이번 동일 자원에서 이전 소스로 실시한 세 기준 실행을 숨기지 않고 보관한다.

1. [첫 실행](booking-burst-latency-followup-2026-10-28/baseline-incomplete-200-sales.json)은 200석 판매 후 두 번째 구간의 좌석 잠금 4건과 대기 조회 10건이 transport timeout으로 중단됐다.
2. [새 프로세스 실행](booking-burst-latency-followup-2026-10-28/baseline-failed-clean.json)은 초반 조회와 대기열 진입에서 500/503이 발생했다.
3. [후속 기준 실행](booking-burst-latency-followup-2026-10-28/baseline-failed-mature.json)은 대기열 진입 500으로 중단됐다. 수집한 오류에는 앱의 instance 헤더와 JSON 본문이 없었다. 이후 단건 DB/조회는 정상이다. 플랫폼 앞단 오류 가능성은 있으나 원인을 확정하지 않았다.

따라서 이번 자원에서 성공한 전후 600석 실행 한 쌍은 확보하지 못했다. 실패한 실행의 부분 p95를 완료 실행인 것처럼 비교하지 않는다. IAM 전파 전 403, 테스트 실행 파일 쓰기 경로 오류 등 부하 시작 전 설정 실패도 성능 결과에 포함하지 않는다.

[사전 진단](booking-burst-latency-followup-2026-10-28/diagnostic-profile.json)에서 준비 요청의 DB 풀 대기가 컸고, 공개 좌석 조회는 서비스 내부 약 30 ms에 비해 클라이언트 왕복 약 2.3초였다. 따라서 서비스 함수 시간만으로 개선을 판단하지 않는다. [V8 진단](booking-burst-latency-followup-2026-10-28/cpu-public-diagnostic.json)은 JWT 키 변환·GC 비용을 확인했다. RSS 계측이 주원인이라는 가설은 1,500번 호출 21–23 ms로 기각했고 계측 방식을 바꾸지 않았다. 진단 profiler는 전체 판매 측정에서 끈 상태다.

[동일 1,500명 진입·200명 준비 진단](booking-burst-latency-followup-2026-10-28/after-profile-result.json)에서는 기존 진단 대비 잠금 평균 SQL 6.17→3.49회, 준비 17.25→13.76회가 관측됐다. 준비의 인스턴스별 DB 풀 대기 p95는 4,193/4,312→1,393/2,043 ms, 잠금은 991/976→397/425 ms였다. 이 진단의 준비 왕복 p95는 5,872→4,913 ms였지만 전체 600석 결과와 다른 표본이므로 전체 실행의 악화를 상쇄하는 근거로 쓰지 않는다.

추가로 같은 후보 코드의 테스트 wrapper에서만 ioredis 자동 pipelining을 켠 [비교 진단](booking-burst-latency-followup-2026-10-28/pipeline-profile-result.json)을 실시했다. 대기열 진입은 6,114→6,117 ms, 좌석 조회는 2,307→2,371 ms로 개선되지 않았다. 잠금은 2,313→2,192 ms, 준비는 4,913→3,913 ms였지만 단일 200명 진단이며 인스턴스별 부하 분포도 달랐다. 핵심 초기 경로의 개선을 입증하지 못해 이 설정을 제품 코드에 채택하지 않았다. 자동 pipelining은 계측한 Redis 경로도 우회하므로 해당 진단의 Redis 0 ms를 통신 지연 0으로 해석하지 않는다.

## 코드 검증

[검증 기록](booking-burst-latency-followup-2026-10-28/validation.json): API 단위 162개 파일·2,701개, 실제 PostgreSQL/Valkey 통합 37개 파일·437개 통과. typecheck와 Nest/SWC 빌드 통과. lint 오류 0개, 기존 경고 50개. 화면 변경이 없는 API 최적화이므로 브라우저 UI 테스트는 실행하지 않았다.

## 한계와 정리

실제 PG·로그인 폭주·cold start·공개 edge·실제 단말·현장 QR 입장 충돌과 운영 worker 부하는 범위 밖이다. 초당 1건 확인 결과로 200명의 동시 결제 확인을 보장하지 않는다. 모든 경로의 지연 목표를 통과해야 전체 SLO 통과다.

[운영 설정 대조](booking-burst-latency-followup-2026-10-28/production-unchanged.json)에서 API 리비전 `grabit-api-00268-2sd`와 API·SQL·Valkey 설정이 작업 전과 같았다. 운영 배포·운영 DB 쓰기·커밋·PR은 수행하지 않았다. 코드 변경은 `ps/perf/booking-burst-latency`에 미커밋 상태로 남긴다.

[테스트 이미지 정리](booking-burst-latency-followup-2026-10-28/deleted-test-images.json)는 원격 이미지 13개, [로컬 정리](booking-burst-latency-followup-2026-10-28/local-credential-cleanup.json)는 로컬 이미지 태그 17개와 임시 비밀 포함 파일 23개 삭제를 확인했다. [최종 삭제 확인](booking-burst-latency-followup-2026-10-28/cleanup.json)에서 임시 API·Job·PostgreSQL·Valkey 네 자원 모두 관리 API 404로 확인했다. 두 전용 이미지 경로도 비어 있다.
