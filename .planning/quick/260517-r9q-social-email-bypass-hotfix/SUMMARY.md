---
status: complete
quick_id: 260517-r9q
slug: social-email-bypass-hotfix
completed_at: 2026-05-17T10:40:00Z
branch: main
---

# Social Email Bypass Hotfix Summary

## Completed

- Changed social registration completion to create social-only users with `isEmailVerified=true` and return auth tokens immediately.
- Changed existing social login to mark previously unverified social-linked users as email verified before issuing tokens.
- Preserved normal email/password signup email verification.

## Verification

- `pnpm --filter @grabit/api test src/modules/auth/auth.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/api test src/modules/auth/auth.controller.spec.ts`
- `pnpm --filter @grabit/api build`
