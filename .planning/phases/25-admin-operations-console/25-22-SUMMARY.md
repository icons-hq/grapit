---
phase: 25-admin-operations-console
plan: "22"
subsystem: admin-operations
tags: [admin-operations, seat-operations, reservations, react-query, vitest]

requires:
  - phase: 25-admin-operations-console
    provides: Plan 25-11 reservation export UI/E2E deferral contract
  - phase: 25-admin-operations-console
    provides: Plan 25-12 seat operation backend APIs and audit/history contract
provides:
  - Reservation-scoped cancelled-seat immediate-open UI inside `AdminBookingDetailModal`
  - Dedicated `SeatOperationsPanel` for disable, reactivate, and history workflows
  - React Query hook layer for admin manual-open and seat operation API calls
  - Component coverage for reasoned confirmation and query invalidation
affects: [25-23, 25-15, phase-26-cutover]

tech-stack:
  added: []
  patterns:
    - Admin seat operation mutations share booking and seat-operation query invalidation.
    - Reservation-specific manual-open stays in the reservation detail modal while seat-centric toggles live in a dedicated panel.
    - Route-level E2E remains skipped until final admin route composition.

key-files:
  created:
    - apps/web/hooks/use-admin-seat-operations.ts
    - apps/web/components/admin/seat-operations-panel.tsx
    - apps/web/components/admin/__tests__/seat-operations-panel.test.tsx
  modified:
    - apps/web/components/admin/admin-booking-detail-modal.tsx
    - apps/web/e2e/admin-export-and-seat-ops.spec.ts

key-decisions:
  - "Kept cancelled-seat immediate open in `AdminBookingDetailModal` per D-12 instead of moving it into `SeatOperationsPanel`."
  - "Invalidated both `['admin','bookings']` and `['admin','seat-operations']` after manual-open, disable, and reactivate mutations."
  - "Kept route-level E2E skipped and updated it as the intended flow contract for Plan 25-23 final composition."

patterns-established:
  - "Seat operation confirmation dialogs echo the resource summary and keep confirm disabled until a non-empty reason is entered."
  - "Seat operation history queries use `['admin','seat-operations','history', filters]` under a shared seat-operation invalidation root."

requirements-completed: [ADMIN-03, ADMIN-04]

duration: 12m19s
completed: 2026-05-14
---

# Phase 25 Plan 22: Seat Operations Web Summary

**Admin seat operations web surface with reasoned manual-open, disable/reactivate confirmations, history lookup, and shared query invalidation.**

## Performance

- **Duration:** 12m19s
- **Started:** 2026-05-14T03:00:50Z
- **Completed:** 2026-05-14T03:13:09Z
- **Tasks:** 1
- **Files modified:** 5

## Accomplishments

- Added `use-admin-seat-operations.ts` with hooks for cancelled-seat manual-open, seat disable, seat reactivate, and seat operation history.
- Extended `AdminBookingDetailModal` with cancelled-seat immediate-open UI that requires a reason and final confirmation.
- Added `SeatOperationsPanel` for seat disable/reactivate/history, with resource summaries and reason-gated confirmations.
- Added component tests that verify modal placement, reason gating, API payloads, and invalidation of booking plus seat-operation queries.
- Updated the skipped route-level E2E contract to reflect the final intended `/admin/bookings` and `/admin/seat-operations` flow.

## Task Commits

1. **Task 1 RED: seat operations UI tests** - `336cb30` (`test`)
2. **Task 1 GREEN: seat operations UI** - `9e7e5d0` (`feat`)

## Files Created/Modified

- `apps/web/hooks/use-admin-seat-operations.ts` - Adds React Query hooks for admin manual-open, disable, reactivate, and history APIs.
- `apps/web/components/admin/admin-booking-detail-modal.tsx` - Keeps cancelled-seat immediate-open in the reservation detail modal with reasoned confirmation.
- `apps/web/components/admin/seat-operations-panel.tsx` - Adds the dedicated seat operations panel for disable, reactivate, and history.
- `apps/web/components/admin/__tests__/seat-operations-panel.test.tsx` - Covers immediate-open placement, reason gating, mutation payloads, and invalidation.
- `apps/web/e2e/admin-export-and-seat-ops.spec.ts` - Keeps route-level E2E skipped but updates the intended final flow.

## Decisions Made

- Followed D-12: immediate-open remains reservation-scoped in `AdminBookingDetailModal`; disable/reactivate/history are seat-scoped in `SeatOperationsPanel`.
- Followed D-13: all capacity-impacting UI actions require a reason before the confirmation button becomes enabled.
- Kept the E2E spec deferred because the plan explicitly assigns route-level execution to final composition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies for local verification**
- **Found during:** Task 1 RED
- **Issue:** The isolated worktree initially had no `node_modules`, so `vitest` was unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile`; generated dependency directories are ignored.
- **Files modified:** None tracked.
- **Verification:** Re-ran the RED test and observed the expected missing component failure.
- **Committed in:** Not committed; generated dependency directories are ignored.

**2. [Rule 3 - Blocking] Built `@grabit/shared` declarations for web typecheck**
- **Found during:** Task 1 GREEN verification
- **Issue:** `pnpm --filter @grabit/web typecheck` could not resolve `@grabit/shared` declaration output in the fresh worktree.
- **Fix:** Ran `pnpm --filter @grabit/shared build`; generated `packages/shared/dist/` is ignored.
- **Files modified:** None tracked.
- **Verification:** `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** Not committed; generated dist is ignored.

---

**Total deviations:** 2 auto-fixed (Rule 3: 2)  
**Impact on plan:** Verification environment only. Product changes stayed inside the plan-owned web files.

## Issues Encountered

- `apply_patch` initially created the RED test in the parent checkout because it has no `workdir` parameter. The accidental parent file was deleted immediately, the same test was added under the isolated worktree, and the parent checkout was verified clean for the plan-owned file.
- The exact `pnpm --filter @grabit/web test -- components/admin/__tests__/seat-operations-panel.test.tsx` command runs the full web test suite in this package. It passed, but existing unrelated jsdom/React `act(...)` warnings still appear in older tests.

## Known Stubs

None. Stub scan found only user-facing input placeholders and TanStack Query `placeholderData`; no placeholder data source, mock-only UI, TODO/FIXME, or "coming soon" implementation was introduced.

## Threat Flags

None - the new admin browser to seat-operation API calls are covered by the plan threat model (`T-25-22-01`, `T-25-22-02`) and route through the Phase 25-12 backend capability-protected APIs.

## Authentication Gates

None.

## User Setup Required

None for product behavior. Fresh isolated worktrees need workspace dependencies installed and `@grabit/shared` built before web typecheck can resolve generated declarations.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/seat-operations-panel.test.tsx` - PASS; 1 file / 2 tests.
- `pnpm --filter @grabit/web test -- components/admin/__tests__/seat-operations-panel.test.tsx` - PASS; exact command ran full web suite, 62 files / 384 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.

## TDD Gate Compliance

- RED commit `336cb30` exists before GREEN commit `9e7e5d0`.
- RED verification failed for missing `SeatOperationsPanel`, establishing the missing web seat operations surface before implementation.
- GREEN verification passed after the implementation commit.

## Next Phase Readiness

Plan 25-23 can now compose `ReservationExportPanel` and `SeatOperationsPanel` into the final admin route surface and unskip route-level E2E when the page wiring exists. Phase 26 cutover should preserve the shared invalidation root so booking lists and seat operation history refresh after operator actions.

## Self-Check: PASSED

- Verified all five source/test/E2E files exist in the isolated worktree.
- Verified summary file exists at `.planning/phases/25-admin-operations-console/25-22-SUMMARY.md`.
- Verified task commits `336cb30` and `9e7e5d0` exist in git history.
- Verified no tracked file deletions were introduced by the task commits.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
