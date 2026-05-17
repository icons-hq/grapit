---
status: complete
quick_id: 260517-r9q
slug: social-email-bypass-hotfix
completed_at: 2026-05-17T10:46:00Z
branch: quick/260517-social-email-bypass-hotfix
---

# Signup Verification Bypass Hotfix Summary

## Completed

- Changed social registration completion to create social-only users with `isEmailVerified=true` and return auth tokens immediately.
- Changed existing social login to mark previously unverified social-linked users as email verified before issuing tokens.
- Changed signup SMS send/verify endpoints to skip the default IP throttler.
- Bypassed app-side SMS resend cooldown and phone-axis counters so launch traffic is not blocked locally.
- Preserved normal email/password signup email verification.
- Preserved Twilio provider validation/errors, including invalid/landline recipient handling and provider-level 429.

## Verification

- `pnpm --filter @grabit/api test src/modules/auth/auth.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/api test src/modules/auth/auth.controller.spec.ts`
- `pnpm --filter @grabit/api test src/modules/sms/sms.controller.spec.ts src/modules/sms/sms.service.spec.ts`
- `pnpm --filter @grabit/api build`
