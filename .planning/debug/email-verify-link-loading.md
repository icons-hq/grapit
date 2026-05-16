---
status: resolved
trigger: "Email verification link uses localhost:3000 and verification page can remain loading after logging in without email verification."
created: "2026-05-17T00:00:00+09:00"
updated: "2026-05-17T00:06:00+09:00"
---

# Debug Session: email-verify-link-loading

## Symptoms

- Expected behavior: Verification emails should point to the active frontend origin, and the verification page should not sit in a loading resend state after login.
- Actual behavior: The received verification link points to `http://localhost:3000/auth/verify-email?token=...`; after completing signup without email verification and logging in again, the email verification page shows `다시 보내는 중...` indefinitely.
- Error messages: No explicit UI error in the screenshot; local curl shows email verification request can be rate-limited with `TRAFFIC_RATE_LIMITED`.
- Timeline: Started after adding login-before-email-verification routing and email-query verification page flow.
- Reproduction: Signup without clicking verification email, login again, land on `/auth/verify-email?email=...`; click or wait for verification email flow.

## Current Focus

- hypothesis: Email link generation always uses backend `FRONTEND_URL`, which is currently `http://localhost:3000`, and the email-query verification page auto-sends a new request on mount, leaving users in loading state while mail/rate-limit/network work is pending.
- test: Inspect link-generation code, `.env`, and browser/API behavior for `/auth/verify-email?email=...`.
- expecting: Link base comes from `FRONTEND_URL`; frontend auto request uses `requestOnMount`.
- next_action: Completed. Continue with ship/deploy if production rollout is required.

## Evidence

- timestamp: "2026-05-17T00:00:00+09:00"
  observation: `.env` contains duplicate `FRONTEND_URL=http://localhost:3000`, and `AuthService.issueEmailVerificationForUser()` builds `${FRONTEND_URL}/auth/verify-email?token=...`.
- timestamp: "2026-05-17T00:00:00+09:00"
  observation: `/auth/verify-email?email=...` renders `EmailVerificationStatus` with `requestOnMount`, causing the UI to enter `loading` immediately.
- timestamp: "2026-05-17T00:00:00+09:00"
  observation: Local request to `/api/v1/auth/email-verification/request` returned `429 TRAFFIC_RATE_LIMITED`, so automatic resend can immediately fight throttling.
- timestamp: "2026-05-17T00:06:00+09:00"
  observation: Browser verification of `/auth/verify-email?email=network@example.com` showed no email-verification API request on page load, then one manual resend POST containing `frontendOrigin: "http://localhost:3001"`.
- timestamp: "2026-05-17T00:06:00+09:00"
  observation: API unit coverage verifies local `http://localhost:3001` origins are allowed in development, untrusted origins are ignored, and production falls back to configured `https://heygrabit.com`.

## Eliminated

- hypothesis: Token verification endpoint itself is missing.
  reason: `/auth/verify-email?token=...` already routes to `EmailVerificationStatus` token verification; the reported URL base is the observed problem.

## Resolution

- root_cause: Email verification and reset links were derived only from backend `FRONTEND_URL`, while the local frontend was actually running on a different origin. Separately, `/auth/verify-email?email=...` auto-requested another verification email on mount, so a slow send or rate limit left the user seeing the resend loading state.
- fix: Added a guarded frontend-origin resolver for auth email links, passed the browser origin from signup/social completion/email resend/password reset requests, and removed automatic resend from the email-query verification page.
- verification: API typecheck, web typecheck, full Vitest suites triggered by the targeted auth commands, `git diff --check`, Browser snapshot, and headless Playwright network interception all passed.
- files_changed:
  - apps/api/src/modules/auth/auth.service.ts
  - apps/api/src/modules/auth/auth.controller.ts
  - apps/api/src/modules/auth/dto/register.dto.ts
  - apps/api/src/modules/auth/dto/social-register.dto.ts
  - apps/api/src/modules/auth/dto/reset-password.dto.ts
  - apps/web/lib/frontend-origin.ts
  - apps/web/components/auth/email-verification-status.tsx
  - apps/web/components/auth/signup-form.tsx
  - apps/web/app/auth/callback/page.tsx
  - apps/web/app/auth/reset-password/page.tsx
  - apps/web/app/auth/verify-email/page.tsx
