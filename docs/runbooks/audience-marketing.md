# 관심 고객·마케팅

## 기능과 범위

- `/admin/audience`: 관심군, 개인별 관심 프로필, 관심 태그/공연 연결, 소재별 전환, GA4 집계 관심사. 기존 `/admin/analytics`와 관리자 메뉴에서 연결한다.
- `/mypage/interests`: 아티스트 / 활동·취미 / 소식·혜택의 세 선택 질문, 질문당 최대 5개. 마이페이지와 가입 후 7일 이내 홈에서 안내하되 가입·인증·예매 복귀를 가로막지 않는다.
- 개인별 열람은 기존 개인 방문 기록처럼 `audit.read`와 `security.manage`가 모두 필요하다. 태그 변경은 `security.manage`, 집계·소재·Google 보고서는 `audit.read`가 필요하다. 태그 변경은 관리자 감사 기록에 남긴다.
- 기본 선택지는 NAMTANFILM 및 일반 활동·혜택이다. 알려진 공개 공연의 정확한 제목에만 아티스트/팬 이벤트 태그를 연결한다. 고객 답변·프로필을 생성하거나 과거 고객 행동을 backfill하지 않는다. 나머지 공연 태그는 관리자가 명시적으로 지정한다.

## 선택 취향과 행동 근거

별도 `interests-v1` 선택 동의로 선택한 태그와 회원 ID를 추천·마케팅 기획에 이용한다. 마케팅 수신 동의를 자동으로 켜지 않는다. 행동 분석 보완은 별도 선택이며 기본 off다. 방문 이력은 자체 방문 분석 동의를 유지한 세션만 존재한다. 행동 동의 시작 이후의 조회·찜·예매만 이용하고 이전 기록은 소급 이용하지 않는다. 보완을 껐다가 다시 켜면 새 시각부터 시작한다.

`audience_preferences`/`audience_user_tags`는 마지막 저장부터 90일이다. 보완 분석은 최근 90일과 동의 시작 중 더 늦은 시각을 기준으로 한다. 프로필은 조회 시 원본에서 계산하여 별도의 파생 프로필 사본을 남기지 않는다. 철회하면 선택값과 프로필을 즉시 지우며, 선택 분석 로그 전체 철회는 기존 `/legal/analytics`에서 처리한다. 탈퇴·병합 계정 및 만료 프로필은 즉시 조회 대상에서 제외하고 기존 5분 worker가 배치 삭제한다. 답변을 담지 않은 동의 증빙도 90일 후 삭제한다.

직접 선택과 행동 추정은 별도 표시한다. 추정 수준은 확률이 아니다. 같은 관심의 동일 KST일 조회는 1일로 중복 제거한다. 찜 또는 현재 유효한 결제 예매는 강한 근거, 2일 이상 조회 또는 결제 시작은 보통, 단일 조회는 약한 근거다. 취소된 예매는 현재 구매 관심 근거에서 제외한다. 태그 없는 공연은 분류하지 않는다. 구매 단계 역시 태그가 연결된 공연에서 관측한 상태이며 모든 구매 이력을 대표하지 않는다. 민감 속성을 공연 취향에서 추정하지 않는다.

## 홍보 소재 성과

링크 생성기에서 공개 공연/카탈로그 경로와 `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`를 만든다. 개인 식별값을 라벨에 넣지 않는다. 캠페인과 채널을 같게 두고 소재 코드만 바꾸면 비교하기 쉽다.

기간 내 시작한 세션이 분모다. 가입·찜·결제 시작·결제 완료 **세션**과 전환율을 보여준다. 결제 건수는 별도이며 한 세션의 복수 구매로 전환율이 100%를 넘지 않는다. 같은 회원·공연의 결제는 가장 최근의 일치 `checkout_start`에만 귀속하고 마지막 관측 후 30분까지 연결한다. 이후 취소된 발권 주문의 승인도 포함한다(기존 분석 계약). 찜은 이번 버전의 `favorite_add`부터 관측하며 과거 저장을 이벤트로 복원하지 않는다. 최대 100개 조합을 보여주고 초과 시 축약 사실을 표시한다.

관측 캠페인 비교는 무작위 A/B 실험이나 인과 효과가 아니다. 광고 노출·비용이 없어 CTR·ROAS를 계산하지 않는다. 실제 메시지 발송 기능은 포함하지 않는다. 후속 발송은 현재 `users.marketing_consent`를 다시 확인한다.

## GA4 연결

2026-11-12 사용자가 현재 Google 계정에 새 GA4 생성 및 한국 서비스 약관/데이터 처리 약관 동의를 승인했다. 생성 결과:

- 계정 `Grabit`: `416048996`
- 속성 `Grabit · heygrabit.com`: `563988659`, 대한민국 시간, KRW
- 웹 스트림 `Grabit Web`: `16326086984`, `https://heygrabit.com`
- 측정 ID: `G-CDQCEPLW7F`
- 선택적 계정 데이터 공유 off, 향상된 측정 off. 사용자·이벤트 보관을 2개월로 맞추고 새 활동 시 보관 갱신 off. 세부 위치/기기 수집 off.
- Google 신호 활성화와 최종 사용자 데이터 수집 확인은 새 사이트 고지·동의 배포 이후 단계로 남긴다. 계정 생성은 사이트 태그 배포·수집 활성화를 의미하지 않는다.

서버는 공식 `@google-analytics/data` SDK와 ADC로 `brandingInterest` / `activeUsers`를 조회한다. 회원 식별자를 Google 보고서와 연결하지 않는다. `subjectToThresholding`은 임계값 적용 대상 표시이며 실제 누락 확정이 아니다. 한 이용자가 여러 관심에 포함되므로 합계나 점유율을 만들지 않는다. 미설정·권한 부족·quota·조회 실패·빈 결과를 별도 표시한다. Valkey 공유 캐시는 30분, 실패 캐시는 60초이며 동시 갱신 lock을 사용한다. Valkey 실패 시 무제한 Google 호출로 우회하지 않는다.

브라우저는 Basic Consent Mode다. 별도 Google 수집·이용 및 국외 이전 동의와 만 18세 확인 전에는 스크립트를 로드하지 않는다. 관리자 및 기존 생년월일로 만 18세 미만임을 확인한 계정은 제외하고, DNT/GPC를 존중한다. 허용 경로는 공개 카탈로그뿐이며 회원 ID·연락처·취향 답변·주문·결제·인증·검색어를 보내지 않는다. UTM은 기존 allowlist 정제를 적용한다. 철회와 비공개 경로에서는 이미 로드한 태그도 `ga-disable-{id}`로 중단한다. 철회 시 브라우저의 `_ga*` 쿠키를 삭제한다. Google의 과거 집계를 즉시 삭제한다고 안내하지 않는다.

### 배포 전 연결 절차

1. API 런타임은 현재 `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`이다. 신규 GA4 속성의 **Viewer**만 부여하고 프로젝트 `grapit-491806`의 `analyticsdata.googleapis.com`을 활성화한다. 서비스 계정 JSON 키를 만들지 않는다. 이 외부 권한/설정 변경은 승인된 범위에서 수행한다.
2. 실제 Google/재처리자의 처리 국가 목록과 게시할 안내를 확정한다. 단순히 미국만 처리한다고 기재하지 않는다. 확인한 ISO 국가 코드를 `GA4_TRANSFER_COUNTRIES`에 넣는다. 이는 실제 범위 검토를 대신하는 기본 목록이 아니다.
3. repository variables에 `GA4_PROPERTY_ID=563988659`, `GA4_MEASUREMENT_ID=G-CDQCEPLW7F`, 국가 목록을 설정한다. 초기 배포는 `GA4_ENABLED=false`, `GA4_NOTICE_READY=false`. workflow의 기본값도 false다. 별도 web 빌드 ID가 아니라 API 공개 config로 측정 ID를 전달한다.
4. 승인된 기존 CI/CD로 migration `0060_audience_interests`와 API/Web을 배포한다. 운영 DB 대상 확인·migration freeze 절차는 기존 runbook을 따른다.
5. 사용자 취향 선택/철회, 관리자 권한·태그·소재 비교, Google 안내를 live 확인한다. Google 신호 및 사용자 동의 확인을 완료하고 준비된 공지/선택기능이 실제 표시되는 것을 확인한 후 두 gate를 활성화한다. GA4 read API의 실제 인증·빈 결과/threshold 처리를 확인한다.
6. 별도 QA 브라우저에서 동의 전 Google 요청 0 → 별도 동의 → 정제된 공개 경로 전송 → 철회 후 요청 중단을 확인한다. 고객 데이터를 테스트용으로 생성하거나 동의를 대리하지 않는다. 새 속성은 관심사가 표시되기까지 수집·처리 시간과 충분한 표본이 필요하다.

공식 근거: [Data API 스키마](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [응답 metadata](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData), [quota](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas), [Consent Mode](https://developers.google.com/tag-platform/security/concepts/consent-mode), [태그 차단](https://developers.google.com/tag-platform/security/guides/privacy), [Google 처리 약관](https://business.safety.google/adsprocessorterms/), [보관 설정](https://support.google.com/analytics/answer/7667196).


### Google 공개 처리 범위 참고 (2026-11-12 확인)

[공식 재처리자 목록](https://business.safety.google/adssubprocessors/)에서 Google Analytics Standard를 명시한 제3자 지원 법인의 소재 국가 코드는 `AR BR IE IN JP MX MY NL PH PL TR TW US`, Google 계열사는 `AE AR AU BR CA CH CO CZ DE DK ES FR GB HR IE IL IN IT KE NL NO PE PH PL PT SE SG`다. IT시설관리만 명시한 별도 계열사는 `TW US`다. GA360만 명시한 행은 제외했다.

[DPA 10.2](https://business.safety.google/adsprocessorterms/)가 연결하는 [데이터센터 위치](https://datacenters.google/locations/)의 개발 중 표시 없는 위치 국가·지역은 `BE CL DE DK FI GB IE JP NL SG TW US UY`, 개발 중으로만 등재된 추가 국가는 `AT IN MY NO SE TH`다. 표시와 소개문 상태가 일치하지 않는 경우가 있어 이를 현재 GA4 저장소 목록으로 해석하지 않는다.

위 목록은 공개 시설·법인의 소재 범위이며 해당 속성의 개별 요청 경로 확인서는 아니다. 모든 자료가 모든 국가로 전송·복제된다는 뜻이 아니고, 지원 공유 off가 모든 계열사의 서비스 운영을 없애는 것도 아니다. 2026-11-13 사용자 승인에 따라 Google Analytics Standard에 해당하는 운영·지원 국가와 개발 중으로 표시되지 않은 데이터센터 국가의 합집합을 가능한 처리 범위로 고지한다. 개발 중 시설만 등재된 국가는 추가하지 않는다. 실제 저장·지원 경로가 달라질 수 있음을 안내하고 원문 링크를 제공한다. 공개 목록 변경 시 국가 범위와 고지를 다시 검토한다.

배포 국가 설정: `AE,AR,AU,BE,BR,CA,CH,CL,CO,CZ,DE,DK,ES,FI,FR,GB,HR,IE,IL,IN,IT,JP,KE,MX,MY,NL,NO,PE,PH,PL,PT,SE,SG,TR,TW,US,UY`. 현재 동의 버전은 `google-interests-v2`다. 초기 태그 설정 보완 후 버전을 올려, 열려 있던 v1 코드가 새 서버 설정으로 수집을 재개하지 못하게 한다. 기존 v1 동의는 재사용하지 않고 새 코드에서 다시 선택받는다. 브라우저 저장 키의 v1은 JSON 형식 버전이며 동의 버전과 별개다. 사이트 고지와 동의 UI를 배포·확인한 뒤 Google 신호/최종 사용자 동의 확인과 두 gate를 켠다. Google 지원팀에 고객 원본 자료를 추가로 공유하는 작업이나 Google Ads 연결은 포함하지 않는다.


## 구현 검증 (2026-11-12)

- 공유 계약 7개, 관련 API 단위·권한 5개, 관련 웹 단위·회귀 40개 통과.
- 별도 loopback Docker PostgreSQL/Valkey에서 관심 프로필 및 기존 분석 통합 14개 통과. 실제 DB로 동의 전 제외, 같은 날 조회 중복 제거, 현재 수신동의 반영, 철회·만료 삭제, 취소 예매 제외, 소재별 결제의 단일 귀속을 확인했다.
- 배포 가드 31개, API build, API/Web 타입 검사, 변경 파일 lint, diff 공백 검사를 통과했다. 홈의 기존 `<img>` 경고는 범위 밖으로 유지했다.
- Browser plugin이 제공되지 않아 저장소 Playwright를 설치된 Chrome channel로 실행했다. `http://localhost:3185`, API `http://127.0.0.1:8184`에서 1440×1000 / 390×844의 3개 브라우저 시나리오를 통과했다. 화면 식별·주요 UI·PC/모바일 렌더링·가로 넘침·framework overlay·애플리케이션 console 오류·상호작용을 확인했다.
- 사용자 선택 저장 → 실제 API/DB → 관리자 개인 프로필 → 철회 후 404까지 확인했다. 소재·태그·GA4 표본/임계값 상태는 명시된 합성 응답으로 렌더링했다. Google 스크립트는 로컬 stub으로 대체하여 Google에 테스트 방문을 보내지 않았다. 동의 전 로드 없음, 정제된 공개 경로, 철회 후 로드 없음은 브라우저에서 확인했다.
- 호스트 기본 Node 26의 Web Storage 변화로 기존/신규 웹 테스트가 실패하여, CI와 같은 설치된 Node 22.23.1로 실행해 통과했다. 이 문제를 우회하는 제품 코드는 추가하지 않았다.
- 산출 이미지: `/tmp/grabit-audience-qa/`. 태그 편집·소재 비교·관심사 표의 숫자는 QA 샘플이며 실제 고객 통계가 아니다.
- 운영 migration/배포, GA4 Data API 실인증·실수집, Google 신호 데이터 표시, 실기기/Safari·부하 검증은 아직 실행하지 않았다. 운영 수집 활성화와 인증은 위 연결 절차 및 명시적 승인 이후 확인한다.


## Google 태그 초기화 및 실제 라이브러리 검증

Google 태그는 개별 스트림의 `config`보다 먼저 기본 페이지 이벤트를 만들 수 있다. `consent` / `js` 명령 전에 전역 `set`으로 `send_page_view: false` 및 정제한 `page_location`, `page_referrer`, `page_title`을 적용한다. 스트림 config와 수동 page_view에만 정제 주소를 넣는 구현으로 되돌리지 않는다. 브라우저 안의 dataLayer만 검사해서는 실제 Google 요청을 증명할 수 없다.

실제 vendor 코드 검증은 현재 속성의 공개 gtag 스크립트를 임시 파일로 내려받아 `GA4_VENDOR_SCRIPT`와 `GA4_VENDOR_MEASUREMENT_ID`를 지정한 `audience.spec.ts`의 Google 시나리오로 실행한다. 모든 Google 수집 요청을 Playwright에서 가로채 204로 응답하므로 이 QA는 Google에 방문 데이터를 보내지 않는다. 기본 CI는 stub으로 동의/철회 흐름을 확인한다. bootstrap 회귀는 별도 단위 테스트가 지킨다.

운영 검증은 primary 수집 응답(`analytics.google.com/g/collect` 또는 `*.google-analytics.com/g/collect`)을 기다린 뒤 수행한다. `stats.g.doubleclick.net`의 신호 연결 응답만으로 본 수집 성공을 판정하지 않는다. Google 도메인 전체의 URL/본문에 허용하지 않은 검증용 쿼리 값이 없는지, 별도 동의 전 요청 0건과 철회 후 추가 요청 0건을 확인한다. 인증·회원·결제 데이터나 실제 비밀값을 검증용 URL에 넣지 않는다.

스트리밍된 분석 설정 화면은 상위 provider가 먼저 공유 query cache를 채울 수 있다. 초기 HTML과 첫 클라이언트 렌더에는 같은 비활성 snapshot을 쓰고 hydration 이후 현재 설정을 반영한다. `analytics-settings-hydration.test.tsx`가 기존 자체 분석 설정과 Google 설정의 조기 도착을 각각 재현한다.
