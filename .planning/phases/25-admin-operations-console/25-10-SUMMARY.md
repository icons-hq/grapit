---
phase: 25-admin-operations-console
plan: "10"
subsystem: admin-support-content
tags: [admin-operations, support-content, faq, notices, translation-review, tdd]

requires:
  - phase: 25-admin-operations-console
    plan: "07"
    provides: Admin audit/security primitives and support.manage capability context
provides:
  - FAQ and notice authoring/review backend service and controller
  - Admin support-content React Query hooks
  - FAQ/notice authoring, review, publish, and archive UI surface
affects: [25-23, ADMIN-02]

tech-stack:
  added: []
  patterns:
    - Locale-row support content lifecycle with manual ko/en source content
    - Assisted th/zh content review gate before publish
    - React Query mutation invalidation for support-content and operations inbox families

key-files:
  created:
    - apps/api/src/modules/admin/admin-support-content.controller.ts
    - apps/api/src/modules/admin/admin-support-content.service.ts
    - apps/api/src/modules/admin/admin-support-content.service.spec.ts
    - apps/web/hooks/use-admin-support-content.ts
    - apps/web/app/admin/support-content/page.tsx
    - apps/web/components/admin/support-content-manager.tsx
    - apps/web/components/admin/__tests__/support-content-manager.test.tsx
  modified: []

key-decisions:
  - "Kept support content controller/service unregistered in AdminModule because final wiring is explicitly reserved for Plan 25-23."
  - "Used existing support_faqs/support_notices locale-row schema instead of introducing a new grouping table or schema column."
  - "Did not call TranslationService notice draft generation; ko/en are manual source rows and assisted th/zh rows require operator review before publish."

requirements-completed: [ADMIN-01, ADMIN-02]

duration: 15m57s
started: 2026-05-14T02:04:31Z
completed: 2026-05-14T02:20:28Z
---

# Phase 25 Plan 10: Support Content Authoring Summary

**FAQ/notice authoring with manual ko/en source content, assisted th/zh review gating, and admin review/publish UI.**

## Performance

- **Duration:** 15m57s
- **Started:** 2026-05-14T02:04:31Z
- **Completed:** 2026-05-14T02:20:28Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `AdminSupportContentService` for FAQ and notice create/edit/review/publish/archive/list/detail lifecycle.
- Added `AdminSupportContentController` under `/api/v1/admin/support-content` with `support.manage` capability metadata and role/capability guards.
- Enforced Phase 25 translation policy: `ko` and `en` are manual source content; assisted `th`, `zh-CN`, and `zh-TW` rows carry `자동 번역 검수본` and cannot publish before review.
- Added `/admin/support-content`, `use-admin-support-content.ts`, and `SupportContentManager` with FAQ/notice tabs, create/edit form, detail preview, review/publish/archive controls, and operations inbox linkage.
- Added TDD coverage for backend lifecycle/review gating and frontend authoring/review surfaces plus React Query invalidation.

## Task Commits

1. **Task 1 RED: support content backend workflow tests** - `81d1d06` (`test`)
2. **Task 1 GREEN: support content backend lifecycle** - `bb0ebe6` (`feat`)
3. **Task 2 RED: support content manager tests** - `8e956bb` (`test`)
4. **Task 2 GREEN: support content admin manager** - `6e7a92a` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/admin/admin-support-content.controller.ts` - Admin FAQ/notice controller endpoints with `support.manage` capability metadata.
- `apps/api/src/modules/admin/admin-support-content.service.ts` - FAQ/notice lifecycle service with memory-store tests and Drizzle-backed implementation.
- `apps/api/src/modules/admin/admin-support-content.service.spec.ts` - TDD coverage for FAQ CRUD, notice CRUD, review gating, publish/archive, manual ko/en, and assisted translation labels.
- `apps/web/hooks/use-admin-support-content.ts` - React Query hooks and mutation invalidation for support content and operations inbox families.
- `apps/web/app/admin/support-content/page.tsx` - Admin support content route entry.
- `apps/web/components/admin/support-content-manager.tsx` - FAQ/notice authoring/review manager UI.
- `apps/web/components/admin/__tests__/support-content-manager.test.tsx` - Component and hook tests for authoring, review, publish disabled state, translation-use label, and inbox linkage.

## Decisions Made

- Existing `support_faqs` and `support_notices` are locale-row tables, so this plan manages content at the locale-row level rather than adding a new cross-locale content group. A new table/column would have been an architectural change outside this plan.
- Controller/provider registration was not added to `admin.module.ts`; the user and plan explicitly reserved final wiring for `25-23`.
- `scheduledAt` is preserved as notice metadata, but notice create/edit stays in `draft` until an explicit publish action.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies for local verification**
- **Found during:** Task 1 RED
- **Issue:** `vitest` was unavailable in the isolated worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile`.
- **Files modified:** None tracked; dependency directories are ignored.
- **Commit:** Not committed.

**2. [Rule 3 - Blocking] Built shared type artifacts for API typecheck**
- **Found during:** Task 1 GREEN
- **Issue:** `pnpm --filter @grabit/api typecheck` could not resolve `@grabit/shared` declarations before `packages/shared/dist` existed.
- **Fix:** Ran `pnpm --filter @grabit/shared build`.
- **Files modified:** None tracked; generated `dist` output is ignored.
- **Commit:** Not committed.

**3. [Rule 3 - Blocking] Missing read_first UI file handled by existing contract**
- **Found during:** Task 2 context read
- **Issue:** `apps/web/components/admin/operations-inbox.tsx` did not exist in this worktree even though the plan listed it under `read_first`.
- **Fix:** Preserved the plan's operations linkage by invalidating `['admin','operations']` and adding `/admin/operations?source=notice_followup` route linkage without creating or modifying an out-of-scope inbox file.
- **Files modified:** `apps/web/hooks/use-admin-support-content.ts`, `apps/web/components/admin/support-content-manager.tsx`
- **Commit:** `6e7a92a`

## Known Stubs

None. Stub scan found no TODO/FIXME/placeholder strings or hardcoded empty data flowing into the UI. Empty arrays/objects are limited to tests, query defaults, or mutation request bodies.

## Threat Flags

None. The new network endpoints and support-content state transitions are the exact trust boundary covered by `T-25-05` and `T-25-06`: actor/timestamp state is persisted on review/publish/archive fields, and assisted translation-use labels are preserved.

## Authentication Gates

None.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/admin/admin-support-content.service.spec.ts` - PASS; exact script ran full API suite, 62 files / 617 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `pnpm --filter @grabit/web test -- components/admin/__tests__/support-content-manager.test.tsx` - PASS; exact script ran full web suite, 57 files / 369 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.

## TDD Gate Compliance

- Backend RED commit `81d1d06` failed because `admin-support-content.service.ts` did not exist, then GREEN commit `bb0ebe6` made the backend tests pass.
- Frontend RED commit `8e956bb` failed because `support-content-manager` and `use-admin-support-content` did not exist, then GREEN commit `6e7a92a` made the frontend tests pass.

## Next Phase Readiness

Plan `25-23` can register the support content controller/provider and sidebar route after remaining Phase 25 admin modules are ready for final wiring. Route-level smoke is intentionally deferred until that wiring plan.

## Self-Check: PASSED

- Verified all seven created source/test files exist.
- Verified summary file exists at `.planning/phases/25-admin-operations-console/25-10-SUMMARY.md`.
- Verified task commits `81d1d06`, `bb0ebe6`, `8e956bb`, and `6e7a92a` exist in git history.
- Verified no tracked file deletions were introduced.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
