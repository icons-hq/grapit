---
phase: 25-admin-operations-console
plan: "13"
subsystem: admin-operations
tags: [admin, banners, audit, nestjs, react, tanstack-query, vitest]

requires:
  - phase: 25-03
    provides: Banner schema fields and migration-owned enum contract
  - phase: 25-07
    provides: Admin audit log persistence primitives
  - phase: 25-08
    provides: Admin capability guard pattern
provides:
  - Audited banner create/update/delete/reorder runtime behavior
  - banner.manage capability enforcement on banner mutation routes
  - Expanded banner manager controls for placement, device, schedule, status, image URL, link URL, and sort order
  - Admin and public home banner query invalidation after banner mutations
affects: [admin-console, public-home-banners, launch-content-audit]

tech-stack:
  added: []
  patterns:
    - Controller-level AdminCapabilitiesGuard on admin mutation methods
    - AdminService mutation context passed into masked audit events
    - Shared banner schema types reused by admin UI form payloads

key-files:
  created:
    - apps/web/components/admin/__tests__/banner-manager.test.tsx
  modified:
    - apps/api/src/modules/admin/admin-banner.controller.ts
    - apps/api/src/modules/admin/admin.service.ts
    - apps/api/src/modules/admin/admin.service.spec.ts
    - apps/web/hooks/use-admin.ts
    - apps/web/components/admin/banner-manager.tsx

key-decisions:
  - "Kept schema and migration files untouched; prerequisite commit 5b0597f supplied the missing banner.manage audit contract."
  - "Kept banner CRUD inside the existing AdminService and AdminBannerController instead of adding a new module."
  - "Invalidated both ['admin', 'banners'] and ['home', 'banners'] after every banner mutation."

patterns-established:
  - "Banner mutations accept request context and write banner.manage audit snapshots through AdminAuditService."
  - "Banner UI submits shared schema-aligned placement, deviceTarget, schedule, status, sortOrder, imageUrl, and nullable linkUrl fields."

requirements-completed: [ADMIN-03, ADMIN-04]

duration: 21min
completed: 2026-05-14
---

# Phase 25 Plan 13: Banner Operations Summary

**Audited banner management with capability-protected NestJS mutations and schema-aligned React controls for placement, device, schedule, and status**

## Performance

- **Duration:** 21 min
- **Started:** 2026-05-14T02:30:43Z
- **Completed:** 2026-05-14T02:51:54Z
- **Tasks:** 2 completed
- **Files modified:** 6 source/test files plus this summary

## Accomplishments

- Added `banner.manage` capability enforcement to banner create/update/delete/reorder routes.
- Added masked `banner.manage` audit events for banner create/update/delete/reorder, including safe before/after snapshots.
- Validated expanded banner fields and schedule ordering in the backend without touching schema or migration files.
- Expanded the admin banner form with placement, device target, schedule window, status, link, image upload, and sort controls.
- Preserved presigned image upload and invalidated both admin and public home banner query families after every mutation.

## Task Commits

1. **Task 1 RED: Add failing banner audit API tests** - `49ddb21` (test)
2. **Task 1 GREEN: Audit banner API mutations** - `1bddfb7` (feat)
3. **Task 2 RED: Add failing banner manager UI tests** - `cd635ad` (test)
4. **Task 2 GREEN: Expand banner manager controls** - `528313f` (feat)

## Files Created/Modified

- `apps/api/src/modules/admin/admin-banner.controller.ts` - Adds capability guard usage and request context forwarding for banner mutations.
- `apps/api/src/modules/admin/admin.service.ts` - Validates banner mutation payloads, rejects invalid schedules/reorders, and writes audit events.
- `apps/api/src/modules/admin/admin.service.spec.ts` - Covers audit writes, schema-aligned fields, route order, schedule validation, reorder validation, and capability metadata.
- `apps/web/hooks/use-admin.ts` - Invalidates admin and public home banner query families after banner mutations.
- `apps/web/components/admin/banner-manager.tsx` - Adds expanded banner controls and submits schema-aligned payloads.
- `apps/web/components/admin/__tests__/banner-manager.test.tsx` - Covers expanded controls, upload preservation, submit payload, and query invalidation.

## Decisions Made

- Reused the existing admin banner controller/service structure to keep ownership and routing stable.
- Treated prerequisite commit `5b0597f` as the schema/action source of truth and did not edit schema or migration files in this plan.
- Left route-level page wiring outside this plan's ownership; `BannerForm` now supports expanded initial data and payloads for current and future callers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored local test/build prerequisites in the worktree**
- **Found during:** Task 1 verification
- **Issue:** The worktree initially lacked installed dependencies, and API typecheck needed the shared package build output.
- **Fix:** Ran `pnpm install --frozen-lockfile` and `pnpm --filter @grabit/shared build`.
- **Files modified:** None tracked.
- **Verification:** API and web tests/typechecks completed successfully.
- **Committed in:** Not applicable; no tracked file changes.

**2. [Rule 3 - Blocking] Added jsdom DOM API polyfills for Radix Select in the new banner test**
- **Found during:** Task 2 RED/GREEN verification
- **Issue:** Radix Select calls pointer capture and `scrollIntoView`, which jsdom does not implement.
- **Fix:** Added test-local `HTMLElement.prototype` polyfills in `banner-manager.test.tsx`.
- **Files modified:** `apps/web/components/admin/__tests__/banner-manager.test.tsx`
- **Verification:** `pnpm --filter @grabit/web test -- components/admin/__tests__/banner-manager.test.tsx` passed.
- **Committed in:** `528313f`

---

**Total deviations:** 2 auto-fixed blocking issues.
**Impact on plan:** Both fixes were required to execute the requested TDD and verification gates. No schema or migration files were changed.

## Issues Encountered

- The original blocker was resolved before continuation by prerequisite commit `5b0597f`, which added `banner.manage` to audit schema, migration metadata, and audit action constants.
- One accidental edit attempt targeted the parent checkout before worktree containment was rechecked; it was reverted immediately in the parent checkout before continuing in this worktree.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts` - PASS, 63 files / 635 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `pnpm --filter @grabit/web test -- components/admin/__tests__/banner-manager.test.tsx` - PASS, 61 files / 382 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.

## TDD Gate Compliance

- RED commit present before backend implementation: `49ddb21`
- GREEN commit present after backend RED: `1bddfb7`
- RED commit present before web implementation: `cd635ad`
- GREEN commit present after web RED: `528313f`

## Known Stubs

None. Stub scan found only a real form placeholder attribute (`placeholder="https://..."`) and no empty/mock data flows.

## Auth Gates

None.

## Threat Flags

None. The new security-relevant surface matches the plan threat model: `banner.manage` capability enforcement and `banner.manage` audit events.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Banner operations are now capability-protected, audited, cache-safe, and aligned with the schema/migration contract that was supplied before this continuation.

## Self-Check: PASSED

- Verified all modified/created files exist.
- Verified task commits exist: `49ddb21`, `1bddfb7`, `cd635ad`, `528313f`.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
