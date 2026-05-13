---
status: resolved
trigger: "태국 번호 사용자가 회원가입 테스트 중 전화번호 인증 단계에서 generic auth error page를 보고 번호 인증이 진행되지 않는다는 production 보고"
created: 2026-05-13T15:05:18+09:00
updated: 2026-05-13T16:44:00+09:00
---

# Debug Session: Thai Phone Auth Error

## Symptoms

expected: 태국 휴대폰 번호로 회원가입 전화번호 인증을 요청하면 production에서 SMS 인증번호 발송 및 인증 확인이 정상 진행되고, 회원가입 플로우가 계속된다.
actual: 사용자는 "An error occurred during authentication. Please try again after a while, or go back to home." generic auth error page를 보고 전화번호 인증이 되지 않는다고 보고했다.
errors: 스크린샷의 frontend auth error page 문구 외 raw error message는 아직 확인 전이다.
started: 2026-05-13 현재 production 사용자 테스트 중 보고.
reproduction: heygrabit.com 회원가입 플로우에서 태국 번호로 전화번호 인증 시도.

## Evidence

- Cloud Run production API is running project `grapit-491806`, service `grabit-api`, revision `grabit-api-00060-57b`, image tag `11b9912b432fac8170d5bc3fd38d9b804aaedf73`.
- Cloud Run production web is running service `grabit-web`, revision `grabit-web-00035-wbk`, image tag `11b9912b432fac8170d5bc3fd38d9b804aaedf73`.
- GitHub Actions CI for `origin/main` commit `11b9912` completed successfully before the deployed revisions.
- Production API log at `2026-05-13T05:04:35Z` shows `POST /api/v1/sms/send-code` returned `200`.
- The same API log emitted `sms.sent` with `phone: '+84982291899'`, `country: 'VN'`, `providerStatus: 'pending'`, `providerChannel: 'sms'`, and `verificationSid: 'VE87785064e5569c293b641fd68545b3e9'`.
- No matching `POST /api/v1/sms/verify-code` request appeared around the reported attempt, so the user likely never received/entered a code for verification.
- Twilio Verify Attempts for `VE87785064e5569c293b641fd68545b3e9` show one SMS attempt to masked destination `+84***99`, carrier `Mobile Viettel`, `errorCode: null`, `conversionStatus: unconverted`, price `USD 0.2852`.
- Current API code uses Twilio Verify (`apps/api/src/modules/sms/twilio-verify-client.ts`). Old Infobip Cloud Run env bindings still exist, but are not on the current send path.
- The screenshot matches the auth route error boundary in `apps/web/app/auth/error.tsx`; normal `PhoneVerification` send/check failures render inline status messages instead of navigating to that page.
- Production web logs also showed an unrelated but real Next image optimizer runtime error: `EACCES: permission denied, mkdir '/app/apps/web/.next/cache'`.

## Eliminated

- Twilio synchronous send failure: eliminated because Cloud Run returned 200, `sms.sent` was logged, and Twilio Attempt has no provider error.
- Cloud Run API crash on send-code: eliminated because `POST /api/v1/sms/send-code` completed with 200.
- Missing production Twilio configuration: eliminated because Twilio Verify created an SMS attempt under the configured service.
- Thailand provider outage as primary cause: not supported by evidence; the actual destination submitted to the provider was Vietnam country code `+84`, not Thailand `+66`.

## Resolution

root_cause: The signup flow submitted the Thai user's phone number as Vietnam E.164 (`+84...`) instead of Thailand E.164 (`+66...`). Twilio accepted and attempted delivery to the wrong country, so the tester could not complete OTP verification. The generic auth error page is a separate auth-segment fallback; the production web image-cache permission error could also surface generic route errors and was fixed as hardening.
fix: Default the phone input to Thailand on Thai locale, show a masked E.164 destination before sending OTP, include the masked destination in send/resend success messages, and pre-create the writable Next image cache directory in the web Docker image.
verification: `pnpm test`; `pnpm --filter @grabit/web exec vitest run components/ui/__tests__/phone-input-i18n.test.tsx components/auth/__tests__/phone-verification.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx components/auth/__tests__/auth-email-verification.test.tsx`; `pnpm --filter @grabit/web typecheck`; `pnpm --filter @grabit/web build`; `docker build -f apps/web/Dockerfile -t grabit-web-thai-hotfix:local .`; `docker run --rm grabit-web-thai-hotfix:local sh -c 'test -w /app/apps/web/.next/cache && id && ls -ld /app/apps/web/.next/cache'`.
files_changed:
  - apps/web/components/ui/phone-input.tsx
  - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
  - apps/web/components/auth/phone-verification.tsx
  - apps/web/components/auth/__tests__/phone-verification.test.tsx
  - apps/web/messages/ko.json
  - apps/web/messages/en.json
  - apps/web/messages/th.json
  - apps/web/messages/zh-CN.json
  - apps/web/messages/ja.json
  - packages/shared/src/i18n/launch-copy-keys.ts
  - packages/shared/src/i18n/launch-copy-keys.test.ts
  - apps/web/Dockerfile
