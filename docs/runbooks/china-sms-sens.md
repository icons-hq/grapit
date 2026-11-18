# 중국(+86) SENS OTP 설정과 전환

2026-11-18 작성. 코드 구현·로컬 검증과 운영 복구를 구분한다. 계정 개설, 과금 설정, 외부 발송, Secret Manager/운영 설정 및 배포는 승인된 범위에서 실행한다.

## 확인된 근거와 남은 조건

Twilio 지원 티켓 #30420943은 중국 규제·통신사 차단으로 정상 트래픽도 안정적으로 전달하기 어렵고 복구 일정이 없다고 답했다. 사용자가 전달한 SENS 고객지원 답변(문의 `W20261118385235`, 답변 `A20261118391085`)은 중국 국제 SMS를 별도 신청 없이 이용할 수 있고, OTP 및 `[{회사명}] verification: {숫자}` 형식만 허용된다고 확인했다. 발신번호는 수신자에게 임의 번호로 표시될 수 있다.

이 답변은 SENS 계정 생성이나 SMS 프로젝트·발신번호 등록을 대신하지 않는다. 중국 3대 통신사의 개별 수신 품질, 시험 지원, 정확한 요금은 이번 답변에서 확정되지 않았다. 현재 동의한 중국 시험 단말과 SENS 계정은 확보되지 않았다. 공급자 접수 성공은 실제 단말 수신을 보장하지 않는다. [국제 SMS 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy)

## 설정

중국 번호만 별도로 선택하며, 한국·태국 등 나머지 번호는 기존 Twilio Verify를 사용한다. DB schema 변경은 없다.

| 설정 | 위치 / 용도 |
| --- | --- |
| `SMS_CN_PROVIDER` | GitHub repository variable. `twilio` 기본값, 검증·전환 시 `sens`. 정확한 소문자 값 사용 |
| `NCP_SENS_SMS_SERVICE_ID` | Repository variable. SENS SMS 프로젝트의 서비스 ID |
| `NCP_SENS_SMS_FROM` | Repository variable. SENS에 등록된 숫자 발신번호. 중국 수신 화면에서 바뀌어 보이는 번호를 입력하지 않음 |
| `NCP_SENS_SMS_COMPANY_NAME` | Repository variable. 기본 `ICONS`. 영문·숫자·공백·`_`·`-`, 40자 이내. 고객지원이 허용한 회사명 사용 |
| `NCP_SENS_ACCESS_KEY` | Secret Manager `ncp-sens-access-key:latest`에 연결 |
| `NCP_SENS_SECRET_KEY` | Secret Manager `ncp-sens-secret-key:latest`에 연결 |
| `SMS_VERIFICATION_TOKEN_SECRET` / `JWT_SECRET` | 기존 인증 증명 비밀키로 목적을 분리한 HMAC을 생성. 모든 API revision에서 동일해야 함 |

네이버클라우드 기업 계정과 SENS SMS 프로젝트를 만들고 발신번호 등록을 완료한 뒤 API 인증키를 준비한다. 키는 채팅·Git·로그에 남기지 않고 기존 Secret Manager 절차로 등록하며, API 실행 서비스 계정의 해당 secret 접근 권한을 확인한다. 기업 발신번호 등록 서류는 [공식 FAQ](https://www.ncloud.com/support/faq/all/2048)를 따른다.

`sens`일 때는 Twilio 자격도 계속 필요하다. 필수 SENS 값 누락·잘못된 형식은 API 기동 실패로 처리한다. Deploy preflight는 `sens` 전환 시 서비스 ID·발신번호를 요구한다. `twilio` 배포에는 SENS secret이 없어도 되며, 기존 secret이 남아 있어도 사용하지 않는다. 공급자를 전환하는 동안 인증 비밀키를 동시에 교체하지 않는다.

## 코드 동작과 실패 처리

- `send-code`는 기존 국가 제한, 번호별 제한, 전체 분당·시간당 예산을 먼저 적용한다. SENS는 +86 휴대전화만 받는다.
- OTP는 안전한 난수 6자리이며 Valkey에는 전화번호·임의 nonce와 결합한 HMAC만 저장한다. 평문은 발송 중 메모리에만 존재한다. TTL은 10분이다.
- 발송 전에 후보 코드를 저장한다. 준비 실패는 발송 없이 예산을 돌려준다. 발송 직렬화 lease는 30초, HTTP timeout은 10초다.
- HTTP 202와 정상 응답을 함께 확인하면 후보 코드를 활성화한다. 기존 코드는 새 발송이 확정 수락될 때 교체한다. 명시적인 4xx 거절은 새 후보만 삭제해 기존 코드를 보존한다.
- timeout·네트워크·5xx·정상 형식이 아닌 응답은 이미 발송됐을 수 있다. 자동 재시도나 Twilio fallback을 하지 않고 예산과 후보를 유지한다. `SMS_SEND_OUTCOME_UNKNOWN` 응답은 코드 입력칸을 열고 후보의 남은 TTL 동안 재발송을 막는다. 문자를 못 받은 경우 최대 10분 대기가 생길 수 있다.
- 발송 API 수락 후 Valkey commit 응답을 잃어도 저장된 후보로 인증할 수 있다. 코드가 이미 사용됐다면 늦은 commit으로 되살리지 않는다.
- 검증은 번호별 15분간 10회, 재발송으로 초기화하지 않는다. SENS에는 관리형 OTP 보호가 없으므로 `SMS_LOCAL_RATE_LIMITS_ENABLED=false`여도 이 검증 제한과 발송 직렬화는 유지한다.
- 성공 시 코드를 한 번만 소비하고 기존 목적별 단회 사용 `verificationToken`을 발급한다. 인증 성공과 계정 생성 성공은 별개다.

## 최초 전환 순서

1. **호환 코드 선배포:** 승인을 받은 배포에서 이 API와 웹 변경을 먼저 `SMS_CN_PROVIDER=twilio`로 배포한다. API/Web가 호환 revision에 100% 도달했는지 확인한다. SENS를 모르는 이전 API와 활성 SENS를 동시에 운영하지 않는다.
2. **계정·인증키·발신번호 준비:** 위 값과 secret 접근 권한을 확인한다. `SMS_ALLOWED_COUNTRIES`가 설정되어 있다면 `CN` 포함 여부를 확인한다. 발송 비용 한도와 알림을 계정에서 확인한다. 예산 수치는 현재 행사 규모에 맞춰 승인된 값으로 정한다.
3. **동의한 단말 시험:** 승인된 별도 시험 환경에서 본토 +86 단말로 발송 → 실제 수신 → 코드 검증 → 가입을 확인한다. 한국 번호가 Twilio를 계속 사용하는지도 확인한다. 가능하면 China Mobile/Unicom/Telecom 각각 시험한다. 시험 단말이 없으면 이 단계를 통과했다고 기록하지 않는다.
4. **운영 활성화:** 검증 근거와 전환 승인을 확보한 후 `SMS_CN_PROVIDER=sens`를 설정해 승인된 Deploy workflow로 반영한다. API와 Web health, revision SHA/traffic, 런타임 provider 설정을 readback한다. 로그 `provider: naver_sens`와 실제 가입 결과를 대조한다.
5. **전환 중 기존 코드:** live Twilio marker가 있으면 SENS 새 발송은 `429 SMS_RESEND_COOLDOWN`으로 기존 만료까지 기다린다. 받은 Twilio 코드는 새 revision에서도 검증된다. 기존 marker를 강제로 삭제하거나 실제 가입자 번호로 시험하지 않는다.

## 결과 조회와 미수신 조사

| 증거 | 확인할 내용 | 의미 |
| --- | --- | --- |
| 앱 `sms.sent` + `requestId` | SENS API 202 수락 | 요청 접수만 확인 |
| SENS 목록/결과 조회 | requestId → messageId, `status`, `statusCode`, `statusName`, 완료 시각·통신사 | 공급자 처리 결과. 해외 통신사 인계 성공도 실제 수신과 다를 수 있음 |
| 사용자 단말 수신 | 수신 시각·발신 표시·코드 입력 가능 | 실제 수신 증거 |
| 앱 `sms.verified` + 가입 결과 | 토큰 검증 및 계정 생성 성공 | 가입 복구 증거 |

`requestId`로 [발송 목록 조회](https://api.ncloud-docs.com/docs/sens-sms-list)에서 `messageId`를 얻고 [결과 조회](https://api.ncloud-docs.com/docs/sens-sms-get)로 개별 상태를 확인한다. 상위 `200 success`는 조회 성공이며 개별 메시지 성공과 구분한다. 이 변경에는 결과 자동 polling이 포함되지 않는다. 조회 응답에는 수신번호·OTP 본문이 포함될 수 있으므로 원문을 로그나 티켓에 붙이지 않는다.

`sms.send_failed`의 `provider: naver_sens` 및 Sentry의 `sens.status`, `sens.outcome`을 확인한다. OTP·인증키는 기록하지 않는다. 미수신 문의는 마스킹한 고객 식별 정보, requestId/messageId, 시간대·결과코드를 준비한다. 해외 통신사는 보통 7일 이내 로그만 보관하므로 신속히 조사한다. [공식 정책](https://guide.ncloud-docs.com/docs/sens-smspolicy)

## 되돌리기

호환 코드가 있는 현재 버전에서 `SMS_CN_PROVIDER=twilio`로 설정해 승인된 workflow로 배포한다. SENS 코드가 남아 있으면 만료·소비 전까지 새 Twilio 발송을 기다리고, 검증은 기존 SENS 상태로 처리한다. SENS를 모르는 과거 바이너리로 즉시 되돌리면 이미 수신한 코드를 검증할 수 없으므로, 모든 SENS challenge가 만료된 뒤에만 검토한다. Twilio로 되돌리는 것은 SENS 사용 중단이며, Twilio 중국 경로의 수신 장애를 복구했다는 뜻은 아니다.

## 로컬 검증

```sh
pnpm --filter @grabit/api exec vitest run src/modules/sms/naver-sens-client.spec.ts src/modules/sms/sms.service.spec.ts src/common/observability/sentry-redaction.parity.spec.ts
pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/sens-sms.integration.spec.ts
pnpm --filter @grabit/web exec vitest run components/auth/__tests__/phone-verification.test.tsx components/auth/__tests__/auth-email-verification.test.tsx
pnpm --filter @grabit/shared exec vitest run src/i18n/launch-copy-keys.test.ts
node --test scripts/managed-demo/deploy-guards.test.mjs
```

통합 테스트는 전용 임시 Valkey 클러스터를 만들며 모든 외부 발송 호출을 가로챈다. 서명·템플릿, 만료·재발송·추측 제한·동시 소비·전환, 목적별 단회 토큰을 검증한다. API/Web 타입 검사와 변경 파일 lint, 실제 중국어 가입 화면의 1280×900 및 390×844 렌더링도 확인한다. 로컬 통과는 실제 중국 SMS 수신 증거가 아니다.
