# 자체 방문·행동 분석 개인정보처리방침 개정안 — 한·영 검토 초안

작성일: 2026-11-11 KST. **게시·시행되지 않은 검토용 문서**다. 현재 적용 중인 `privacy-policy.md`, `privacy-policy.en.md`, `CONSENT_DOCUMENT_VERSIONS`와 동의 항목은 이 문서로 변경되지 않는다. 아래 대괄호 항목과 철회·삭제 절차를 확정하고 실제 구현을 검증한 뒤 게시한다.

## 게시 전 확정 사항

| 항목 | 상태 또는 확정할 값 |
| --- | --- |
| 개정 버전 | `[개인정보 책임자·법무 확정]` |
| 공지일 | `[YYYY-MM-DD KST]` |
| 시행일 | `[YYYY-MM-DD KST — 법무 확정]` |
| 사전 공지 기간·방법 | `[법무 확정]`. 현행 Grabit 방침 제11조의 **시행 7일 전 공지 약속**을 함께 검토한다. 모든 법률상 변경에 7일 또는 30일이 일률 적용된다는 의미는 아니다. |
| 동의 근거·범위 | 선택 동의에 의한 자체 분석 및 회원 연결. 기존 마케팅 메시지 수신 동의와 구분한다. 기존 회원에 대한 적용·동의 문구·아동/해외 이용자 처리는 법무 확인 대상이다. |
| 수집 활성화 | 서버 `ANALYTICS_ENABLED=false`, DB 수집 설정 `enabled=false`가 기본값이다. 두 설정이 활성화되고 이용자가 선택 동의한 경우에만 수집하도록 검증한다. 정책 확정 전 off를 유지한다. |
| 철회와 기존 자료 | 철회 버튼에서 관련 기록 삭제를 자동 요청하고 서버 삭제 완료 여부를 표시하는 설계를 전제로 한다. 아래 ‘철회·삭제 검토’와 제7조의 실제 이행 여부를 검증한다. |
| 위탁·국외 이전 | 실제 GCP/Cloudflare 계약, 재수탁자, 데이터 위치, edge/지원 접근 및 로그 보관을 확인한 뒤 제5·6조를 확정한다. 자체 분석이라는 이유만으로 국외 이전이 없다고 단정하지 않는다. |

법적 근거와 도구 비교는 [공식 근거 조사](../research/2026-11-11-first-party-analytics-evidence.md)에 정리했다. 최신 확인한 [2026.4. 처리방침 작성지침](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030030&nttId=12018)은 자동수집장치·거부, 식별형 행태정보, 변경 공개 사항을 다룬다. 확정 후에는 [동의 문서 버전 절차](../runbooks/consent-document-versions.md)에 따라 ko/en 문서·효력일·동의 버전·검증을 함께 갱신한다.

### 철회·삭제 검토 — 자동 삭제 설계 및 활성화 전 검증

현행 개인정보 보호법 제37조 제3항은 동의 철회 시 지체 없이 파기 등 필요한 조치를 요구하며, 제2항 각 호의 예외를 둔다. 제4항은 예외로 조치하지 않는 경우 사유 통지를, 제5항은 처리정지 자료에 대해서도 파기 등 조치를 규정한다. 이는 모든 삭제가 버튼 클릭과 같은 순간에 동기적으로 끝나야 한다는 기술적 규정은 아니지만, 향후 수집만 끄는 것으로 기존 식별 가능 자료의 조치를 대신할 수 있다는 뜻도 아니다. [개인정보 보호법 제37조](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1034515819)

게시 전 다음을 확인한다.

- 거부/철회 시 수집 중단·대기 배치 폐기 후 `POST /analytics/withdraw`에 불투명 visitor/session ID만 전송하여 해당 방문자의 raw·세션·가입 유입 연결자료 삭제와 영향받은 집계 재작성을 요청하는 흐름을 검증한다. 브라우저 ID를 먼저 없애 서버 자료를 찾지 못하게 되는 순서도 피한다.
- 지연 이벤트가 다시 저장되지 않게 방문 UUID의 SHA256 해시를 재수집 차단 목적으로 최대 90일 보관한다. 이 표시는 분석·광고·재연결에 사용하지 않는다. 해시라는 이유만으로 개인정보 범위 밖이라고 단정하지 않으며 필요성·기간·별도 처리 근거를 법무와 확인한다.
- 네트워크 실패 시 수집은 즉시 멈춘 상태로 유지하고 삭제요청용 ID만 브라우저에 pending 상태로 남겨 재시도한다. 서버 삭제 확인 전에는 완료로 표시하지 않는다. 성공 후 pending ID를 삭제한다. 미완료 요청은 최대 90일 보관한다. 장기 실패 처리·사용자 통지는 법무·운영 검토 대상으로 둔다.
- 법령상 예외를 적용하려면 항목·근거·분리 보관·사유 통지를 확인한다.
- `privacy@heygrabit.com`은 추가 문의·본인확인·다른 기기 기록 등의 권리행사 경로다. 버튼으로 이미 접수한 동의 철회를 처리하기 위해 같은 의사를 이메일로 다시 제출하도록 요구하는 유일한 경로로 삼지 않는다.
- 식별자 없는 집계의 계속 보관 가능 여부, 소수 집단 재식별 가능성, 백업 내 삭제 이행·복원 시 재유입 방지, 동의/철회 증거의 필요 최소 보관기간을 법무와 확인한다. 이 문서 자체는 적법성 확정 또는 구현 완료 증거가 아니다.

## 한국어 개정 문구 초안

아래는 현행 방침에 추가·수정할 해당 부분의 초안이다. 나머지 조항은 별도 승인된 변경이 없는 한 유지한다.

### 제1조 (개인정보의 처리 목적) — 선택 분석 목적 추가

4. **자체 방문·행동 분석(선택 동의 시)**: 방문 경로와 홍보 캠페인의 반응, 공연 탐색부터 가입·예매에 이르는 이용 흐름, 재방문 및 서비스 이용 중 이탈을 통계적으로 분석하여 서비스와 홍보 운영을 개선합니다. 회원과 방문 기록을 연결하는 경우 가입·결제·취소의 전환 통계를 확인하기 위한 범위에서 이용합니다. 이 동의는 광고성 메시지 수신 동의와 별개입니다.

### 제2조 (처리하는 개인정보 항목) — 선택 분석 항목 추가

**자체 방문·행동 분석에 선택 동의한 경우 처리하는 항목**

| 구분 | 처리 항목 |
| --- | --- |
| 방문·세션 식별 및 선택 상태 | 무작위 방문 식별자, 세션 식별자, 분석 선택 상태와 적용된 동의 안내 버전·시각 |
| 페이지·유입 정보 | 정규화한 공개 페이지 경로와 이전 경로, 유입 사이트의 도메인, 홍보 링크의 UTM source·medium·campaign·term·content, 최초 방문 페이지 |
| 접속 환경 | 언어, 기기·브라우저·운영체제 종류, 화면 크기 구간. 정확한 화면 크기나 전체 브라우저 식별 문자열 대신 구간 또는 종류를 사용합니다. |
| 이용 행동 | 공연 상세 조회, 예매 진입, 대기열 진입, 좌석 선택, 결제 시작, 가입 시작, 허용된 링크 선택, 스크롤 구간, 체류 시간 및 발생 시각 |
| 회원 연결·유입 기여도 | 동의한 회원이 로그인·가입할 때 확인된 내부 회원 식별자와 현재 방문 세션의 연결, 처음 연결하는 시점에 확인한 최초·최근 유입 경로 정보 |

방문 식별자는 이름 대신 임의의 값으로 생성하지만 회원 계정과 연결될 수 있으므로 완전히 익명인 정보라고 보지 않습니다. 가입 유입 분석에 사용한 최초·최근 유입 정보는 처음 연결할 때의 기록으로 보관하며, 이후 로그인을 이유로 이 가입 유입 기록을 덮어쓰지 않습니다.

자체 분석 저장소에는 원본 IP 주소, 이름·이메일·전화번호, 검색어 원문, 폼 입력 내용, 결제·QR 식별자 또는 화면 녹화·세션 리플레이를 저장하지 않습니다. 페이지 주소의 임의 쿼리나 전체 유입 URL을 저장하지 않으며 허용된 UTM 항목만 제한하여 처리합니다. 관리자·현장 업무, 인증 콜백, 결제 복귀 및 마이페이지 경로는 이 분석 수집에서 제외합니다.

가입 완료·결제 완료·취소 여부는 서비스를 제공하기 위해 이미 보관하는 회원·예매·결제 기록을 기준으로 집계합니다. 브라우저가 보낸 완료 주장만으로 확정하지 않으며 해당 거래 식별자를 분석 이벤트에 복제하지 않습니다. 분석 동의 여부와 관계없이 서비스 제공이나 법령 준수에 필요한 기존 회원·예매·결제 기록은 해당 목적과 보유기간에 따라 처리합니다.

### 제2조의2 (자체 분석의 자동수집장치·행태정보 및 거부) — 신설

1. 회사는 이용자가 선택 동의한 경우에만 자체 분석을 시작합니다. 이용자의 브라우저 저장공간(localStorage)에 분석 선택 상태와 무작위 방문 식별자를 저장하고, 탭별 저장공간(sessionStorage)에 세션 식별자를 저장합니다. 이 정보는 반복 방문과 연속된 이용 흐름을 구분하기 위한 것으로, 해당 브라우저에서 회사의 자체 분석에 사용됩니다.
2. 세션은 30분 동안 활동이 없으면 만료됩니다. 브라우저의 선택 상태·방문 식별자는 저장 시점으로부터 최대 90일 동안 사용합니다. 브라우저 설정이나 사이트 데이터 삭제에 따라 더 일찍 사라질 수 있습니다.
3. 이용자는 `사이트 하단 방문 분석 설정(/legal/analytics)`에서 분석을 허용하지 않거나 이전 동의를 철회할 수 있습니다. 거부·철회 시 이후 수집과 전송을 즉시 중단하고 전송 대기 자료를 폐기합니다. 동시에 해당 방문자의 기존 기록 삭제를 요청합니다. 분석 식별자는 더 이상 수집에 사용하지 않으며, 삭제요청을 완료하기 위한 최소한의 식별자만 임시로 보관할 수 있습니다. 서버 삭제 완료를 확인하면 이 식별자도 삭제합니다. 처리 상태와 자세한 절차는 제7조에서 확인할 수 있습니다.
4. 분석을 거부하거나 동의를 철회해도 회원가입·로그인·예매 등 본래 서비스를 이용하는 데 불이익이 없습니다. 분석 설정은 브라우저·기기별로 적용되며 다른 기기에서의 선택은 별도로 관리할 수 있습니다. 다른 기기에 연결된 기록의 권리행사는 제7조의 문의처로 요청할 수 있습니다.
5. 브라우저의 사이트 데이터 삭제·저장 차단 기능도 이용할 수 있습니다. 사이트 데이터 전체를 지우면 로그인 등 다른 설정에도 영향이 있을 수 있습니다. 분석만 중단하려면 서비스의 분석 설정을 이용할 수 있습니다.

### 제3조 (개인정보의 처리 및 보유 기간) — 선택 분석 보관기간 추가

| 항목 | 보유·이용 기간 |
| --- | --- |
| 방문·행동 원본 기록, 세션 및 회원 유입 연결자료 | 각 기록의 발생 또는 최초 연결 시점으로부터 최대 90일. 목적 달성 또는 동의 철회 등으로 그 전에 불필요해지면 제7·8조에 따라 처리합니다. |
| 브라우저의 분석 선택 상태·무작위 방문 식별자 | 저장 시점부터 최대 90일. 거부·철회 후에는 수집에 사용하지 않으며, 삭제요청용 식별자는 아래 별도 항목에 따라 처리합니다. 거부 상태를 기억하는 최소한의 설정은 유지할 수 있습니다. |
| 탭의 세션 식별자 | 30분 무활동 시 만료. 탭 종료 또는 브라우저 저장소 삭제로 더 일찍 삭제될 수 있습니다. |
| 최근 활동 여부를 판단하는 임시 표시 | 마지막 활동 후 최대 5분 |
| 방문자·세션·회원 식별자를 제거한 시간·일 단위 통계 | 생성 시점부터 최대 365일. 특정 개인을 알아볼 수 있는 자료는 이 항목의 비식별 집계로 취급하지 않습니다. |
| 철회 후 재수집을 차단하기 위한 방문 식별자의 해시 표시 | 철회 시점부터 최대 90일. 늦게 도착하는 이벤트의 재저장을 차단하기 위한 용도로만 사용하며 분석·광고에 사용하지 않습니다. `[필요성·별도 처리 근거 및 기간 — 법무 확정]` |
| 브라우저의 미완료 삭제요청용 방문·세션 식별자 | 서버 삭제 완료 확인 시 즉시 삭제. 네트워크 실패 시 요청 재시도와 상태 확인 용도로만 임시 보관하며 새 방문 수집에는 사용하지 않습니다. 최대 90일. 장기 실패 처리·통지 방식은 법무·운영 검토 대상입니다. |

위 기간은 자체 분석의 최대 보유기간이며 법령상 모든 분석 자료에 의무적으로 적용되는 기간이 아닙니다. 기간이 끝났거나 목적상 필요하지 않게 된 자료는 복구·재생되지 않도록 파기합니다. 동의·철회 증거를 별도로 보관해야 하는 경우에는 `[필요한 항목·법적 근거·기간 — 법무 확정]`을 공개합니다.

### 제5·6조 (위탁 및 국외 이전) — 확정 전 검토 항목

자체 분석 자료는 회사가 관리하는 서비스 데이터베이스에서 처리할 예정입니다. 기존 클라우드 호스팅·트래픽 전달 과정에서 처리되는 항목은 실제 계약과 서비스 구성에 맞춰 아래 사항을 확정하여 기존 표에 반영합니다.

`[수탁자·재수탁자 / 업무 / 처리·보관 국가 / 접근·이전 시점 및 방법 / 항목 / 목적 / 보유기간 / 근거 / 거부 방법과 효과 — 배포 구성·계약 및 법무 확인 후 확정]`

이 개정안의 자체 분석을 위해 외부 광고 픽셀, GA4·PostHog·Clarity 또는 새로운 세션 리플레이 도구를 추가하지 않습니다. 향후 외부 분석·광고 도구를 도입할 경우 별도로 처리 내용과 적용 근거를 확인하고 필요한 고지·동의·거부 수단을 마련합니다.

### 제7조 (정보주체의 권리·의무 및 행사방법) — 분석 권리행사 추가

이용자는 `[방문 분석 설정 위치·링크]`에서 선택한 분석 동의를 언제든 철회할 수 있습니다. 철회하면 이후 수집을 즉시 중단하고 해당 방문자의 기존 원본·세션·가입 유입 연결자료 삭제를 자동으로 요청합니다. 서버는 관련 기록을 삭제하고 영향을 받은 집계를 다시 작성합니다. 회사는 이 절차를 통해 지체 없이 파기 등 필요한 조치를 합니다. 법령상 예외에 따라 일부 자료를 보존하거나 조치를 제한하는 경우에는 해당 근거와 사유를 안내하고 다른 목적의 자료와 분리하여 관리합니다.

연결 오류 등으로 삭제 요청을 완료하지 못했더라도 분석 수집은 중단된 상태로 유지됩니다. 이 경우 삭제요청에 필요한 최소 식별자를 브라우저에 임시 저장하여 재시도하고 대기·실패 상태를 안내합니다. 서버 삭제 완료 확인 전에는 삭제가 끝났다고 표시하지 않습니다. 완료 확인 후 삭제요청용 식별자도 삭제합니다. 지연 전송된 이벤트가 다시 저장되지 않도록 별도의 재수집 차단 표시를 제3조의 기간 동안 유지할 수 있으며 이를 분석이나 광고에는 사용하지 않습니다.

자체 분석 자료의 열람·정정·삭제·처리정지, 다른 기기에 연결된 기록 또는 철회 처리 확인에 관한 문의는 `privacy@heygrabit.com`으로 접수할 수 있습니다. 요청자의 권리를 보호하기 위해 필요한 최소한의 확인을 진행할 수 있습니다. 브라우저 식별자가 이미 삭제되어 자료를 확인할 수 없는 경우에는 그 한계와 가능한 대체 절차를 안내합니다. 분석 동의 철회는 회원 탈퇴나 진행 중인 예매 취소를 뜻하지 않습니다.

`[게시 전 필수 확인: 위 철회 접수·서버 기록 처리·실패 대응·문의 운영 절차가 실제로 구현되고 검증되었는지 확인]`

### 제11조 (개인정보처리방침의 변경) — 이력 추가

| 버전 | 시행일 | 주요 변경사항 |
| --- | --- | --- |
| `[확정 버전]` | `[법무 확정 시행일]` | 선택 동의 기반 자체 방문·행동 분석, 회원 유입 연결, 자동수집장치와 거부·철회 절차 및 보유기간 추가 |

공지 예정일은 `[확정 공지일]`, 사전 공지 기간과 방법은 `[법무 확인 내용]`입니다. 이전 방침과 각 적용기간, 변경 전후 내용을 확인할 수 있도록 게시합니다.

## English amendment draft

The following clauses are a review draft for the corresponding parts of the existing Privacy Policy. They are **not effective**. Bracketed information, withdrawal handling, and actual deployment details must be confirmed before publication.

### Article 1 (Purpose of Processing Personal Information) — additional optional purpose

4. **First-party visit and behavior analytics (with optional consent)**: We analyze referral and campaign responses, the journey from performance discovery to registration and booking, repeat visits, and points where visitors leave the service. We use these statistics to improve the service and our promotional operations. Where visits are linked to a Member account, the link is used to measure registration, completed-payment, and cancellation conversion statistics. This consent is separate from consent to receive promotional messages.

### Article 2 (Personal Information Items Processed) — optional analytics items

| Category | Information processed |
| --- | --- |
| Visit/session identification and choice | Random visitor identifier, session identifier, analytics choice, and the applicable consent notice version and time |
| Pages and acquisition | Normalized public page paths and previous paths, referring domain, permitted UTM source/medium/campaign/term/content parameters, and landing page |
| Access environment | Language and categories of device, browser, operating system, and screen size; categories rather than exact screen dimensions or a full browser user-agent string |
| Service interactions | Performance detail views, booking entry, queue entry, seat selection, checkout initiation, registration initiation, permitted link selections, scroll-depth bands, time spent, and event time |
| Account link and acquisition attribution | The verified internal Member identifier linked to the current session when a consenting Member signs in or registers, and the observed first-touch and last-touch acquisition information at the first link |

Although the visitor identifier is randomly generated rather than a name, it can be linked to a Member account. We therefore do not describe the linked information as completely anonymous. Acquisition information used for registration attribution is recorded at the first link and is not overwritten merely because the Member signs in again.

Our first-party analytics store does not retain raw IP addresses, names, email addresses, phone numbers, raw search terms, form contents, payment or QR identifiers, screen recordings, or session replays. It does not retain arbitrary URL query strings or full referring URLs. Only permitted UTM parameters are processed within defined limits. Administrator, on-site staff, authentication callback, payment return, and account-page routes are excluded from this analytics collection.

Completed registration, payment, and cancellation statistics are based on existing service records rather than unverified completion events sent by a browser. Transaction identifiers are not duplicated into analytics events. Existing membership, booking, and payment records required to provide the service or comply with law remain subject to their existing purposes and retention periods, regardless of the analytics choice.

### Article 2-2 (Automatic Collection, Behavioral Information, and Choice) — new

1. First-party analytics begins only after the visitor provides optional consent. We use browser local storage to retain the analytics choice and a random visitor identifier, and tab-specific session storage to retain a session identifier. These values help distinguish repeat visits and a continuous service journey within our first-party analytics.
2. A session expires after 30 minutes of inactivity. The browser choice and visitor identifier are used for no more than 90 days from storage. They may be removed earlier by browser settings or deletion of site data.
3. You can decline analytics or withdraw previous consent at `[verified location/link for Visit analytics settings]`. Declining or withdrawing stops subsequent collection and transmission immediately and discards queued data. It also requests deletion of that visitor's existing records. The analytics identifiers are no longer used for collection; only the minimum identifiers needed to complete the deletion request may be retained temporarily. These are removed after server-side deletion is confirmed. Article 7 explains the process and status information.
4. Declining or withdrawing consent does not disadvantage your use of registration, sign-in, booking, or other core services. Choices apply to the browser/device where they are made. You can manage choices on other devices separately and contact us under Article 7 about records linked to those devices.
5. You can also use your browser's site-data deletion and storage-blocking controls. Deleting all site data may affect sign-in and other preferences. The service's analytics setting allows you to stop analytics specifically.

### Article 3 (Processing and Retention Period) — additional analytics periods

| Information | Retention/use period |
| --- | --- |
| Raw visit/interaction records, sessions, and Member acquisition links | Up to 90 days from the record or first-link time. Earlier withdrawal, completion of the purpose, or other grounds for erasure are handled under Articles 7 and 8. |
| Browser analytics choice and random visitor identifier | Up to 90 days from storage. They are no longer used for collection after refusal/withdrawal. Deletion-request identifiers are handled separately below; a minimal setting may remain to remember the refusal. |
| Tab session identifier | Expires after 30 minutes of inactivity; closing the tab or deleting browser storage may remove it earlier. |
| Temporary recent-activity marker | Up to five minutes after the last activity |
| Hourly/daily statistics with visitor, session, and Member identifiers removed | Up to 365 days from creation. Information from which a particular person can still be identified is not treated as non-identifying aggregate data under this category. |
| Hashed visitor marker used to prevent collection after withdrawal | Up to 90 days from withdrawal, solely to reject late-arriving events. It is not used for analytics or advertising. `[Necessity, separate processing basis, and period — legal confirmation]` |
| Browser visitor/session identifiers for a pending deletion request | Removed immediately after server-side deletion is confirmed. During a network failure, they are retained temporarily only to retry and track the request, not to collect new visits. `Maximum 90 days; prolonged failure handling and notification remain subject to legal and operational review` |

These are maximum periods proposed for first-party analytics, not statutory retention periods that apply to all analytics data. Data that is no longer necessary or reaches its retention limit is erased so that it cannot be recovered or reproduced. If separate consent/withdrawal evidence must be retained, we will disclose `[necessary items, legal basis, and retention period — subject to legal confirmation]`.

### Articles 5 and 6 (Outsourcing and Cross-Border Transfers) — information to confirm

First-party analytics data is intended to be processed in the service database managed by the Company. Before publication, the existing outsourcing/transfer tables must be updated to reflect verified cloud hosting, traffic delivery, contracts, and deployment arrangements:

`[Processor and subprocessor / task / countries of processing or storage / timing and method of access or transfer / items / purpose / retention / legal basis / refusal method and effect — confirm against contracts, deployment, and legal review]`

This amendment does not add external advertising pixels, GA4, PostHog, Clarity, or a new session-replay tool for first-party analytics. If such a tool is introduced later, its processing and legal basis will be reviewed separately and the necessary notices, consent, and choice mechanisms will be provided.

### Article 7 (Data Subject Rights and How to Exercise Them) — analytics rights

You may withdraw optional analytics consent at any time through `Visitor analytics settings in the site footer (/legal/analytics)`. Withdrawal immediately stops subsequent collection and automatically requests deletion of that visitor's raw records, sessions, and registration-acquisition links. The server deletes the relevant records and recalculates affected aggregates. Through this process, we take the necessary steps, including erasure, without delay. If a statutory exception requires retention or restricts a requested measure, we explain the applicable basis and reason and manage that information separately from records used for other purposes.

If a connection error prevents completion of the deletion request, analytics collection remains stopped. Only the minimum deletion-request identifiers are temporarily retained in the browser for retry and status checking, and a pending/failure status is shown. We do not display deletion as completed before the server confirms it. After confirmation, the deletion-request identifiers are removed. A separate marker may be retained for the period in Article 3 to prevent late events from recreating deleted records; it is not used for analytics or advertising.

Requests concerning access, correction, deletion, suspension, records linked to another device, or confirmation of withdrawal handling can be submitted to `privacy@heygrabit.com`. We may conduct the minimum verification necessary to protect your rights. If an identifier has already been deleted and records cannot be located, we explain the limitation and any available alternative process. Withdrawing analytics consent does not itself close your membership or cancel an existing booking.

`[Required before publication: verify that withdrawal receipt, server-record handling, failure recovery, and the support procedure are implemented and tested.]`

### Article 11 (Changes to the Privacy Policy) — revision entry

| Version | Effective date | Main changes |
| --- | --- | --- |
| `[confirmed version]` | `[effective date confirmed by legal review]` | Optional first-party visit/behavior analytics, Member acquisition links, automatic collection and refusal/withdrawal procedures, and retention periods |

The planned notice date is `[confirmed notice date]`. The notice period and publication method are `[legal confirmation]`. Previous versions, their applicable periods, and the changes will be made available for review.

## 동의 안내 문구 초안 / Draft consent notice

**[선택] 방문·행동 분석 허용**

Grabit은 방문 경로와 공연 탐색·가입·예매 흐름을 분석하여 서비스를 개선합니다. 동의하면 무작위 방문·세션 식별자, 페이지·캠페인 정보, 기기 등 접속 환경 구간과 제한된 이용 행동을 처리하며, 로그인·가입 시 회원 계정과 현재 세션을 연결할 수 있습니다. 원본·연결 자료는 최대 90일, 식별자를 제거한 집계는 최대 365일 보관합니다. 철회하면 수집을 멈추고 기존 기록 삭제를 요청하며, 재수집 차단용 표시는 최대 90일 유지할 수 있습니다. 동의하지 않거나 나중에 철회해도 회원가입과 예매를 이용할 수 있습니다. 자세한 항목·기간·철회 및 삭제 방법은 `[확정 처리방침 링크]`에서 확인하세요.

선택 버튼: **동의 / 동의하지 않음**. 설정 화면의 철회 버튼: **분석 동의 철회**.

**[Optional] Allow visit and behavior analytics**

Grabit uses analytics to improve referral, performance discovery, registration, and booking experiences. With your consent, we process random visitor/session identifiers, page and campaign information, categories of access environment, and limited interactions. When you sign in or register, we may link the current session to your Member account. Raw and linked information is retained for up to 90 days; statistics with identifiers removed are retained for up to 365 days. Withdrawal stops collection and requests deletion; a marker that prevents recollection may remain for up to 90 days. Declining or later withdrawing does not prevent registration or booking. See `[confirmed Privacy Policy link]` for the items, periods, and how to withdraw or request erasure.

Choice buttons: **Allow / Decline**. Settings withdrawal button: **Withdraw analytics consent**.

## 별도 발견 사항 — 이 개정안의 외부 도구 활성화 근거가 아님

- 현재 ko/en 처리방침에서 **Sentry 위탁·국외 이전 설명이 확인되지 않는다**. 실제 수신 법인·리전·재수탁·항목·보관·삭제·계약을 확인해 별도 정합성 검토가 필요하다. 임의의 수탁자명·국가·기간을 이 초안에 확정값으로 넣지 않는다.
- 현재 웹 코드에는 일반 replay 샘플링 0과 오류 replay 샘플링 1.0 설정이 있지만 `replayIntegration()` 등록은 발견되지 않았다. 실제 전송 여부는 운영 계정·번들로 확인하지 않았으므로 오류 replay가 이미 동작한다고 단정하지 않는다. [Sentry 공식 Next.js 설정](https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/)
- GCP 서울 데이터베이스 계획과 별개로 Cloudflare edge 및 클라우드 지원 접근·로그의 실제 처리를 확인해야 한다. 이 초안은 기존 외부 처리 현황을 전부 검증했다는 의미가 아니다.


## 구현 상한 확정(2026-11-11)

미완료 삭제요청의 브라우저 보관 상한은 90일이다. 삭제 성공을 서버에서 확인하기 전에는 삭제 완료로 표시하지 않는다. 미완료 상태에서는 분석을 다시 켤 수 없으며 저장한 식별자는 삭제 요청에만 사용한다. 보관 상한 경과는 서버 삭제 확인을 의미하지 않는다. 이 구현값에 대한 법무 검토는 필요하다.
