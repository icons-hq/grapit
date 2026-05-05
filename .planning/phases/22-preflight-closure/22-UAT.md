---
status: diagnosed
phase: 22-preflight-closure
source:
  - .planning/phases/22-preflight-closure/22-01-SUMMARY.md
  - .planning/phases/22-preflight-closure/22-02-SUMMARY.md
  - .planning/phases/22-preflight-closure/22-03-SUMMARY.md
  - .planning/phases/22-preflight-closure/22-04-SUMMARY.md
  - .planning/phases/22-preflight-closure/22-05-SUMMARY.md
started: 2026-05-05T18:33:12+09:00
updated: 2026-05-05T18:40:03+09:00
mode: automated-production-cli-and-browser
targets:
  web: https://heygrabit.com
  api: https://api.heygrabit.com
  cloud_run_api_revision: grabit-api-00027-nxq
  cloud_run_web_revision: grabit-web-00027-twt
---

# Phase 22 Production UAT

User instruction: automate CLI and browser testing against production, not local.

Safety boundary: no real SMS was sent, no known production user password was reset, and no unredacted OTP, phone, reset token, cookie, bearer header, provider secret, or mailbox screenshot is recorded here. SMS tests used reserved/safe numbers only where no SMS send occurs.

## Current Test

[testing complete]

## Tests

### 1. Production API Health And Redis Cluster
expected: `GET https://api.heygrabit.com/api/v1/health` returns HTTP 200 with `status=ok` and Redis cluster status up.
result: pass
observed: HTTP 200 in 125ms; body reported `redis.mode=cluster`, `client=ioredis-cluster`, `configured=true`, `status=up`.

### 2. Production Public Catalog APIs
expected: public catalog endpoints return live JSON data from production.
result: pass
observed: `/api/v1/home/banners`, `/api/v1/home/hot`, and `/api/v1/performances?genre=musical&page=1&limit=4` returned HTTP 200 with banner/performance data.

### 3. Legal Public URLs, Canonical, Robots, And Contact Content
expected: `/legal/terms`, `/legal/privacy`, and `/legal/marketing` return HTTP 200, correct canonical URLs, `robots=index, follow`, and required legal/contact content.
result: pass
observed: all three pages returned HTTP 200. Canonicals matched `https://heygrabit.com/legal/{slug}`. Robots metadata was `index, follow`. Terms contained `support@heygrabit.com`; privacy contained `privacy@heygrabit.com` and support contact.

### 4. Browser Home And Footer Links
expected: real browser opens production home, renders catalog sections, and footer links route to legal pages plus `mailto:support@heygrabit.com`.
result: pass
observed: Playwright browser rendered home with HOT/new performance sections and footer links for 이용약관, 개인정보처리방침, and 고객센터.

### 5. Browser Mobile Legal Rendering
expected: legal content remains readable on mobile viewport with no obvious overlap from fixed bottom navigation.
result: pass
observed: Playwright mobile viewport `390x844` rendered `/legal/terms` with readable headings/body and fixed bottom navigation. Screenshot artifact: `.planning/phases/22-preflight-closure/artifacts/phase22-legal-terms-mobile.png`.

### 6. Password Reset Request UI And Production API Origin
expected: browser submission on `/auth/reset-password` posts to production API and shows generic success copy without exposing whether the email exists.
result: pass
observed: Playwright submitted `phase22-browser-uat@example.invalid`; network showed `POST https://api.heygrabit.com/api/v1/auth/password-reset/request => 200`, and the UI showed 비밀번호 재설정 메일 발송 완료.
caveat: this proves frontend/API origin and enumeration-safe copy only. It does not prove inbox delivery, Resend provider id, or Gmail receipt.

### 7. Password Reset Invalid Token Confirm UI
expected: invalid reset token confirm posts to production API and shows the invalid/expired link copy.
result: pass
observed: Playwright submitted `invalid-token` with a valid password shape; network showed `POST https://api.heygrabit.com/api/v1/auth/password-reset/confirm => 401`, and the UI showed 유효하지 않은 링크.

### 8. SMS Expired/No-OTP Verify Copy Without Sending SMS
expected: verifying a valid reserved number with no active OTP returns HTTP 410 and Korean expired/resend copy.
result: pass
observed: `POST /api/v1/sms/verify-code` with a reserved valid E.164 number returned HTTP 410 and `인증번호가 만료되었습니다. 재발송해주세요`.

### 9. SMS Invalid International Number Handling
expected: invalid phone numbers that pass broad E.164 regex are handled as user-facing validation errors, not production 500s.
result: issue
reported: "Production `POST /api/v1/sms/verify-code` and `POST /api/v1/sms/send-code` returned HTTP 500 for an invalid-but-regex-valid international number. Cloud Run stderr showed `Error: 올바른 휴대폰 번호를 입력해주세요` from `parseE164`, then an uncaught exception stack at `SmsService.verifyCode` / `SmsController.verifyCode`."
severity: major

### 10. Full Production Valkey Smoke Script
expected: full `scripts/smoke-valkey-production.mjs` can run against production with operator-approved auth header and safe booking fixtures.
result: blocked
blocked_by: third-party
reason: "The script intentionally requires `GRABIT_SMOKE_AUTH_HEADER_FILE`, `GRABIT_SMOKE_PERFORMANCE_ID`, `GRABIT_SMOKE_SHOWTIME_ID`, and `GRABIT_SMOKE_SEAT_ID`. These production-safe fixtures were not available in the workspace, so running full lua/socketio/idle checks would be unsafe."

### 11. Cloud Run Provider Observation Window
expected: recent production logs show no `CROSSSLOT`, `sms.verify_failed`, `provider=valkey`, or Resend/email-service provider failures around the automated UAT window.
result: pass
observed: Cloud Logging queries for the production API service over the checked window returned zero matching `CROSSSLOT` / `sms.verify_failed` / `provider=valkey` entries and zero matching Resend/email-service provider failures.
caveat: Sentry dashboard observation was not performed because no Sentry MCP/app tool was available in this session.

## Browser Console Observations

- Production pages repeatedly logged `POST https://api.heygrabit.com/api/v1/auth/refresh => 401` for an unauthenticated browser session. This did not block visible flows, but it is noisy browser telemetry.
- One early browser session observed `/favicon.ico => 404`. This is non-blocking but worth cleaning up separately.

## Summary

total: 11
passed: 9
issues: 1
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "Invalid phone numbers that pass broad E.164 regex are handled as user-facing validation errors, not production 500s."
  status: failed
  reason: "Production returned HTTP 500 for invalid-but-regex-valid international SMS phone input; Cloud Run stderr showed `parseE164` throwing a plain Error that escaped as an internal server error."
  severity: major
  test: 9
  root_cause: "`sendCodeSchema` accepts broad E.164-like values and `verifyCodeSchema` only requires a non-empty phone. Both `SmsService.sendVerificationCode()` and `SmsService.verifyCode()` call `parseE164()` without converting its plain `Error('올바른 휴대폰 번호를 입력해주세요')` into `BadRequestException` or Zod validation output, so Nest treats the validation failure as an unhandled 500."
  artifacts:
    - path: "apps/api/src/modules/sms/phone.util.ts"
      issue: "`parseE164()` throws a plain Error for invalid libphonenumber results."
    - path: "apps/api/src/modules/sms/sms.service.ts"
      issue: "`sendVerificationCode()` and `verifyCode()` call `parseE164()` before user-facing exception normalization."
    - path: "apps/api/src/modules/sms/sms.controller.ts"
      issue: "Controller schemas allow invalid-but-regex-valid international numbers to reach service parsing."
    - path: "Cloud Logging"
      issue: "Production `grabit-api-00027-nxq` recorded 500 requests for `/api/v1/sms/verify-code` and `/api/v1/sms/send-code` during this UAT."
  missing:
    - "Normalize `parseE164()` validation failures to `BadRequestException('올바른 휴대폰 번호를 입력해주세요')` before provider/Valkey work."
    - "Add API/service tests for invalid-but-regex-valid international numbers on both `send-code` and `verify-code`."
    - "Keep the valid no-OTP verify path returning HTTP 410."
  debug_session: ""

## Gap Closure Plan

Ready for `$gsd-execute-phase 22 --gaps` or a small `$gsd:quick` fix:

1. Add a small phone-normalization wrapper in the SMS service layer, or make the controller schemas refine with `parseE164()`, so invalid libphonenumber inputs become HTTP 400.
2. Use the same normalized phone handling in both `sendVerificationCode()` and `verifyCode()` before any Valkey counter, OTP, cooldown, or Infobip work.
3. Add targeted regression tests:
   - `send-code` with a regex-valid but invalid E.164 number returns HTTP 400 with `올바른 휴대폰 번호를 입력해주세요`.
   - `verify-code` with the same invalid number returns HTTP 400 with the same copy.
   - `verify-code` with a valid reserved number and no OTP still returns HTTP 410 expired/resend copy.
   - invalid `send-code` does not call Infobip or write OTP state.
4. Verify locally with targeted API tests, deploy, and rerun the production UAT checks for tests 8 and 9.
