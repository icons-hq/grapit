---
phase: 25-admin-operations-console
plan: "24"
subsystem: admin-operations
tags: [admin-operations, seat-operations, validation, zod, nestjs, vitest]

requires:
  - phase: 25-admin-operations-console
    provides: Plan 25-12 backend seat operation APIs and audit/history contract
  - phase: 25-admin-operations-console
    provides: Plan 25-22 seat operation web panel and fixture coverage
  - phase: 25-admin-operations-console
    provides: Plan 25-23 route wiring for `/admin/seat-operations`
provides:
  - Shared UUID validation contract for admin seat operation showtime IDs
  - Controller-level 400 response for malformed seat operation history queries
  - Service-level validation before Drizzle/PostgreSQL UUID comparisons
  - Production-shaped UUID fixtures for Phase 25 seat operation UI/E2E happy paths
  - Disabled-seat propagation through booking state, checkout lock validation, payment finalization, and captured-payment compensation paths
affects: [25-admin-operations-console, phase-26-cutover, admin-seat-operations, booking-payment]

tech-stack:
  added: []
  patterns:
    - Shared Zod UUID schemas are reused by controller pipes and defensive service boundaries.
    - Admin seat operation happy-path fixtures use production-shaped UUIDs while malformed-input regressions stay explicit.
    - Admin-disabled seats are treated as unavailable in shared seat state, backend locks, frontend seat maps, and final payment DB writes.
    - Captured payment failures after async DONE or existing DONE recovery compensate both external Toss payment state and local payment/reservation state.

key-files:
  created:
    - apps/api/src/modules/admin/admin-seat-operations.controller.spec.ts
  modified:
    - packages/shared/src/schemas/admin-operations.schema.ts
    - packages/shared/src/schemas/admin-operations.schema.test.ts
    - packages/shared/src/types/booking.types.ts
    - apps/api/src/modules/admin/admin-seat-operations.controller.ts
    - apps/api/src/modules/admin/admin-seat-operations.service.ts
    - apps/api/src/modules/admin/admin-seat-operations.service.spec.ts
    - apps/api/src/modules/booking/booking.service.ts
    - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
    - apps/api/src/modules/booking/__tests__/dto.spec.ts
    - apps/api/src/modules/payment/payment.service.ts
    - apps/api/src/modules/payment/payment.service.spec.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts
    - apps/web/components/admin/__tests__/seat-operations-panel.test.tsx
    - apps/web/components/booking/seat-map-viewer.tsx
    - apps/web/components/booking/__tests__/seat-map-viewer.test.tsx
    - apps/web/e2e/admin-export-and-seat-ops.spec.ts

key-decisions:
  - "Admin seat operation `showtimeId` now uses one shared UUID schema across shared contracts, controller query validation, and service defensive validation."
  - "Malformed `showtime-1` remains covered by the controller regression, while targeted happy-path fixtures no longer use `showtime-1` as a production ID."
  - "Review-discovered disabled-seat races are closed as part of this gap because admin seat disable is the mutation that introduced the unavailable state."
  - "Captured payment paths fail closed with compensation instead of returning reservation detail from stale `DONE` rows."
  - "D-08 admin MFA remains accepted risk; this gap closure does not add MFA work or claim MFA PASS evidence."

patterns-established:
  - "Malformed admin UUID inputs fail before any Drizzle `eq()` comparison against PostgreSQL UUID columns."
  - "Controller specs assert validation prevents service invocation for malformed admin query input."
  - "Payment finalization only transitions `seat_inventories` from `available` to `sold`; `disabled`, `held_cancelled`, and existing `sold` rows fail closed."
  - "Captured-payment failures after disabled-seat conflicts cancel Toss, mark local payment `CANCELED`, mark pending reservation `FAILED`, and avoid broadcast/QR side effects."

requirements-completed: [ADMIN-03, ADMIN-04]

duration: 96 min
completed: 2026-05-14T08:36:00Z
---

# Phase 25 Plan 24: Seat Operation UUID Validation Gap Summary

**Malformed admin seat operation showtime IDs now fail as validation-level 400 responses before database UUID comparisons, and the adjacent disabled-seat booking/payment races are closed.**

## Performance

- **Duration:** 96 min
- **Started:** 2026-05-14T07:00:57Z
- **Completed:** 2026-05-14T08:36:00Z
- **Tasks:** 16
- **Files modified:** 18 implementation/test files

## Accomplishments

- Added a shared `adminSeatOperationShowtimeIdSchema` with UUID validation and reused it in request/history contracts.
- Tightened `GET /admin/seat-operations/history` query validation so malformed `showtimeId=showtime-1` returns 400 before the service is called.
- Added service-level validation in `performOperation` and `listHistory` so non-controller callers cannot send malformed showtime IDs into Drizzle/PostgreSQL UUID comparisons.
- Normalized Phase 25 seat operation UI/component/E2E happy-path fixtures to `00000000-0000-4000-8000-000000000001`.
- Added `disabled` as a first-class `SeatState` so admin-disabled seats render and broadcast as unavailable instead of falling through as available.
- Blocked new locks, existing lock ownership checks, lock extension, and lock consumption when DB seat inventory is `disabled`, `held_cancelled`, or `sold`.
- Added absent-row admin disable support: a valid SVG seat with no `seat_inventories` row can now be inserted as `disabled`, audited, recorded in history, lock-released, and broadcast.
- Added post-commit active-lock cleanup for admin disable, with best-effort failure handling so a committed disabled state still broadcasts.
- Hardened reservation and async payment finalization so seats are sold only from `available`, preventing `disabled` or delayed-release rows from being overwritten to `sold`.
- Hardened captured-payment recovery paths so existing async `DONE` payments and async webhook `DONE` payments compensate Toss/local state when disabled seats prevent finalization.

## Task Commits

1. **Task 1 RED: malformed showtime ID regressions** - `0d01918` (`test`)
2. **Task 1/2 GREEN: UUID validation and fixture normalization** - `58d9cf4` (`fix`)
3. **Review fix: mutation validation and E2E history mock alignment** - `05246a8` (`test`)
4. **Review RED: disabled seat booking regressions** - `f270161` (`test`)
5. **Review GREEN: disabled seats unavailable in booking flow** - `01244a3` (`fix`)
6. **Review RED: lock ownership helpers reject disabled DB state** - `34f2170` (`test`)
7. **Review RED: admin disable releases active locks** - `13020b3` (`test`)
8. **Review GREEN: checkout locks guarded against disabled seats** - `cf026c8` (`fix`)
9. **Review RED: disabled-seat payment finalization races** - `8a780f0` (`test`)
10. **Review GREEN: payment finalization hardened to `available -> sold` only** - `05bf046` (`fix`)
11. **Review RED: absent inventory rows, post-confirm cleanup, and duplicate DONE recovery blockers** - `32fc259` (`test`)
12. **Review GREEN: final disabled-seat admin/checkout blockers** - `7ea2d55` (`fix`)
13. **Review RED: async DONE disabled-seat compensation** - `1b8858d` (`test`)
14. **Review GREEN: async DONE reservation compensation** - `8905316` (`fix`)
15. **Review RED: captured payment compensation gaps** - `0c18f60` (`test`)
16. **Review GREEN: captured payment failures compensated** - `5ba2a94` (`fix`)

## Files Created/Modified

- `packages/shared/src/schemas/admin-operations.schema.ts` - Adds exported admin seat operation UUID schema and applies it to request/history schemas.
- `packages/shared/src/schemas/admin-operations.schema.test.ts` - Covers malformed ID rejection and valid UUID acceptance.
- `apps/api/src/modules/admin/admin-seat-operations.controller.ts` - Reuses the shared UUID schema in history query validation and adds explicit service injection.
- `apps/api/src/modules/admin/admin-seat-operations.controller.spec.ts` - Proves malformed `showtime-1` history query returns 400 and does not call the service.
- `apps/api/src/modules/admin/admin-seat-operations.service.ts` - Rejects malformed showtime IDs, creates disabled rows for valid absent inventory rows, and preserves audit/history/broadcast behavior.
- `apps/api/src/modules/admin/admin-seat-operations.service.spec.ts` - Covers service boundary rejection, active lock release, absent-row disable, and best-effort cleanup behavior.
- `packages/shared/src/types/booking.types.ts` - Adds `disabled` to the shared seat state contract.
- `apps/api/src/modules/booking/booking.service.ts` - Treats disabled seats as unavailable in lock/status/checkout helper paths and exposes active lock force-release.
- `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` - Covers disabled DB state for new locks, existing lock assertions, lock extension, lock consumption, post-confirm cleanup bypass, and seat status.
- `apps/api/src/modules/booking/__tests__/dto.spec.ts` - Covers `disabled` as an allowed `SeatState`.
- `apps/api/src/modules/payment/payment.service.ts` - Restricts async payment sold transitions to `available` rows and compensates captured async DONE payments on disabled-seat conflicts.
- `apps/api/src/modules/payment/payment.service.spec.ts` - Verifies async payment sold predicates and captured async DONE compensation.
- `apps/api/src/modules/reservation/reservation.service.ts` - Restricts synchronous sold transitions to `available` rows and compensates captured existing DONE recovery failures.
- `apps/api/src/modules/reservation/reservation.service.spec.ts` - Verifies reservation sold predicates, existing DONE compensation, generic transaction failure compensation, and cleanup behavior.
- `apps/web/components/admin/__tests__/seat-operations-panel.test.tsx` - Uses a production-shaped UUID for seat operation history and mutation fixtures.
- `apps/web/components/booking/seat-map-viewer.tsx` - Renders disabled seats as unavailable and blocks disabled clicks.
- `apps/web/components/booking/__tests__/seat-map-viewer.test.tsx` - Covers disabled seat styling and click blocking.
- `apps/web/e2e/admin-export-and-seat-ops.spec.ts` - Uses a production-shaped UUID in the dedicated seat operations route smoke.

## Decisions Made

- Shared validation remains in `@grabit/shared` so API and future clients share the same UUID contract.
- Controller regression keeps the original UAT value `showtime-1` to prove the observed 500 path is closed.
- Targeted happy-path fixtures use a stable UUID because `showtime-1` was masking production UUID constraints.
- Admin disable cleanup is best-effort after DB commit; DB state remains source of truth and broadcast still reflects the committed disabled state.
- Payment finalization uses a DB transition invariant (`available -> sold`) instead of relying only on pre-flight Redis lock checks.
- Existing captured payments are treated as post-capture failures, not harmless duplicate commits, when reservation or seat finalization fails.

## Review-Driven Findings Closed

**1. [CR] Disabled seats could remain bookable after admin disable**
- **Issue:** Admin disable broadcasted `disabled`, but booking state, lock checks, and frontend viewer did not consistently treat `disabled` as unavailable.
- **Fix:** Added `disabled` to `SeatState`, blocked disabled locks and checkout helpers, rendered/click-blocked disabled seats, and force-released active locks after admin disable.
- **Committed in:** `f270161`, `01244a3`, `34f2170`, `13020b3`, `cf026c8`

**2. [CR] Payment finalization could overwrite `disabled` seats to `sold`**
- **Issue:** Reservation and async payment finalization used a broad sold predicate, allowing `disabled -> sold` under a race.
- **Fix:** Both finalization paths now update only rows where `seat_inventories.status = 'available'`; non-available rows fail closed before broadcast/QR.
- **Committed in:** `8a780f0`, `05bf046`

**3. [CR] Admin disable could not disable untouched available SVG seats**
- **Issue:** Seats with no `seat_inventories` row are normal available seats, but admin disable required a pre-existing row.
- **Fix:** `seat.disable` validates the SVG seat map and creates a `disabled` inventory row with audit/history/broadcast evidence.
- **Committed in:** `32fc259`, `7ea2d55`

**4. [CR] Captured payment paths could remain uncompensated**
- **Issue:** Existing async `DONE` recovery and async webhook `DONE` finalization could fail after capture without refund/local cancellation.
- **Fix:** Captured failure paths now cancel Toss, mark local payments `CANCELED`, mark pending reservations `FAILED`, and avoid seat broadcast/QR issuance.
- **Committed in:** `1b8858d`, `8905316`, `0c18f60`, `5ba2a94`

## Threat Flags

None. The plan threat register is mitigated as follows:

| Threat | Status | Evidence |
|--------|--------|----------|
| T-25-24-01 DoS via malformed history query | MITIGATED | Controller and service reject malformed showtime IDs before DB work. |
| T-25-24-02 PostgreSQL UUID error disclosure | MITIGATED | Malformed history query returns HTTP 400 validation response. |
| T-25-24-03 Mutation tampering with malformed UUID | MITIGATED | `performOperation` validates `showtimeId` before transaction. |
| T-25-24-04 MFA accepted-risk ledger | ACCEPTED | D-08 remains accepted risk and no MFA work was added. |
| T-25-24-05 Disabled-seat booking continuation | MITIGATED | Backend lock helpers, active lock cleanup, frontend disabled rendering, and payment DB transition predicates fail closed. |
| T-25-24-06 Captured payment inconsistency after disabled-seat conflicts | MITIGATED | Existing DONE recovery and async DONE webhook paths compensate Toss/local payment/reservation state. |

## Authentication Gates

None.

## User Setup Required

None.

## Verification

- RED: malformed UUID regression tests failed before implementation.
- RED: disabled-seat booking/payment/admin operation regressions failed before fixes.
- RED: captured payment compensation regressions failed before fixes.
- GREEN: `pnpm --filter @grabit/shared test -- src/schemas/admin-operations.schema.test.ts` - PASS, 8 files / 43 tests.
- GREEN: `pnpm --filter @grabit/api exec vitest run modules/admin/admin-seat-operations.controller.spec.ts modules/admin/admin-seat-operations.service.spec.ts modules/booking/__tests__/booking.service.spec.ts modules/booking/__tests__/dto.spec.ts modules/reservation/reservation.service.spec.ts modules/payment/payment.service.spec.ts` - PASS, 6 files / 124 tests.
- GREEN: `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/seat-operations-panel.test.tsx components/booking/__tests__/seat-map-viewer.test.tsx` - PASS, 2 files / 26 tests with existing React `act(...)` warnings.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/shared build` - PASS.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api lint` - PASS_WITH_WARNINGS; 50 existing warnings, 0 errors.
- `git diff --check` - PASS.
- `rg -n "showtime-1" packages/shared/src/schemas/admin-operations.schema.test.ts apps/api/src/modules/admin/admin-seat-operations.service.spec.ts apps/web/components/admin/__tests__/seat-operations-panel.test.tsx apps/web/e2e/admin-export-and-seat-ops.spec.ts` - PASS with no output.
- Final GSD code review: `25-REVIEW.md` status `clean`, findings 0.

## TDD Gate Compliance

- RED commit `0d01918` exists before GREEN commit `58d9cf4`.
- Review RED commits `f270161`, `34f2170`, `13020b3`, `8a780f0`, `32fc259`, `1b8858d`, and `0c18f60` exist before their corresponding GREEN fixes.
- RED failures proved malformed ID handling, disabled-seat lock/checkout/finalization gaps, absent-row admin disable gaps, and captured payment compensation gaps.
- GREEN verification passed after validation, disabled-seat propagation, checkout guard, active lock cleanup, final payment DB invariant fixes, and captured-payment compensation fixes.

## Next Phase Readiness

Phase 25 gap closure is complete from automated evidence and clean code review. D-08 admin MFA remains accepted risk and should carry into Phase 26 planning as a known launch risk, not a hidden PASS.

## Self-Check: PASSED

- Verified all plan-owned files exist.
- Verified task commits `0d01918`, `58d9cf4`, `05246a8`, `f270161`, `01244a3`, `34f2170`, `13020b3`, `cf026c8`, `8a780f0`, `05bf046`, `32fc259`, `7ea2d55`, `1b8858d`, `8905316`, `0c18f60`, and `5ba2a94` exist in git history.
- Verified targeted Phase 25 seat-operation happy-path fixtures no longer contain `showtime-1`.
- Verified disabled seats cannot continue through new locks, existing checkout helpers, active admin-disabled locks, frontend seat selection, final payment sold transitions, or captured async payment recovery paths.
- Verified no live booking, Toss live-key, canary, load, DR, field QR, settlement, event-day monitoring, or MFA implementation work was introduced.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
