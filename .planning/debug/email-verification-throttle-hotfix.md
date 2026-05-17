---
status: resolved
trigger: "Production email verification code entry and resend both show the throttled copy."
created: "2026-05-17T20:12:00+09:00"
updated: "2026-05-17T20:12:00+09:00"
---

# Debug Session: email-verification-throttle-hotfix

## Symptoms

- Expected behavior: Users can submit a received email verification code and resend a code during signup verification.
- Actual behavior: Both code submission and resend show `잠시 후 다시 시도해주세요.`
- Production evidence: Cloud Run request logs for `grabit-api-00100-zld` showed repeated `429` responses for `POST /api/v1/auth/email-verification/verify` and `POST /api/v1/auth/email-verification/resend` from `https://heygrabit.com`.

## Resolution

- root_cause: Email verification endpoints still used IP-based Nest `@Throttle` limits. During launch traffic behind Cloudflare/shared IPs, the global/default throttler blocked the signup verification path before auth service code validation or resend logic could run.
- fix: Added `@SkipThrottle()` to `email-verification/request`, `email-verification/resend`, and `email-verification/verify`, matching the production SMS signup throttle hotfix pattern while leaving token/code validation behavior unchanged.
- verification: `pnpm --filter @grabit/api test -- src/modules/auth/auth.controller.spec.ts src/modules/traffic/traffic-defense.service.spec.ts src/modules/sms/sms.controller.spec.ts` passed 69 files / 711 tests. `pnpm --filter @grabit/api typecheck` passed.
- files_changed:
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/auth/auth.controller.spec.ts
