---
phase: 25-admin-operations-console
plan: "23"
subsystem: admin-operations
tags: [admin, rbac, security, audit, navigation, playwright, nestjs, nextjs]

requires:
  - phase: 25-admin-operations-console
    provides: Phase 25 operations, support content, seat operations, audit, and security controllers/services from prior plans
  - phase: 25-admin-operations-console
    provides: Plan 25-14 audit/security surfaces and deferred MFA accepted-risk copy
provides:
  - Final AdminModule registration for Phase 25 operations/support/seat/audit/security controllers and providers
  - Grouped admin sidebar entries for operations, FAQ/notice, seat operations, audit log, and security settings
  - Explicit admin access-denied layout state for non-admin users while backend guards remain authoritative
  - Route wiring smoke coverage for AdminModule registrations, admin sidebar links, and deferred MFA security UI
affects: [25-15, admin-console, admin-rbac, route-verification, security-operations]

tech-stack:
  added: []
  patterns:
    - AdminSecurityService is registered through an AdminModule factory provider to avoid Nest resolving the optional options object.
    - Admin sidebar navigation is grouped by overview, event/content, operations, and audit/security while preserving existing links.
    - Admin access denial is rendered as a visible role=alert state instead of a blank client redirect.

key-files:
  created:
    - apps/web/e2e/admin-rbac-and-security.spec.ts
  modified:
    - apps/api/src/modules/admin/admin.module.ts
    - apps/web/app/admin/layout.tsx
    - apps/web/components/admin/admin-sidebar.tsx

key-decisions:
  - "Registered AdminSecurityService with a factory provider because its optional options constructor argument should not become a Nest injection dependency."
  - "Kept client access-denied as UX only; backend RolesGuard and AdminCapabilitiesGuard remain the authoritative enforcement layer."
  - "Recorded the exact E2E command blocker instead of killing the unrelated process occupying localhost:3000."

patterns-established:
  - "Route wiring smoke can combine static AdminModule registration assertions with mocked-auth browser checks for shell/access-denied behavior."
  - "Phase 25 admin navigation groups new operations/security routes without removing dashboard, performances, banners, bookings, consent audit, or translations entries."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04]

duration: 14m21s
completed: 2026-05-14
---

# Phase 25 Plan 23: Admin Route Wiring Summary

**Phase 25 admin controllers, providers, grouped navigation, access-denied UX, and RBAC/security route smoke are wired together.**

## Performance

- **Duration:** 14m21s
- **Started:** 2026-05-14T03:31:05Z
- **Completed:** 2026-05-14T03:45:26Z
- **Tasks:** 1
- **Files modified:** 4 source/test files plus this summary

## Accomplishments

- Registered `AdminOperationsController`, `AdminSupportContentController`, `AdminSeatOperationsController`, `AdminAuditController`, and `AdminSecurityController` in `AdminModule`.
- Registered Phase 25 admin providers including operations, support content, seat operations, audit, security, and `AdminCapabilitiesGuard`.
- Added grouped sidebar links for `운영 인박스`, `FAQ/공지`, `좌석 운영`, `감사 로그`, and `보안 설정` while preserving all existing admin entries.
- Replaced the previous blank/redirect admin layout failure state with an explicit `관리자 접근 권한이 없습니다` access-denied surface.
- Added `admin-rbac-and-security.spec.ts` covering module registration, non-admin access denial, preserved/new sidebar links, and deferred MFA copy.

## Task Commits

1. **Task 1: Register AdminModule, sidebar, layout access state, and route-level E2E** - `cfec19f` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/admin/admin.module.ts` - Final Phase 25 controller/provider wiring and factory registration for `AdminSecurityService`.
- `apps/web/app/admin/layout.tsx` - Adds loading and explicit access-denied UI for non-admin users.
- `apps/web/components/admin/admin-sidebar.tsx` - Groups admin navigation and adds operations/support/seat/audit/security links.
- `apps/web/e2e/admin-rbac-and-security.spec.ts` - Adds route wiring smoke for module registrations, access denial, sidebar links, and deferred MFA visibility.

## Decisions Made

- Registered `AdminSecurityService` through a factory provider so Nest injects only `DRIZZLE` and `AdminAuditService`; the optional service options object stays an implementation default.
- Kept route-level E2E focused on RBAC/security shell behavior and registration assertions because final full-suite validation is Plan 25-15 scope.
- Did not kill the unrelated process on `localhost:3000`; verified with a worktree server on `3001` instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies for isolated worktree verification**
- **Found during:** Verification setup
- **Issue:** The isolated worktree had no `node_modules`, so typecheck/E2E tools were unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile`; generated dependency directories are ignored.
- **Files modified:** None tracked.
- **Verification:** Subsequent API/web typecheck commands ran.
- **Committed in:** Not committed; generated dependency directories are ignored.

**2. [Rule 3 - Blocking] Built `@grabit/shared` declarations for typecheck**
- **Found during:** Verification setup
- **Issue:** `packages/shared/dist` was absent in the fresh worktree.
- **Fix:** Ran `pnpm --filter @grabit/shared build`.
- **Files modified:** None tracked.
- **Verification:** `pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** Not committed; generated package output is ignored.

**3. [Rule 2 - Missing Critical] Avoided Nest optional-options DI failure for AdminSecurityService**
- **Found during:** AdminModule registration
- **Issue:** Registering `AdminSecurityService` as a plain class provider would require Nest to resolve its optional options object.
- **Fix:** Registered it with a factory provider injecting only `DRIZZLE` and `AdminAuditService`.
- **Files modified:** `apps/api/src/modules/admin/admin.module.ts`
- **Verification:** API typecheck passed and `admin-rbac-and-security.spec.ts` asserts the registration is present.
- **Committed in:** `cfec19f`

**4. [Rule 3 - Blocking] Ran E2E smoke on alternate port because localhost:3000 is occupied**
- **Found during:** Requested E2E verification
- **Issue:** `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts` failed before tests because `localhost:3000` is already used by `/Users/sangwopark19/workspace/fso/notes-app`.
- **Fix:** Left the unrelated process untouched, started this worktree web server on `3001`, and ran the same spec with a temporary Playwright config.
- **Files modified:** None tracked.
- **Verification:** Alternate-port E2E passed: 3 tests / 3 passed.
- **Committed in:** Not committed; verification-only workaround.

---

**Total deviations:** 4 auto-fixed (Rule 3: 3, Rule 2: 1)  
**Impact on plan:** Product scope stayed within the user-provided write scope. Verification was truthful: exact E2E command is blocked by an unrelated port conflict, while equivalent worktree browser smoke passed on port `3001`.

## Issues Encountered

- `apply_patch` initially applies relative to the parent checkout. I re-applied the patch under `.codex/worktrees/agent-25-23/`, removed the accidental parent E2E file, restored the parent plan-owned files, and verified those parent paths are clean.
- The exact Playwright command cannot run while `localhost:3000` is occupied by the unrelated `notes-app` Next server. I did not terminate that process.

## Known Stubs

None in the files created/modified by this plan. Stub scan found no `TODO`, `FIXME`, placeholder data source, or mock-only UI in the changed files.

## Threat Flags

None. The touched surfaces match the plan threat model:

| Flag | File | Description |
|------|------|-------------|
| Covered by T-25-23-01 | `apps/web/app/admin/layout.tsx` | Client access-denied state is UX only; backend guards remain authoritative. |
| Covered by T-25-23-02 | `apps/api/src/modules/admin/admin.module.ts` | Controllers are registered before route smoke coverage. |

## Authentication Gates

None.

## Verification

- `pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` - PASS.
- `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts` - BLOCKED before test execution: `http://localhost:3000 is already used`; owner process is `next-server (v16.2.5)` with cwd `/Users/sangwopark19/workspace/fso/notes-app`.
- `TZ=UTC pnpm --filter @grabit/web exec playwright test admin-rbac-and-security.spec.ts --config=/tmp/grapit-admin-rbac-playwright.config.mjs` with this worktree server on `http://localhost:3001` - PASS, 3 tests / 3 passed.
- `git diff --check -- apps/api/src/modules/admin/admin.module.ts apps/web/app/admin/layout.tsx apps/web/components/admin/admin-sidebar.tsx apps/web/e2e/admin-rbac-and-security.spec.ts` - PASS.

## TDD Gate Compliance

Warning: the task is marked `tdd="true"`, but the plan and user prompt both required route-level E2E to be updated only after AdminModule/sidebar wiring. I did not create a RED test commit before implementation; route smoke coverage was added after wiring and committed atomically in `cfec19f`.

## User Setup Required

None for product behavior. To run the exact E2E command locally, free `localhost:3000` or run against an isolated port/config as done above.

## Next Phase Readiness

Plan 25-15 can now aggregate Phase 25 verification against the final AdminModule/sidebar/security wiring. One downstream check remains outside this plan's write scope: the sidebar exposes `/admin/seat-operations`, but the route page file itself is not part of the 25-23 ownership list.

## Self-Check: PASSED

- Verified all four source/test files exist.
- Verified summary file exists at `.planning/phases/25-admin-operations-console/25-23-SUMMARY.md`.
- Verified task commit `cfec19f` exists in git history.
- Verified no tracked file deletions were introduced by the task commit.
- Verified parent checkout plan-owned paths are clean after the patch relocation.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
