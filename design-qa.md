# Grabit 티켓 개편 디자인·동작 QA

## 2026-10-28 PR #239 리뷰·출시 준비

통합 후 운영 migration·배포를 승인받아 [PR #239](https://github.com/icons-hq/grapit/pull/239)를 준비했다. 아래 최초 통합의 미배포 표시는 당시 범위를 설명한다. 배포 완료 여부는 실제 CI/CD와 배포 후 증거로 별도 확인한다.

- 기준·요구사항 병렬 리뷰와 GitHub 자동 리뷰에서 찾은 4가지 문제를 수정했다: 층 포함 좌석 ID 선택/복원, 선택 날짜 마감 후 모바일 달력 재진입, 결제 화면 복귀 시 최신 회차 유지, 공연장 변경 시 이전 장소의 템플릿 참조 거절.
- 회차 URL 갱신은 `replaceState(null, ...)`로 Next의 검색 매개변수·인증/대기열 복귀 주소와 동기화한다. 공연장 검증은 좌석도를 생략한 부분 수정도 포함하며, 명시적으로 분리한 공연 사본은 저장할 수 있다.
- CI에서 실패한 기존 E2E를 현재 화면 계약에 맞췄다. 4개 언어의 홈/검색/상세 제목, 새 공연장·찜 조회 mock, `showtimes.dateTime` fixture를 갱신했다. 예매 차단과 부작용 금지 assertion은 유지했다.
- 관리자 패치노트에 PR #239의 기능·수정·검증 정보를 추가했다.
- Node 22 웹 단위 **1,606개**, API 단위 **2,684개**, 템플릿 HTTP/PostgreSQL 통합 **11개**, 전체 typecheck·lint(오류 0) 통과. 최종 history 조정 후 해당 회귀 파일도 재검증했다.
- 로컬 Chrome E2E: 다국어 smoke 1개와 예매 차단/대기열·데스크톱/모바일 층 선택 5개 통과. 기존 전체 CI는 수정 커밋으로 다시 실행한다.
- 운영 변경 전 read-only 조사에서 진행 중 결제·환불·취소·좌석 잠금·대기/입장 세션 0, 운영 migration ledger 48개(최신 `0047_support_thread_audit_actions`)를 확인했다. 신규 migration 2개 후 기대 ledger 수는 50개다. 격리 DB의 51개는 전체 journal을 처음부터 적용한 결과이며 운영 기존 ledger 수와 혼동하지 않는다. 사전 Cloud SQL 백업 완료를 확인했다.

## 2026-10-28 최신 운영 코드 통합

통합 검증 결과: **통과**. 운영 배포는 이번 작업에 포함하지 않았다.

- 기준: 운영 반영된 `0b81c8152b0317e44e3b19aa7da7a2f0daab8733` (PR #238). 통합 브랜치는 `ps/feat/nol-ui-integration`이다.
- 원본 `ps/feat/nol-ticket-redesign`의 변경 파일 194개는 바이트 해시·Git 상태·HEAD를 비교해 보존을 확인했다. 별도 worktree에 구매자 카탈로그·관심/최근 공연·예매 화면과 공연장 좌석도 템플릿, 관련 API·공유 계약·migration을 통합했다.
- 서버 queue, 좌석/소켓 provider, reservation, ticket 모듈과 기존 결제·QR·Valkey Cluster 통합 테스트, CI/CD·운영 설정은 기준 커밋과 동일하다. 매진 후 추가 입장을 차단하는 capacity version 검사와 입장 상한 200명은 유지된다.
- 새 템플릿 테스트의 익명 React wrapper lint 오류를 수정했다. 좌석 선택 E2E는 등급명이 여러 곳에 표시되는 새 요약 구조와 모바일 펼침 동작을 검증하도록 갱신했다.
- 실제 로컬 API 연결 중 초기 대기열 진입이 두 번 전송되어 한 요청이 403을 받는 현상을 발견했다. Root Strict Mode에서만 2회 요청되는 최소 테스트로 재현했다. 초기 효과를 한 microtask 늦추고 cleanup generation을 확인해 중복 전송을 막았다. 수정 후 일반/Strict Mode 모두 요청 1회이며, 새 구매자 브라우저에서도 단일 201 응답·콘솔 오류 0건을 확인했다. 서버 입장 로직은 수정하지 않았다.

### 검증 환경과 결과

Node 22.23.1 / pnpm 10.28.1을 최종 단위 검사·빌드에 사용했다. 최초 셸의 Node 26.5.0에서는 jsdom의 `localStorage` 충돌로 웹 테스트가 실패했으며, CI와 같은 Node 22에서 전체 웹 테스트가 통과했다. API 통합 테스트는 최초 Node 26 환경의 Testcontainers에서 실행했고, 별도 로컬 API·migration·실제 UI 연동은 Node 22에서 확인했다.

| 검증 | 결과 |
| --- | --- |
| 최종 전체 단위 검사 `pnpm test --force` | 웹 **1,598**, API **2,684**, shared **200**, edge proxy **10** 통과 |
| PostgreSQL·Valkey 통합 검사 `pnpm --filter @grabit/api test:integration --maxWorkers=2` | **35개 파일·423개 테스트 통과**. 템플릿 권한·버전 고정·동시 저장·10,000석, 즐겨찾기 격리, 매진 회귀·결제·QR 포함 |
| 기존 DB 업그레이드 | 운영 기준 커밋의 migration 49개와 기존 좌석도 fixture → 신규 2개 적용 후 51개. 기존 51개 public 테이블의 기존 컬럼·행 해시 일치. 기존 layout은 `is_template=false`, floor config는 null, 새 favorites는 빈 테이블 |
| 타입 검사 | 전체 통과, 최종 프런트 수정 후 웹 재검사 통과 |
| lint | 오류 0. 웹 33개·API 50개 기존 경고. 최종 변경 파일 별도 검사도 통과 |
| 실제 production build `pnpm build --force` | Node 22에서 shared·API·Next.js Turbopack·edge 전부 통과. 임시 webpack 설정 없이 저장소 설정 그대로 사용, Sentry 업로드 비활성화 |
| Playwright E2E | 대기열 8, 층별 좌석 선택 2, 약관/결제 위젯 오류 6, 결제 복구 8, 완료 QR 2: **총 26개 통과**. 프런트 대기열 수정 후 해당 대기열·좌석 10개 재검사 통과 |
| 원본·운영 수정 보존 | 원본 194개 파일과 Git 상태·HEAD 동일, 보호 대상 서버·배포 파일 diff 없음 |
| Git whitespace | `git diff --check` 통과 |

Browser plugin not available. 저장소의 Playwright 테스트와 Playwright MCP를 사용했다. 저장소 버전에 맞는 headless Chromium 실행 파일이 로컬에 없어, 저장소 밖 임시 설정에서 설치된 Chrome을 선택했다. 의존성·저장소 Playwright 설정은 바꾸지 않았다.

### 실제 렌더링과 상호작용

로컬 `http://localhost:3108` 웹과 `http://localhost:8080` API, 전용 PostgreSQL 16·Valkey 8 컨테이너를 사용했다. 운영 DB·기존 개발 DB를 복제하거나 변경하지 않았다. Desktop 1440×1000, mobile 390×844를 직접 확인했고, E2E는 1280×900·375×812 및 iPhone 13 viewport를 사용했다.

| 화면·경로 | 확인된 동작 |
| --- | --- |
| 홈 → 장르 → 상세 | 가상 공연이 실제 카탈로그 API에서 표시됨. Grabit 보라색 유지, 정상 제목·본문·이미지 렌더링 |
| 카테고리·랭킹·오픈 예정·공연장·검색·최근 본 공연 | 모바일 route/title/주요 heading 정상. `퍼플` 검색 결과 확인. 페이지 오류·가로 넘침 0 |
| 상세 → 찜 → 찜 목록 | 실제 계정 API 저장 후 목록에서 동일 공연 확인 |
| 상세의 둘째 날짜 선택 → 대기열 → 좌석 | `showtimeId`가 URL에 유지되고 선택 일정은 2026.11.12 19:00 KST로 일치 |
| 좌석·층·구역 | 전면 구역 확대, 1층 A-1 선점, 2층 왕복 후 선택 유지. 모바일 요약 펼침·선택 좌석·52,000원(50,000+수수료 2,000) 확인 |
| 좌석 → 결제 확인 | 서버 선점 재확인 후 동일 회차·좌석·금액으로 이동. 실제 PG 요청·승인은 하지 않음 |
| 관리자 → 회차·좌석·가격 → 템플릿 | v1 불러오기·v2 저장, 공연 가격 50,000원 유지. DB에서 기존 세 공연의 연결은 모두 v1로 유지되는 것을 확인. Desktop/mobile 가로 넘침 없음 |
| 시각·콘솔 | 빈 페이지·프레임워크 오류 화면 없음. 최종 대기열 콘솔 오류·경고 0. 카탈로그의 Next Image LCP 권고 경고는 기능 오류와 구분 |

수동 검증에 추가한 공연은 `[로컬 QA]` 합성 fixture이며, 계정도 전용 검증 계정이다. 포스터·SVG는 기존 seed asset을 사용했다. 결제 SDK는 E2E/수동 화면 확인에서 모의 응답을 사용했다. 수동 연동 DB의 reservation·payment는 모두 0개였다. 검증 서버·컨테이너·전용 DB와 임시 세션 파일을 정리했다. 캡처·실행 로그는 저장소 밖에 보관한다.

### 남은 범위

커밋·PR·운영 배포와 운영 migration은 실행하지 않았다. 운영 반영 시 `0049_performance_favorites`·`0050_venue_layout_templates`를 승인된 CI/CD로 적용하고 API·웹 배포 후 live smoke를 확인해야 한다. 실제 PG 승인·환불, 실기기 Safari/Android, 현장 스캐너, 1,500명 부하의 재측정은 이번 UI 통합 범위에 포함하지 않았다. 이전 [운영 부하 검증](docs/research/girl-rules-600-capacity-2026-10-27.md)의 전체 지연 기준 미달 판정은 그대로 유효하다.

## 2026-10-26 화면 개편 기록

아래는 최초 개편 당시의 기록이다. 현재 통합·검증 상태는 위 2026-10-28 항목을 따른다.

final result: passed

구현·수정 후 Chrome에서 다시 렌더링해 비교했다. P0/P1/P2 미해결 항목은 없다. Grabit 색상 복원 후 예매 CTA·선택 회차·로고의 실제 계산 색상은 모두 `rgb(108, 60, 224)`로 확인했다. 검증용 공연·계정을 제거한 최종 미리보기에는 실제 공개 공연 1개만 남아 있다.

## 기준과 범위

- 원본: https://nol.yanolja.com/ticket 및 연결된 장르·랭킹·오픈 예정·검색·공연 상세 화면.
- 구현: http://localhost:3100, 브랜치 `ps/feat/nol-ticket-redesign`.
- 사용자 합의: Grabit 브랜드와 기존 공연 데이터를 유지하고 필요한 데이터 구조는 확장한다. 후속 지시에 따라 NOL의 파란색 대신 기존 Grabit `#6C3CE0`와 기존 배경·본문·경계 토큰을 사용한다.
- 데스크톱 1440×1000, 모바일 390×844 CSS viewport. 원본/구현을 같은 비교 입력으로 함께 열어 확인했다. Chrome localhost 110% 확대를 임시 보정했으며 사용자 설정은 변경하지 않았다.
- 공연·후기·판매율이 서로 다르므로 콘텐츠 픽셀 일치율은 계산하지 않는다. 실제 이미지, 배치, 글꼴, 간격, 메뉴, 동작을 비교한다.

Chrome 캡처 원본은 데스크톱 원본 1425×990 / 구현 1426×990px, 모바일 원본 375×812 / 구현 376×814px다. 비교 이미지는 각각 CSS viewport 크기로 정규화했다. 파일별 원본 픽셀·정규화·crop은 [screenshots.json](docs/research/nol-ticket-redesign-2026-10-26/screenshots.json)에 기록했다. 중간 너비 1023×768px도 상세 화면에서 확인했다. 이는 실기기 Safari/Android 검증을 대체하지 않는다.

## 발견한 문제와 수정

| 심각도 | 문제 | 수정 및 재검증 |
| --- | --- | --- |
| P1 | 개발 서버의 오래된 CSS 때문에 다중 장르 추천 포스터가 화면 전체로 확장 | 최신 CSS로 서버를 다시 시작하고 실제 image parent 위치·크기 및 추천 영역을 확인 |
| P2 | 모바일 배너가 세로 영역 안에 작게 들어가 과도한 빈 공간 발생 | 원본처럼 cover crop 적용, 실제 모바일 배너 제목과 이미지 확인 |
| P2 | 장르 배너가 홈과 동일한 큰 크기로 표시 | 장르 전용 1000×360px 데스크톱 배치 적용 |
| P2 | 모바일 장르·랭킹의 공통 검색 헤더와 하단 메뉴가 원본보다 화면을 많이 차지 | 현재 장르/페이지 제목과 검색·언어 제어만 둔 문맥 헤더 적용, 장르·랭킹·오픈 예정의 루트 하단 메뉴 숨김, 장르 배너는 너비 60%·높이 300px로 조정 |
| P2 | 모바일 랭킹이 2열 카드로 표시 | 원본처럼 포스터·순위·정보의 세로 목록으로 변경, 데스크톱 순위도 포스터 아래 배치 |
| P2 | 오픈 예정 화면이 사이드바와 작은 목록으로만 표시 | 상단 큰 카드 3열·아래 필터 대화상자와 목록으로 변경 |
| P2 | 계정 탭의 CSS가 기존 primitive 속성과 불일치 | 실제 `role=tab` 기준으로 스타일 적용 |
| P2 | 모바일 날짜 선택에 모달 포커스 경계가 없음 | Radix Dialog/Trigger로 포커스 이동·복원과 ESC 닫기 적용 |
| P2 | 날짜 Dialog의 기본 중앙 이동이 모바일 bottom sheet와 충돌 | Tailwind translate 값을 모바일 0으로 명시하고 달력 폭을 100%로 맞춤 |

## 의도된 차이

Grabit 로고·기존 보라색 팔레트·공연·가격·정책·4개 언어를 유지한다. NOL의 여행, MD shop, toping, 멤버십, 할인, 리뷰와 판매 점유율은 Grabit에 대응 데이터/계약이 없어 표시하지 않는다. 랭킹은 누적 조회수 기준을 명시한다. 실제 정보가 없는 상세 섹션은 숨긴다. 한 개의 배너에서는 불필요한 전환 제어를 숨긴다.

검색은 Grabit의 독립 검색 경로에서 검색어를 바로 수정할 수 있는 폼을 유지한다. 지역은 17개 시·도 select, 공연일은 실제 날짜 입력으로 제공한다. 원본의 해외 숙소 검색 탭·출연자 검색 추천은 추가하지 않았다. 판매·오픈 시각에는 연도와 KST를 유지하므로 원본의 짧은 상대 날짜와 줄 수가 다를 수 있다. 모바일 언어 제어와 실제 판매 상태 배지는 Grabit 요구사항으로 유지한다.

## 필수 시각 검증

| 영역 | 확인 결과 | 근거 |
| --- | --- | --- |
| 글꼴·타이포그래피 | 기존 Pretendard 실제 로딩, 헤더·섹션·카드·보조문구의 위계와 한국어 줄바꿈 확인 | [헤더 확대 비교](docs/research/nol-ticket-redesign-2026-10-26/header-focus.jpg), [홈](docs/research/nol-ticket-redesign-2026-10-26/home-desktop.jpg) |
| 간격·배치 | 1240px 콘텐츠, 장르 배너 크기, 5열 카드, 모바일 세로 랭킹과 가로 목록, 상세 일정 패널 확인. 모바일·데스크톱 문서 가로 넘침 없음 | [모바일 홈](docs/research/nol-ticket-redesign-2026-10-26/home-mobile.jpg), [상세](docs/research/nol-ticket-redesign-2026-10-26/detail-desktop.jpg) |
| 색상·토큰 | 사용자 후속 지시에 따라 Grabit primary `#6C3CE0`, 본문 `#1A1A2E`, 보조 `#6B6B7B`, 배경 `#F5F5F7`, 경계 `#E4E4E7` 유지. 파란색 override 및 로고의 초록 포인트 제거 | [캘린더·CTA 확대 비교](docs/research/nol-ticket-redesign-2026-10-26/calendar-focus.jpg), 실제 computed style |
| 이미지 | 8개 장르 PNG 로컬 제공, 기존 Grabit 배너·포스터 사용. 배너 cover crop, 포스터 비율 유지, 확대 보기 확인 | [모바일 상세](docs/research/nol-ticket-redesign-2026-10-26/detail-mobile.jpg), [asset provenance](apps/web/public/images/ticket-genres/sources.json) |
| 문구·콘텐츠 | 실제 공개 상태·가격·KST 일정 사용, 종료 공연 표시, 없는 리뷰·판매량·할인 미표시. 테스트 데이터는 명시적으로 표시 후 제거 | [실제 데이터 검색](docs/research/nol-ticket-redesign-2026-10-26/search-desktop.jpg), [최종 홈](docs/research/nol-ticket-redesign-2026-10-26/final-home-desktop.png) |

아래 구조 비교는 **보라색 복원 이전**의 다중 공연 fixture 화면이다. 카드·메뉴·반응형 수정 재검증을 보존하기 위한 기록이며 최종 브랜드 색상은 위의 최신 홈·상세·검색 캡처가 기준이다.

- [모바일 장르 배너](docs/research/nol-ticket-redesign-2026-10-26/layout-genre-mobile.jpg)
- [모바일 랭킹 목록](docs/research/nol-ticket-redesign-2026-10-26/layout-ranking-mobile.jpg)
- [오픈 예정 큰 카드와 필터](docs/research/nol-ticket-redesign-2026-10-26/layout-upcoming-desktop.jpg)

## 실제 동작 검증

| 흐름 | 확인 |
| --- | --- |
| 배너·목록 | 이전/다음, 일시정지, 배너 전체보기와 닫기. 오픈 예정 rail은 다음 클릭 후 `scrollLeft=840`, 이전 이동 확인 |
| 탐색 | 전체 카테고리 → 장르, 모바일 현재 장르 메뉴 → 랭킹, 랭킹 장르 변경과 URL 반영 |
| 필터·검색 | 장르·판매중·지역 조합의 결과 수, 모바일 필터 적용, 공연장 이름 검색 → 해당 공연 목록, `Girl Rules` 검색. 최종 실제 데이터 검색은 종료 공연 1건 |
| 다국어 | 영어 전환 시 장르·상태·ended query 유지, 한국어 복귀. 4개 언어 계약은 기존/추가 단위 테스트로 검증 |
| 관심 공연 | 비로그인 시 상세 복귀 주소로 로그인, 저장 후 목록 표시, 다른 QA 계정에서는 빈 목록. 실제 PostgreSQL 동시 저장·상한·계정 격리 통합 검사 |
| 최근 기록·계정 | 최근 본 공연 표시·비우기, 내 티켓 → 티켓 지갑, 마이페이지 탭·로그아웃 |
| 상세·예매 | 포스터 확대·닫기, 모바일 날짜 14→15 변경, 선택한 `showtimeId`가 대기열 이후 좌석 화면에 유지됨. 로컬 좌석 1석 선택·금액 표시·전체 해제 |
| 모달·포커스 | 날짜 창 너비 약 376px, 달력 약 335px. 포커스가 dialog 안에 있고 ESC 후 예매 버튼으로 복귀. 최종 보라색 날짜 선택·CTA를 다시 렌더링해 확인 |

[최종 모바일 날짜 선택 화면](docs/research/nol-ticket-redesign-2026-10-26/implementation-date-selection-mobile.png)은 색상 확인용 임시 공연으로 촬영했다. 이 공연도 확인 후 삭제했다. 실제 결제·환불·메일/SMS 발송은 실행하지 않았다.

Chrome 비밀번호 자동완성 확장프로그램의 알림 레이어가 로그인 직후 상단 버튼을 가린 현상은 DOM hit test로 확인했다. 개발 중 modal 열린 상태의 hot reload에서 hydration 경고도 관찰했다. 최종 빌드 후 새 페이지에서 날짜 선택·닫기·검색을 다시 검사했으며 앱 console error는 없었다. 확장프로그램 자체 오류와 Next.js 개발 표시기는 제품 화면 오류로 분류하지 않았다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| 웹 전체 Vitest | 176개 파일, **1,587개 통과** |
| 공통 계약 Vitest | 18개 파일, **196개 통과** |
| API 카탈로그·검색·상태·캐시 | 4개 파일, **100개 통과** |
| Migration snapshot·lock timeout | 2개 파일, **6개 통과** |
| PostgreSQL 통합 검사 | 2개 파일, **8개 통과** (Testcontainers) |
| 웹/API typecheck | 통과 |
| 웹/API production build | 통과. Sentry 업로드 비활성화 |
| lint | 오류 0. 웹 33개·API 50개 경고 유지 (이미지 태그 권고·기존 hook/test 코드 등) |
| Git diff whitespace | 통과 |

명령은 저장소에 명시된 `pnpm@10.28.1`로 실행했다. API 전체 단위 suite는 변경 영향 밖이어서 재실행하지 않고 관련 API·migration 106개와 실제 PostgreSQL 8개를 검사했다. 모바일은 Chrome 반응형 화면에서 검사했으며 실기기 시험은 이번 범위에 포함하지 않았다. 배포 후 live smoke는 운영 배포를 실행하지 않았으므로 미실행이다.

검증용 공연은 본 QA 10개와 색상 QA 1개, 계정은 2개를 모두 제거했다. 검증용 reservation은 0개이며 좌석 잠금은 화면에서 해제했다. 기존 로컬 원본 DB와 운영 DB는 변경하지 않았다. 현재 로컬 복제 DB의 공개 공연은 실제 데이터 1개(종료)이고 오픈 예정 빈 상태가 정상이다. [기계 판독 가능한 검증·정리 결과](docs/research/nol-ticket-redesign-2026-10-26/verification.json).

## 남은 사항

- P3: 오픈 시각의 긴 KST 표기, 공연장 고유 로고가 없는 경우 공통 공연장 아이콘 사용. 실제 신규 공연 자료에 맞춘 편집이 가능하며 기능을 막지 않는다.
- 운영 반영은 미실행이다. 승인된 배포 절차에서 `0049_performance_favorites`를 먼저 적용하고 API·웹 배포 및 live smoke가 필요하다.
- 변경은 작업 브랜치에 있으며 커밋·PR·운영 배포는 생성하지 않았다.

완료 체크: 원본·구현 비교, 주요 상호작용, 모바일/데스크톱 렌더링, 사용자 지정 팔레트, 오류/빈 상태, 자동 검사, 문서 갱신, 테스트 데이터 정리 모두 완료.
