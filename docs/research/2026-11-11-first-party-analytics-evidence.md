# 자체 방문 분석의 개인정보·도구·비용 검토

확인일: **2026-11-11 KST**. 공식 법령·기관·제품 문서와 현재 저장소를 확인했다. 운영 DB, 운영 설정, 실제 청구서, Sentry 계정에는 접속하지 않았다. 아래는 구현 의사결정을 위한 근거와 검토 항목이며, 특정 처리의 적법성을 확정하는 법률 의견이 아니다.

## 1. 이번 설계에서 먼저 정할 기준

회원 DB의 가입 집계와 브라우저 방문 측정은 서로 다른 모집단이다. 브라우저 거부·차단·네트워크 실패·다른 기기로의 이동 때문에 방문 데이터로 모든 가입을 설명할 수 없다. 서버의 가입·결제·취소 기록을 정본으로 유지하고, 동의한 방문에서 연결된 전환만 별도로 표시하는 것이 이 프로젝트의 분석 기준이다. first-touch/last-touch는 관찰된 유입 기여도이며 광고의 인과 효과나 ROAS를 증명하지 않는다. 광고비 입력·매체 연동 없이 ROAS를 계산하지 않는다.

자체 visitor ID라도 로그인한 `user_id`와 연결되거나 다른 정보와 쉽게 결합할 수 있으면 **완전 익명 정보라고 안내하지 않는다**. 일반 개인정보 또는 연결 가능한 가명 식별 정보로 보수적으로 다룬다. 법 제2조는 다른 정보와 쉽게 결합해 개인을 알아볼 수 있는 정보와 가명정보도 개인정보 범위에 둔다. 단순 UUID 치환을 법 제28조의2의 동의 없는 가명정보 처리 특례 적용 근거로 삼지 않는다. [개인정보 보호법 제2조](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031868871), [제28조의2~제28조의5](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334887)

## 2. 단계별 개인정보 검토

| 단계 | 확인한 근거 | 이 작업의 보수적인 적용 및 남은 판단 |
| --- | --- | --- |
| 1. 기존 가입·결제 집계 | 수집 목적 범위 내 이용, 목적 외 이용 제한, 최소수집 원칙 | 새 수집 없이 기존 운영 목적의 집계만 제공한다. 국가·언어·인증·동의율도 집계로 표시하고 신규 PII 열람 경로를 만들지 않는다. 기존 수집 근거·목적과의 정합성은 개인정보 책임자가 확인한다. [법 제15·16·18조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334879) |
| 2. 방문·행동과 회원 연결 | 동의를 근거로 처리할 때 목적·항목·기간·거부권 등을 사전에 알려야 하며 불필요한 정보 동의 거부로 본 서비스를 거부할 수 없음 | 분석 선택 동의를 기본 거부 상태로 두고, 거부·철회해도 가입·예매를 이용할 수 있도록 한다. 기존 마케팅 **수신** 동의를 분석·회원 연결 동의로 자동 전용하지 않는다. 동의 외 적법 근거를 택하려면 별도의 법무 판단을 받는다. [법 제15조 제2항·제16조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334879) |
| 자동수집장치·행태정보 고지 | 자동수집장치의 설치·운영·거부를 처리방침에 기재 | 쿠키뿐 아니라 localStorage/sessionStorage, 자체 식별자, 회원 연결, 수집 방법과 거부 수단을 실제 구현대로 설명한다. 수집 항목·목적·보유기간·법적 근거도 함께 공개한다. [법 제30조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127663), [2026 작성지침, 본문 54~57쪽](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030030&nttId=12018) |
| 보관·삭제 | 목적 달성, 보유기간 경과 등 불필요해지면 파기 | raw 90일은 이 작업의 제안값이며 법정 의무기간이 아니다. visitor·session·회원 유입 연결의 보관기간도 명시하고 삭제 job으로 검증한다. 식별자를 제거한 집계의 별도 보관기간과 소수 집단 재식별 위험을 정한다. [법 제21조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335641) |
| 3. 외부 분석·광고·리플레이 | 수탁·재수탁 공개, 위탁계약 및 국외 이전 근거 검토 필요 | SDK 설치 전에 실제 수신 법인·국가·항목·목적·기간·재수탁·거부 방법을 확인한다. 외부 도구가 자신을 processor 또는 controller로 부르는 것만으로 한국법 분류를 확정하지 않는다. 단순히 처리방침에 추가했다고 모든 이전이 허용되는 것은 아니다. [법 제26조](https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1025127467), [제28조의8 제1항](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1034515803), [제2항 고지항목](https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1033215841) |

PIPC의 2024-01-31 정책 방안은 식별하지 않는 행태정보도 누적·결합으로 식별되지 않게 관리하고 투명성과 통제권을 제공하도록 설명한다. 개인을 식별하여 처리하는 경우에는 적법 근거와 사후 거부가 필요하다고 구분한다. 이 문서는 맞춤형 광고에 관한 **정책 방안**이다. 이를 모든 자체 서비스 분석에 대한 포괄적인 동의 면제나 확정된 최신 가이드라인으로 확대 해석하지 않는다. [PIPC 공식 발표](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS074&mCode=C020010000&nttId=9888)

2017년 「온라인 맞춤형 광고 개인정보보호 가이드라인」의 공식 게시물은 확인되며, 2020년 소관이 PIPC로 변경되었다고 안내한다. 요청에 적힌 이름과 같은 개정 가이드라인의 최종 공개본은 이번 조사에서 확인하지 못했다. 2026-10-30 공식 안내서 목록과 공개 검색에서 확인되지 않았다는 것이지, 존재하지 않는다고 단정하는 것은 아니다. 시행 전에 최신본 존재 여부를 다시 확인한다. [2017 공식 게시물](https://www.kmcc.go.kr/user.do?boardId=1099&boardSeq=44473&cp=1&mode=view&nop=10&page=A02030700), [PIPC 2026-10-30 안내서 목록](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030030&nttId=12605)

### 처리방침 초안과 시행 전 확인

- 최신 확인본은 **2026.4. 개인정보 처리방침 작성지침**이다. 본문 54~57쪽의 자동수집장치·식별형 행태정보 항목, 58쪽 이후 제3자 수집 허용 항목, 83~85쪽의 변경 고지를 참고한다. 쿠키와 유사 기술의 설명·목적·수집·거부, 식별형 행태정보의 법적 근거·항목·방법·목적·기간·거부 수단을 실제 동작과 일치시킨다. [공식 게시물 및 PDF](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030030&nttId=12018)
- **2026.2. 표준(안)**은 공인중개사·노인복지관·여행업용이다. Grabit에 바로 적용되는 표준 인증이나 면책 양식이 아니다. 구조를 참고하되 티켓 플랫폼의 처리 현황으로 다시 작성한다. [공식 표준(안)](https://www.privacy.go.kr/front/bbs/bbsView.do?bbsNo=BBSMSTR_000000000049&bbscttNo=20869)
- 시행일·공지일·재동의 필요 여부는 법무/개인정보 책임자 확인 항목으로 둔다. **모든 개정에 법정 7일 또는 30일이 일률 적용된다고 단정하지 않는다.** 현재 Grabit 방침 제11조에는 자체적으로 시행 7일 전 고지를 약속하고 있다. 이 약속과 새 처리의 동의 근거, 실제 공지일을 함께 확인해야 한다. 현재 문서의 유효 버전은 임의 변경하지 않고 ko/en 개정 초안을 별도로 두며, 확정 후 [동의 문서 버전 runbook](../runbooks/consent-document-versions.md)을 따른다. [2026 작성지침 83~85쪽](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030030&nttId=12018)
- 법무 확인과 정책 개정이 끝나기 전 수집 flag는 **기본 off**다. opt-out은 이후 수집·전송을 멈추고 대기 중 배치를 폐기해야 한다. 과거 식별 가능 자료의 열람·삭제·처리정지 요청 경로와 계정 탈퇴 시 연결자료 처리도 운영 절차에 포함한다. 광고·리플레이는 이번 단계에서 켜지 않는다.

### 최소수집 기준

운영·마케팅 의사결정에 필요한 정규화 path, UTM 5종, referrer 도메인, 기기/브라우저/OS/언어/화면 크기 **구간**, 제한된 이벤트와 동의 증거만 채택한다. 원본 IP·전체 UA·이름·이메일·전화·검색어 원문·결제/QR/재설정 식별자는 분석 저장소로 보내지 않는다. 임의 UTM에도 고객 정보가 들어갈 수 있으므로 길이·문자 allowlist와 민감 패턴 제외가 필요하다. Google의 공식 구현 지침도 URL과 UTM 5종, 사용자 입력에 PII가 섞이지 않도록 요구한다. 이는 자체 구축에도 유용한 최소수집 설계 근거이며 한국법상 적법성 판단을 대신하지 않는다. [Google PII 방지 지침](https://support.google.com/analytics/answer/6366371)

## 3. 자체 구축·GA4·PostHog 비교

비용은 2026-11-11 공개 USD 가격 기준이다. 계약·세금·환율·도입 인건비는 별도이며 아래 운영 부담 평가는 이 프로젝트에 대한 설계 판단이다.

| 대안 | 비용 | 개인정보·데이터 위치 | 1인 운영 부담 | Grabit 관리자 통합 |
| --- | --- | --- | --- | --- |
| 자체 NestJS/PostgreSQL | 별도 분석 SaaS 요금 없음. 아래 추가 DB 저장소·쿼리/worker 비용과 유지보수 필요 | 수집 allowlist·동의·보관·삭제·계정 연결을 직접 통제. 기존 클라우드/edge 위탁 검토는 남음 | SDK 유지, 봇/중복 제거, rollup, 정정·삭제, 성능 및 비용 경보까지 직접 책임 | 기존 권한과 화면, 서버 결제 정본을 직접 활용. 외부 API quota·계정 운영 없음 |
| GA4 Standard | 기본 도구 무료. 360·BigQuery 등 추가 서비스 비용은 별도 확인 | Google에 전송. GA4는 IP를 수집 단계의 위치 산출 후 저장 전에 버린다고 설명하지만, 이것이 모든 이벤트의 익명성이나 국내 저장을 보장하지 않음 | 수집 SDK·광고 보고서 준비는 빠름. 이벤트 taxonomy, 동의 모드, 서비스 계정·API quota 관리 필요 | Data API로 가능. Standard Core 동시 요청 10, 시간/일별 token quota가 있어 서버 캐시·오류 처리가 필요 |
| PostHog Cloud | 월 첫 100만 이벤트 무료. 공개 익명 이벤트 단가는 초과 첫 구간 $0.00005/건부터. 식별 이벤트는 person 처리 요금 차이가 있으므로 전량 익명 단가로 예산을 잡지 않음 | Cloud 위치는 미국 또는 독일 선택. 한국 이용자에 대한 위탁·국외 이전·삭제 설정 검토 필요 | 퍼널·경로·retention·dashboard 제공으로 개발 부담 감소. 스키마·동의·과금 한도·키 관리 필요 | private API/쿼리로 통합 가능. 서버 측 인증키와 외부 서비스 장애 대응 필요 |
| PostHog 자체 호스팅 | 인프라·운영 인건비 직접 부담 | 호스팅 위치 통제 가능 | 공식 문서는 self-host를 unsupported로 안내하며 보안·업그레이드·스케일 책임을 이용자에게 둠. 별도 분석 스택 운영은 현재 1인 modular monolith 기준에 부담 | 별도 배포·DB·통합을 운영해야 하므로 현재 단계의 우선안으로 선택하지 않음 |

공식 근거: [GA4 무료 도구](https://marketingplatform.google.com/about/analytics/), [GA4 지역 수집/IP 처리](https://support.google.com/analytics/answer/11598602), [GA4 Data API quota](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas), [PostHog 가격](https://posthog.com/product-analytics/pricing), [PostHog 익명/식별 이벤트 과금 구분](https://posthog.com/docs/data/anonymous-vs-identified-events), [PostHog 위치·보안](https://posthog.com/handbook/company/security), [PostHog API](https://posthog.com/docs/api), [PostHog self-host 지원 범위](https://posthog.com/docs/self-host).

GA4 Standard의 사용자·이벤트 수준 보관기간은 일반적으로 2개월/14개월 선택이며 표준 집계 보고서와 탐색·퍼널의 보관 영향을 구분해야 한다. PostHog 공개 가격 페이지는 무료 플랜 이벤트 1년, 유료 플랜 7년을 안내하므로 이 프로젝트의 90일 raw 정책을 자동으로 충족한다고 볼 수 없다. [GA4 보관](https://support.google.com/analytics/answer/7667196), [PostHog 보관·가격](https://posthog.com/pricing)

**이번 요구에는 자체 구축을 우선하는 것이 타당하다는 판단**이다. 이유는 무료 여부가 아니라 기존 관리자에서 서버 기준 가입·결제 사실과 연결하고 수집 범위를 좁히려는 요구다. 외부 도구도 무료 구간이 있으므로 “자체 구축이 항상 싸다”고 주장하지 않는다. 인입량·유지보수 부담이 커지면 PostHog Cloud 같은 대안을 다시 평가한다. 자체 구축에서도 raw 보고서가 예매 DB 용량을 잠식하지 않도록 인입 제한·kill switch·rollup·보관 삭제를 갖춰야 한다.

## 4. Cloud SQL 저장량·비용 시나리오

Google 공식 가격 페이지의 공개 지역별 표 데이터에서 **Seoul(`asia-northeast3`), MySQL/PostgreSQL, 단일존 SSD**를 확인했다. 월 단가는 **$0.221/GiB-month**이며 시간 단가는 $0.00030274/GiB-hour다. 같은 지역 HA SSD는 $0.442/GiB-month, 사용 백업은 $0.104/GiB-month다. 기본으로 렌더링된 다른 지역 가격을 서울 가격으로 사용하지 않았다. [Cloud SQL 공식 가격: Storage and networking](https://cloud.google.com/sql/pricing)

가정: 이벤트 1건의 저장 크기 **1KB = 1,000 bytes**, raw 90일, 계산한 raw 크기에 30% 여유. 아래 비용은 90일치가 쌓인 뒤 해당 용량을 한 달 내내 **추가 할당할 필요가 있을 때의 SSD 용량 비용 환산**이다. 서버 CPU·메모리·WAL/PITR·백업·인덱스·테이블 팽창·세션/유입 연결 테이블·rollup·API/worker·네트워크·세금은 포함하지 않는다. 30% 여유가 이 비용들을 모두 커버한다는 뜻이 아니다.

| 이벤트/일 | 90일 이벤트 | raw GiB | +30% 공간 GiB | 단일존 SSD 환산/월 | HA SSD 환산/월 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000 | 900,000 | 0.84 | 1.09 | $0.24 | $0.48 |
| 100,000 | 9,000,000 | 8.38 | 10.90 | $2.41 | $4.82 |
| 1,000,000 | 90,000,000 | 83.82 | 108.96 | $24.08 | $48.16 |

계산식: `GiB = 일 이벤트 수 × 90 × 1,000 / 2^30`, `여유 포함 = GiB × 1.3`, `단일존 월 환산 = 여유 포함 × $0.221`. 이 값은 추정 행 크기에서 계산한 시나리오이며 실제 데이터 크기는 `pg_total_relation_size` 등 로컬/승인된 관측으로 검증해야 한다. Cloud SQL 청구는 이벤트 bytes가 아니라 할당된 저장 용량 기준이므로 기존 여유 안에 들어가면 당장 용량 증설 비용이 없을 수 있고, 할당 단위·자동 증가·공유 DB의 다른 테이블 때문에 실제 증분은 달라진다. [공식 저장소 과금](https://cloud.google.com/sql/pricing)

[기존 비용 runbook](../runbooks/managed-demo-cost-floor.md)에는 과거 10GB micro 프로필과 이후 더 큰 DB/연결 용량 운영 기록이 함께 있다. 이번 조사에서 live DB tier·할당량·여유·청구를 확인하지 않았으므로 어느 과거 프로필도 현재 값이라고 단정하지 않는다. 특히 일 10만 건 시나리오도 분석 raw와 여유만 약 10.90GiB여서 과거 10GB 전체 DB 기준으로는 들어가지 않는다. 저장 단가보다 write/rollup/대시보드 쿼리와 연결 수가 먼저 운영 제약이 될 수 있다.

오픈 전 확인할 실측 항목은 이벤트/세션 수, 배치당 bytes·DB 시간, 수집 drop 비율, rollup 지연, 90일 삭제 job 완료, 분석 테이블+인덱스 크기, DB connection/p95와 예매·결제 p95다. 총 비용 또는 처리 가능 TPS는 이 저장량 표에서 추정하지 않는다. 예매 성능이 악화되면 분석을 먼저 끌 수 있어야 한다.

## 5. 외부 픽셀·리플레이 보류 메모

현재 코드의 `apps/web/instrumentation-client.ts`는 `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`, `sendDefaultPii: false`와 URL/QR 관련 마스킹을 설정한다. 그러나 `apps/web` 전체 검색에서 `replayIntegration()`/`new Replay()` 등록은 발견되지 않았다. 공식 Next.js 문서는 Replay integration 등록과 샘플링 설정 모두를 안내한다. 따라서 **“오류 시 실제 리플레이가 전송 중”은 확인된 사실이 아니다**. DSN·실행 번들·수신 데이터·계정 보관기간도 확인하지 않았다. [Sentry Next.js Replay 설정](https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/)

| 선택지 | 유용성 | 개인정보 관점과 채택 전 조건 |
| --- | --- | --- |
| Sentry 오류 중심 소량 Replay | 오류 직전/직후 DOM 흐름과 네트워크·콘솔 맥락을 오류 조사에 연결 | 공식 기본값은 텍스트·입력 마스킹과 미디어 차단이지만 설정·프레임워크 변경 시 검증이 필요하다. 도입한다면 결제·QR·개인정보 입력·관리자·현장 화면을 제외하고 동의/거부를 연결한다. canvas 기록은 별도 위험 검토한다. [Sentry Privacy](https://docs.sentry.io/platforms/javascript/session-replay/privacy/) |
| Microsoft Clarity | 히트맵·세션 기록·마우스/스크롤 등 UX 분석, 공개 가격상 무료 | DOM/interaction 수집 범위가 자체 allowlist보다 넓다. Microsoft는 자신을 data controller로 설명하며 광고 활용을 포함한 고지 예시도 제공한다. 단순 위탁 도구로만 가정하지 않는다. [수집 항목](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data), [FAQ](https://learn.microsoft.com/en-us/clarity/faq), [고지 예시](https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure) |

Clarity Consent V2는 거부 시 쿠키 없이 제한적으로 작동하는 모드를 설명한다. “거부 = 외부 전송 없음”이 요구되는 경우 SDK 자체를 로드하지 않거나 중단하는 별도 구현이 필요하다. 공식 고지 문구를 복사하는 것만으로 한국법상 동의를 충족했다고 판단하지 않는다. [Clarity Consent V2](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2)

Meta·Kakao·Naver·GA4 광고 픽셀, Clarity, 새로운 Sentry Replay 등록은 이번 단계에서 구현/활성화하지 않는다. 필요해지면 매체·ID·처리 목적을 정하고 ko/en 정책·동의·거부·위탁/국외 이전 검토를 먼저 한다. 방문 분석 동의와 광고성 메시지 수신 동의, 외부 광고 전송 동의를 혼동하지 않는다.

## 6. 별도 발견 사항과 확인하지 못한 것

1. 현재 ko/en 개인정보처리방침의 수탁자/국외 이전 목록에는 Sentry가 없다. 실제 Sentry 수신 항목·법인·리전·재수탁·보관/삭제 계약을 확인해 별도로 정합성을 검토해야 한다. sampling 옵션만으로 실제 replay 수집을 단정하지 않는다.
2. 자체 분석도 공개 트래픽은 Cloudflare edge를 통과한다. 원본 IP를 분석 DB에 저장하지 않는다는 사실만으로 edge·호스팅의 로그/지원 접근·위탁·국외 이전 검토가 없어지지 않는다. 실제 Cloudflare/GCP 계약·로그 보관·데이터 위치는 이번 조사 범위에서 확인하지 않았다.
3. 시행일, 사전 공지 기간, 기존 회원 재동의/신규 선택 동의, 계정과 방문 연결의 적법 근거, 아동/해외 이용자 처리, 철회 시 기존 연결 데이터 처리, 집계의 보관기간은 개인정보 책임자·법무 결정 사항이다. 현재 수집 기본 off를 유지한다.
4. 가격은 공개 USD 표준 가격이며 실제 청구·할인·환율·세금·현재 여유 용량을 검증하지 않았다. GA4 360 계약 견적, PostHog 식별 이벤트의 최종 혼합 단가, Sentry 실제 플랜 비용도 미확인이다.
5. 90일 raw 보관과 삭제 job이 실제 승인된 배포 환경에서 실행된다는 증거는 배포 후 별도로 확인해야 한다. 이 문서는 구현 준비 근거이며 운영 활성화·법무 승인·유효 문서 개정 완료의 증거가 아니다.
