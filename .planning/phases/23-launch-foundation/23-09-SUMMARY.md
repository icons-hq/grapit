---
phase: 23-launch-foundation
plan: 09
subsystem: auth
tags: [auth, email-verification, sms-otp, i18n, next-intl, vitest]

requires:
  - phase: 23-launch-foundation
    provides: Email verification and refresh-family API behavior from 23-06
  - phase: 23-launch-foundation
    provides: Shared launch copy manifest from 23-15
provides:
  - Five-locale auth email verification, OTP, and auth error/status copy
  - Email verification status component with request/resend/verify state handling
  - Token-backed `/auth/verify-email` web route
  - Login and signup wiring for email verification and device-limit status visibility
affects: [phase-23, web-auth, sms-otp, email-verification, shared-i18n]

tech-stack:
  added: []
  patterns:
    - Auth UI copy resolves from five-locale message JSON through a small locale fallback helper
    - Email verification API calls use `showErrorToast: false` and map server failures to safe localized states
    - TDD RED/GREEN commits enforce launch copy and UI state coverage

key-files:
  created:
    - apps/web/app/auth/verify-email/page.tsx
    - apps/web/components/auth/auth-launch-copy.ts
    - apps/web/components/auth/email-verification-status.tsx
    - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
  modified:
    - apps/web/components/auth/phone-verification.tsx
    - apps/web/components/auth/login-form.tsx
    - apps/web/components/auth/signup-form.tsx
    - apps/web/messages/ko.json
    - apps/web/messages/en.json
    - apps/web/messages/th.json
    - apps/web/messages/zh-CN.json
    - apps/web/messages/zh-TW.json
    - packages/shared/src/i18n/launch-copy-keys.ts
    - packages/shared/src/i18n/launch-copy-keys.test.ts
    - packages/shared/src/types/auth.types.ts

key-decisions:
  - "Auth/email/OTP UI copy is sourced from `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json` and checked against the shared launch copy manifest."
  - "Email verification UI suppresses raw server/provider messages and maps throttled, expired, verified, and system states to safe localized copy."
  - "The backend-sent `/auth/verify-email?token=...` link now has a web route that verifies the opaque token without rendering it."

patterns-established:
  - "Use `getAuthLaunchCopy(locale)` for auth UI status copy instead of hardcoded Korean status strings."
  - "Use `role=\"alert\"` for expired/error auth states and `aria-live=\"polite\"`/`role=\"status\"` for sent/resend/verified states."

requirements-completed: [I18N-02, AUTH-01, AUTH-02]

duration: 13m15s
completed: 2026-05-06
---

# Phase 23 Plan 09: Auth Verification UI Copy Summary

**Email verification, SMS OTP, and auth status UI now expose distinguishable five-locale launch states backed by shared copy-key tests.**

## Performance

- **Duration:** 13m15s
- **Started:** 2026-05-06T06:54:42Z
- **Completed:** 2026-05-06T07:07:57Z
- **Tasks:** 1 TDD task
- **Files modified:** 15

## Accomplishments

- Added `EmailVerificationStatus` for sent, resend loading/success, expired, verified, throttled, and system-error states.
- Added `/auth/verify-email` so API-generated email verification links have a token-backed web UI.
- Localized `auth.emailVerification`, `auth.otp`, and `auth.errors` in all five launch locales.
- Updated `PhoneVerification` to use localized OTP state copy for send/resend/loading/success/expired/invalid/throttled/system states.
- Updated login/signup surfaces to display email verification and three-device policy status copy.

## Task Commits

1. **Task 1 RED: Auth verification copy/UI tests** - `c8c2b77` (test)
2. **Task 1 GREEN: Localized auth verification states** - `c8fe69b` (feat)

## Files Created/Modified

- `apps/web/app/auth/verify-email/page.tsx` - Token-backed email verification page.
- `apps/web/components/auth/auth-launch-copy.ts` - Locale fallback helper for auth UI copy.
- `apps/web/components/auth/email-verification-status.tsx` - Email verification state UI and safe API error mapping.
- `apps/web/components/auth/__tests__/auth-email-verification.test.tsx` - Message namespace and email verification UI state coverage.
- `apps/web/components/auth/phone-verification.tsx` - Localized OTP status copy and `role="alert"` expired/error states.
- `apps/web/components/auth/login-form.tsx` - Localized auth error/status mapping and device-limit notice toast/status.
- `apps/web/components/auth/signup-form.tsx` - Requests email verification after signup and renders the verification status component.
- `apps/web/messages/*.json` - Five-locale auth email/OTP/error namespaces.
- `packages/shared/src/i18n/launch-copy-keys.ts` - Shared manifest aligned to the Plan 23-09 auth copy contract.
- `packages/shared/src/types/auth.types.ts` - Optional `deviceLimitNotice` on `AuthResponse`.

## Decisions Made

- Reused message JSON as the UI source of truth rather than duplicating auth copy in components.
- Kept backend/server raw error strings out of email verification UI to avoid leaking provider or token context.
- Preserved the existing special-case China mainland SMS validation message while localizing generic OTP invalid/throttled/system states.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added token-backed verify-email route**
- **Found during:** Task 1 GREEN implementation
- **Issue:** The API sends links to `/auth/verify-email?token=...`, but the web app had no route for that link, so the new email verification status UI would not be reachable from real email.
- **Fix:** Added `apps/web/app/auth/verify-email/page.tsx` using `EmailVerificationStatus` with opaque token verification.
- **Files modified:** `apps/web/app/auth/verify-email/page.tsx`
- **Verification:** `pnpm --filter @grabit/web test -- auth-email-verification.test.tsx phone-verification.test.tsx` passed.
- **Committed in:** `c8fe69b`

**2. [Rule 2 - Missing Critical] Added device-limit notice to shared auth response type**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Plan 23-06 API returns `deviceLimitNotice`, but the shared web `AuthResponse` type did not expose it, preventing typed UI handling of the D-15 three-device notice.
- **Fix:** Added optional `deviceLimitNotice?: string` and mapped it in `LoginForm`.
- **Files modified:** `packages/shared/src/types/auth.types.ts`, `apps/web/components/auth/login-form.tsx`
- **Verification:** `pnpm --filter @grabit/shared typecheck` and targeted web auth tests passed.
- **Committed in:** `c8fe69b`

---

**Total deviations:** 2 auto-fixed (Rule 2: 2)  
**Impact on plan:** Both fixes were required to make the planned UI states reachable and type-safe. No unrelated architecture or service behavior was changed.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` still fails on the known out-of-scope `SignupStep2` `consentItems` error from Plan 23-07. This plan did not change that contract; Plan 23-10 owns the itemized signup consent UI and submit payload.
- `@grabit/web` test script still runs the full Vitest suite even when file names are passed after `--`; the full suite passed with existing jsdom warning output.

## Known Stubs

None. Stub scan found only intentional form placeholders and timer cleanup `null` assignments in touched auth components.

## Auth Gates

None.

## Threat Flags

None. The new email verification route and API calls are within the plan's browser UI -> auth/email/SMS API trust boundary, and raw token/provider details are not rendered.

## Verification

- `pnpm --filter @grabit/web test -- auth-email-verification.test.tsx phone-verification.test.tsx` - PASS, 38 files / 265 tests due existing web script behavior.
- `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts` - PASS, 3 files / 26 tests due shared script behavior.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/web lint` - PASS with 23 pre-existing warnings and 0 errors.
- `grep -R "인증 메일 다시 보내기" apps/web/components/auth apps/web/messages/ko.json && test -f apps/web/messages/zh-TW.json` - PASS.
- `pnpm --filter @grabit/web typecheck` - FAIL, known out-of-scope `apps/web/components/auth/signup-step2.tsx(66,16)` missing `consentItems`.

## TDD Gate Compliance

- RED commit present: `c8c2b77`
- GREEN commit present after RED: `c8fe69b`
- Refactor commit: Not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 23-10 to replace the temporary legacy signup consent payload with itemized `consentItems`. Downstream auth UI should use `getAuthLaunchCopy(locale)` for status copy instead of adding new hardcoded Korean strings.

## Self-Check: PASSED

- Key created and modified files exist on disk.
- Task commits `c8c2b77` and `c8fe69b` exist in git history.
- No unexpected tracked file deletions were introduced.
- Known typecheck failure is the pre-declared Plan 23-10 `SignupStep2` `consentItems` gap, not a 23-09 regression.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
