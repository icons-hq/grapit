---
phase: 24-traffic-booking-payment-core
plan: "19"
subsystem: testing
tags: [booking, valkey, postgres, migrations, integration]
requires:
  - phase: 24-07
    provides: floor-aware booking runtime seat identity and booking policy lookup contract
  - phase: 24-03
    provides: phase24 booking-core migration baseline
provides:
  - booking integration coverage aligned to encoded floor-aware runtime seat locks
  - fresh-db-safe phase24 migration chain without duplicate translation draft index creation
  - passing API integration verification for booking and admin dashboard suites
affects: [booking-runtime, integration-testing, fresh-db-bootstrap]
tech-stack:
  added: []
  patterns:
    - integration DB stubs mirror Drizzle select().from().leftJoin().where() policy lookups
    - Valkey fixture keys and set members use encoded runtime seat ids derived from canonical seatKey
key-files:
  created:
    - .planning/phases/24-traffic-booking-payment-core/24-19-SUMMARY.md
  modified:
    - apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts
    - apps/api/test/booking-cluster-lua.integration.spec.ts
    - apps/api/src/database/migrations/0012_phase24_booking_core.sql
key-decisions:
  - "Integration specs now seed encoded runtime seat ids while response assertions stay on decoded seat keys where BookingService intentionally returns them."
  - "Mock Drizzle DB stubs explicitly support leftJoin().where() so getMaxTicketsPerUser() stays covered by the real query shape."
  - "The published translation partial unique index remains owned by migration 0007 only; 0012 no longer recreates it."
patterns-established:
  - "Booking integration fixtures must treat floor-aware seatKey as the canonical identity and encode it only at the Redis boundary."
  - "Fresh migration regressions are verified through the admin-dashboard integration suite before running the full API integration suite."
requirements-completed: [BOOK-01, BOOK-03]
duration: 5m
completed: 2026-05-10
---

# Phase 24 Plan 19: Traffic + Booking + Payment Core Summary

**Booking integration specs now follow the live floor-aware seat lock contract, and Phase 24 migrations bootstrap cleanly on a blank Postgres container.**

## Performance

- **Duration:** 5m
- **Started:** 2026-05-10T08:48:00Z
- **Completed:** 2026-05-10T08:52:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Updated both booking integration specs to support the current `leftJoin()` booking-policy query and encoded runtime seat lock keys.
- Preserved user-facing assertions on decoded seat keys while moving Redis lock keys, `user-seats`, and `locked-seats` fixtures to canonical encoded runtime ids.
- Removed the duplicate `idx_translation_drafts_one_published_per_source_locale` creation from `0012_phase24_booking_core.sql`, restoring fresh migration safety and green API integration coverage.

## Task Commits

Each task was committed atomically:

1. **Task 1: Refresh booking integration stubs and seat-key fixtures to the Phase 24 runtime contract** - `3dbfbdb` (`fix`)
2. **Task 2: Make the migration chain fresh-DB safe by removing the duplicate translation index from 0012** - `f4e904c` (`fix`)

## Files Created/Modified

- `apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts` - Updated the real-Valkey integration fixture to use `leftJoin()`-aware DB stubs and encoded runtime seat ids.
- `apps/api/test/booking-cluster-lua.integration.spec.ts` - Aligned cluster-mode booking Lua coverage to the same encoded runtime seat identity and booking-policy query contract.
- `apps/api/src/database/migrations/0012_phase24_booking_core.sql` - Removed the duplicate translation-draft partial unique index creation so blank DB migration succeeds.
- `.planning/phases/24-traffic-booking-payment-core/24-19-SUMMARY.md` - Execution record for this plan.

## Decisions Made

- Kept the integration fixtures on canonical `seatKey` input such as `1F:A-1`, and encoded only the Redis-facing runtime seat id with `encodeURIComponent`.
- Used deterministic `maxTicketsPerUser` rows through `leftJoin().where()` in both specs so `BookingService.getMaxTicketsPerUser()` stays exercised without weakening the mock shape.
- Left `0007_phase23_launch_foundation.sql` as the only migration that creates `idx_translation_drafts_one_published_per_source_locale`, avoiding any broader DDL edits in `0012`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Isolated Task 1 verification from the package script fan-out**
- **Found during:** Task 1
- **Issue:** `pnpm --filter @grabit/api test:integration -- <files>` still executed `admin-dashboard.integration`, so Task 1 verification was blocked by the separate duplicate-index failure before Task 2 ran.
- **Fix:** Ran `pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts <files>` to isolate the two intended specs, then reran the plan-level integration commands after Task 2 fixed the migration chain.
- **Files modified:** None
- **Verification:** Isolated 2-file Vitest run passed; both plan-level integration commands passed after Task 2.
- **Committed in:** n/a (verification-only adjustment)

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)
**Impact on plan:** No scope creep. The deviation only isolated verification while preserving the planned final integration gates.

## Issues Encountered

- The integration package script did not stay file-scoped when passed Task 1 file arguments, so Task 1 verification needed one direct `vitest` invocation before the full suite could be green.

## Known Stubs

None.

## Threat Flags

None - the changes stayed inside the plan threat model and introduced no new trust-boundary surface.

## User Setup Required

None - Docker-backed integration verification was completed locally.

## Verification

- `pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts src/modules/booking/__tests__/booking.service.integration.spec.ts test/booking-cluster-lua.integration.spec.ts` - PASS, 2 files / 16 tests
- `pnpm --filter @grabit/api test:integration -- admin-dashboard.integration` - PASS, 5 files / 41 tests
- `pnpm --filter @grabit/api test:integration` - PASS, 5 files / 41 tests

## Next Phase Readiness

- Booking integration coverage now matches the live Phase 24 booking contract instead of stale raw-seat fixtures.
- Fresh environments can replay the full migration chain without the duplicate translation index failure, so downstream API integration and bootstrap gates are stable again.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-19-SUMMARY.md`.
- Verified task commits `3dbfbdb` and `f4e904c` exist in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-10*
