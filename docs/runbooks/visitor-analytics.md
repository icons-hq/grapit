# 방문·가입 분석 운영

## 현재 도입 상태

1단계 가입 모니터링은 `/admin/users`, 2단계 자체 방문·행동 분석은 `/admin/analytics`다. 2단계는 코드·migration·화면을 준비하되 수집 기본값을 꺼 둔다. 정책 개정·실판매 용량 검증·운영 활성화 승인은 별도다. [ADR 0013](../adr/0013-first-party-consented-analytics.md), [공식 근거와 도구 비교](../research/2026-11-11-first-party-analytics-evidence.md), [한·영 정책 개정 초안](../legal/analytics-privacy-amendment-draft.md)을 함께 읽는다.

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

원본 IP·이름·이메일·전화·검색어·전체 URL query/hash·결제/QR/예매 식별자·폼 값·리플레이는 수집하지 않는다. `stripUrlQuery`를 재사용한 뒤 path를 추가 정규화하고, UTM만 별도로 읽는다. UTM에 개인 식별값을 넣지 않는다. `/admin`, `/field`, `/api`, `/mypage`, `/payment`, 인증 하위 경로, 유효한 공개 공연 UUID가 없는 예매/공연 경로는 제외한다. 라우트가 같은 query 변화에서는 UTM이 바뀐 경우만 새 유입으로 잡으며 검색어 변화는 저장하지 않는다.

## 지표 해석

- UV는 브라우저 ID 기준이며 기기 간 같은 사람을 합치지 않는다. 기간 UV는 원본에서 distinct하며 일·시간별 UV를 더하지 않는다. 재방문은 보관 중인 더 이른 세션이 있는 브라우저다. 오늘/7일/30일/공지 이후 구간과 바로 앞 동일 길이 구간을 비교한다. 보관·동의 이전 데이터가 없는 비교는 공지 효과를 증명하지 않는다.
- 세션 유입은 처음 진입한 경로다. UTM이 없으면 referrer 도메인, 둘 다 없으면 direct다. UTM이 새로 들어오면 같은 30분 안에도 새 캠페인 세션으로 구분한다.
- 가입 기여도는 가입 시각이 관측 세션에 포함된 경우에만 기록한다. 첫 유입과 그 가입 세션 유입을 고정하며 이후 로그인으로 바꾸지 않는다. 기존 고객의 나중 로그인은 가입 캠페인이 아니다. 동의 이전·다른 기기·차단·잘못된 시계·유실은 연결되지 않을 수 있다.
- 예매 퍼널은 기간 내 `page_view → performance_view → seat_select → checkout_start → DB payment` 순서다. 같은 공연을 요구하고 최종 결제는 가장 최근의 일치 checkout에만 연결한다. 마지막 수집 시각 뒤 30분까지 결제를 연결한다. 선택 기간 밖에서 시작한 흐름은 완전한 퍼널로 잡히지 않는다.
- `booking_start`는 예매 경로 진입, `queue_enter`는 서버의 대기열 세션 발급, `seat_select`는 좌석 잠금 성공, `checkout_start`는 Toss SDK에 결제를 요청하기 직전, `signup_start`는 가입 폼 진입이다. 실제 거래 실패/성공을 이 이벤트로 확정하지 않는다.
- 가입/결제/취소는 기존 테이블에서 집계하고 완료 이벤트를 중복 저장하지 않는다. 결제 완료는 발권된 예매의 승인(`CONFIRMED/CANCELLED`, `DONE/PARTIAL_CANCELED/CANCELED`, `paid_at`)이며 이후 취소도 포함한다. 취소는 좌석 부분 취소와 전체 취소를 합쳐 예매별 중복 제거한다. 발권 실패 보상 취소는 제외한다. 익명·동의 거부를 포함한 DB 실적과 관측 퍼널의 분모가 다르다.
- 평균 체류는 화면이 보인 시간의 근사치이고 마지막 페이지는 이탈의 근사치다. 한 페이지 방문을 곧바로 낮은 관심/GA4 bounce로 해석하지 않는다. 캠페인 데이터만으로 광고비·ROAS·인과 효과를 계산하지 않는다.

## 수집 제어·부하 경계

1. 처리방침 개정/고지/시행일과 선택 동의를 확정한다. 기존 문서를 직접 덮지 말고 [동의 문서 버전 절차](consent-document-versions.md)를 따른다. 현재 PR에는 초안만 있으며 기존 적용 버전은 유지된다.
2. 승인된 배포에서 repository variable `ANALYTICS_ENABLED=true`를 API에 전달한다. unset은 Deploy workflow에서 false로 덮으며 코드 기본값도 false다. 기존 환경 변수 방식만으로 즉시 중단할 수 없으므로 관리자 DB 스위치를 별도로 둔다.
3. `security.manage` 관리자가 `/admin/analytics`에서 정책 시행·선택 동의 절차를 확인하고 수집을 시작한다. DB 기본값은 false다. `audit.read`만 있는 운영자는 지표만 읽는다.
4. 티켓 오픈 전/부하 급증/오류 때 **수집 즉시 중단**을 누른다. 모든 API가 새 배치마다 공유 스위치를 읽는다. 진행 중인 배치는 완료될 수 있으며 브라우저는 30초 내 새 설정을 가져온다. 원본 조회·보관 삭제는 중단하지 않는다.

웹은 최대 20개/16KiB 배치를 20초 주기·페이지 종료 때 Beacon으로 전송하고 실패 시 keepalive fetch로 한 번 대체한다. 실패 배치 재전송/무한 큐는 없고 업무 흐름을 막지 않는다. 수집 API는 전용 신뢰 IP throttle 60배치/분, 연결/철회 10회/분을 적용한다. 봇·prefetch·DNT/GPC는 기록하지 않는다.

분석은 API/worker 프로세스마다 별도 최대 1개 DB 연결을 사용한다. 연결 timeout 300ms, statement timeout 1.5초, lock timeout 100ms다. 수집은 연결이 바쁘면 기다리지 않고 버린다. worker의 집계 statement만 5초로 제한한다. 별도 풀은 예매 풀 고갈을 피하기 위한 것으로 공유 DB CPU/IO나 API 프로세스 자원까지 분리하지 않는다. 실제 티켓 오픈 부하/Web Vitals 검증 없이 용량 보장을 하지 않는다.

## 집계·삭제

기존 5분 주기 `grabit-background-worker`가 `analytics-maintenance` pg-boss job을 등록한다. 5분 구간별 UUID로 중복 enqueue를 막고 advisory lock으로 중복 집계를 막는다. KST 시간/일 단위 집계는 upsert하여 중복 가산하지 않는다. 지연 이벤트를 위해 직전 구간도 다시 계산한다. backfill은 한 job에 시간 24구간·일 7구간으로 제한하고 후속 job으로 이어간다.

90일 원본은 10,000행, 세션은 5,000행씩 삭제하며 남으면 후속 job을 보낸다. 회원 탈퇴/병합 계정은 배치에서 방문 연결을 해제하고 가입 유입 연결을 지운다. 365일 집계·만료 철회 표시도 지운다. 작업 실패는 pg-boss 실패/재시도 상태와 worker 로그로 확인한다. 집계 job 실패가 반드시 Cloud Run Job 실행 실패를 뜻하지는 않는다. 관리자 최근 집계 시각이 15분 이상 뒤처지면 worker 실행/실패를 확인한다. 신규 일일 요약·알림 automation은 만들지 않았다.

철회는 전용 API에서 방문자별 lock → 재수집 금지 hash → raw/session/가입 연결 삭제 순으로 처리한다. 영향받은 집계는 제거하고 worker가 재작성한다. 삭제 실패 시 브라우저는 수집을 즉시 중단하고 삭제 요청만 60초마다/다음 방문에 재시도한다. 완료 확인 전에는 다시 허용하지 않으며 서버 응답 전 삭제 완료로 표시하지 않는다. 브라우저 저장 정보를 모두 지우면 미완료 요청을 재시도할 ID도 사라질 수 있어 별도 개인정보 문의 경로를 제공한다.

## 비용·용량 계획

추정 이벤트 1건 1,000bytes, 90일, 여유 30% 기준이다. 실제 행·인덱스·세션 크기는 더 클 수 있다.

| 이벤트/일 | 90일 + 여유 용량 | 서울 단일존 SSD 월 환산 |
| ---: | ---: | ---: |
| 10,000 | 1.09 GiB | $0.24 |
| 100,000 | 10.90 GiB | $2.41 |
| 1,000,000 | 108.96 GiB | $24.08 |

서울 SSD 공개 단가 $0.221/GiB-month로 계산한 저장소 시나리오다. [공식 가격](https://cloud.google.com/sql/pricing). 실제 할당 저장소, index/WAL/backup/CPU/worker/네트워크/할인/세금은 별도이고 현행 청구나 여유 공간을 조회하지 않았다. 기존 [비용·용량 runbook](managed-demo-cost-floor.md)의 현재 선택 프로파일과 배포 preflight를 따른다. 연결 예산은 `API_MAX × (DB_POOL_MAX + PGBOSS_POOL_MAX + 1) + workerTasks × (WORKER_DB_POOL_MAX + workerPgBossPoolMax + 1) + reserve`다. 분석 때문에 인스턴스를 자동 증설하거나 비용을 승인하지 않는다.

## 3단계 보류와 별도 발견

광고 픽셀 ID와 리플레이 요청이 없으므로 Meta/Kakao/Naver/GA4/Clarity를 설치하거나 활성화하지 않는다. 필요해지면 매체·처리 목적·수신 법인/국가·동의·거부를 먼저 확정한다. 현재 Sentry에는 오류 리플레이 샘플링 설정이 있으나 `replayIntegration()` 등록과 실제 전송은 확인되지 않았다. 기존 ko/en 정책 수탁자 목록의 Sentry 누락은 이번 수집 기능과 별도 검토 항목이다.

## 로컬 검증 재현

`pnpm --filter @grabit/shared build`와 `pnpm --filter @grabit/api build` 후 `node --experimental-strip-types apps/api/test/helpers/analytics-browser-server.mjs`를 실행한다. 이 harness는 loopback Docker PostgreSQL/Valkey만 생성하며 합성 관리자 인증·공연 응답을 제공한다. 분석 API·SQL은 실제 구현을 사용한다. 운영 인증·결제 검증이 아니다. 종료 신호를 받으면 서버·연결·컨테이너를 정리한다.

웹 서버를 `NEXT_PUBLIC_API_URL=http://127.0.0.1:8184`, `PLAYWRIGHT_PORT=3185`로 기동하고 `ANALYTICS_LIVE_API=true pnpm --filter @grabit/web exec playwright test e2e/analytics.spec.ts`로 검증한다. 일반 CI에서는 별도 harness가 필요한 실제 저장 시나리오 한 개만 건너뛰고 DB 통합 테스트를 수행한다. 테스트 report/screenshot 디렉터리는 `ANALYTICS_QA_DIR`로 저장소 밖에 지정할 수 있다.

2026-11-11 로컬 검증에서는 API 단위 2,764개, 분석 PostgreSQL/Valkey 통합 5개, 관련 웹 91개와 추가 fresh-tab 철회 회귀 검증, 가입·분석 브라우저 시나리오 5개를 통과했다. 분석 API 실패 상태에서 합성 링크 동작 25회 처리에 2ms가 걸렸고 가입 입력은 동작했으며 애플리케이션 예외는 없었다. 이 측정은 로컬 개발 빌드의 작은 동작 검증이며 운영 LCP/INP/실판매 부하 성능 보장이 아니다. 운영 검증은 승인된 배포·활성화 단계에서 수행한다.
