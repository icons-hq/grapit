---
phase: quick-260517-glr-admin-performance-detail-visibility-toggles
plan: 01
type: quick
status: complete
completed_at: 2026-05-17T03:16:55Z
duration: "~11m"
requirements:
  - QUICK-260517-GLR
commits:
  - 323ebde
  - 00a2efe
  - ef1c910
  - 9549ce1
key_files:
  created:
    - apps/api/src/database/migrations/0019_performance_copy_visibility.sql
    - apps/web/components/admin/__tests__/performance-form-visibility.test.tsx
  modified:
    - apps/api/src/database/schema/performances.ts
    - apps/api/src/database/migrations/meta/_journal.json
    - packages/shared/src/schemas/performance.schema.ts
    - packages/shared/src/schemas/performance.schema.test.ts
    - packages/shared/src/types/performance.types.ts
    - apps/api/src/modules/admin/admin.service.ts
    - apps/api/src/modules/admin/admin-performance.controller.ts
    - apps/api/src/modules/admin/admin.service.spec.ts
    - apps/api/src/modules/performance/performance.service.ts
    - apps/api/src/modules/performance/performance.service.spec.ts
    - apps/web/hooks/use-admin.ts
    - apps/web/components/admin/performance-form.tsx
    - apps/web/app/performance/[id]/page.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
    - apps/web/hooks/__tests__/use-booking.test.tsx
decisions:
  - Admin edit reload uses guarded /api/v1/admin/performances/:id so hidden copy can be preserved without exposing it through the public detail endpoint.
  - Public masking happens after locale translation overlay, preventing hidden translated copy from leaking back into responses.
  - Detail images remain independent from description text visibility.
---

# Phase quick-260517-glr Plan 01: Admin Performance Detail Visibility Toggles Summary

Admin-controlled `descriptionVisible` and `salesInfoVisible` flags now persist separately from performance copy, reload through the protected admin endpoint, and mask hidden copy from public API/page surfaces.

## Completed Work

| Task | Status | Commit | Notes |
| ---- | ------ | ------ | ----- |
| Task 1: Persist visibility flags and enforce API masking | Complete | 323ebde, 00a2efe | Added RED API/schema tests, DB columns/migration, shared contract fields, admin persistence, guarded include-hidden detail path, and public response masking. |
| Task 2: Add admin header controls and public section omission | Complete | ef1c910, 9549ce1 | Added RED UI tests, admin endpoint hook, section header switches/chips, preserved text submission, and public detail section/nav omission while keeping detail images visible. |

## Verification

| Command | Result |
| ------- | ------ |
| `pnpm --filter @grabit/shared test -- src/schemas/performance.schema.test.ts` | Passed: 8 files, 46 tests |
| `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/performance/performance.service.spec.ts` | Passed: 65 files, 691 tests |
| `pnpm --filter @grabit/web test -- components/admin/__tests__/performance-form-visibility.test.tsx 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx'` | Passed: 71 files, 438 tests |
| `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` | Passed |

## TDD Gate Compliance

- RED API/schema commit: `323ebde`
- GREEN API/schema commit: `00a2efe`
- RED UI commit: `ef1c910`
- GREEN UI commit: `9549ce1`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added local `ResizeObserver` test polyfill**
- **Found during:** Task 2 RED UI test execution
- **Issue:** Radix/shadcn form controls in jsdom required `ResizeObserver`, blocking the intended visibility assertions before implementation.
- **Fix:** Added a focused test-local polyfill in `performance-form-visibility.test.tsx`.
- **Files modified:** `apps/web/components/admin/__tests__/performance-form-visibility.test.tsx`
- **Commit:** `ef1c910`

**2. [Rule 3 - Blocking] Updated fixture shapes for new shared contract**
- **Found during:** Task 2 GREEN typecheck
- **Issue:** Existing web test fixtures needed the new required visibility fields after the shared `Performance` type changed.
- **Fix:** Added explicit `descriptionVisible` and `salesInfoVisible` values to affected fixtures.
- **Files modified:** `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx`, `apps/web/hooks/__tests__/use-booking.test.tsx`
- **Commit:** `9549ce1`

## Known Stubs

None. Targeted stub scan found only intentional admin form input placeholder attributes, not mock data or unfinished UI paths.

## Threat Flags

None beyond the planned trust boundaries in the quick plan. The new admin/public data split and DB migration match the registered threat mitigations.

## Notes

- Existing showtime update behavior, publish flow, booking policy handling, and cache invalidation paths were preserved.
- `STATE.md`, `ROADMAP.md`, `PLAN.md`, `CONTEXT.md`, and this `SUMMARY.md` were not committed per quick task constraints.

## Self-Check: PASSED

- Found summary file: `.planning/quick/260517-glr-https-heygrabit-com-admin-performances-1/260517-glr-SUMMARY.md`
- Found commits: `323ebde`, `00a2efe`, `ef1c910`, `9549ce1`
- Git status contains only the untracked quick planning artifact directory, intentionally left uncommitted for the orchestrator.
