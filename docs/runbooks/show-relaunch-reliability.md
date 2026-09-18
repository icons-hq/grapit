# 공연 재오픈 신뢰성 수정과 운영 인수

기준: 2026-09-17 장애 분석의 A01–D12, 총 40항목. 현재 구현과 테스트를 기준으로 과거 수정, 이번 수정, 외부 검증을 구분한다. 로컬 green은 배포·실결제·실물 지급 완료를 뜻하지 않는다.

## 이번 변경

- 모든 좌석 해제 경로(취소 finalizer, 지연 해제 worker, 티켓 취소, 레거시 취소, 관리자 오픈)는 같은 좌석의 `active/cancellation_pending` 권리를 확인한다. 실제 갱신된 좌석만 broadcast하며 관리자 성공 audit도 실제 갱신 대상만 기록한다. 전부 보호되면 관리자 API는 409를 반환한다.
- migration `0033`은 모든 회차의 활성 `showtime_id + seat_key`를 유일하게 만든다. 취소 이력은 보존한다. 기본 베네핏 중복 방지는 `active`와 `redeemed`를 모두 포함한다.
- 보상 취소 `cancel_pending` 동안 DONE 재전송은 재발권하지 않는다. PG CANCELED만 미발권 취소 완료로 수렴한다. 전체 취소는 `CANCEL_STATUS_CHANGED`와 `PAYMENT_STATUS_CHANGED/CANCELED` 양쪽에서 같은 finalizer로 처리한다. 잘못된 금액의 callback도 이미 수락한 결제 상태를 덮어쓰지 않는다.
- 일반 confirm과 비동기 progress는 동일 주문의 Redis confirmation lease를 공유한다. 잠금 경합·유실은 503 재시도로 처리한다. 타 요청이 처리 중인 정상 결제를 보상 취소하지 않는다. 이전 진행/실패/만료 이벤트는 확정·취소된 상태를 되돌리지 못한다. 이미 발권된 취소는 progress가 부분 갱신하지 않고 취소 finalizer로 수렴하도록 재시도한다.
- 두 발권 경로는 같은 기본 베네핏 생성 함수와 사용자·공연 단위 매수 제한/advisory lock을 사용한다. 회차가 달라도 공연 매수 제한을 지킨다. 초과 결제 보상 사유는 좌석 충돌과 구분한다.
- 베네핏 생성의 showtime 잠금은 `FOR NO KEY UPDATE`다. Ticket FK의 KEY SHARE와 호환해 동시 결제의 lock upgrade deadlock을 피하며 설정 변경과는 직렬화한다.
- 최초 payment deadline은 서버의 공연 정책을 사용하고 prepare 시 선택 좌석의 Redis TTL을 동일 기한으로 맞춘다(기존 TTL이 길면 단축). 공유 선택 목록과 관련 없는 좌석의 TTL은 줄이지 않는다. 결제 앱으로 넘길 때 기존 grace(8분, 생성 후 총 15분 cap)와 서버 응답 deadline을 유지한다. 클라이언트가 보낸 deadline을 기준으로 삼지 않는다. 화면 제목에는 고정 7분을 표시하지 않고 서버 countdown을 기준으로 안내한다.
- 만료 worker는 예약 상태/진단만 정리한다. 사용자 전체 잠금을 해제하지 않는다. 과거 예약과 같은 사용자의 새 시도를 구별할 수 없으므로 Redis 자체 TTL이 잠금 만료를 담당한다. 사용자 ‘선택 해제’는 Lua의 원자적 owner 확인을 사용한다.
- 소셜 로그인 callback의 오류·재시도·로딩·toast는 선택 언어를 사용한다. 기존 번역을 공유하고 계정 충돌 후 기존 계정으로 로그인하는 안내를 보존한다. session refresh는 AuthInitializer 한 곳에서만 수행하며 실패 후 로딩을 종료한다.
- 과거 `취소 시각 + 3일` 값은 금융기관의 입금 예정일이 아니므로 새로 저장하거나 응답에 노출하지 않는다. 처리 지연 후 CS 안내는 요청 후 3일의 별도 운영 기준이다. 고객 문구는 결제사 취소 완료와 실제 카드/계좌 반영을 구분한다.

## 40항목 처리표

`회귀`는 기존 구현을 관련 테스트로 재검증한 항목이다. `외부 인수`가 남은 항목을 완료로 표시하지 않는다. 실제 단말·공급자 계약·실물 원장은 코드로 증명할 수 없다.

| ID | 구현/회귀 범위 | 남은 외부 인수 |
| --- | --- | --- |
| A01 | edge proxy redirect·canonical origin 테스트 | 배포 후 HTTP/www/deep link 재확인 |
| A02 | auth 초기화·마이페이지·QR 조회 회귀 | 당시 해외 인앱 브라우저/OS 재현 |
| A03 | SMS 국가코드·send/verify 오류·throttle 테스트 | 태국 실제 번호 수신·공급자 전달 결과 |
| A04 | 발송 실패와 인증 불일치 UI/오류 매핑 회귀 | 실제 발송 오류 표시 확인 |
| A05 | 인증/대체 진입 코드 유지 | 중국 번호·현행 공급자 허용 정책 검증 |
| A06 | 소셜 callback 언어별 오류·재시도, refresh 1회 및 실패 후 로딩 종료, 추가정보·공유 IP throttle 회귀 | Naver 운영 앱 승인 및 실제 계정 왕복 |
| A07 | 계정 연결/병합 테스트·구매내역 조회 회귀 | 당사자 계정으로 실제 티켓 확인; 임의 병합 금지 |
| B01 | 공연 편집·회차 FK 보존 회귀 | 새 공연 실제 설정 저장 확인 |
| B02 | catalog freshness·cache·cluster Lua 회귀 | 배포 뒤 전체 언어에서 교체 SVG 확인 |
| B03 | floor-aware 좌석 identity·SVG 검증 회귀 | 새 업로드 SVG와 실제 좌석 배치 대조 |
| B04 | 본인 선택 해제 원자화·매수 제한 통일 | 새 정책으로 다중 탭/재진입 확인 |
| B05 | queue admission·runtime capacity 회귀 | 판매 운영 모드 및 부하 리허설 |
| B06 | 소유권 guard + DB 부분 unique + 충돌 보상 | migration 적용 및 live invariant 재조회 |
| B07 | 만료 worker의 사용자 전체 잠금 해제 제거 | 배포 후 sweep/TTL 확인 |
| C01 | provider 원본 오류·금액·key scope 회귀 | 운영 key/MID 연결 실결제 |
| C02 | USD quote·해외카드 provider 분기·취소 회귀 | 실제 계약/카드사 승인 거절과 구현 오류 구분 |
| C03 | Alipay lifecycle·복귀·재시도 UI 회귀 | 실제 앱 전환/취소/뒤로가기 |
| C04 | 늦은 DONE·주문 공통 잠금·역순 이벤트·중복 발급 방지 | PG 재전송 live 관측 |
| C05 | 만료/중단/승인 실패 진단 분리 회귀 | 관리자 원인별 집계 확인 |
| C06 | 결제 return/대기/실패 안내 회귀 | Twitter/Kakao/Samsung 실제 브라우저 왕복 |
| C07 | 서버 정책 기반 deadline·TTL 정렬 | 결제 앱 체류/복귀 실측 |
| C08 | TRANSFER/계좌이체 전체 취소 정책 회귀 | BankPay 실결제 취소 대조 |
| C09 | 부분 취소·잔액0·full finalizer 및 권리 회수 회귀 | PG 원장 전체 대조는 별도 수행 |
| C10 | 오래된 취소가 새 소유자 재고를 열지 못함 | 수동 복구 시 아래 소유권 절차 필수 |
| C11 | 전체 취소 수수료·시작 후 차단 회귀 | 새 공연 약관/정책 검수 |
| C12 | 원통화 환불 계산·provider 취소 회귀 | 카드 명세서·환율·금융기관 반영은 별도 |
| C13 | 인위적 입금 예정일 제거·4개 언어 문구 수정 | 금융기관 반영일을 보장하지 않음 |
| C14 | 매출/부분취소/정산 통화/CSV 회귀 | 실제 정산 명세서와 gross/fee/net 대조 |
| D01 | 목록/상세/필터/티켓별 집계 회귀 | 운영자 메뉴 인수 |
| D02 | BOM·실패 예약·국가코드·좌석명 export 회귀 | 사용하는 Excel/현장 출력물 확인 |
| D03 | 결제/취소/환불·소셜 로그인 복귀 안내 다국어 회귀, 계정 충돌 후 기존 계정 로그인 안내 유지 | 언어·결제수단별 실왕복 |
| D04 | 입장 후 QR 재조회 실DB 통합 검증 | 구매자 실제 단말 확인 |
| D05 | 기존 계정·회차 일괄 입장 보존 | 동행자 분리 입장 정책은 운영자가 결정 |
| D06 | 동시 검표 후 티켓 단위 monitor 집계 검증 | 실제 방문 인원과 일괄 처리 수를 혼동하지 않음 |
| D07 | 동시 스캔·중복 차단·offline sync 회귀 | 카메라/QR 표시/통신 현장 테스트 |
| D08 | verify→consume→재조회 경로 실DB 확인 | 현장 단말과 운영 인프라 p50/p95, 목표 합의 |
| D09 | sync/async 동일 기본 권리 생성 + hash 기반 복구 CLI | 승인 후 3티켓·13권리 복구와 read-back |
| D10 | 중복 권리 방지·배정/CSV/수령 기록 회귀 | 발표표·추가 보상·당일표 버전 대조 |
| D11 | 입장과 수령 분리·동시 중복 수령 차단 검증 | 실물 입고/지급/반품/잔량 원장 및 담당자 인수 |
| D12 | 기존 비용 절감/판매 모드 runbook과 배포 workflow 유지 | 판매 용량 복구·worker/queue 부하·롤백 리허설 |

## migration 사전검사와 배포

전체 테이블을 검사한다. Girl Rules 한 회차의 0건만으로 제약 적용을 판단하지 않는다.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT showtime_id, seat_key, count(*)
FROM ticket_items WHERE status IN ('active', 'cancellation_pending')
GROUP BY showtime_id, seat_key HAVING count(*) > 1;
SELECT ticket_item_id, benefit_identity, count(*)
FROM ticket_benefit_entitlements
WHERE source = 'configuration' AND benefit_kind = 'included'
  AND state IN ('active', 'redeemed')
GROUP BY ticket_item_id, benefit_identity HAVING count(*) > 1;
ROLLBACK;
```

두 결과 모두 0행이어야 한다. migration 자체도 쓰기 잠금을 잡고 재검사하며 중복 발견/잠금 10초 초과 시 실패한다. 기존 티켓이나 수령 기록을 자동 삭제하지 않는다. PostgreSQL의 [부분 유니크 인덱스](https://www.postgresql.org/docs/16/indexes-partial.html)와 [행 잠금 호환성](https://www.postgresql.org/docs/16/explicit-locking.html)을 기준으로 했다.

승인된 배포는 작업 브랜치 → ready PR → CI → merge → 기존 Deploy workflow migration/API/Web → live smoke 순서다. 기존 PR #185의 guard를 현재 main에 통합한 변경이므로 두 PR을 중복 적용하지 않는다. 이 작업에서 직접 main push, PR merge, production migration은 수행하지 않았다.

코드 rollback 시에도 소유권 보호 인덱스를 임의 제거하지 않는다. 0033 이전 앱과 혼재하는 롤링 구간에는 충돌 오류가 발생할 수 있으므로 한산한 시간에 수행하고 예약/웹훅 실패율을 관찰한다. 인덱스 사전검사 실패는 데이터 검토로 돌아가며, 자동 삭제로 우회하지 않는다.

## 기본 베네핏 누락 복구

`included-benefit-repair.cli`는 설정 최신 버전의 included 권리만 다룬다. `CONFIRMED` 예약, `DONE` 결제, `active` 티켓에 한정한다. 추첨/수령/취소 이력을 바꾸지 않는다. 이미 active 또는 redeemed인 같은 권리는 제외한다.

```bash
pnpm --filter @grabit/api build
# DATABASE_URL은 승인된 대상 환경에서 비밀 주입한다. 명령행에 값을 적지 않는다.
node apps/api/dist/ops/included-benefit-repair.cli.js dry-run <showtime-uuid>
node apps/api/dist/ops/included-benefit-repair.cli.js apply <showtime-uuid> <reviewed-hash>
node apps/api/dist/ops/included-benefit-repair.cli.js dry-run <showtime-uuid>
```

1. dry-run은 READ ONLY/REPEATABLE READ다. 두 mode 모두 회차가 없으면 `BENEFIT_REPAIR_SHOWTIME_NOT_FOUND`로 실패한다. 회차·누락 티켓 수·권리 수·해시만 출력한다.
2. 회차와 생성 대상 목록의 해시를 검토한다. hash에는 ticket id, benefit identity, configuration id와 표시문구 snapshot이 포함된다.
3. 명시 승인 후 apply한다. 회차 → 티켓 순서로 잠근 뒤 후보를 다시 계산한다. 해시가 달라졌으면 중단한다.
4. 검토된 누락 권리만 INSERT한다. 실제 returning 수가 예상과 다르면 transaction을 취소한다.
5. 다시 dry-run하여 누락 0/0을 확인하고, 티켓·제한 베네핏·수령 기록 수가 보존됐는지 별도 대조한다. 출력 JSON은 운영 증거로 보관한다.

2026-09-18 09:39 KST 읽기 전용 재조회: Girl Rules 회차 `3d66b3d3-61f3-427c-9fda-1a5eece511c5`는 3티켓·13권리 누락, 전체 공연 활성 좌석 중복 0, 기본 권리 중복 0, 재고 소유권 불일치 0이었다. 이 수치는 실행 시 다시 확인하며 이 문서 자체가 apply 승인은 아니다.

## 수동 취소/재고 복구 보호

[Toss 취소 대조 절차](ticket-cancellation-reconciliation.md)를 먼저 따른다. PG 상태와 내부 티켓 상태를 맞추는 애플리케이션 finalizer를 우선 사용한다. 과거 SQL을 복사해 좌석을 직접 열지 않는다.

- 보호 대상은 현재 `active/cancellation_pending` ticket_items다. 취소 대상 예약의 좌석 목록만으로 공유 재고를 열면 안 된다.
- 예외 SQL이 꼭 필요하면 승인된 reservation id에 한정하고 같은 transaction 안에서 대상 ticket 상태를 처리한 뒤 아래 조건을 재고 UPDATE에 추가한다. 기본 종료는 ROLLBACK이다.
- 승인 대상 행 수와 실제 returning을 비교하고, active owner/available 및 sold/no-owner 검사, QR/베네핏 상태까지 검증한 뒤 해당 실행의 승인에 따라 commit한다.

```sql
AND NOT EXISTS (
  SELECT 1 FROM ticket_items owner
  WHERE owner.showtime_id = seat_inventories.showtime_id
    AND owner.seat_key = seat_inventories.seat_key
    AND owner.status IN ('active', 'cancellation_pending')
)
```

## 현장/실물 인수

현재 구현은 QR 한 장의 수동 입장 확인으로 같은 계정·회차의 유효 티켓 전체를 입장 처리한다. 초기 seat-level ADR의 개별 입장 예시와 다르며 7월 4일 요청으로 변경된 현재 코드가 기준이다. 이번 작업에서는 이 정책을 되돌리지 않았다. 일괄 입장 수는 실제 방문자 수와 동일하다고 해석하지 않는다.

베네핏은 입장 시 자동 수령되지 않는다. 현장 직원이 해당 QR의 권리별 수령 동작을 해야 기록이 남는다. 수령은 온라인 서버 확정이 필요하다. 오프라인 입장 대기는 sync 전까지 확정 인원으로 세지 않는다. 지류를 쓰는 경우에도 권리 id/티켓 id별 체크표와 재접속 후 중복 대조 담당자를 정한다. 수령 기록 없는 과거 포스터 부족의 원인을 임의 확정하지 않는다.

새 공연마다 품목/회차별 `기초 재고 + 입고 + 반환 - 실제 지급 - 손실 = 마감 잔량`을 대조한다. 권리수, 발표표, 추가 보상표, 지급 원장, 실물 잔량은 각각의 기준시각과 버전을 적는다. 기술 테스트는 이 원장 작성과 운영자 인수를 대체하지 않는다.

## 새 공연 오픈의 남은 gate

- [판매 운영 용량 복원](managed-demo-cost-floor.md#restore-for-an-actual-ticket-opening): booking gate를 닫은 상태에서 DB/Valkey/API/Web 용량 및 지속 worker를 복원하고 대상 공연으로 부하·queue·롤백을 검증한다. 현재 demo의 5분 worker 주기를 현장 운영 성능으로 간주하지 않는다.
- [결제 운영 UAT](live-foreign-payment-cancel-uat-2026-06-03.md): 명시 승인된 계정·결제 금액·수단으로 승인 → 발권 → 취소 → PG/DB 대조를 수행한다. 고객 연락, 임의 계정 병합, 실제 결제/환불은 포함 승인 없이는 실행하지 않는다.
- [기존 오픈 evidence gates](ticketing-open-evidence-gates-2026-06-03.md): actual phone/browser, scanner 권한, 동시 스캔, 연결 단절/복구, 수동 검색 예외, 실물 원장 담당자 인수를 남긴다. 미실행 항목은 pass가 아니다.


## 이번 검증 기록 (2026-09-18)

| 검증 | 결과/범위 |
| --- | --- |
| 단위 테스트 | API 1,309 / Web 678 / shared 130 / edge 6, 합계 2,123 통과 |
| API 전체 integration | 6파일·62테스트 통과. testcontainers PostgreSQL 16/Valkey 8, 운영 DB 미사용 |
| 핵심 재현 | 기존 상태의 중복 좌석, 7분 deadline, 베네핏 누락, 잠금 탈취, 이미 수령한 권리 재생성, 동시 late DONE 보상 취소, showtime deadlock, 역순 상태 퇴행, 매수 초과, 보상 취소 중 재발권을 red 확인 후 green |
| 브라우저 E2E | 8파일·34테스트 통과: 소셜 오류/다국어/재시도, 결제 pending/failed/expired, floor/queue, QR 검표/권한/중복, offline 재연결, CSV/수동 오픈. 결제/사용자 API는 fixture |
| 가입 SMS E2E | 별도 PostgreSQL/Valkey 컨테이너에 migration/seed 후 실제 API 기동, 발송 cooldown·000000 인증·오입력 3테스트 통과. 공급자 자격증명 없이 SMS mock 사용; 실제 SMS 미발송 |
| 실제 render | localhost:3218 예매 취소 상세 1440×1100 / 390×844 및 en callback 1440×1000, th/zh-CN callback 390×844. 새 문구·가로 overflow 0·페이지 런타임 오류 0 확인 |
| 정적 검증 | 전체 typecheck 통과. lint 오류 0(기존 경고 남음). API build 통과. diff/문서 상대 경로 검사 통과 |
| 운영 read-only | 09:39 KST 전체 인덱스 preflight 0/0, 재고 불일치 0. 10:05 KST 실제 복구 함수 dry-run 3티켓/13권리, applied 0 |

실제 복구 dry-run hash: `2d2b742e127379fc4be975cde9252975cdb1e50644ae9a145ac2ddeecfbe94d3`. 적용 직전 재조회가 바뀌면 이 값은 사용할 수 없다.

최종 리뷰: Standards 미해결 0건, Spec 미해결 0건. 소셜 계정 충돌의 후속 행동 안내 누락도 수정 후 재검토했다. 운영 승인/실사용자/실물 gate는 이 판정과 별도다.

검토 시 출처: `implement`의 검증·리뷰·작업 브랜치 커밋 절차를 적용했다. `code-review`의 Standards/Spec 검토에서 발견된 잠금·이벤트·보상 취소·매수 제한·감사 이력 문제를 수정하고 관련 재현을 추가했다. 브라우저는 Browser 스킬 미제공으로 저장소 Playwright 사용. render 증거와 읽기 전용 집계는 로컬 artifacts `grapit-relaunch-2026-09-18`에 별도 보관한다.

실제 PG 승인/취소, 카드사 반영, 중국/태국 전화 수신, 현장 카메라/네트워크, 실물 지급 원장, 판매 운영 부하, PR/CI/배포 및 운영 권리 INSERT는 실행하지 않았다. 공급자/실사용자/실물 검증과 명시적인 운영 변경 승인이 필요한 잔여 인수다. 로컬 테스트 수치나 기존 운영의 정상 데이터로 이 gate를 pass 처리하지 않는다.
