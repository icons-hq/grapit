---
status: resolved
trigger: "태국 번호로 회원가입 SMS 인증코드 발송을 시도했지만 코드가 전화번호로 전송되지 않았다는 사용자 보고"
created: 2026-05-12
updated: 2026-05-12
---

# Debug Session: Thai SMS Country Code

## Symptoms

expected: 회원가입 3단계에서 태국 휴대폰 번호를 입력하면 SMS OTP가 실제 태국 번호로 수신된다.
actual: 사용자는 인증코드가 전화번호로 전송되지 않았다고 보고했다.
errors: 사용자 관측상 SMS 미수신. Cloud Run `grabit-api`에는 `sms.send_failed` ERROR가 없고 `sms.sent`가 기록됨.
timeline: 2026-05-12 13:16-13:17 KST 무렵 재현.
reproduction: https://heygrabit.com/auth 회원가입 -> 전화번호 국가 선택 -> 인증번호 발송.

## Current Focus

hypothesis: 사용자가 태국 번호라고 의도했지만 실제 production API 요청은 Thailand `+66`이 아니라 Vietnam `+84`로 전송되었고, 기존 UI는 선택된 전화 국가의 calling code를 접힌 상태에서 명확히 보여주지 않아 국가 선택 실수를 만들기 쉬웠다.
test: Cloud Run request/stdout 로그와 browser route interception으로 실제 전송 body 비교.
expecting: production 로그에는 `+84...`가 남고, browser에서 태국을 정확히 선택하면 `/sms/send-code` body가 `+66...`으로 생성된다.
next_action: deploy 후 태국 번호로 production UAT를 재실행하고 Cloud Run `sms.sent` 로그가 `country: 'TH'`, `providerStatus`, `messageId`를 남기는지 확인한다. If any non-China international number is used intentionally, verify the request reaches Infobip and the country/provider fields are logged.
reasoning_checkpoint: root cause confirmed by Cloud Run logs, browser interception, and read-only gsd-debugger review
tdd_checkpoint: focused API/web specs and typechecks passed

## Evidence

- timestamp: 2026-05-12T04:16:41Z
  source: gcloud logging read
  finding: `POST https://api.heygrabit.com/api/v1/sms/send-code` returned HTTP 200.
  implication: API request itself succeeded.
- timestamp: 2026-05-12T04:16:42Z
  source: gcloud logging read
  finding: `SmsService` logged `event: 'sms.sent'` with phone `+84982291899`.
  implication: backend/provider path accepted a Vietnam `+84` destination, not a Thailand `+66` destination.
- timestamp: 2026-05-12T04:17:21Z
  source: gcloud logging read
  finding: second `POST /api/v1/sms/send-code` returned HTTP 200.
  implication: repeated user attempt followed the same accepted-send path.
- timestamp: 2026-05-12T04:17:22Z
  source: gcloud logging read
  finding: second `SmsService` log again used phone `+84982291899`.
  implication: the browser state submitted Vietnam country code consistently.
- timestamp: 2026-05-12T04:59:40Z
  source: browser route interception
  finding: selecting `태국 +66` in the phone country selector and entering the same local-style subscriber number produced request body `{ "phone": "+66982291899" }`.
  implication: the phone component can generate the correct Thai E.164 number when Thailand is selected; the production incident was a wrong country selection / visibility issue, not a provider rejection of a correct Thai number.
- timestamp: 2026-05-12T04:57-04:59Z
  source: browser + computer use
  finding: selected phone country button is visually compact and primarily flag-based; accessible label includes the country name, while the visible trigger does not show the calling code.
  implication: users can miss that the selected phone country is not Thailand.

## Eliminated

- hypothesis: Infobip rejected the send synchronously.
  reason: no `sms.send_failed` ERROR logs, request HTTP 200, and `sms.sent` logs for both attempts.
- hypothesis: frontend cannot generate Thai E.164.
  reason: browser interception produced `+66982291899` after selecting `태국 +66`.

## Resolution

root_cause: Production signup submitted a Vietnam `+84` E.164 phone number while the user intended Thailand `+66`; Infobip accepted the `+84` request, so the app treated it as sent. The old phone country trigger did not show the selected calling code in its collapsed state.
fix: Phone country selector now shows the selected calling code in the collapsed trigger and accessible name. Valid international E.164 numbers remain supported globally, while the pre-existing China mainland block remains unchanged. Successful provider accepts now log country/providerStatus/providerGroupId/messageId for future delivery tracing.
verification: |
  - `pnpm --filter @grabit/api typecheck` -> passed.
  - `pnpm --filter @grabit/web typecheck` -> passed.
  - `pnpm --filter @grabit/api exec vitest run src/modules/sms/phone.util.spec.ts src/modules/sms/sms.service.spec.ts` -> 98 tests passed after global-country correction, including Vietnam accepted.
  - `pnpm --filter @grabit/web exec vitest run components/ui/__tests__/phone-input-i18n.test.tsx components/auth/__tests__/phone-verification.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx` -> 37 tests passed after global-country correction.
  - Browser route interception on local dev verified selected `태국 +66` displays `국가 선택: 태국 +66` and submits `{ phone: "+66982291899" }` without sending a real SMS.
files_changed: |
  - apps/api/src/modules/sms/phone.util.ts
  - apps/api/src/modules/sms/phone.util.spec.ts
  - apps/api/src/modules/sms/sms.service.ts
  - apps/api/src/modules/sms/sms.service.spec.ts
  - apps/web/components/ui/phone-input.tsx
  - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
  - .planning/debug/thai-sms-country-code.md
