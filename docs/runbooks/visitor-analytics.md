# 방문·가입 분석 운영

## 현재 도입 상태

1단계 가입 모니터링은 `/admin/users`, 2단계 자체 방문·행동 분석은 `/admin/analytics`다. 2단계는 코드·migration·화면을 준비하되 수집 기본값을 꺼 둔다. 정책 개정·실판매 용량 검증·운영 활성화 승인은 별도다. [ADR 0013](../adr/0013-first-party-consented-analytics.md), [공식 근거와 도구 비교](../research/2026-11-11-first-party-analytics-evidence.md), [한·영 정책 개정 초안](../legal/analytics-privacy-amendment-draft.md)을 함께 읽는다.

## 즉시 운영: 식별자 없는 횟수 집계

2026-11-12 추가한 `POST /analytics/counts`는 공개 화면의 종류와 동작 이름별 개수만 받는다. 방문/세션/회원/이벤트 ID, 클라이언트 발생 시각, 실제 경로/공연 ID, query, 유입·기기 정보는 받지 않는다. DTO는 추가 필드를 거부하며 최대 20개 동작의 합계를 한 배치로 제한한다. 별도 브라우저 식별자를 만들지 않고 인증·cookie·referrer 없이 전송한다. DNT/GPC, 관리자·민감 경로, 명시적 거부(기존 분석 거부 포함)를 존중한다. `/legal/analytics`의 횟수 집계 설정은 허용/거부 값만 저장한다. 서비스 제공·보안용 기존 접속 로그와는 별도다.

서버는 전용 분석 연결의 한 statement로 공유 스위치를 확인하고 `analytics_counters`의 시간대/화면 종류/동작별 숫자에 더한다. 개인별 raw event는 저장하지 않으며 365일 후 삭제한다. 연결 대기·오류·부하 제한은 버리고 사용자 동작을 지연시키지 않는다. 네트워크 손실·브라우저 거부·호출 위조·공유 IP throttle 영향을 받을 수 있는 운영 참고용 횟수이며 사람 수/세션/정확한 전환율이 아니다.

이 모드는 `AGGREGATE_ANALYTICS_ENABLED=true` 환경 변수와 DB `aggregate_enabled=true`를 함께 요구한다. 개인별 연결 모드의 `ANALYTICS_ENABLED`/`enabled`와 독립적이다. 2026-11-12 1차 배포에서는 횟수 집계만 활성화했다. 후속 개인별 방문·좌표·화면 재생 요청은 아래 별도 절차에 따라 `analytics-v2-replay` 동의부터 활성화한다. 관리자는 `/admin/analytics`의 횟수 집계 시작/중단을 사용한다. 기본 조회는 어제 00:00 KST부터다. 개인정보처리방침 페이지에서 공개 집계 안내·설정으로 연결하며 현행 방침 본문을 소급 변경하지 않는다. 별도 개인별 분석 개정 준비안은 미게시 상태다.

[기존 Cloudflare 기록 조사](../research/2026-11-12-existing-traffic-evidence.md)의 `httpRequests1hGroups` 요청/HTML pageViews와 공개 호스트의 adaptive HTML 추정치를 `analytics_traffic_history`에 보존한다. HTML 요청은 봇·모니터링을 포함하고 사람 수가 아니다. 집계 간 모집단·수집 위치가 다르므로 새 브라우저 횟수와 더하지 않는다. 현재 시간대와 조회 시작 시각을 포함한 시간대는 부분 구간이 포함될 수 있다. 별도 정기 Cloudflare 수집은 아직 구성하지 않았으며 관리자는 화면의 확보 시각으로 범위를 확인한다.

### 기존 접속 집계 import runbook

개인정보가 없는 공급자 집계만 아래 형식으로 정규화한다. `analyticsTrafficHistoryImportSchema`가 추가 필드·지표·수치·중복을 검증한다.

- `observedThrough`: 공급자 조회 시각(ISO UTC)
- `rows`: `{ bucket: 정각 ISO UTC, source: cloudflare_zone|cloudflare_public_html, metric: requests|html_page_views|html_requests_estimated, count: 정수, sampled: boolean }`

운영 적용은 프로젝트 `grapit-491806`, 리전 `asia-northeast3`, DB **grapit**을 확인한 뒤 수행한다. 승인된 API 배포 이미지로 일회용 Cloud Run Job을 만들며, 기존 worker를 변경하지 않는다. worker와 같은 Cloud SQL 연결/네트워크 및 최소한의 `database-url:latest` 참조만 사용한다. 개인 OAuth/API 키를 운영에 복사하지 않는다.

1. JSON의 UTF-8 원문 SHA256을 검토한다. `ANALYTICS_HISTORY_BASE64`, `EXPECTED_HISTORY_SHA256`, `EXPECTED_DATABASE_NAME=grapit` 환경값을 넣는다. 이 payload에는 공개 화면의 시간별 숫자만 있으며 비밀은 포함하지 않는다.
2. `node dist/ops/analytics-history-import.cli.js dry-run`으로 DB 이름·행 수·조회 시각·해시를 확인한다. 스크립트는 DB가 다르면 쓰지 않는다.
3. 같은 이미지·입력으로 `apply`를 실행한다. 동일 시간/출처/지표를 upsert하고 더 오래된 스냅샷은 최신 값을 덮지 않는다. 별도 신규 테이블만 기록한다.
4. 실행 성공과 관리자 화면의 시각·일별 합계를 공급자 응답과 대조한다. 일회용 job은 삭제해 정리한다. 요청된 기존 집계 외의 고객·거래 데이터는 읽거나 수정하지 않는다.

로컬 검증: shared contract 2개, 관련 웹 25개, API 경계/마이그레이션 8개, PostgreSQL/Valkey 통합 6개 및 배포 가드 31개 통과. PC/모바일 브라우저 3개 시나리오를 통과했다. 개인별 수집의 기존 live-harness 시나리오 1개는 별도 harness를 기동하지 않아 제외했으며 개인별 수집 구현은 이 변경의 활성화 범위가 아니다. API/Web 타입과 변경 파일 lint를 통과했다.

## 수집 항목과 보관

| 항목 | 판단 목적 | 저장 위치 | 보관 | 개인정보 성격 |
| --- | --- | --- | --- | --- |
| 무작위 visitor/session ID, 선택 동의 버전·시각 | 브라우저 중복 제거, 세션 연결, 동의 근거 | 브라우저 storage, `analytics_sessions` | visitor·동의 최대 90일, 세션 30분 무활동 만료, 서버 90일 | 연결 가능한 식별 정보 |
| path·이전 path, 공개 공연 ID, 이벤트 종류·시각, 좌석 개수 | 공연 관심과 단계별 진행 | `analytics_events` | 90일 | 식별자와 결합되는 행태정보 |
| referrer 도메인, UTM source/medium/campaign/term/content, 랜딩 path | 채널·캠페인·콘텐츠별 반응 | `analytics_sessions.touch`, `analytics_attribution` | 90일 | 회원 연결 시 개인정보 |
| 언어, 기기·브라우저·OS·화면 크기 구간 | 번역·기기별 개선 우선순위 | `analytics_sessions` | 90일 | 다른 항목과 연결 가능, 세부 fingerprint 없음 |
| 링크 대상 path, 스크롤 25/50/75/100%, 보이는 화면 체류 초 | 콘텐츠 관심·마지막 페이지 분석 | `analytics_events.props` | 90일 | 연결 가능한 행태정보 |
| 인증된 회원 ID와 첫 유입/가입 직전 유입 | 가입 기여도, DB 사실 대조 | `analytics_sessions.user_id`, `analytics_attribution` | 90일, 회원 영구 삭제 시 연결 제거 | 개인정보. 완전 익명 아님 |
| 일·시간 UV/세션/PV | 추이 조회 | `analytics_rollups` | 365일 | 개별 식별자 없는 통계; 소수 집단 주의 |
| 활성 visitor TTL 집합 | 최근 5분 활성 수 | Valkey `analytics:active-visitors:v1` | 5분 | 일시적 가명 식별자 |
| 철회 UUID의 SHA256·만료 시각 | 지연 전송의 재수집 방지 | `analytics_opt_outs` | 최대 90일 | 삭제·거부 이행 목적의 연결 가능 정보 |
| 미완료 삭제 요청의 visitor/session ID | 삭제 요청 재시도 | 브라우저 localStorage | 완료 즉시 삭제, 최대 90일 | 삭제 목적만 사용, 분석 재사용 금지 |

원본 IP·이름·이메일·전화·검색어·전체 URL query/hash·결제/QR/예매 식별자·폼 값은 분석 이벤트에 수집하지 않는다. 개인별 관리자 화면은 인증된 회원 연결을 통해 기존 회원 DB의 이름·이메일을 표시한다. v2의 마스킹된 화면 재생은 아래 별도 보관·접근 기준을 적용한다. `stripUrlQuery`를 재사용한 뒤 path를 추가 정규화하고, UTM만 별도로 읽는다. UTM에 개인 식별값을 넣지 않는다. `/admin`, `/field`, `/api`, `/mypage`, `/payment`, 인증 하위 경로, 유효한 공개 공연 UUID가 없는 예매/공연 경로는 제외한다. 라우트가 같은 query 변화에서는 UTM이 바뀐 경우만 새 유입으로 잡으며 검색어 변화는 저장하지 않는다.

## 지표 해석

- UV는 브라우저 ID 기준이며 기기 간 같은 사람을 합치지 않는다. 기간 UV는 원본에서 distinct하며 일·시간별 UV를 더하지 않는다. 재방문은 보관 중인 더 이른 세션이 있는 브라우저다. 오늘/7일/30일/공지 이후 구간과 바로 앞 동일 길이 구간을 비교한다. 보관·동의 이전 데이터가 없는 비교는 공지 효과를 증명하지 않는다.
- 세션 유입은 처음 진입한 경로다. UTM이 없으면 referrer 도메인, 둘 다 없으면 direct다. UTM이 새로 들어오면 같은 30분 안에도 새 캠페인 세션으로 구분한다.
- 가입 기여도는 가입 시각이 관측 세션에 포함된 경우에만 기록한다. 첫 유입과 그 가입 세션 유입을 고정하며 이후 로그인으로 바꾸지 않는다. 기존 고객의 나중 로그인은 가입 캠페인이 아니다. 동의 이전·다른 기기·차단·잘못된 시계·유실은 연결되지 않을 수 있다.
- 예매 퍼널은 기간 내 `page_view → performance_view → seat_select → checkout_start → DB payment` 순서다. 같은 공연을 요구하고 최종 결제는 가장 최근의 일치 checkout에만 연결한다. 마지막 수집 시각 뒤 30분까지 결제를 연결한다. 선택 기간 밖에서 시작한 흐름은 완전한 퍼널로 잡히지 않는다.
- `booking_start`는 예매 경로 진입, `queue_enter`는 서버의 대기열 세션 발급, `seat_select`는 좌석 잠금 성공, `checkout_start`는 Toss SDK에 결제를 요청하기 직전, `signup_start`는 가입 폼 진입이다. 실제 거래 실패/성공을 이 이벤트로 확정하지 않는다.
- 가입/결제/취소는 기존 테이블에서 집계하고 완료 이벤트를 중복 저장하지 않는다. 결제 완료는 발권된 예매의 승인(`CONFIRMED/CANCELLED`, `DONE/PARTIAL_CANCELED/CANCELED`, `paid_at`)이며 이후 취소도 포함한다. 취소는 좌석 부분 취소와 전체 취소를 합쳐 예매별 중복 제거한다. 발권 실패 보상 취소는 제외한다. 익명·동의 거부를 포함한 DB 실적과 관측 퍼널의 분모가 다르다.
- 평균 체류는 화면이 보인 시간의 근사치이고 마지막 페이지는 이탈의 근사치다. 한 페이지 방문을 곧바로 낮은 관심/GA4 bounce로 해석하지 않는다. 캠페인 데이터만으로 광고비·ROAS·인과 효과를 계산하지 않는다.

## 수집 제어·부하 경계

1. 처리방침 개정/고지/시행일과 선택 동의를 확정한다. 기존 문서를 직접 덮지 말고 [동의 문서 버전 절차](consent-document-versions.md)를 따른다. 새 선택기능은 `/legal/analytics`의 별도 처리 안내와 두 개의 선택 동의를 적용한다. 기존 필수 개인정보처리방침·마케팅 수신 동의의 버전은 재사용하지 않는다.
2. 승인된 배포에서 repository variable `ANALYTICS_ENABLED=true`를 API에 전달한다. unset은 Deploy workflow에서 false로 덮으며 코드 기본값도 false다. 기존 환경 변수 방식만으로 즉시 중단할 수 없으므로 관리자 DB 스위치를 별도로 둔다.
3. `security.manage` 관리자가 `/admin/analytics`에서 정책 시행·선택 동의 절차를 확인하고 수집을 시작한다. DB 기본값은 false다. `audit.read`만 있는 운영자는 지표만 읽는다.
4. 티켓 오픈 전/부하 급증/오류 때 **수집 즉시 중단**을 누른다. 모든 API가 새 배치마다 공유 스위치를 읽는다. 진행 중인 배치는 완료될 수 있으며 수집 중인 브라우저는 30초 내 새 설정을 가져온다. 환경 게이트 기본 off 또는 요청 실패 시 반복 조회를 멈추며, 환경 승인 후 일시 중지는 5분마다 확인한다. 원본 조회·보관 삭제는 중단하지 않는다.

웹은 최대 20개/16KiB 배치를 20초 주기·페이지 종료 때 Beacon으로 전송하고 실패 시 keepalive fetch로 한 번 대체한다. 실패 배치 재전송/무한 큐는 없고 업무 흐름을 막지 않는다. 수집 API는 전용 신뢰 IP throttle 60배치/분, 연결/철회 10회/분을 적용한다. 봇·prefetch·DNT/GPC는 기록하지 않는다.

분석은 API/worker 프로세스마다 별도 최대 1개 DB 연결을 사용한다. 연결 timeout 300ms, statement timeout 1.5초, lock timeout 100ms다. 수집은 연결이 바쁘면 기다리지 않고 버린다. worker의 집계 statement만 5초로 제한한다. 별도 풀은 예매 풀 고갈을 피하기 위한 것으로 공유 DB CPU/IO나 API 프로세스 자원까지 분리하지 않는다. 실제 티켓 오픈 부하/Web Vitals 검증 없이 용량 보장을 하지 않는다.

## 집계·삭제

기존 5분 주기 `grabit-background-worker`가 `analytics-maintenance` pg-boss job을 등록한다. 5분 구간별 UUID로 중복 enqueue를 막고 advisory lock으로 중복 집계를 막는다. KST 시간/일 단위 집계는 upsert하여 중복 가산하지 않는다. 지연 이벤트를 위해 직전 구간도 다시 계산한다. backfill은 한 job에 시간 24구간·일 7구간으로 제한하고 후속 job으로 이어간다.

90일 원본은 10,000행, 세션은 5,000행씩 삭제하며 남으면 후속 job을 보낸다. 회원 탈퇴/병합 계정은 배치에서 방문 연결을 해제하고 가입 유입 연결을 지운다. 365일 집계·만료 철회 표시도 지운다. 작업 실패는 pg-boss 실패/재시도 상태와 worker 로그로 확인한다. 집계 job 실패가 반드시 Cloud Run Job 실행 실패를 뜻하지는 않는다. 관리자 최근 집계 시각이 15분 이상 뒤처지면 worker 실행/실패를 확인한다. 신규 일일 요약·알림 automation은 만들지 않았다.

철회는 전용 API에서 방문자별 lock → 재수집 금지 hash → raw/session/가입 연결 삭제 순으로 처리한다. 영향받은 집계는 제거하고 worker가 재작성한다. 삭제 실패 시 브라우저는 수집을 즉시 중단하고 삭제 요청만 60초마다/다음 방문에 재시도한다. 완료 확인 전에는 다시 허용하지 않으며 서버 응답 전 삭제 완료로 표시하지 않는다. 브라우저 저장 정보를 모두 지우면 미완료 요청을 재시도할 ID도 사라질 수 있어 별도 개인정보 문의 경로를 제공한다.

동의 변경은 다른 탭에도 전달되어 해당 탭의 대기 배치·세션·회원 연결 캐시를 폐기한다. 재동의 후에는 새 브라우저 식별자를 공유하며, 멈춰 있던 탭은 전송 전에 식별자를 다시 확인한다. 다른 탭이 만든 새 식별자는 지우지 않는다.

## 비용·용량 계획

추정 이벤트 1건 1,000bytes, 90일, 여유 30% 기준이다. 실제 행·인덱스·세션 크기는 더 클 수 있다.

| 이벤트/일 | 90일 + 여유 용량 | 서울 단일존 SSD 월 환산 |
| ---: | ---: | ---: |
| 10,000 | 1.09 GiB | $0.24 |
| 100,000 | 10.90 GiB | $2.41 |
| 1,000,000 | 108.96 GiB | $24.08 |

서울 SSD 공개 단가 $0.221/GiB-month로 계산한 저장소 시나리오다. [공식 가격](https://cloud.google.com/sql/pricing). 실제 할당 저장소, index/WAL/backup/CPU/worker/네트워크/할인/세금은 별도이고 현행 청구나 여유 공간을 조회하지 않았다. 기존 [비용·용량 runbook](managed-demo-cost-floor.md)의 현재 선택 프로파일과 배포 preflight를 따른다. 연결 예산은 `API_MAX × (DB_POOL_MAX + PGBOSS_POOL_MAX + 1) + workerTasks × (WORKER_DB_POOL_MAX + workerPgBossPoolMax + 1) + reserve`다. 분석 때문에 인스턴스를 자동 증설하거나 비용을 승인하지 않는다.

## 광고 매체와 화면 재생 범위

Meta/Kakao/Naver/Clarity는 설치하지 않는다. 후속 Google 관심사 분석과 관심 프로필은 [관심 고객·마케팅 runbook](audience-marketing.md)의 별도 선택 동의 및 활성화 절차를 따른다. 기존 자체 분석 동의를 Google 동의로 재사용하지 않는다. 클릭·터치·스크롤·화면 재생은 요청에 따라 자체 수집한다. rrweb은 로컬 번들 라이브러리이며 외부 rrweb 서비스로 전송하지 않는다. Sentry의 미사용 오류 리플레이 샘플링도 0으로 명시한다. 기존 ko/en 정책 수탁자 목록의 Sentry 누락은 이번 수집 기능과 별도 검토 항목이다.

## 로컬 검증 재현

`pnpm --filter @grabit/shared build`와 `pnpm --filter @grabit/api build` 후 `node --experimental-strip-types apps/api/test/helpers/analytics-browser-server.mjs`를 실행한다. 이 harness는 loopback Docker PostgreSQL/Valkey만 생성하며 합성 관리자 인증·공연 응답을 제공한다. 분석 API·SQL은 실제 구현을 사용한다. 운영 인증·결제 검증이 아니다. 종료 신호를 받으면 서버·연결·컨테이너를 정리한다.

웹 서버를 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8184`, `PLAYWRIGHT_PORT=3185`로 기동하고 `ANALYTICS_LIVE_API=true pnpm --filter @grabit/web exec playwright test e2e/analytics.spec.ts`로 검증한다. 일반 CI에서는 별도 harness가 필요한 실제 저장 시나리오 한 개만 건너뛰고 DB 통합 테스트를 수행한다. 테스트 report/screenshot 디렉터리는 `ANALYTICS_QA_DIR`로 저장소 밖에 지정할 수 있다.

2026-11-11 로컬 검증에서는 API 단위 2,764개, 분석 PostgreSQL/Valkey 통합 5개, 관련 웹 91개와 추가 fresh-tab 철회 회귀 검증, 가입·분석 브라우저 시나리오 5개를 통과했다. 분석 API 실패 상태에서 합성 링크 동작 25회 처리에 2ms가 걸렸고 가입 입력은 동작했으며 애플리케이션 예외는 없었다. 이 측정은 로컬 개발 빌드의 작은 동작 검증이며 운영 LCP/INP/실판매 부하 성능 보장이 아니다. 운영 검증은 승인된 배포·활성화 단계에서 수행한다.

후속 리뷰의 다중 탭 철회/재동의 누락을 재현하고 수정했다. 클라이언트 테스트 9개와 실제 두 탭 → API → DB의 철회/재동의/새 방문 저장/재삭제를 통과했다. 재동의 시 방문자 ID를 먼저 공유해 동시 생성 경쟁도 방지한다. CI에서 발견된 기존 연결 예산 기대값 4건을 분석 연결 포함 기준으로 갱신했고 해당 운영 스크립트 검사 66개가 통과했다.


## 개인별 방문·좌표·세션 리플레이 (analytics-v2-replay)

- 수집·이용 및 국외 이전은 기본 미동의다. 배너의 `동의`는 두 항목을 함께 허용하며, 상세 설정에서는 각각 기본 미선택인 체크박스 두 개를 선택한 뒤 허용할 수 있다. 두 항목이 모두 허용된 이후부터만 전송한다. 동의 버전·시각과 두 선택값을 세션에 저장한다. 이전 analytics-v1 상태나 마케팅 동의를 재사용하지 않는다.
- 첫 방문 배너에는 `서비스 개선을 위해 쿠키와 이용정보를 수집합니다.` 한 문장과 `자세한 내용 보기`, `동의`·`거부`만 표시한다. `동의`·`거부`는 화면 이동 없이 즉시 저장하고 해당 배너를 닫는다. 상세 화면은 `자세한 내용 보기` 링크로만 `/legal/analytics`에서 열며 수집 항목·보관기간·처리 국가와 항목별 설정을 확인할 수 있다. 미완료 삭제 요청 중에는 재동의 버튼을 비활성화하며, 상세 링크 이동만으로 동의를 저장하지 않는다.
- `pointer_click`: 문서 좌표 x/y, viewport/document 크기, scroll offset, mouse/touch/pen/keyboard, 대상 종류와 고정 CTA 분류만 저장한다. DOM text, CSS selector, 입력값은 보내지 않는다. 좌표는 90일이며 민감 경로와 동의 UI를 제외한다.
- rrweb의 전체/증분 DOM snapshot, 포인터·스크롤·크기 변경·마스킹된 입력 상태를 저장한다. 모든 텍스트와 값은 마스킹하고, script·iframe·canvas·video·audio·임의 URL·원본 이미지·custom event는 제외한다. 클라이언트 전송 전 및 API 저장 전에 같은 허용목록 sanitizer를 적용한다. `/auth`, `/legal`에서는 replay를 시작하지 않는다. 기존 인증 하위/결제/마이페이지/관리자/현장 경로도 제외한다.
- 최대 768 KiB/배치, 200 events/배치, 10 MiB/세션, 1000 chunks/세션이다. 약 5초마다 전송하며 큰 snapshot은 일반 fetch, 작은 종료 배치만 keepalive를 사용한다. 메모리·서버 용량 제한 또는 네트워크 실패 시 누락될 수 있다. 브라우저에 녹화 원본을 영구 저장하지 않는다. 실제 화면의 영상 파일이 아닌 마스킹된 DOM 기반 재생이다.
- `analytics_replay_chunks`는 14일 후 조회에서 제외하고 기존 5분 worker가 1000행씩 삭제한다. 세션 삭제 FK cascade로 철회 때 함께 삭제한다. 나머지 원본90일·집계365일은 유지한다.
- `/admin/analytics/visitors`, `/sessions/:id`, `/replays/:id`는 **audit.read와 security.manage 모두** 필요하다. visitor UUID는 삭제 권한용 값이므로 응답하지 않고 md5(UUID) 불투명 표시값으로 방문 세션을 묶는다. 상세에는 회원 이름·이메일을 포함하므로 운영자 화면 공유에 유의한다. 일반 audit.read 통계 권한만으로 상세는 열 수 없다.
- 목록은 최신50세션, 타임라인은 최신 500행씩 조회한다. 시각과 UUID를 함께 커서에 넣어 같은 밀리초의 기록도 누락 없이 이어간다. 히트맵은 현재 타임라인 범위의 동일 경로·약100px 너비구간 클릭을 문서크기로 정규화한다. 상세 화면에 이 범위를 표시한다. 당시 화면은 별도 replay를 선택해 재생/탐색/속도를 조정한다.

### 전송·운영 설정

배포 Web build arg `NEXT_PUBLIC_ANALYTICS_API_URL`은 repository variable `ANALYTICS_API_ORIGIN`에서 가져온다. 운영 값은 **https://grabit-api-d3c6wrfdbq-du.a.run.app** (프로젝트 grapit-491806, asia-northeast3, 기존 grabit-api)이다. `/api/v1/analytics`와 `/api/v1/admin/analytics`만 이 origin을 사용한다. 일반 API와 예매·결제는 기존 public API를 유지한다. 기존 공개 origin의 Origin 검증·JWT·관리자 권한·throttle은 그대로 적용되며 새 공개 bypass를 만들지 않는다. 개인별 payload 및 상세 응답을 Cloudflare CDN으로 보내지 않는다. 향후 API origin 교체 시 이 build 변수를 함께 갱신하고 재배포한다.

선택 분석 endpoint는 Sentry 오류/transaction/HTTP breadcrumb 및 span의 식별정보에서 제외한다. Cloud Logging `_Default` sink의 `personal-analytics-request-logs` exclusion은 `grabit-api`의 `/api/v1/(admin/)?analytics` 요청 메타데이터 저장만 제외한다. 다른 서비스 로그는 유지한다. 일반 사이트·보안 로그 전체가 동의로 중단된다고 고지하지 않는다.

2026-11-12 승인 범위에서 `grabit-db-managed-demo`의 **새 자동 백업 위치를 asia-northeast3**로 지정했다. 기존 백업은 이동·삭제하지 않았다. 기존 백업은 개인별 수집 활성화 이전 자료다. 최근 자동백업7개/PITR7일을 유지하며 신규 수동 백업에 개인별 자료가 포함되면 목적·만료일을 기록하고7일 이내 정리한다. 복원된 DB는 분석 수집·관리자 개인별 조회를 열기 전에 복원시각 이후 접수한 철회와 현재시각14/90일 만료를 재적용한다. 공급자 최종삭제 최대180일은 Google CDPA의 삭제 처리 상한이며 활성DB 보관을180일로 늘리는 의미가 아니다.

### 배포·활성화 순서

1. CI로 0058/0059 migration과 API/Web 배포를 수행한다. 운영 DB 연결 대상 확인, migration freeze 임시해제와 복구는 기존 배포 절차를 따른다.
2. Web build의 직접 전송 origin, CORS, 실제 요청 목적지, 새 자동백업 위치와 Logging exclusion을 검증한다.
3. 한영 선택기능 안내를 게시하고 상세 페이지 링크·두 동의 항목·거부/철회를 실제 렌더링으로 확인한다. 기존 필수 방침의 개정 시점 약속을 지워 즉시 적용하는 방식으로 대체하지 않는다. 새 기능은 별도 상세 동의 시점부터만 적용한다.
4. 승인된 `ANALYTICS_ENABLED=true` 배포 후 관리자 DB 스위치를 v2로 켠다. 별도 QA 브라우저 한 건으로 동의 전 전송없음 → 두 동의 → 좌표·replay 저장 → 관리자 실제 재생 → 철회 삭제를 확인한다. 합성 QA 방문은 실제 신규회원 실적으로 보고하지 않는다.
5. `/analytics/config`의 noticeVersion/enabled, live 관리자의 최근 수신·개인별 기록, 새 공지와 거부 상태를 확인한다. 수집 중지 시 신규 raw/replay 배치는 모두 공유 kill switch를 적용한다.

사전 수집하지 않은 2026-11-11의 개인별 클릭·화면은 복원하지 않는다. 이미 확보한 Cloudflare HTML 요청 집계는 개인별 이력과 구분한다.

### 구현 검증(운영 배포 전)

공유 계약 전체 215개, API 단위 2,767개, PostgreSQL/Valkey 통합 502개 통과. 웹 전체 1,768개 중 6개는 동시 대량 실행에서 5초 timeout으로 실패했고, 관련 3개 파일을 낮은 동시성으로 재실행하여 모두 통과했다(기능 오류 수정 없음). 변경 대상 웹·API 타입 검사와 lint를 통과했다. 로컬 실제 브라우저 → API → DB에서 두 선택 동의 전송, 좌표·마스킹 replay 저장, 권한 있는 관리자 재생/히트맵, PC 1440×1000·모바일 390×844, 두 탭 철회/재동의/서버 삭제를 통과했다. Browser plugin이 제공되지 않아 기존 Playwright 흐름을 사용했다. 운영 CORS·인증·수신·공지는 배포 뒤 확인한다.


## 관심 프로필과 소재 비교 확장

`/admin/audience`에서 선택 취향·개인별 관심 근거·공연 태그·소재별 세션 전환 및 GA4 집계 관심사를 조회한다. `/mypage/interests`의 `interests-v1`은 기존 방문 분석·마케팅 수신 동의와 별개다. `favorite_add` / `favorite_remove`는 찜 API 성공 후 자체 분석 동의가 있는 경우에만 수집한다. 이전 찜을 새 이벤트로 복원하지 않는다. 상세 계약·보관·권한·Google 연동 준비 상태는 [전용 runbook](audience-marketing.md)을 따른다.
