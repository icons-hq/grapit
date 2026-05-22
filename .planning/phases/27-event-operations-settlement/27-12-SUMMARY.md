---
phase: 27-event-operations-settlement
plan: 12
subsystem: field-operations
tags: [nextjs, react-query, qr-check-in, scanner, auth-return, playwright, vitest]

requires:
  - phase: 27-event-operations-settlement
    provides: [QR ticket issue/deep-link contract, field operations schemas, admin capability model]
provides:
  - protected scanner-only `/field/check-in` route
  - online verify-first scanner UI with manual consume action
  - safe local `returnTo` handling for scanner login return
  - QR check-in component and browser contracts
affects: [phase-27-field-operations, qr-entry, auth, admin-capabilities]

tech-stack:
  added: []
  patterns: [React Query API hooks over `apiClient`, accessible status/alert scanner result bands, safe local auth return target]

key-files:
  created:
    - apps/web/hooks/use-field-operations.ts
    - apps/web/components/field/scanner-check-in.tsx
    - apps/web/app/field/check-in/page.tsx
    - apps/web/lib/auth-return.ts
  modified:
    - apps/web/components/field/__tests__/scanner-check-in.test.tsx
    - apps/web/e2e/phase27-qr-check-in.spec.ts
    - apps/web/app/auth/page.tsx
    - apps/web/components/auth/login-form.tsx
    - apps/web/app/layout-shell.tsx
    - .planning/phases/27-event-operations-settlement/deferred-items.md

key-decisions:
  - "Scanner check-in uses a minimal public-route shell rather than the full admin layout so scanner-only users do not see unrelated admin surfaces."
  - "Login return targets are accepted only as safe local paths to avoid open redirects while preserving QR camera deep-link flow."
  - "The route verifies on open but only calls consume after a scanner presses `입장 처리`."

patterns-established:
  - "Scanner result UI exposes `role=status`/`role=alert` labels for stable mobile and E2E accessibility contracts."
  - "Field operation hooks normalize both backend schema responses and existing E2E mock shapes without rendering raw token/JTI/full URL values."

requirements-completed: [QR-02]

duration: 19min
completed: 2026-05-22
---

# Phase 27 Plan 12: Scanner Check-In Route Summary

**Phone-camera QR deep links now land on a protected scanner-only route with safe login return, verify-first ticket status, and manual server-authoritative entry consume.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-05-22T03:47:33Z
- **Completed:** 2026-05-22T04:06:36Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `useFieldCheckInVerify()` and `useFieldCheckInConsume()` hooks with response normalization for `/api/v1/field/check-in/verify` and `/consume`.
- Built `ScannerCheckIn` with processable, processed, duplicate, tampered, refunded/cancelled, wrong-showtime, offline-pending, and access-denied states while hiding raw QR secrets.
- Added `/field/check-in` as a minimal scanner route that redirects logged-out users to `/auth?returnTo=...`, denies normal members, verifies on open, and consumes only after `입장 처리`.
- Extended QR E2E coverage for buyer QR deep links, logged-out return target, normal member denial, no consume-on-open, manual consume, and duplicate repeat scan.

## Task Commits

1. **Task 1 RED: scanner component acceptance tests** - `379bded6` (test)
2. **Task 1 GREEN: scanner hooks and component** - `86155024` (feat)
3. **Task 2 RED: scanner route E2E contracts** - `2fa6e878` (test)
4. **Task 2 GREEN: scanner-only route and auth return** - `3b045a62` (feat)

## Files Created/Modified

- `apps/web/hooks/use-field-operations.ts` - React Query verify/consume hooks and scanner response normalization.
- `apps/web/components/field/scanner-check-in.tsx` - Mobile-first scanner UI with result band, ticket identity, offline warning, access denial, and sticky manual consume action.
- `apps/web/app/field/check-in/page.tsx` - Protected scanner route that handles QR token params, login return, capability gating, verify, and consume.
- `apps/web/lib/auth-return.ts` - Safe local `returnTo` parser for auth redirects.
- `apps/web/components/field/__tests__/scanner-check-in.test.tsx` - Component contracts for verify-first, manual consume, rejection states, offline pending, access denial, and secret redaction.
- `apps/web/e2e/phase27-qr-check-in.spec.ts` - Browser contracts for QR route, login return, scanner consume, duplicate handling, and secret redaction.
- `apps/web/app/auth/page.tsx` - Authenticated redirect now honors safe `returnTo`.
- `apps/web/components/auth/login-form.tsx` - Successful login now returns verified users to safe local `returnTo`.
- `apps/web/app/layout-shell.tsx` - Public GNB/footer/mobile tab hidden on `/field/check-in`.
- `.planning/phases/27-event-operations-settlement/deferred-items.md` - Recorded out-of-scope typecheck debt.

## Decisions Made

- Used a standalone `/field/check-in` page outside `/admin` because scanner-only staff must not see full admin sidebar labels or unrelated privileged surfaces.
- Added `auth-return.ts` instead of passing arbitrary URLs through login, so QR camera deep links work without creating an open redirect.
- Kept consume server-authoritative and manual-only: route verification never displays completed entry copy and never calls consume until the scanner presses `입장 처리`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing workspace dependencies for TDD verification**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/web exec vitest ...` initially failed because `vitest` was unavailable in the worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the manual worktree.
- **Files modified:** None committed; dependency install populated ignored local `node_modules`.
- **Verification:** Scanner component test ran and failed for the expected missing implementation during RED, then passed after GREEN.
- **Committed in:** Not committed; environment-only unblocker.

**2. [Rule 3 - Blocking] Built shared package dist for E2E**
- **Found during:** Task 2 RED
- **Issue:** Playwright could not resolve `@grabit/shared/constants/locales.js` from generated dist output.
- **Fix:** Ran `pnpm --filter @grabit/shared build`.
- **Files modified:** None committed; generated dist is ignored.
- **Verification:** QR E2E executed and produced expected RED failures before route implementation.
- **Committed in:** Not committed; environment-only unblocker.

**3. [Rule 2 - Missing Critical] Added safe auth return handling**
- **Found during:** Task 2 route implementation
- **Issue:** Logged-out QR visitors needed to return to `/field/check-in?...` after login, but accepting arbitrary return targets would be unsafe.
- **Fix:** Added `resolveSafeReturnTo()` and wired auth page/login success redirects to local-only `returnTo`.
- **Files modified:** `apps/web/lib/auth-return.ts`, `apps/web/app/auth/page.tsx`, `apps/web/components/auth/login-form.tsx`
- **Verification:** `phase27-qr-check-in.spec.ts` logged-out QR return test passes.
- **Committed in:** `3b045a62`

**4. [Rule 2 - Missing Critical] Hid public shell on scanner route**
- **Found during:** Task 2 route implementation
- **Issue:** The scanner route would otherwise inherit public shell UI, which conflicts with the minimal scanner-only surface.
- **Fix:** Added `/field/check-in` to `LayoutShell` hide rules.
- **Files modified:** `apps/web/app/layout-shell.tsx`
- **Verification:** QR E2E confirms scanner/normal-member route does not render admin sidebar labels, and route uses the scanner surface.
- **Committed in:** `3b045a62`

**5. [Rule 1 - Test/Accessibility Contract] Stabilized Playwright selectors around accessible scanner states**
- **Found during:** Task 2 E2E GREEN
- **Issue:** Playwright treated inner text nodes in scanner route result bands as hidden even though the accessible UI surface was present.
- **Fix:** Added explicit `role=status`/`aria-label` for result bands and `role=alert` label for access denial; E2E now asserts accessible states.
- **Files modified:** `apps/web/components/field/scanner-check-in.tsx`, `apps/web/e2e/phase27-qr-check-in.spec.ts`
- **Verification:** QR E2E passes 4/4.
- **Committed in:** `3b045a62`

---

**Total deviations:** 5 auto-fixed (2 blocking, 2 missing critical, 1 bug/test contract)
**Impact on plan:** All fixes were required to complete the planned scanner flow, verify it in the worktree, or keep the auth/scanner surface safe.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` still fails outside Plan 27-12 scope on missing sibling/future modules `components/admin/settlement-dashboard` and `components/field/field-monitor`, plus existing `admin-user-management` label-map drift for scanner and settlement permissions. This was recorded in `deferred-items.md`.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/field/__tests__/scanner-check-in.test.tsx` - PASSED, 8 tests.
- `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- phase27-qr-check-in.spec.ts` - PASSED, 4 tests.
- `pnpm --filter @grabit/web typecheck` - FAILED due out-of-scope Phase 27 sibling debt listed above; Plan 27-12 files no longer report type errors.

## TDD Gate Compliance

- RED commit exists before Task 1 GREEN: `379bded6`.
- GREEN commit exists for Task 1: `86155024`.
- RED commit exists before Task 2 GREEN: `2fa6e878`.
- GREEN commit exists for Task 2: `3b045a62`.

## Known Stubs

None. Stub scan only found non-stub test defaults, form placeholders, and a null filter predicate.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth-return | `apps/web/lib/auth-return.ts` | Added login return target handling for QR deep links; mitigated by accepting only local paths and rejecting protocol-relative/external targets. |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 27-13 can build offline sync on top of the scanner component's offline-pending surface and `field.scan.sync` capability.
- Plan 27-16 manual phone-camera verification should use `/field/check-in?ticket=...` and confirm camera deep-link behavior on a real device.
- Sibling Phase 27 typecheck debt should be closed by the settlement dashboard, field monitor, and admin label-map plans before treating full web `typecheck` as green.

## Self-Check: PASSED

- Verified created files exist: scanner hooks, scanner component, scanner route, auth return helper, QR E2E, and `deferred-items.md`.
- Verified task commits exist: `379bded6`, `86155024`, `2fa6e878`, `3b045a62`.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
