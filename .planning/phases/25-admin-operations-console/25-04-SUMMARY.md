---
phase: 25-admin-operations-console
plan: "04"
subsystem: database
tags: [admin, operations, drizzle, zod, event-publish, venue, banners]

requires:
  - phase: 25-03
    provides: Admin operations shared capability and lifecycle contracts
  - phase: 25-01..25-20
    provides: zh-TW launch locale drift reconciliation
provides:
  - Event publish lifecycle schema separated from public sales/display status
  - Venue access notes and transport summary schema contract
  - Banner placement, device targeting, schedule, and status schema contract
  - Phase 25 schema regression test for migration prerequisites
affects: [25-06, 25-08, 25-13]

tech-stack:
  added: []
  patterns:
    - Separate admin publish lifecycle enum beside public performance_status
    - Expand-only banner defaults preserving existing image upload behavior

key-files:
  created:
    - apps/api/src/database/schema/phase25-admin-content.schema.spec.ts
  modified:
    - packages/shared/src/schemas/performance.schema.ts
    - packages/shared/src/types/performance.types.ts
    - apps/api/src/database/schema/performances.ts
    - apps/api/src/database/schema/venues.ts
    - apps/api/src/database/schema/banners.ts
    - apps/api/src/database/schema/index.ts
    - apps/api/src/modules/admin/admin.service.ts
    - apps/api/src/modules/performance/performance.service.ts

key-decisions:
  - "Internal event publishing uses performance_publish_state with draft/review/publish_ready/published and does not overload performance_status."
  - "Banner operations add placement/device/schedule/status with defaults that keep existing active image banners compatible."

patterns-established:
  - "Schema-first admin content contracts are locked by Vitest before Phase 25 migration generation."
  - "Expanded banner fields are mapped through both admin and public banner service responses."

requirements-completed: [ADMIN-01, ADMIN-04]

duration: 9 min
completed: 2026-05-14
---

# Phase 25 Plan 04: Admin Content Schema Contracts Summary

**Event publish lifecycle, venue transport metadata, and banner operations schema contracts are ready for Phase 25 migration generation.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-14T00:52:13Z
- **Completed:** 2026-05-14T01:01:35Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Added `performance_publish_state` with exactly `draft`, `review`, `publish_ready`, and `published`, keeping it separate from public `performance_status`.
- Added venue `access_notes` and `transport_summary` fields plus shared validation fields for admin event publish review.
- Added banner `placement`, `device_target`, `starts_at`, `ends_at`, and `status` contracts while preserving existing `image_url`, `link_url`, `sort_order`, and `is_active` fields.
- Added schema regression coverage that locks the shared zod contracts, Drizzle enums/columns, and schema barrel exports.

## Task Commits

1. **Task 1 RED:** `2394ac5` (test) - failing schema contract tests for admin event, venue, transport, and banner fields
2. **Task 1 GREEN:** `b9970d0` (feat) - shared and Drizzle schema contracts plus compatible service mappers

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `apps/api/src/database/schema/phase25-admin-content.schema.spec.ts` - locks Phase 25 admin content schema contracts.
- `packages/shared/src/schemas/performance.schema.ts` - adds publish lifecycle, venue/transport, and banner operation validation.
- `packages/shared/src/types/performance.types.ts` - adds publish/banner types and response field contracts.
- `apps/api/src/database/schema/performances.ts` - adds internal publish lifecycle fields.
- `apps/api/src/database/schema/venues.ts` - adds venue access and transport metadata fields.
- `apps/api/src/database/schema/banners.ts` - adds banner placement/device/schedule/status enums and fields.
- `apps/api/src/database/schema/index.ts` - exports the new enums through the schema barrel.
- `apps/api/src/modules/admin/admin.service.ts` - maps expanded event/banner fields so admin API writes remain compile-safe.
- `apps/api/src/modules/performance/performance.service.ts` - maps expanded banner response fields for public home banners.

## Decisions Made

- Public `performance_status` remains the sales/display state only; admin publish readiness is modeled by `performance_publish_state`.
- Banner defaults are `home_hero`, `all`, and `active` to avoid breaking existing banner create/upload paths before the Phase 25 banner UI expansion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Prepared worktree dependency artifacts for verification**
- **Found during:** Task 1 automated verification
- **Issue:** Fresh worktree had no `node_modules`, and API typecheck could not resolve `@grabit/shared` until the shared package had emitted `dist`.
- **Fix:** Ran `pnpm install --frozen-lockfile` and `pnpm --filter @grabit/shared build`; generated artifacts are ignored and not committed.
- **Files modified:** None tracked
- **Verification:** Final plan automated command passed.
- **Committed in:** N/A

**2. [Rule 3 - Blocking] Added service mappers for expanded banner/event contracts**
- **Found during:** Task 1 GREEN implementation
- **Issue:** Expanding the shared `Banner` and performance publish contract required API mappers to preserve typecheck and existing response compatibility.
- **Fix:** Updated admin and public performance services to persist/map new event and banner fields.
- **Files modified:** `apps/api/src/modules/admin/admin.service.ts`, `apps/api/src/modules/performance/performance.service.ts`
- **Verification:** `pnpm --filter @grabit/api typecheck` and `pnpm --filter @grabit/shared typecheck`
- **Committed in:** `b9970d0`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both were required to verify the planned schema contracts. No scope expansion beyond contract compatibility.

## Issues Encountered

None remaining. The plan verification command passes after the shared package build step.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api exec vitest run database/schema/phase25-admin-content.schema.spec.ts` - PASS
- `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-content.schema.spec.ts && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/shared typecheck` - PASS

## Next Phase Readiness

Phase 25 can proceed to support/FAQ/notice schema split in `25-21`, then the Phase 25 Drizzle migration gate in `25-06`.

## Self-Check: PASSED

- Summary exists at `.planning/phases/25-admin-operations-console/25-04-SUMMARY.md`.
- Created schema test exists at `apps/api/src/database/schema/phase25-admin-content.schema.spec.ts`.
- Task commits found: `2394ac5`, `b9970d0`.
- `STATE.md`, `ROADMAP.md`, and `REQUIREMENTS.md` were not modified.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
