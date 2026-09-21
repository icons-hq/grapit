# Grabit 현행 서비스 진단

- 조사일: **2026-09-21 KST**.
- 의사결정 지도: [Grabit 전면 개편 의사결정 지도](https://github.com/icons-hq/grapit/issues/199).
- 진단 티켓: [개편 판단에 필요한 현행 업무·화면·계약·검증 근거를 확보한다](https://github.com/icons-hq/grapit/issues/200).
- 정적 분석 기준: [9a6ca20a8a19ac302b69bf459cc64605cb5dd961](https://github.com/icons-hq/grapit/tree/9a6ca20a8a19ac302b69bf459cc64605cb5dd961).
- 화면 근거: 이번 조사에서 직접 연 **운영 공개/관리자/현장 화면 14개 업무 묶음, 채택한 캡처 20개**. Chrome의 기존 관리자 로그인 프로필과 비로그인 인앱 브라우저를 사용했다.
- 실행 검증: **API 1,312 + Web 686 + Shared 130 + 격리 PostgreSQL 회귀 17 = 2,145개 통과**.
- 목표: 전체 개편의 유지·통합·삭제·재구축 판단에 필요한 현황과 질문을 확정한다. 이번 문서는 구현 명세나 정책 합의가 아니다.

## 1. 판단 요약

현재 서비스에는 좌석 소유권·결제 재처리·부분취소·QR·특전 중복 방지를 위한 검증 자산이 존재한다. 전면 개편에서는 이를 새 구현의 안전 기준으로 보존하면서, **서로 다른 운영 정책, 관측 상태 표현, 운영자의 업무 흐름, 실제 외부 연동 검증 기준**을 함께 다시 정해야 한다.

| 분류 | 확인한 사실 | 개편 결정에 주는 영향 | 근거 |
| --- | --- | --- | --- |
| 재현된 표시 오류 | 행사/회차 미선택으로 조회가 실행되지 않은 현장 모니터가 “입장 흐름이 정상입니다”를 표시한다. 상단 문구는 코드상 상수다. | 미선택·미조회·조회 실패·관측 정상·이상 징후를 별도 상태로 정의해야 한다. | 화면 11, [query enable 조건](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/hooks/use-field-monitor.ts#L29), [상단 문구](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/field/field-monitor.tsx#L252), [경고 패널](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/field/field-monitor.tsx#L445) |
| UX/데이터 의미 | 정산도 행사 미선택 상태에서 조회를 하지 않지만 매출·환불·입장·노쇼를 0으로 표시한다. | 실제 0과 아직 모르는 값을 구분하고, 정산 기준시각·대상을 화면에서 명확하게 해야 한다. | 화면 10, [조회 조건](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/hooks/use-admin-settlement.ts#L38), [기본값](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/admin/settlement-dashboard.tsx#L906) |
| 정책 충돌 | 실제 검표는 같은 구매자·회차의 유효 티켓을 별도 결제까지 일괄 입장 처리한다. 일부 ADR/용어집은 스캔한 좌석만 처리한다고 설명한다. | 동행자 분리 도착, 실제 방문 인원, QR의 처리 단위를 운영자와 정해야 한다. | 아래 B6의 코드·테스트·PRD·ADR 대조 |
| 정책 충돌 | 혜택 identity는 문서상 시스템 생성·고정 값이지만 실제 UI/API는 운영자 입력·편집 값을 저장한다. 이름 수정과 식별자 변경은 권리에 미치는 영향이 다르다. | 혜택의 동일성, 표시 이름 수정, 버전 변경과 기존 권리 보존의 경계를 정해야 한다. | 화면 9, 아래 B10 |
| 운영 UX | 정산·현장 모니터·좌석 운영에서 event/showtime ID나 좌석 키를 직접 입력한다. 혜택 화면에는 공연/회차 선택기가 있어 방식도 다르다. | 공연을 중심으로 일하는 운영 흐름과 공통 선택/탐색 방식을 재검토할 근거다. | 화면 7·9·10·11 |
| 운영 UX | 새 공연 등록은 기본정보·미디어·가격·회차·캐스팅·좌석·정책·언어 검토를 긴 한 폼에 담고 floorKey, hold, CARD 등을 노출한다. | 준비·검수·공개·판매의 단계와 운영자가 이해할 언어를 정해야 한다. | 화면 6 |
| 공개 UX/콘텐츠 | 관찰한 홈의 중심 배너는 판매 종료 공연의 티켓 오픈 안내다. 상세의 일정 범위·자정 시각과 실제 공연일 안내가 혼재하며 고객센터에는 런칭 준비 문구가 남아 있다. | 공연 기간·회차·판매 기간, 종료/준비 중 카탈로그, 콘텐츠 갱신 책임을 구분해야 한다. | 화면 1·3·13 |
| 운영 증거 | 컷오버 화면은 Phase26/M1 및 .planning 증거 경로를 노출한다. 서버는 지정 JSON 원장을 읽는다. 화면의 no-go를 실제 현재 BOOKING_ENABLED 값으로 단정할 수 없다. | 공연별 최신 증거·담당자·유효기간과 실제 runtime 상태의 관계를 정의해야 한다. | 화면 14, [원장 읽기](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-cutover.service.ts#L93) |
| 검증 공백 | 테스트 통과와 실제 PG 승인·해외 SMS·실물 지급·판매 용량 검증은 다르다. 브라우저 E2E에도 provider/응답 fixture와 직접 완료 URL 이동이 섞여 있다. | 오픈 합격선에 실제 외부 연동·장비·운영자의 수행 증거를 별도로 포함해야 한다. | 7절의 이번 실행 및 기존 검증 자산 분석 |

현재 발견은 **전면 재설계의 판단 근거**다. 특정 모듈의 일괄 폐기, 새 스택 도입, 부분취소/입장 정책의 변경을 이번 진단만으로 승인한 것은 아니다.

## 2. 근거의 범위

| 구분 | 이번에 확인한 것 | 이 근거로 확정할 수 없는 것 |
| --- | --- | --- |
| 운영 화면 | 공개 홈·검색·상세, 인증/가입 첫 단계, 영문 오류 복귀, 공연 등록, 좌석 운영, 인박스, 혜택 설정, 정산, 현장 모니터/QR 없는 접근, 고객센터, 컷오버 | 실제 판매/환불/입장/지급 성공, 모든 데이터가 있는 상태의 UX |
| 로컬 코드 | 위 커밋의 route·controller·service·schema·shared 계약·문서 충돌 | 동일 커밋의 운영 배포 여부·운영 DB 제약 적용 여부 |
| 이번 테스트 | 단위 2,128개와 새 PostgreSQL 컨테이너에서 재오픈 회귀 17개 | 운영 PG·Valkey 전체·다중 인스턴스·실기기·실물 원장 검증 |
| 기존 테스트/운영 기록 | E2E/CI가 어떤 dependency를 실제 실행하거나 mock하는지 정적 확인 | 기존 pass·과거 배포/보정 수치를 이번 fresh 결과로 사용하는 것 |

브라우저 검수는 구매·저장·취소·입장·혜택 지급·배포를 실행하지 않았다. 일반 화면 탐색에는 세션 refresh·캐시·공연 상세 조회수 갱신이 수반될 수 있다. 특히 구매자 예매 상세 GET의 QR self-heal 경로는 호출하지 않았다. 영문 오류 화면은 기존 E2E에 쓰이는 query를 URL에 지정해 렌더했으며 실제 OAuth 실패 사례로 집계하지 않았다.

인앱 브라우저의 viewport override/clip 캡처가 잘못 축소된 두 파일은 배제했다. 모바일 주요 흐름은 정상 캡처가 가능한 Chrome에서 390×844로 확인했고, 인증 화면은 인앱 브라우저의 자연 크기에서 관찰했다. 관리자 화면은 기존 로그인 프로필의 **새 탭**으로 확인했으며 원래 사용자 탭은 보존했다.

## 3. 실제 화면과 업무 흐름

아래 “양호”는 명시된 관찰 상태에 대한 평가다. 거래나 운영 전체가 통과했다는 뜻이 아니다.

| 단계 | 업무 화면 | 관찰 범위의 상태 |
| --- | --- | --- |
| 01 | 공개 홈 | 개선 필요 |
| 02 | 검색 초기 화면 | 기본 안내 양호 |
| 03 | 공연 상세 | 정보 정합성 검토 |
| 04 | 로그인·가입 | 기본 폼·검증 안내 양호 |
| 05 | 해외 로그인 오류 복귀 | 복구 안내·언어 유지 확인 |
| 06 | 공연 목록·등록 | 구조 재검토 |
| 07 | 좌석 운영 | 입력 방식 개선 필요 |
| 08 | 운영 인박스 | 빈 상태 안내 양호 |
| 09 | 혜택 설정 | 정책·UX 재검토 |
| 10 | 어드민 정산 초기 화면 | 개선 필요 |
| 11 | 현장 모니터 | 오해 위험 |
| 12 | 현장 QR 진입 | 누락 QR 안내 확인 |
| 13 | 공개 고객지원 | 업무 연결 재검토 |
| 14 | 컷오버·오픈 검증 | 운영 절차 재설계 필요 |

### 01. 공개 홈

관찰: 운영 실화면 · **개선 필요**

- 현재 판매 종료 공연의 티켓 오픈 배너가 메인에 남아 있다.
- 판매 중 공연이 없는 상태를 설명하거나 다음 행동을 안내하는 본문이 없다.
- 모바일 검색·하단 이동은 명확하지만 분류와 HOT 뒤 실제 판매 가능 공연이 없는 상태다.

![01. 공개 홈 — 01-live-home-desktop.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/01-live-home-desktop.jpg)

![01. 공개 홈 — 06-live-home-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/06-live-home-mobile.jpg)

### 02. 검색 초기 화면

관찰: 운영 실화면 · **기본 안내 양호**

- 검색 전 상태는 공연을 검색하라는 안내와 입력/버튼이 명확하다. 실제 결과·필터/종료 공연 탐색은 추가 확인 대상이다.

![02. 검색 초기 화면 — 10-live-search-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/10-live-search-mobile.jpg)

### 03. 공연 상세

관찰: 운영 실화면 · **정보 정합성 검토**

- 판매 종료 상태와 비활성 CTA는 데스크톱·모바일에서 명확하다.
- 일정은 5월31일~7월4일 00:00로 보이지만 상세 본문·포스터는 7월4일 공연을 설명해 기간·회차의 의미가 혼재한다.
- 모바일 첫 화면은 포스터가 대부분을 차지하고 날짜·장소·가격은 아래에 있다.

![03. 공연 상세 — 02-live-performance-desktop.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/02-live-performance-desktop.jpg)

![03. 공연 상세 — 03-live-performance-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/03-live-performance-mobile.jpg)

### 04. 로그인·가입

관찰: 운영 비로그인 폼 · 제출 미실행 · **기본 폼·검증 안내 양호**

- 로그인/회원가입 분리, 3단계 가입 안내, 비밀번호 조건과 빈 이메일 오류가 보인다.
- 실제 가입·이메일/SMS 발송·최종 동의 제출은 실행하지 않았다.

![04. 로그인·가입 — 09-live-auth-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/09-live-auth-mobile.jpg)

![04. 로그인·가입 — 12-live-signup-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/12-live-signup-mobile.jpg)

### 05. 해외 로그인 오류 복귀

관찰: 운영 UI에 기존 E2E의 오류 query 입력 · **복구 안내·언어 유지 확인**

- account_conflict 안내에서 기존 계정 로그인 행동을 설명한다.
- Try logging in again 클릭 뒤 /en/auth로 이동하고 영문 UI를 유지한다.
- 실제 OAuth 공급자 인증 실패를 재현한 것은 아니다. 영문 폼의 비밀번호 보기 접근성 이름은 한국어로 남는다.

![05. 해외 로그인 오류 복귀 — 15-live-auth-conflict-en.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/15-live-auth-conflict-en.jpg)

### 06. 공연 목록·등록

관찰: 운영 실화면 · 저장 미실행 · **구조 재검토**

- 목록의 상태 필터·검색·등록 진입은 명확하다.
- 기본정보·미디어·가격·회차·캐스팅·좌석·판매정책·언어검수가 단일 긴 폼에 모여 있다.
- 게시 검토 요약은 있으나 floorKey, CARD 등 내부 용어가 노출된다.
- 장르·오픈상태·관람연령 combobox의 접근성 이름을 추가 확인할 필요가 있다.

![06. 공연 목록·등록 — 05-live-admin-performances.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/05-live-admin-performances.jpg)

![06. 공연 목록·등록 — 07-live-admin-create-performance.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/07-live-admin-create-performance.jpg)

![06. 공연 목록·등록 — 08-live-admin-create-policy.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/08-live-admin-create-policy.jpg)

### 07. 좌석 운영

관찰: 운영 실화면 · 변경 미실행 · **입력 방식 개선 필요**

- 회차 ID와 1F:A-10 같은 좌석 키를 직접 입력해야 한다.
- 입력 전 변경 버튼은 비활성이고 필요한 입력 안내는 있다. 실제 좌석 변경은 수행하지 않았다.
- 390px에서는 메뉴가 접히고 입력과 버튼이 세로로 배치되며 페이지 전체 가로 넘침은 관찰되지 않았다.

![07. 좌석 운영 — 16-live-seat-operations.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/16-live-seat-operations.jpg)

![07. 좌석 운영 — 19-live-admin-seat-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/19-live-admin-seat-mobile.jpg)

### 08. 운영 인박스

관찰: 운영 실화면 · 빈 상태 · **빈 상태 안내 양호**

- 필터·빈 큐·상세 패널 다음 행동이 보인다.
- 실제 문의 처리·담당자 변경·에스컬레이션은 실행하지 않았다.
- 공개 문의 채널은 이메일이며 이 인박스로의 유입 계약은 별도 확인이 필요하다.

![08. 운영 인박스 — 13-live-admin-operations.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/13-live-admin-operations.jpg)

### 09. 혜택 설정

관찰: 운영 실화면 · 저장 미실행 · **정책·UX 재검토**

- 공연/회차 선택기는 있으나 혜택 identity·상호 배제 identity를 직접 입력한다.
- 설정 저장·테스트 실행·라이브 적용이 구분되며 사유를 요구한다.
- 문서의 시스템 생성/고정 식별자와 실제 수동 입력/수정 계약이 충돌한다.

![09. 혜택 설정 — 11-live-admin-benefits.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/11-live-admin-benefits.jpg)

### 10. 어드민 정산 초기 화면

관찰: 운영 Chrome · 기존 로그인 · **개선 필요**

- 공연·회차를 이름으로 고르는 대신 event ID와 showtime ID를 직접 입력하게 한다.
- 공연 미선택 상태에서도 총매출·입장·노쇼가 모두 0으로 보여 미조회와 실제 0을 구분하기 어렵다.
- active 티켓 gross 등 내부 표현이 운영자 안내에 노출된다.

![10. 어드민 정산 초기 화면 — 04-live-admin-settlement-desktop.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/04-live-admin-settlement-desktop.jpg)

### 11. 현장 모니터

관찰: 운영 실화면 · 행사 미선택 · **오해 위험**

- 행사/회차를 ID로 입력하게 한다.
- 조회 지표가 모두 '-'이고 새로고침 비활성인데 입장 흐름이 정상이라고 표시한다.
- entered, offline pending 등 내부 상태명이 화면에 남아 있다.

![11. 현장 모니터 — 14-live-field-monitor.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/14-live-field-monitor.jpg)

### 12. 현장 QR 진입

관찰: 운영 실화면 · QR 없는 요청 · **누락 QR 안내 확인**

- QR이 없는 접근은 명확한 메시지와 다시 확인 버튼을 보여준다.
- 고객 QR 조회, 실제 입장·지급·오프라인 동기화는 실행하지 않았다.

![12. 현장 QR 진입 — 18-live-field-checkin-mobile.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/18-live-field-checkin-mobile.jpg)

### 13. 공개 고객지원

관찰: 운영 실화면 · 문의 미발송 · **업무 연결 재검토**

- 공지·FAQ와 이메일 문의가 공개 입구다.
- 런칭 준비 안내가 남아 있고, 이메일 문의를 어드민 인박스에서 어떻게 처리하는지는 이번 화면으로 확인되지 않는다.

![13. 공개 고객지원 — 20-live-customer-support.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/20-live-customer-support.jpg)

### 14. 컷오버·오픈 검증

관찰: 운영 실화면 · 검증/활성화 버튼 미실행 · **운영 절차 재설계 필요**

- 화면에 Phase26·M1·Gate Ledger·evidence freshness 같은 구현/과거 계획 언어가 직접 노출된다.
- 오픈 불가와 근거 부족은 구분해 표시하나, 원장의 상태를 현재 runtime booking flag나 실검증 결과와 동일시할 수 없다.
- 현재 공연별 운영자가 해야 할 행동·담당자·최신 증거 중심으로 재검토할 필요가 있다.

![14. 컷오버·오픈 검증 — 21-live-cutover-gates.jpg](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/21-live-cutover-gates.jpg)

## 4. 업무와 데이터 소유권

경로는 Nest controller 기준 상대 경로다.

| 업무 | 주요 API 진입점 | 영속/일시 상태와 책임 |
| --- | --- | --- |
| 대기열·좌석 선택 | `POST queue/performances/:performanceId/enter`, `GET queue/sessions/:queueSessionId`, `POST booking/seats/lock`, `DELETE booking/seats/lock/:showtimeId/:seatId` | queue admission은 Redis의 사용자·refresh family·device slot·token hash 결합. 좌석 선택 잠금은 Redis Lua/TTL, 판매 재고는 `seat_inventories`. [Queue entry](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/queue/queue.controller.ts#L25-L66), [좌석 잠금](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/booking/booking.controller.ts#L28-L107) |
| 예매 준비·구매 | `POST reservations/prepare`, `POST payments/confirm` | `reservations`는 구매자·회차·상태·결제/취소 기한·queue 증거, `reservation_seats`는 최초 좌석/가격 snapshot, `booking_policies`는 공연 단위 정책. 준비 시 가격을 서버 자료로 재계산하고 잠금 소유권 확인 후 예매·좌석 snapshot·동의 기록을 트랜잭션에 저장. [컨트롤러](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.controller.ts#L69-L113), [prepare 경계](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1128-L1223) |
| 결제 승인·비동기 복구 | `POST payments/branch`, `POST payments/async-return`, `POST payments/toss/webhook` | `payments`는 원 결제/원통화 quote/PG metadata, `payment_webhook_events`는 수신·처리 ledger. `ReservationFinalizationService`와 `PaymentService`가 sync/async 발권을 담당. [branch/return](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.controller.ts#L26-L53), [webhook](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment-webhook.controller.ts#L114-L169), [payment schema](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/payments.ts#L8-L31) |
| 취소·환불·좌석 재판매 | `GET reservations/:id/refund-preview`, `POST reservations/:id/refund`, 기존 `PUT reservations/:id/cancel`, 운영자 refund API | `refunds`는 요청/진행/완료/실패·저장 quote·재시도, `ticket_items`는 좌석별 취소 경제값/유효성/재오픈 상태, `PaymentCancellationFinalizerService`는 로컬 확정의 공통 경계. `pg-boss`가 취소 재시도와 지연 좌석 해제 담당. [refund entry](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/refund/refund.controller.ts#L6-L23), [refund schema](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/refunds.ts#L16-L61) |
| QR 발급·조회 | `GET tickets/reservations/:id`, `GET reservations/:id` | `ticket_items`는 좌석별 권리/입장 상태, `tickets`는 QR credential/JTI/서명 버전/사용·폐기 이력. 구매자 상세 조회에서 누락 QR 복구 가능. [QR schema](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/tickets.ts#L23-L69), [상세 조회 복구](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1436-L1447) |
| 현장 입장·오프라인 동기화 | `POST field/check-in/verify`, `POST field/check-in/consume`, `POST field/check-in/offline-sync` | `ticket_items.admission_state`와 `tickets.used_at`를 트랜잭션에 변경하고 `ticket_scan_events`/감사 기록을 남김. offline은 `deviceAttemptId` 기준 재검증·중복 제거 후 같은 consume 서비스 사용. [field controller](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/field-check-in.controller.ts#L25-L61), [offline 재검증](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/offline-sync.service.ts#L42-L121) |
| 특전 설정·추첨·지급 | `admin/benefits/showtimes/:id/configuration`, `test-runs`, `live-runs`, `rollback`, `POST field/benefits/redeem` | `ticket_benefit_configurations`, `ticket_benefits`는 설정/버전, run/result는 배정 근거, `ticket_benefit_entitlements`는 티켓별 권리, `ticket_benefit_redemption_records`는 지급 시도와 처리 결과. 입장과 별개. [운영 API](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.controller.ts#L96-L282), [지급 처리](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/benefit-redemption.service.ts#L149-L213) |
| 정산·운영 증빙 | `GET admin/settlement/summary`, `GET admin/settlement/reconciliation`, `POST admin/settlement/export` | summary/export는 예매·결제·티켓·환불·scan projection. reconciliation은 유효 티켓 매출에 대응하는 Toss 국내 정산 조회와 외화 gross 분리를 제공. 외화 실제 지급은 상점관리자 자료 대조가 별도. [API/권한](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-settlement.controller.ts#L46-L100), [대조 범위](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-settlement-reconciliation.service.ts#L40-L114) |

## 5. 거래·권리·현장 계약의 현재 상태

### B1. 회차·좌석당 유효 티켓 1개는 현재 코드와 DB migration에 명시돼 있다

- **정적 코드 확인:** `ticket_items`에 `(showtime_id, seat_key)` partial unique가 있고 `active/cancellation_pending`을 모두 포함한다. 해제용 `noActiveTicketItemOnSeat()`는 같은 회차·floor·seat의 유효 권리를 찾는다. 티켓 취소·지연 해제도 이를 WHERE에 포함한다. [schema](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/ticket-items.ts#L80-L87), [guard](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/seat-ownership.ts#L5-L21), [지연 해제](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/jobs/cancelled-seat-release.worker.ts#L148-L174).
- **테스트 근거:** disposable PostgreSQL 통합 테스트는 동시 동일 좌석 판매, `cancellation_pending` 재판매 차단, 오래된 취소의 새 소유자 좌석 해제 방지를 직접 검증하도록 작성돼 있다. [통합 테스트](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L31-L115).
- **미검증:** 이번 조사에서 운영 DB 인덱스를 재조회하지 않았다. 과거 9/17 메모의 "unique/guard 미반영"을 현행 결함으로 재사용하면 안 된다. 현재 migration `0033`은 중복 발견 시 중단하고 자동 데이터 삭제 없이 제약을 생성한다. [migration](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/migrations/0033_active_seat_and_benefit_uniqueness.sql#L1-L33).

### B2. 동기·비동기 결제는 같은 주문 잠금을 공유하지만 각각 발권·보상 로직을 가진다

- **정적 코드 확인:** 일반 confirm과 webhook progress 모두 `acquirePaymentConfirmLock(orderId)`를 쓴다. 발권 트랜잭션 안에서 공연·사용자 advisory lock 하에 누적 티켓 제한을 재확인하며 예매 CONFIRMED·결제 DONE·Ticket Item·기본 특전·판매 재고를 반영한다. PG 승인 뒤 DB/좌석 실패에는 보상 취소 경로가 있다. [일반 lock](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation-finalization.service.ts#L128-L164), [async lock](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.service.ts#L862-L893), [제한 lock](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/ticket-limit.ts#L14-L64), [async 트랜잭션](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.service.ts#L1794-L1937).
- **정적 코드 확인:** webhook은 event ledger의 처리 완료 중복을 건너뛰고, 외부 PG 원거래를 재조회한 상태를 검증한 뒤 처리한다. 따라서 webhook payload만 믿는 구조는 아니다. [ledger](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment-webhook.controller.ts#L122-L169), [PG 검증](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment-webhook.controller.ts#L299-L345).
- **테스트 근거:** 누적 제한 lock, unique 충돌 후 승인 취소, 늦은 async DONE 복구 및 보상 IN_PROGRESS/DONE replay가 소스에 있다. [일반 회귀](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation-finalization.service.spec.ts#L179), [unique 충돌](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation-finalization.service.spec.ts#L415), [실DB async 시나리오](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L225-L300).
- **미검증:** 실제 PG 재전송, 앱 왕복, merchant 계약과 live 승인·취소를 실행하지 않았다. 개편 시 두 경로의 의미를 함께 보존해야 한다는 근거이며, 통합 방식 자체는 후속 설계 결정이다.

### B3. 결제 최초 기한은 서버 정책으로 정렬됐고, 대기열/앱 handoff 기한은 별도 규칙이다

- **정적 코드 확인:** prepare는 `bookingPolicy.paymentWindowMinutes`로 deadline을 만들고 선택 좌석 Redis TTL을 같은 기한으로 맞춘다. checkout branch 진입은 8분 grace/생성 후 15분 cap의 extension을 DB와 Redis에 적용한다. 만료 worker는 오래된 예약의 사용자 전체 잠금을 해제하지 않고 Redis TTL에 맡긴다. [prepare](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1158-L1167), [grace](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.service.ts#L400-L479), [worker](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/jobs/pending-payment-expiration.worker.ts#L160-L175).
- **정적 코드 확인:** 비관리자 구매는 refresh cookie와 queue admission cookie를 묶어 showtime/order를 검증한다. 관리자 bypass는 별도 분기다. [AdmissionGuard](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/queue/guards/admission.guard.ts#L35-L120).
- **테스트 근거:** 새 시도 잠금 보존, handoff 결제 만료 제외, Redis extension 실패 시 deadline 복구 테스트가 존재한다. [worker 회귀](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/jobs/pending-payment-expiration.worker.spec.ts#L36-L109), [branch 복구](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.service.spec.ts#L430).
- **정책/미검증:** 8/15분 규칙은 [현행 runbook](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/runbooks/show-relaunch-reliability.md#L13-L14)에도 기록됐다. "현재도 최초 7분 하드코딩 버그"라고 보고하면 틀린다. 실제 구매자 대기·앱 체류시간과 개편 후 정책 숫자는 아직 합의/실측 대상이다.

### B4. 전체 예매 취소와 과거 티켓 부분 취소는 서로 다른 상태 계약이다

- **정적 코드 확인:** 구매자 Ticket Item cancel endpoint는 명시적으로 거절한다. 전체 환불은 요청 시 quote를 저장하고 refund ID 기반 PG idempotency key로 취소하며 불확실한 응답은 retry 상태로 남긴다. refund row는 예매/결제별 unique다. [부분 취소 차단](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.controller.ts#L153-L167), [전체 환불](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/refund/refund.service.ts#L374-L481), [quote 저장/unique 수렴](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/refund/refund.service.ts#L1080-L1124).
- **정책 확인:** 수수료 보유 전체 취소는 예약/모든 티켓 CANCELLED면서 로컬 payment PARTIAL_CANCELED일 수 있다. 과거 티켓 부분 취소는 살아 있는 티켓을 위해 parent CONFIRMED/payment DONE을 유지한다. PG와 로컬 status 문자열 일치를 정산 완료 조건으로 사용하면 안 된다. [ADR](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/adr/0002-use-nol-ticket-cancellation-fee-policy.md#L18-L40), [복구 runbook](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/runbooks/ticket-cancellation-reconciliation.md#L12-L27).
- **테스트 근거:** 수수료 보유/제로잔액/과거 부분취소 부모 상태/다른 소유자 보호/queue enqueue 실패 회귀가 존재한다. [finalizer 테스트](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts#L437), [부분취소 실DB](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L301-L347).
- **미검증:** 실제 환불 수령/카드 명세 반영은 실행하지 않았다. 지원 결제수단별 부분취소 가능 여부는 이미 별도 외부 계약 조사 티켓의 근거와 결합해야 한다.

### B5. QR 발급 단위는 Ticket Item이며 구매자 상세 GET에 복구 쓰기가 있다

- **정적 코드 확인:** Ticket Item마다 활성 QR unique가 있다. 결제 발권 트랜잭션 이후 QR을 발급하며, GET 예매 상세도 CONFIRMED/DONE/active 티켓에 `ensureIssuedTicketsForReservation`을 호출한다. 이 함수는 누락 `tickets` INSERT와 reminder schedule을 수행한다. [QR unique](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/tickets.ts#L59-L67), [발권 이후 QR](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation-finalization.service.ts#L838-L842), [GET 복구](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.ts#L1436-L1447), [실제 INSERT](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/ticket/qr-ticket.service.ts#L195-L251).
- **정책 충돌:** Architecture 문서는 여전히 "QR tickets are reservation-level in the current implementation"이라고 한다. 코드와 ADR 0001/0003에 맞지 않는 문서 부채다. [Architecture](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/03-ARCHITECTURE.md#L284-L292).
- **테스트 근거:** 상세 조회에서 모든 Ticket Item의 누락 QR 복구 및 runtime wiring이 없을 때 blocking 상태 반환 테스트가 있다. [조회 복구](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.spec.ts#L5183), [wiring 누락](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation.service.spec.ts#L5455).
- **진단 함의:** 운영 read-only 작업에서 이 GET을 순수 조회로 취급하면 안 된다. 이번 진단에서는 이 경로를 호출하지 않았다.

### B6. 실제 입장 처리 단위는 계정·회차 일괄이며 ADR/CONTEXT의 좌석별 입장과 충돌한다

- **정적 코드 확인:** consume은 같은 구매자·회차의 모든 CONFIRMED/active/not_entered 티켓을 조회하고 별도 결제의 티켓까지 한 번에 처리한다. [대상 조회](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/field-check-in.service.ts#L464-L490), [일괄 갱신](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/field-check-in.service.ts#L227-L368).
- **테스트 근거:** "same account and showtime even across separate payments" 테스트와 실DB 동시 scanner 테스트는 현행 일괄 입장을 의도적으로 검증한다. [unit](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/field-check-in.service.spec.ts#L317), [integration](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L349-L381).
- **정책 충돌:** PRD는 같은 계정·회차 일괄 입장을 명시하지만, ADR 0001과 CONTEXT는 스캔한 Ticket Item만 입장한다고 규정한다. [PRD](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/02-PRD.md#L102-L109), [ADR](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/adr/0001-seat-level-qr-credentials.md#L20-L21), [CONTEXT](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/CONTEXT.md#L409-L415).
- **후속 결정 근거:** "코드가 잘못됐다"고 단정하기보다 동행자 분리 입장, 양도, 실제 방문 인원, 현장 처리속도의 기준을 운영자와 결정해야 한다. [현행 runbook도 분리 입장 정책을 운영자 결정으로 남김](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/docs/runbooks/show-relaunch-reliability.md#L55-L59). 상태가 entered라는 사실만으로 당사자 전원이 실제 도착했다고 단정할 수 없다.

### B7. 특전은 발권·입장·실물 수령을 분리한 데이터 모델이다

- **정적 코드 확인:** sync/async 발권 모두 기본 권리 생성 함수를 호출한다. 함수는 showtime의 `FOR NO KEY UPDATE` 하에 최신 설정/등급 조건을 읽고 중복 INSERT를 건너뛴다. `active/redeemed` 기본 권리 unique가 재지급 방지를 보조한다. [일반 발권](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/reservation/reservation-finalization.service.ts#L700-L705), [async 발권](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/payment/payment.service.ts#L1849-L1870), [공통 생성](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/included-benefit-entitlements.ts#L8-L95).
- **정적 코드 확인:** 지급은 QR의 showtime/Ticket Item과 entitlement를 일치시킨 뒤 active→redeemed 조건부 UPDATE와 redemption record를 한 트랜잭션에서 수행한다. device attempt에는 unique가 있다. 설정 변경은 이미 redemption record가 존재하면 Result Lock으로 거절한다. [지급](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/field-operations/benefit-redemption.service.ts#L92-L213), [설정 lock](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.service.ts#L454-L485).
- **테스트 근거:** 이미 수령한 기본 권리 재생성 방지와 동시 수령 한 번만 허용하는 실DB 테스트가 존재한다. [재시도](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L150-L166), [동시 수령](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/test/show-relaunch.integration.spec.ts#L349-L381).
- **미검증:** 실물 입고량·현장 전달량·지류/추가 보상은 서버 권리 행과 같지 않다. 과거 기본 권리 누락은 현재 코드에서 동일 원인이 제거돼 있으나 이번 조사에서 운영 누락 수를 재조회하지 않았다.

### B8. 정산은 티켓 유효 매출·PG 국내 지급·외화 지급을 별도로 대조해야 한다

- **정적 코드 확인:** reconciliation의 사이트 gross는 `reservation CONFIRMED + payment DONE + ticket active`에 한정한다. 국내는 Toss settlement rows와 payment key로 매칭하며, 외화 지급액은 상점관리자 값을 별도 입력하라고 안내한다. gross 차액을 추가 수수료로 단정하지 말라는 경고가 이미 코드에 있다. [대상/경고](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-settlement-reconciliation.service.ts#L40-L114), [국내 지급](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-settlement-reconciliation.service.ts#L119-L164).
- **정적 코드 확인:** CSV/export에는 티켓별 원가가 아닌 ticket price, service fee, cancellation fee, refundable amount, admission, reopen 필드가 연결된다. 이 데이터만으로 행사 손익·은행 입금·별도 송금을 확정할 수 없다. [export query](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/settlement-export.service.ts#L281-L347).
- **테스트 근거/미검증:** 국내 정산과 외화 gross 분리 unit 테스트는 존재한다. [unit](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-settlement-reconciliation.service.spec.ts#L55-L56). 실제 PG/은행/회계 원장은 이번에 조회하지 않았다. 최신 runbook의 운영 대조 수치는 기존 기록이며 fresh 검증값이 아니다.

### B9. UI 진단의 '조회'에도 권리 복구·조회수·캐시·외부 조회 부작용이 섞여 있다

- **정적 코드 확인:** 공개 공연 상세와 관리자 공연 상세는 같은 `findById`를 호출하며 매번 `performances.view_count += 1`을 먼저 실행한다. 관리자 상세도 includeHiddenCopy 옵션만 달라진다. [view count](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/performance/performance.service.ts#L306-L324), [관리자 호출부](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-performance.controller.ts#L98-L102).
- **정적 코드 확인:** dashboard GET은 read-through cache set, operations inbox/상세 GET은 SELECT/계산, settlement summary GET은 SELECT/집계, reconciliation GET은 PG 외부 GET, export POST는 audit INSERT다. [dashboard cache](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-dashboard.service.ts#L62-L68), [inbox/detail](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-operations.service.ts#L241-L297), [정산 summary](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/settlement-export.service.ts#L140-L159).
- **진단 함의:** 이번 화면 검수에서는 구매자 상세 self-heal, export와 PG reconciliation을 실행하지 않았다. 공개 공연 상세 탐색은 수행했으며 이 코드에는 조회수 갱신 경로가 있다. 일반 로그/세션 refresh/캐시와 권리·업무 데이터 쓰기를 구분해 보고해야 한다.

### B10. 특전 identity는 실제로 운영자가 입력·변경하며 '시스템 생성의 안정된 식별자' 계약과 다르다

- **정적 코드 확인:** 신규 UI draft는 화면 내부 `localId`만 UUID로 생성하고 저장용 `identity`는 빈값이다. `혜택 identity`와 `상호 배제 identity`는 수정 가능한 input이며, identity 입력 없이는 저장하지 못한다. 입력값을 trim하고 상호 배제값을 CSV로 나눠 API에 그대로 전달한다. [신규 draft](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/admin/admin-benefit-manager.tsx#L995-L1026), [편집 input](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/admin/admin-benefit-manager.tsx#L872-L903), [저장 payload 생성](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/components/admin/admin-benefit-manager.tsx#L1034-L1057), [PUT 호출](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/web/hooks/use-admin-benefits.ts#L107-L118).
- **정적 코드 확인:** shared schema는 1~120자, 콤마 금지, 설정 안의 중복·자기참조·없는 상호 배제 참조를 검사한다. 시스템이 발급한 값인지, 이전 버전과 같은 ID를 유지하는지는 검사하지 않는다. service는 입력 identity를 그대로 저장하고, DB는 별도 row UUID와 `(configuration_id, identity)` unique만 제공한다. [검증](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/packages/shared/src/schemas/benefit.schema.ts#L63-L142), [저장](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.service.ts#L582-L598), [DB 구분](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/database/schema/ticket-benefits.ts#L124-L154).
- **계약 충돌과 UX를 분리:** [CONTEXT:59–61](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/CONTEXT.md#L59-L61)은 Ticket Benefit Identity를 설정 변경·run·export·rollback을 잇는 stable system-generated identity라고 한다. 현행은 운영자가 만들어 재사용하는 업무 key이며 변경 불변성이 강제되지 않는다. 따라서 영문 내부용어와 참조 문자열을 사람이 입력해야 하는 UX 부담에 더해, 생성·안정성 계약 자체의 불일치가 있다. row UUID 또는 UI localId를 이 identity와 혼동하면 안 된다.
- **영향/미검증:** 설정 저장은 입력 benefits로 기본 권리를 즉시 동기화하며, key가 달라지면 새 권리 생성과 옛 key 권리 비활성화 대상으로 처리한다. identity 편집을 표시 이름 변경과 같게 취급할 수 없다. [동기화 호출](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.service.ts#L185-L188), [key 매칭·생성](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.service.ts#L290-L333), [옛 key 비활성화](https://github.com/icons-hq/grapit/blob/9a6ca20a8a19ac302b69bf459cc64605cb5dd961/apps/api/src/modules/admin/admin-benefits.service.ts#L351-L380). identity 변경에 대한 실제 저장·운영 데이터 변경과 별도 재현 테스트는 수행하지 않았다. 입력란 노출은 위 화면 9의 이번 운영 캡처로 확인했다.

### 새 구현에서도 검증해야 할 안전 조건

1. Redis 선택 잠금이 사라져도 DB의 회차·좌석 유효 소유자는 하나여야 하며 오래된 취소/수동 재오픈이 새 소유자의 판매권을 열면 안 된다.
2. PG 승인, 로컬 발권, QR 발급, 기본 특전 생성, 미완료 보상 취소를 별개 결과로 관찰하되 중복/역순 callback으로 재발권하지 않아야 한다.
3. 최초 가격과 수수료는 서버의 좌석/정책에서 도출하고, 확정 시 공연 전체의 사용자 누적 매수를 잠금 안에서 재검사해야 한다.
4. QR credential 유효성, Ticket Item 유효성, admission state, benefit entitlement, redemption은 서로 대체하지 않는다.
5. 과거 부분 취소와 수수료 보유 전체 취소의 PG/로컬 상태 차이를 보존하고, 실제 금융기관 반영/실물 지급을 내부 처리 완료와 혼동하지 않는다.

## 6. 전체 화면·호출 경로 목록

`rg --files apps/web/app | rg '/page\\.tsx$' | sort`로 전체를 열거했다. locale prefix 변형과 dynamic ID 값은 별도 페이지 수로 세지 않았다. `route.ts`, sitemap/robots, error/loading/layout은 이 개수에 포함하지 않는다.

| 역할/업무 | 경로 | 현재 코드에서 확인되는 역할 | 소스 진입점 |
|---|---|---|---|
| 구매자 탐색 | `/` | 배너, HOT, NEW, 장르, 검색 진입 | `apps/web/app/page.tsx:19` |
| 구매자 탐색 | `/genre/[genre]` | 장르별 목록·정렬·pagination | `apps/web/app/genre/[genre]/page.tsx:19` |
| 구매자 탐색 | `/search` | URL 검색 조건과 결과 | `apps/web/app/search/page.tsx:17` |
| 구매자 탐색 | `/performance/[id]` | 공연 상세·일시/가격/예매 가능 상태·번역 문구 | `apps/web/app/performance/[id]/page.tsx:59` |
| 인증 | `/auth` | 로그인/회원가입 tabs | `apps/web/app/auth/page.tsx:14` |
| 인증 | `/auth/callback` | 소셜 로그인 return·추가 정보/동의·오류 복구 | `apps/web/app/auth/callback/page.tsx:35` |
| 인증 | `/auth/reset-password` | 요청/토큰 기반 비밀번호 재설정 | `apps/web/app/auth/reset-password/page.tsx:34` |
| 인증 | `/auth/verify-email` | 이메일 확인 흐름 | `apps/web/app/auth/verify-email/page.tsx:9` |
| 예매 | `/booking/[performanceId]` | 인증·런타임 예매 flag·queue 이후 좌석 화면 | `apps/web/app/booking/[performanceId]/page.tsx:14` |
| 결제 | `/booking/[performanceId]/confirm` | 주문/구매자/약관/기한·Toss 결제 진입 | `apps/web/app/booking/[performanceId]/confirm/page.tsx:80` |
| 결제 복귀 | `/booking/[performanceId]/complete` | 결제 confirm/비동기 복구·pending/failure/complete·QR | `apps/web/app/booking/[performanceId]/complete/page.tsx:141` |
| 구매자 계정 | `/mypage` | 계정 허브·ticket wallet·설정 | `apps/web/app/mypage/page.tsx:119` |
| 구매자 예매 | `/mypage/reservations/[id]` | 예매 상세·QR·취소·결제 재개 | `apps/web/app/mypage/reservations/[id]/page.tsx:21` |
| 고객지원 | `/support` | 공개 공지/FAQ·email 문의 | `apps/web/app/support/page.tsx:13` |
| 법적 콘텐츠 | `/legal/terms`, `/legal/privacy`, `/legal/marketing` | 이용약관/개인정보/마케팅 문서 | 각 `apps/web/app/legal/<name>/page.tsx:1` |
| 현장 | `/field/check-in` | verify·입장 consume·benefit redemption·offline sync | `apps/web/app/field/check-in/page.tsx:32` |
| 관리자 개요 | `/admin` | KPI·차트·인기공연·patch notes | `apps/web/app/admin/page.tsx:54` |
| 관리자 공연 | `/admin/performances` | 검색/상태/목록·archive/delete·edit 진입 | `apps/web/app/admin/performances/page.tsx:47` |
| 관리자 공연 | `/admin/performances/new` | PerformanceForm 신규 등록 | `apps/web/app/admin/performances/new/page.tsx:5` |
| 관리자 공연 | `/admin/performances/[id]/edit` | 상세 조회 후 PerformanceForm 수정 | `apps/web/app/admin/performances/[id]/edit/page.tsx:8` |
| 관리자 콘텐츠 | `/admin/banners` | 배너 CRUD·노출/배치/장치·순서 | `apps/web/app/admin/banners/page.tsx:29` |
| 관리자 콘텐츠 | `/admin/support-content` | 공지/FAQ 작성·검토·발행 | `apps/web/app/admin/support-content/page.tsx:1` |
| 관리자 콘텐츠 | `/admin/translations` | 번역 원문·생성/검토/발행 | `apps/web/app/admin/translations/page.tsx:40` |
| 관리자 운영 | `/admin/operations` | 통합 운영 인박스 | `apps/web/app/admin/operations/page.tsx:14` |
| 관리자 운영 | `/admin/cutover` | cutover gate ledger | `apps/web/app/admin/cutover/page.tsx:6` |
| 관리자 운영 | `/admin/bookings` | 예매 통계·조회·상세·refund·CSV | `apps/web/app/admin/bookings/page.tsx:1` |
| 관리자 운영 | `/admin/seat-operations` | 좌석 비활성/재활성·취소 좌석 즉시 공개·이력 | `apps/web/app/admin/seat-operations/page.tsx:1` |
| 관리자 운영 | `/admin/users` | 회원 목록/상세·권한·CSV·탈퇴/삭제 제한 | `apps/web/app/admin/users/page.tsx:1` |
| 관리자 현장 | `/admin/benefits` | 회차별 혜택 설정·test/live run·rollback·CSV | `apps/web/app/admin/benefits/page.tsx:1` |
| 관리자 현장 | `/admin/field-monitor` | 현장 입장 요약·로그 | `apps/web/app/admin/field-monitor/page.tsx:1` |
| 관리자 정산 | `/admin/settlement` | 정산 요약·PG 대조·입장/노쇼·결제/환불 CSV | `apps/web/app/admin/settlement/page.tsx:1` |
| 관리자 감사 | `/admin/consent-audit` | 동의 기록 검색 | `apps/web/app/admin/consent-audit/page.tsx:11` |
| 관리자 감사 | `/admin/audit` | 행위 감사 로그 | `apps/web/app/admin/audit/page.tsx:11` |
| 관리자 보안 | `/admin/security` | 보안 요약·IP allowlist | `apps/web/app/admin/security/page.tsx:20` |
| 관리자 안내 | `/admin/patch-notes` | 변경 안내 | `apps/web/app/admin/patch-notes/page.tsx:4` |

이와 별도로 Next handler는 `apps/web/app/api/runtime-flags/route.ts`, `apps/web/app/admin/sentry-test/route.ts`가 있고, sitemap·legal robots·공통 error/loading/layout shell이 있다. 이 문서는 handler 실행이나 Sentry test를 하지 않았다.

### 화면에서 API·shared 계약으로 이어지는 위치

| 업무 | frontend 중심 위치 | 공유/런타임 계약과 관찰 |
|---|---|---|
| 공통 HTTP/auth | `apps/web/lib/api-client.ts:33`, `:65`, `:156`; `lib/api-url.ts`; `lib/auth.ts`; `stores/use-auth-store.ts` | fetch + credentials + Bearer, 401 refresh dedup/retry, refresh 실패 clearAuth/`/auth`; 일반 응답은 `res.json() as Promise<T>`(`api-client.ts:153`)이며 전역 response schema parse는 없음 |
| 공개 탐색 | `hooks/use-performances.ts:42`, `:66`, `:78`, `:94`, `:105`; `hooks/use-search.ts`; `lib/catalog-freshness.ts` | `packages/shared/src/schemas/performance.schema.ts:33`, `:44`; `types/performance.types.ts`; 공개 장르 `lib/performance/public-genres.ts` |
| 좌석·대기열·실시간 | `hooks/use-booking.ts:202`, `:241`, `:275`, `:299`; `hooks/use-queue.ts:162`; `hooks/use-socket.ts:14`; `lib/socket-client.ts` | `shared/src/schemas/booking.schema.ts:45` floor-aware selection, `:51` queue admission; `shared/src/seat-identity.ts` |
| 결제·복구 | `hooks/use-booking.ts:319`, `:357`, `:366`, `:404`; `stores/use-booking-store.ts:25`; `lib/booking/payment-return.ts`, `payment-failure-guidance.ts` | `shared/src/schemas/booking.schema.ts:61` policy, `:84` 해외동의, `:111` quote, `:119` payment method, `:265` prepare, `:307` confirm |
| 예매·QR·취소 | `hooks/use-reservations.ts:35`, `:49`, `:58`, `:69`, `:105`; `components/reservation/reservation-detail.tsx` | `shared/src/schemas/booking.schema.ts:142` refund timeline, `:159` cancellation quote, `:203` QR, `:255` ticket email; `shared/src/schemas/ticket-item.schema.ts:10` ticket status/`:16` admission/`:17` QR credential 별도 |
| 공연 등록·좌석도·번역 | `hooks/use-admin.ts:152`, `:173`, `:271`, `:288`, `:307`, `:379`; `components/admin/performance-form.tsx:311`; floor-seat-map/visual-seat-tier editor | `shared/src/schemas/performance.schema.ts:76`, `:95`, `:142`, `:171`; `types/i18n.types.ts` |
| 운영·권한·감사 | `hooks/use-admin-operations.ts`, `use-admin-users.ts`, `use-admin-security.ts`, `use-admin-cutover.ts`, `use-admin.ts:245`; `components/admin/admin-sidebar.tsx:153` | `shared/src/schemas/admin-operations.schema.ts`, `types/admin-operations.types.ts`; menu capability는 frontend 표현이며 API 권한 확인을 대신하지 않음 |
| 공개/관리자 고객지원 | `hooks/use-support-content.ts:57`; `hooks/use-admin-support-content.ts:161`; `components/admin/support-content-manager.tsx` | 공개 payload 및 admin 일부 types가 hooks 안에도 정의되어 있어 shared schema만으로 전체 계약 파악 불가 |
| 혜택·현장·정산 | `hooks/use-admin-benefits.ts:65`, `:125`, `:145`, `:164`; `hooks/use-field-operations.ts:101`, `:122`, `:140`, `:158`; `hooks/use-field-monitor.ts:29`; `hooks/use-admin-settlement.ts:38` | `shared/src/schemas/benefit.schema.ts`, `field-operations.schema.ts:92`, `:142`, `:189`, `:228`, `:295`; offline durable queue `apps/web/lib/field/offline-scan-store.ts:4` |

## 7. 이번 테스트와 기존 검증 자산

기존 설치된 Vitest 3.2.4를 절대 Node 경로로 실행했다. 고정 binary `/Users/sangwopark19/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`는 확인 시 v24.19.0이다. CI는 Node 22를 사용한다(`.github/workflows/ci.yml:43`). Docker client/server 29.6.1. 이번 pass는 이 로컬 런타임의 결과이며 CI를 새로 돌렸다는 뜻이 아니다.

| suite | cwd | 명령 | 결과 |
|---|---|---|---|
| API unit | `apps/api` | 아래 공통 unit 명령 | 104 files / 1,312 tests passed; 9.22s |
| web unit | `apps/web` | 아래 공통 unit 명령 | 103 files / 686 tests passed; 12.10s |
| shared unit | `packages/shared` | 아래 공통 unit 명령 | 15 files / 130 tests passed; 1.15s |
| show relaunch isolated PostgreSQL | `apps/api` | 아래 integration 명령 | 1 file / 17 tests passed; 9.84s |

공통 unit 명령:

```sh
env -u DATABASE_URL NODE_ENV=test /Users/sangwopark19/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run --reporter=dot
```

Integration 명령:

```sh
env -u DATABASE_URL NODE_ENV=test /Users/sangwopark19/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/show-relaunch.integration.spec.ts
```

- DB 안전성은 실행 전 소스로 확인: `apps/api/test/show-relaunch.integration.spec.ts:31`은 `DATABASE_URL`을 읽지 않으며, `:39` 새 `postgres:16-alpine` 컨테이너, `:43` 랜덤 매핑 포트의 `relaunch_test`, `:47` 해당 DB에 migrations, `:54` pool/container 종료다. 기존 로컬 DB/운영 DB 연결 없음.
- 통합 17개는 동일 좌석 동시 판매 소유자 하나, cancellation_pending 재판매 방지, 오래된 취소의 새 소유좌석 공개 방지, async DONE replay/늦은 상태 역행 방지, 포함 특전 재실행 중복 방지, repair dry-run/hash drift, 동시 DONE 취소 방지, 다른 좌석 동시 확정 deadlock 방지, 공연 전체 매수 제한, 보상 취소 IN_PROGRESS 수렴, 부분 취소의 남은 QR/manifest/revenue, 동시 scanner/특전 redeem, pending 만료 보호를 검증한다. 근거: 해당 파일 `:92`, `:123`, `:168`, `:180`, `:225`, `:243`, `:265`, `:301`, `:349`, `:383`.
- 이 통합 test는 PostgreSQL transaction/constraint를 진짜 실행하지만 Toss, locks/방송, email, pg-boss 일부는 test double이다(`:48`, `:128`, `:187`, `:197`, `:322`). 검증된 DB 불변식을 전체 외부 거래·현장 용량 검증으로 일반화하면 안 된다.
- API 기본 설정은 `src` unit만 대상으로 integration을 제외한다(`apps/api/vitest.config.ts:8`, `:14`). web은 jsdom이며 E2E를 제외한다(`apps/web/vitest.config.ts:8`, `:11`). shared는 Zod/schema, seat identity, locale/country, flags, field ingress, catalog freshness를 검증한다.
- web unit pass 중 React act 경고, jsdom navigation not implemented, fixture query data undefined, key warning이 나왔다. 테스트는 exit 0이며 이번 진단에서 fixture/제품 코드 수정을 하지 않았다. 이 경고와 jsdom 특성 때문에 실제 화면·반응형·접근성 판단은 브라우저 관찰을 따로 요구한다.
- 선행 시도 `env -u DATABASE_URL NODE_ENV=test pnpm --filter @grabit/api test:integration test/show-relaunch.integration.spec.ts`는 shell에서 선택된 pnpm11.19.0이 `pnpm.onlyBuiltDependencies`를 무시하고 의존성 자동 검사/설치를 시도해 `ERR_PNPM_IGNORED_BUILDS`로 테스트 전 종료했다. tool이 `pnpm-workspace.yaml`에 추가한 allowBuilds placeholder hunk만 제거하여 원상복구했고 native build 승인/설정 변경은 하지 않았다. repo 선언은 `package.json:16` pnpm10.28.1. 뒤 실행은 pnpm/lifecycle build를 거치지 않고 기존 Vitest를 직접 사용했다.

### 기존 통합·브라우저 E2E·CI의 경계

API integration 6개 파일은 `apps/api/vitest.integration.config.ts:20`에 수집된다. 이번에는 위 show-relaunch만 실행했다.

| 파일 | 코드가 의도한 실제 dependency 검증 |
|---|---|
| `apps/api/test/show-relaunch.integration.spec.ts` | disposable Postgres transaction/ownership/payment/QR/benefit regressions |
| `apps/api/test/admin-dashboard.integration.spec.ts:44` | disposable Postgres16 + Valkey8, 실제 migrations, dashboard aggregate/cache |
| `apps/api/test/booking-cluster-lua.integration.spec.ts:134` | Valkey cluster mode, hash slot/Lua/lock/consume ownership |
| `apps/api/test/sms-cluster-crossslot.integration.spec.ts:76` | Valkey cluster mode OTP Lua/hash tag CROSSSLOT 회귀 |
| `apps/api/test/sms-throttle.integration.spec.ts:67` | Valkey-backed Nest Throttler HTTP limits/TTL; 테스트 컨트롤러, 실제 SMS 전송 아님 |
| `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts:93` | 실제 Valkey8에서 BookingService lock/status/unlock 및 owned-lock 소비 |

Browser spec는 20개 파일이다. 아래는 파일의 정적 분석 결과이며 이번 실행 결과가 아니다.

| 분류 | 파일 | 실제로 검증하려는 부분 / fixture 경계 |
|---|---|---|
| real local API read | `admin-dashboard.spec.ts` | `loginAsTestUser`로 실제 local API 로그인, dashboard 읽기/필터 refetch/차트 SVG. helper API 기본값은 localhost8080(`helpers/auth.ts:51`) |
| real local API + provider mock | `signup-sms.spec.ts` | 가입 step3까지 이동, dev_mock OTP 승인/오류/쿨다운. 실제 해외 SMS 수신이나 최종 회원가입 저장 검증 아님(`:5`, `:41`) |
| SDK hybrid | `toss-payment.spec.ts` | 실제 test SDK iframe mount; 예약 store fixture 주입(`:134`); payments/confirm intercept(`:57`); complete URL 직접 이동(`:155`). test key 없으면 skip(`:34`). PG 승인/return/webhook 전체 흐름 아님 |
| 결제 recovery fixture | `toss-payment-phase24.spec.ts` | pending/failed/expired return UI를 reservations/confirm route mock으로 검증(`:130`, `:171`, `:201`) |
| 구매자/현장 fixture | `booking-floor-selection`, `booking-queue`, `booking-complete-qr`, `phase26-qr-visibility`, `phase27-qr-check-in`, `phase27-offline-sync`, `mypage-withdrawal` | auth/queue/좌석/예약/QR/입장/오프라인/탈퇴 API를 page.route fixture로 대체; UI wiring·payload·오류/중복 표시 회귀. 카메라 실물 장치/실제 동시 scanner/DB 결과 증거 아님 |
| 관리자 fixture | `admin-cutover`, `admin-event-publish`, `admin-export-and-seat-ops`, `admin-operations-inbox`, `admin-rbac-and-security`, `admin-users` | mockAdminAuth/route fixtures로 메뉴·확인/사유·filters·payload·CSV UI·권한표시. 실제 API RBAC/운영 CSV 내용/외부 프로세스 완료 증거 아님 |
| 번역/배포 smoke 혼합 | `i18n-smoke`, `phase26-m1-smoke` | locale/runtime flag/read-only public 및 payment-blocked UI; 여러 API fixture/route 차단 포함. 운영 카탈로그나 거래 전체 자동 검증으로 보면 안 됨 |
| 소셜 오류 표시 | `social-login.spec.ts` | query param 오류/재시도·localized return·refresh 실패. OAuth provider에서 실제 승인하고 돌아오는 흐름 아님 |

CI 계약:

- `.github/workflows/ci.yml:3`: main 대상 pull_request와 workflow_dispatch. 현재 파일에는 push/schedule trigger가 없으며 일부 아래 주석/조건의 main-push 언급은 현재 trigger 정의와 구분해야 한다.
- `:14`, `:30`: job 서비스 Postgres16 `grabit_test`, 시험용 env. `:45` frozen install → lint → typecheck → unit.
- `:49`: Cloud Run background worker payload Node test. `:57`: 전체 API testcontainers integration.
- `:63`, `:66`: CI DB migrate/seed, `:79`: non-fork Toss test secret presence gate, `:97`: Chromium 설치, `:103`: API build.
- `:107` 이후 API background 기동은 Redis 없는 InMemory fallback을 허용하고 health 503도 readiness로 수용한다. 그 조건은 운영 healthy Redis를 증명하지 않는다.
- `:147` 이후 Playwright E2E. `apps/web/playwright.config.ts:17`은 desktop Chromium 단일 project; 개별 spec의 mobile viewport는 있지만 iOS Safari/실제 인앱 browser profile은 없다. `:27`은 Next dev server다.
## 8. 남은 확인과 이번 진단의 한계

| 항목 | 이번에 하지 않은 이유 / 현재 근거 | 이어질 결정 |
| --- | --- | --- |
| 좌석 선택→결제→발권→취소의 운영 정상 거래 | 관찰한 공연은 판매 종료이며 좌석 잠금·결제·환불은 이번 진단 범위의 운영 조작이 아니다. 관련 UI/상태는 소스와 기존 E2E 경계를 조사했고 DB 불변식은 격리 회귀로 검증했다. | 거래 상태·구매자 UX·오픈 검증 |
| 기존 구매자의 QR/예매 상세 | 고객별 QR을 취급하지 않았고 상세 GET은 누락 QR을 생성할 수 있다. 실제 티켓 화면의 데이터 있는 상태는 이번에 미검수다. | QR/권리 보존·구매자 UX |
| 가입 완료·이메일/SMS·외부 OAuth | 폼과 오류 안내/언어 복귀까지만 확인했다. 메시지 발송·실제 계정 생성·외부 인증 왕복은 실행하지 않았다. | 회원/해외 이용 정책·검증 자원 |
| 실제 PG/가맹점 설정·부분취소/정산·은행 반영 | 설정 확인은 기존 별도 사전 작업이며 실제 돈의 이동은 실행하지 않았다. | 가맹점 설정 확인·거래/정산 계약 |
| 정상 QR 검표·중복 입장·특전 지급·현장 오프라인 | 이번 실제 화면은 QR 없는 진입과 모니터 초기 상태다. 고객 QR/권리 소비·카메라/네트워크 실기기 시험은 실행하지 않았다. DB 중복 방지는 격리 테스트 근거다. | 현장 정책·현장 UX·실물 인수 |
| 실제 운영/CS·혜택 데이터가 채워진 상태 | 빈 목록/선택 전 상태와 신규 폼을 관찰했다. 실제 문의 답변·혜택 설정 저장·실행·좌석 변경은 하지 않았다. | 운영 절차·어드민 UX |
| 접근성 전수 준수 | 라벨/오류 안내/레이아웃의 관찰과 일부 DOM/소스 확인만 수행했다. 스크린리더·키보드 전수·명암 자동 측정은 미실행이다. | 각 프로토타입 검증 기준 |
| 운영 배포 SHA·runtime 플래그·전체 health | 별도 HTTP GET은 403, runtime-flags 브라우저 직접 탐색은 클라이언트 차단을 반환했다. 일반 웹 UI는 열렸다. 이 제한을 서비스 장애나 BOOKING_ENABLED 값의 증거로 해석하지 않는다. | 실제 오픈/전환 검증 |
| 클러스터/부하/복구·전체 E2E 재실행 | 이번 실행은 단위와 핵심 PostgreSQL 회귀다. 나머지 통합/브라우저 spec는 정적으로 검증 범위를 분류했다. | 운영 용량·외부 장비·리허설 계획 |

## 9. 다음 결정으로 넘기는 질문

- [전면 개편에서 유지·통합·삭제·재구축할 업무와 완료 기준을 정한다](https://github.com/icons-hq/grapit/issues/201): 37개 route가 담당하는 업무를 기준으로 전면 개편의 완료 조건을 합의한다. 공개 화면뿐 아니라 등록·CS·좌석·특전·정산·오픈 준비를 함께 다룬다.
- [동행자 입장·QR·특전 지급·통신 장애의 현장 정책을 정한다](https://github.com/icons-hq/grapit/issues/206): 입장 처리 단위와 특전의 고정 식별자/표시 이름/권리 버전의 계약 충돌을 해소한다.
- [공연 준비·판매·고객 대응의 운영 절차와 권한을 정한다](https://github.com/icons-hq/grapit/issues/205): 공연/회차 선택, 설정과 게시 검토의 단계, 이메일 문의와 인박스 연결을 정한다.
- [매출·환불·수수료·정산의 기준과 대조 절차를 정한다](https://github.com/icons-hq/grapit/issues/207): 미조회와 0, 유효 티켓 매출과 PG/은행의 사실을 구분한다.
- 구매자·어드민·현장 프로토타입에서는 이 보고서의 화면을 출발점으로 정상/실패/미조회 상태를 함께 검토한다. 현재 모습을 그대로 보존하거나 반대로 모두 버리기로 결정한 것은 아니다.
- [새 업무 경계와 기존 데이터 보존을 만족하는 구조·전환 방식을 정한다](https://github.com/icons-hq/grapit/issues/211): sync/async 확정과 조회 중 복구의 책임, 원장/관측 상태의 출처, 테스트 seam을 비교한다.
- [전면 개편 완료와 12월 오픈을 판단할 검증·전환 계획을 정한다](https://github.com/icons-hq/grapit/issues/212): fixture pass와 실제 운영 수행을 분리하고 과거 실행 원장을 공연별 최신 증거로 어떻게 갱신할지 정한다.

위 질문들은 기존 지도 티켓의 범위에 들어간다. 이번에 새 제품 정책을 대신 결정하거나 같은 질문의 중복 티켓을 만들지 않는다.

## 10. 보관과 재현

- 이 Markdown이 진단의 종합 보고서다. [캡처·테스트 증거 manifest](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/evidence-manifest.json)에 채택 파일의 크기·SHA-256·관찰 단계가 있다.
- [backend 소스 조사 기록](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/source-backend-notes.md)과 [화면 목록/테스트 실행 기록](/Users/sangwopark19/.codex/artifacts/grapit-service-diagnosis-2026-09-21/source-inventory-test-notes.md)은 근거 추적용 보조 자산이다.
- 보고서·스크린샷은 로컬에 보존했다. 공개 이슈에는 요약과 문서 위치·코드 근거를 남기며 고객 정보나 원본 QR을 게시하지 않는다.
- 기존 `docs/agents/issue-tracker.md` 수정은 보존했다. 제품 코드·테스트·설정에 최종 변경을 남기지 않았고 commit/push/배포를 실행하지 않았다.
- 과거 사고 메모리는 조사 항목을 고르는 데만 사용했다. 화면 증거는 전부 이번 캡처이며 과거 테스트/운영 수치를 이번 결과로 사용하지 않았다.
