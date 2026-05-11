---
phase: 24-traffic-booking-payment-core
plan: "06"
subsystem: api
tags: [performance, admin, seat-maps, booking-policy, zod]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: migrated floor-aware seat_maps and booking_policies storage from 24-03
provides:
  - floor-aware performance detail contracts with seatMaps[] and bookingPolicy
  - admin create/update/save persistence for multi-floor seat maps and booking policy
  - deterministic duplicate floorKey rejection before persistence
affects: [24-05, 24-07, 24-09, 24-11, 24-13]
tech-stack:
  added: []
  patterns:
    - shared performance contracts publish seatMaps[] as source-of-truth while keeping a transitional seatMap alias
    - admin persistence replaces seat-map rows wholesale and upserts booking policy rows as one booking contract
key-files:
  created: []
  modified:
    - packages/shared/src/types/performance.types.ts
    - packages/shared/src/schemas/performance.schema.ts
    - packages/shared/src/schemas/performance.schema.test.ts
    - apps/api/src/modules/performance/performance.service.ts
    - apps/api/src/modules/performance/performance.service.spec.ts
    - apps/api/src/modules/admin/admin-performance.controller.ts
    - apps/api/src/modules/admin/admin.service.ts
    - apps/api/src/modules/admin/admin.service.spec.ts
key-decisions:
  - "Performance detail keeps a transitional seatMap alias, but seatMaps[] plus bookingPolicy is the new source-of-truth contract for downstream booking/payment work."
  - "Admin saveSeatMap stays backward-compatible with the legacy single-floor payload by normalizing it to default 1F server-side."
  - "Duplicate floorKey validation is enforced in AdminService before any transaction so the API returns a deterministic 422 path instead of silently collapsing rows."
patterns-established:
  - "Performance detail reads must default legacy floor fields to 1F/1층/0 when older rows are encountered."
  - "Shared schema changes require rebuilding @grabit/shared because apps/api typecheck consumes dist declarations, not shared src directly."
requirements-completed: [BOOK-01, BOOK-03]
duration: 15m 14s
completed: 2026-05-08
---

# Phase 24 Plan 06: Traffic + Booking + Payment Core Summary

**Performance detail and admin persistence now ship floor-aware seatMaps plus explicit bookingPolicy data, including legacy 1F compatibility and duplicate-floor rejection.**

## Performance

- **Duration:** 15m 14s
- **Started:** 2026-05-08T06:22:32Z
- **Completed:** 2026-05-08T06:37:46Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Shared performance contracts now expose `seatMaps[]` and `bookingPolicy` instead of treating a single seat-map row as the only source.
- `PerformanceService.findById()` loads all floor rows, defaults legacy rows to `1F`, and returns booking-policy fields needed by later booking/payment plans.
- Admin create/update/save flows now persist floor rows and booking policy together, while rejecting duplicate `floorKey` values before persistence.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: floor-aware performance contracts** - `16eab11` (`test`)
2. **Task 1 GREEN: floor-aware performance contracts** - `395354a` (`feat`)
3. **Task 2 RED: floor-aware admin persistence** - `955e98b` (`test`)
4. **Task 2 GREEN: floor-aware admin persistence** - `9605537` (`feat`)

## Files Created/Modified

- `packages/shared/src/types/performance.types.ts` - Added floor-aware `SeatMap`, explicit `PerformanceBookingPolicy`, and default booking-policy constants.
- `packages/shared/src/schemas/performance.schema.ts` - Added floor/policy schemas, legacy-or-floor-aware save payload schema, and create/update payload support.
- `packages/shared/src/schemas/performance.schema.test.ts` - Locked shared schema expectations for `seatMaps` and `bookingPolicy`.
- `apps/api/src/modules/performance/performance.service.ts` - Reads all floor rows plus booking-policy rows and synthesizes legacy `1F` defaults.
- `apps/api/src/modules/performance/performance.service.spec.ts` - Covers `seatMaps[]`, `bookingPolicy`, and legacy single-floor compatibility.
- `apps/api/src/modules/admin/admin-performance.controller.ts` - Validates floor-aware save payloads with `ZodValidationPipe`.
- `apps/api/src/modules/admin/admin.service.ts` - Persists multi-floor seat-map rows, upserts booking policies, rejects duplicate `floorKey`, and normalizes legacy save payloads.
- `apps/api/src/modules/admin/admin.service.spec.ts` - Verifies create/update/save persistence paths and duplicate-floor rejection.

## Decisions Made

- Kept `seatMap` as a transitional compatibility alias so existing consumer code can keep compiling while downstream plans migrate to `seatMaps[]`.
- Normalized legacy single-seat-map saves to default `1F`/`1층` instead of forking a separate persistence path.
- Enforced duplicate-floor rejection in the service layer with `UnprocessableEntityException` so server persistence always owns the final uniqueness guarantee.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Rebuilt shared declarations and aligned admin return shapes for expanded contracts**
- **Found during:** Task 1 verification
- **Issue:** `apps/api` typecheck resolves `@grabit/shared` through `packages/shared/dist`, so new `seatMaps`/`bookingPolicy` exports were invisible until the shared build was refreshed, and `AdminService` return shapes no longer matched `PerformanceWithDetails`.
- **Fix:** Rebuilt `@grabit/shared` declarations and updated `AdminService` return objects to carry the expanded detail contract shape before Task 2 persistence work landed.
- **Files modified:** `apps/api/src/modules/admin/admin.service.ts`
- **Verification:** `pnpm --filter @grabit/api typecheck`
- **Committed in:** `395354a`

---

**Total deviations:** 1 auto-fixed (Rule 3: blocking compatibility)
**Impact on plan:** No scope creep. The fix was required to make the shared contract consumable by the API package in this repository layout.

## Issues Encountered

- `pnpm --filter @grabit/api test -- ...` pulled in unrelated suites under the package script, including a pre-existing `modules/traffic/traffic-defense.service.spec.ts` import failure outside 24-06 scope. Verification used `pnpm --filter @grabit/api exec vitest run ...` to isolate the 24-06 specs.

## Known Stubs

None.

## Threat Flags

None - the changed API surfaces stay inside the plan threat model and tighten validation at the admin persistence boundary.

## User Setup Required

None - no new external configuration or secrets were introduced.

## Verification

- `pnpm --filter @grabit/shared test -- src/schemas/performance.schema.test.ts` - PASS
- `pnpm --filter @grabit/api exec vitest run src/modules/performance/performance.service.spec.ts` - PASS
- `pnpm --filter @grabit/api exec vitest run src/modules/admin/admin.service.spec.ts` - PASS
- `pnpm --filter @grabit/api typecheck` - PASS
- `rg -n "seatMaps|bookingPolicy" packages/shared/src/types/performance.types.ts` - PASS
- `rg -n "performanceSeatMapSchema|performanceBookingPolicySchema|maxTicketsPerUser|allowedPaymentMethods|cancelledSeatHold" packages/shared/src/schemas/performance.schema.ts` - PASS
- `rg -n "seatMapRows\\[0\\]" apps/api/src/modules/performance/performance.service.ts` - PASS (no matches)
- `rg -n "default 1F|legacy single-floor|floorKey: '1F'|floorLabel: '1층'" apps/api/src/modules/performance/performance.service.spec.ts` - PASS
- `rg -n "saveSeatMapPayloadSchema|createPerformanceSchema|updatePerformanceSchema|SaveSeatMapPayloadInput" apps/api/src/modules/admin/admin-performance.controller.ts` - PASS
- `rg -n "replaceSeatMaps|persistBookingPolicy|assertUniqueFloorKeys|bookingPolicies|seatMaps" apps/api/src/modules/admin/admin.service.ts` - PASS
- `rg -n "multi-floor|duplicate floorKey|legacy single-seat-map|persists floor-aware seatMaps and bookingPolicy" apps/api/src/modules/admin/admin.service.spec.ts` - PASS

## Next Phase Readiness

- Downstream booking runtime plans can now consume authoritative `seatMaps[]` and `bookingPolicy` data without inferring floor or ticket limits from UI-only state.
- Admin editor/upload work can target the existing `saveSeatMapPayloadSchema` and duplicate-floor contract instead of inventing a new server payload.
- Legacy single-floor records and legacy single-save payloads remain compatible through default `1F` normalization.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-06-SUMMARY.md`.
- Verified task commits `16eab11`, `395354a`, `955e98b`, and `9605537` exist in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
