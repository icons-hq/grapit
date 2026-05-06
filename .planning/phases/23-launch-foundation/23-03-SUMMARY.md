---
phase: 23-launch-foundation
plan: 03
subsystem: api
tags: [feature-flags, booking, reservation, payments, canary, rollback]

requires:
  - phase: 23-launch-foundation
    provides: Shared BOOKING_ENABLED parser from 23-01
provides:
  - Runtime API FeatureFlagsService backed by shared readFeatureFlags
  - Backend BOOKING_ENABLED hard gate before seat lock, reservation prepare, and payment confirm side effects
  - Unit evidence that API-side payment request creation is absent
  - Phase 23 canary rollback runbook with strict D-02 PASS blockers
affects: [phase-23, booking-disabled, payments, canary, launch-ops]

tech-stack:
  added: []
  patterns:
    - API runtime feature flags are read through @grabit/shared readFeatureFlags
    - Booking-disabled hard gates throw ForbiddenException before scarce-resource mutation paths
    - Canary runbooks preserve ACCEPTED_RISK as not-PASS evidence

key-files:
  created:
    - apps/api/src/modules/feature-flags/feature-flags.module.ts
    - apps/api/src/modules/feature-flags/feature-flags.service.ts
    - apps/api/src/modules/feature-flags/feature-flags.service.spec.ts
    - docs/runbooks/phase23-canary-rollback.md
  modified:
    - apps/api/src/app.module.ts
    - apps/api/src/modules/booking/booking.module.ts
    - apps/api/src/modules/booking/booking.service.ts
    - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
    - apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts
    - apps/api/src/modules/reservation/reservation.module.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts
    - apps/api/test/booking-cluster-lua.integration.spec.ts

key-decisions:
  - "API booking flag decisions use runtime BOOKING_ENABLED through FeatureFlagsService, not NEXT_PUBLIC_BOOKING_ENABLED."
  - "Booking-disabled guard blocks lockSeat, prepareReservation, and confirmAndCreateReservation before Redis lock, DB transaction, confirm lock, and Toss side effects."
  - "No API-side payment request creation path exists; this absence is recorded in reservation tests."

patterns-established:
  - "FeatureFlagsModule exports a narrow service for API-side runtime flag checks."
  - "Canary rollback evidence must keep Phase 22 ACCEPTED_RISK caveats separate from PASS evidence."

requirements-completed:
  - FLAG-01
  - FLAG-02

duration: 8 min
completed: 2026-05-06
---

# Phase 23 Plan 03: API Booking Flag Gates Summary

**Runtime `BOOKING_ENABLED=false` now blocks direct booking API mutation paths before Redis locks, reservation transactions, confirm locks, or Toss payment confirmation.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-06T04:40:15Z
- **Completed:** 2026-05-06T04:47:47Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Added `FeatureFlagsModule` and `FeatureFlagsService` using shared `readFeatureFlags(process.env)` behavior.
- Added TDD coverage for false-default API runtime parsing and public-client flag name isolation.
- Gated `BookingService.lockSeat`, `ReservationService.prepareReservation`, and `ReservationService.confirmAndCreateReservation` with `ForbiddenException`.
- Proved disabled booking avoids Redis lock mutation, DB transaction/pending reservation creation, confirm lock acquisition, and Toss `confirmPayment`.
- Documented the Phase 23 canary rollback gate for auth/session, booking-disabled API, Korean root URL, and locale routing.

## Task Commits

1. **Task 1 RED: API runtime flag tests** - `07d7897` (test)
2. **Task 1 GREEN: FeatureFlagsService and module** - `0c1283c` (feat)
3. **Task 2 RED: booking-disabled side-effect tests** - `b2abfc9` (test)
4. **Task 2 GREEN: backend mutation hard gates** - `82361d7` (feat)
5. **Task 3: canary rollback runbook** - `71934f1` (docs)

## Files Created/Modified

- `apps/api/src/modules/feature-flags/feature-flags.service.ts` - Runtime API flag reader and booking guard.
- `apps/api/src/modules/feature-flags/feature-flags.module.ts` - Exported Nest module for API flag service.
- `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` - Runtime parsing and false-default tests.
- `apps/api/src/app.module.ts` - Registers `FeatureFlagsModule`.
- `apps/api/src/modules/booking/booking.service.ts` - Blocks `lockSeat` before booking side effects.
- `apps/api/src/modules/booking/booking.module.ts` - Imports `FeatureFlagsModule`.
- `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` - Disabled lock tests.
- `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts` - Keeps existing integration helper compatible with the new constructor.
- `apps/api/src/modules/reservation/reservation.service.ts` - Blocks prepare and confirm before DB/Toss/lock side effects.
- `apps/api/src/modules/reservation/reservation.module.ts` - Imports `FeatureFlagsModule`.
- `apps/api/src/modules/reservation/reservation.service.spec.ts` - Disabled prepare/confirm tests and API-side payment request absence evidence.
- `apps/api/test/booking-cluster-lua.integration.spec.ts` - Keeps cluster integration helper compatible with the new constructor.
- `docs/runbooks/phase23-canary-rollback.md` - Strict D-02 canary smoke and rollback policy.

## Decisions Made

- Used a dedicated API-side `FeatureFlagsService` rather than reading env in booking/reservation services directly, so the shared parser remains the only flag parsing contract.
- Kept the disabled booking error as a Korean `ForbiddenException`: `예매는 5월말 오픈 예정입니다`.
- Treated API-side payment request creation as absent after code search; added a named test so the evidence is executable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated integration test helpers for the new BookingService dependency**
- **Found during:** Task 2 (Gate booking and payment creation paths before side effects)
- **Issue:** Injecting `FeatureFlagsService` into `BookingService` would leave existing integration helper constructors without the new dependency.
- **Fix:** Added enabled feature-flag mocks to `booking.service.integration.spec.ts` and `booking-cluster-lua.integration.spec.ts`.
- **Files modified:** `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts`, `apps/api/test/booking-cluster-lua.integration.spec.ts`
- **Verification:** `pnpm --filter @grabit/api test -- booking.service.spec.ts reservation.service.spec.ts` passed, and API typecheck passed.
- **Committed in:** `82361d7`

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)  
**Impact on plan:** The deviation was required to keep existing test helpers compatible with the planned DI change. Product behavior and scope were unchanged.

## Issues Encountered

- The API package test command runs the full API Vitest suite even when file names are passed after `--`; the full suite passed during targeted verification.
- GREEN implementation initially exposed a test mock contract mismatch for `assertBookingEnabled`; the mock was updated to match the real service surface.

## Known Stubs

None. Stub scan found only normal test accumulators, Redis Lua empty table syntax, and existing empty object initializers used as data structures.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api test -- feature-flags.service.spec.ts booking.service.spec.ts reservation.service.spec.ts` - PASS, 408 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `grep -R "NEXT_PUBLIC_BOOKING_ENABLED" apps/api/src/modules/feature-flags` - PASS, no matches.
- `rg -n "requestPayment|createPayment|paymentRequest|payments/request|confirmPayment" apps/api/src/modules/payment apps/api/src/modules/reservation apps/api/src/modules/booking` - PASS; only `confirmPayment` path exists.
- `grep -R "payment request creation" apps/api/src/modules/reservation apps/api/src/modules/payment apps/api/src/modules/booking` - PASS.
- `grep -R "예매는 5월말 오픈 예정입니다" apps/api/src/modules/booking apps/api/src/modules/reservation apps/api/src/modules/feature-flags` - PASS.
- Runbook greps for `auth/session`, `booking-disabled API`, `Korean root URL`, `locale routing`, and `do not mark Phase 23 as PASS` - PASS.

## TDD Gate Compliance

- RED commit exists for Task 1: `07d7897`
- GREEN commit exists after Task 1 RED: `0c1283c`
- RED commit exists for Task 2: `b2abfc9`
- GREEN commit exists after Task 2 RED: `82361d7`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for downstream Phase 23 web/i18n/canary plans. Backend booking-disabled behavior is now enforced server-side, and launch canary smoke requirements are executable through the runbook.

## Self-Check: PASSED

- Summary and key feature-flag/runbook files exist on disk.
- Task commits `07d7897`, `0c1283c`, `b2abfc9`, `82361d7`, and `71934f1` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
