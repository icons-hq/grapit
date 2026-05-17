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
  - 7716640
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
    - apps/api/src/modules/booking/providers/redis.provider.ts
    - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
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
| Browser gap: local cache invalidation parity | Complete | 7716640 | Browser save/reload found stale public detail responses in local dev because `InMemoryRedis` lacked `keys()`. Added wildcard key support so `CacheService.invalidatePattern()` works in local/dev parity. |

## Verification

| Command | Result |
| ------- | ------ |
| `pnpm --filter @grabit/shared test -- src/schemas/performance.schema.test.ts` | Passed: 8 files, 46 tests |
| `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/performance/performance.service.spec.ts` | Passed: 65 files, 691 tests |
| `pnpm --filter @grabit/web test -- components/admin/__tests__/performance-form-visibility.test.tsx 'app/performance/[id]/__tests__/performance-detail-formatting.test.tsx'` | Passed: 71 files, 438 tests |
| `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` | Passed |
| Browser use on local dev (`localhost:3000` + `localhost:8080`) | Passed: admin login, create dedicated test performance, hide both copy blocks, admin reload preserves hidden text, public page omits hidden detail/sales anchors and copy while keeping detail image, restore visibility and public copy returns |
| `pnpm --filter @grabit/api test -- src/modules/booking/providers/__tests__/redis.provider.spec.ts src/modules/performance/__tests__/cache.service.spec.ts` | Passed: 65 files, 692 tests |
| `pnpm --filter @grabit/api typecheck` | Passed |

## TDD Gate Compliance

- RED API/schema commit: `323ebde`
- GREEN API/schema commit: `00a2efe`
- RED UI commit: `ef1c910`
- GREEN UI commit: `9549ce1`
- Browser gap fix commit: `7716640`

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

**3. [Browser verification gap] Local cache invalidation mock parity**
- **Found during:** Browser use save/reload/public verification
- **Issue:** DB/admin API updated correctly, but local public detail responses stayed stale after visibility restore because the development `InMemoryRedis` mock did not implement `keys()`, so `CacheService.invalidatePattern()` logged a warning and left cached detail payloads alive until TTL.
- **Fix:** Added wildcard `keys(pattern)` support to `InMemoryRedis` and regression coverage for cache invalidation patterns.
- **Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`
- **Commit:** `7716640`

## Known Stubs

None. Targeted stub scan found only intentional admin form input placeholder attributes, not mock data or unfinished UI paths.

## Threat Flags

None beyond the planned trust boundaries in the quick plan. The new admin/public data split and DB migration match the registered threat mitigations.

## Notes

- Existing showtime update behavior, publish flow, and booking policy handling were preserved.
- Local cache invalidation now matches the pattern-invalidation contract needed by admin performance edits.

## Self-Check: PASSED

- Found summary file: `.planning/quick/260517-glr-https-heygrabit-com-admin-performances-1/260517-glr-SUMMARY.md`
- Found commits: `323ebde`, `00a2efe`, `ef1c910`, `9549ce1`, `7716640`
- Browser verification completed against a temporary local test performance; the temporary row was deleted after verification.
