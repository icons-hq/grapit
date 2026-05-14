---
phase: 25-admin-operations-console
plan: "14"
subsystem: admin-operations
tags: [admin, audit, security, ip-allowlist, mfa-deferred, react-query, nestjs]

requires:
  - phase: 25-admin-operations-console
    provides: Plan 25-07 masked AdminAuditService and AdminSecurityService primitives
  - phase: 25-admin-operations-console
    provides: Plan 25-23 final AdminModule/sidebar route wiring remains downstream
provides:
  - audit.read-protected AdminAuditController returning masked audit query rows
  - security.manage-protected AdminSecurityController returning service-backed allowlist decision state
  - /admin/audit masked audit table with actor/action/resource/status/time/masked IP/reason/changed-field summary
  - /admin/security allowlist state surface and exact deferred MFA accepted-risk copy
affects: [25-23, admin-console, security-operations, audit-monitoring]

tech-stack:
  added: []
  patterns:
    - New unregistered admin controllers can be built with RolesGuard plus AdminCapabilitiesGuard before final 25-23 wiring.
    - Admin security UI must present MFA as deferred accepted risk, never as implemented or PASS.
    - Audit table summaries render only changed field names plus masked/safe diff values.

key-files:
  created:
    - apps/api/src/modules/admin/admin-audit.controller.ts
    - apps/api/src/modules/admin/admin-security.controller.ts
    - apps/web/hooks/use-admin-security.ts
    - apps/web/app/admin/audit/page.tsx
    - apps/web/app/admin/security/page.tsx
    - apps/web/components/admin/admin-audit-table.tsx
    - apps/web/components/admin/admin-security-summary.tsx
  modified: []

key-decisions:
  - "Did not register AdminAuditController or AdminSecurityController in AdminModule; final registration and route-level E2E remain Plan 25-23 scope."
  - "Used AdminSecurityService.evaluateRequest as the service-backed security status source because the current service exposes request evaluation and allowlist creation, not full allowlist listing."
  - "Kept the exact D-08 copy visible: MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다."

patterns-established:
  - "Admin audit/security pages expose required capabilities through data attributes and hook constants: audit.read and security.manage."
  - "Security allowlist mutations invalidate both admin security and admin audit query families."
  - "Changed-field summaries redact sensitive nested keys even when upstream audit snapshots are already masked."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04]

duration: 9m37s
completed: 2026-05-14
---

# Phase 25 Plan 14: Audit And Security Surfaces Summary

**Capability-protected audit/security controllers plus masked admin audit and allowlist UI with MFA preserved as deferred accepted risk.**

## Performance

- **Duration:** 9m37s
- **Started:** 2026-05-14T03:17:24Z
- **Completed:** 2026-05-14T03:27:01Z
- **Tasks:** 2
- **Files modified:** 7 source files plus this summary

## Accomplishments

- Added `AdminAuditController` at `admin/audit` with `RolesGuard`, `AdminCapabilitiesGuard`, `audit.read`, Zod query validation, and masked IP response shaping.
- Added `AdminSecurityController` at `admin/security` with `security.manage`, service-backed request allowlist decision state, allowlist record creation, and D-08 MFA deferred status.
- Added `use-admin-security.ts` for audit queries, security status, allowlist mutation, and query invalidation.
- Added `/admin/audit` and `AdminAuditTable` showing actor, action, resource, status, time, masked IP, reason, and safe changed-field summaries.
- Added `/admin/security` and `AdminSecuritySummary` showing allowlist state, current request evidence, and the exact deferred MFA copy.

## Task Commits

1. **Task 1: Add audit and security controllers** - `029fedf` (`feat`)
2. **Task 2: Build audit and security pages** - `8bd309f` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/admin/admin-audit.controller.ts` - Masked audit query controller requiring `audit.read`.
- `apps/api/src/modules/admin/admin-security.controller.ts` - Security status and allowlist mutation controller requiring `security.manage`.
- `apps/web/hooks/use-admin-security.ts` - React Query hook layer for audit/security APIs.
- `apps/web/app/admin/audit/page.tsx` - Admin audit page shell.
- `apps/web/app/admin/security/page.tsx` - Admin security page shell and allowlist form.
- `apps/web/components/admin/admin-audit-table.tsx` - Dense masked audit table and filters.
- `apps/web/components/admin/admin-security-summary.tsx` - Allowlist/current-request/MFA deferred summary.

## Decisions Made

- Controllers were intentionally left unregistered in `AdminModule` to honor the plan split; Plan 25-23 owns final registration, sidebar, and route-level E2E.
- The security summary uses the existing `AdminSecurityService.evaluateRequest()` result as its service-backed allowlist evidence. Full allowlist record listing is not implemented in this plan because it would require service expansion outside the owned write scope.
- MFA was not implemented and is not presented as PASS. The UI displays the exact accepted-risk/deferred copy required by the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies for isolated worktree verification**
- **Found during:** Task 1 verification
- **Issue:** `pnpm --filter @grabit/api test -- ...` failed with `vitest: command not found` because the isolated worktree had no `node_modules`.
- **Fix:** Ran `pnpm install --frozen-lockfile`; no tracked source or lockfile changes were produced.
- **Files modified:** None tracked.
- **Verification:** Re-ran the API command successfully.
- **Committed in:** Not committed; generated dependency directories are ignored.

**2. [Rule 3 - Blocking] Built `@grabit/shared` declarations for API/web typecheck**
- **Found during:** Task 1 typecheck
- **Issue:** API typecheck could not resolve `@grabit/shared` declaration output in the fresh worktree.
- **Fix:** Ran `pnpm --filter @grabit/shared build`; generated package output is ignored.
- **Files modified:** None tracked.
- **Verification:** API and web typecheck passed after the build.
- **Committed in:** Not committed; generated dist is ignored.

**3. [Rule 1 - Bug] Fixed controller request metadata nullability**
- **Found during:** Task 1 typecheck
- **Issue:** `AdminSecurityService.createAllowlistRecord` expects optional `requestId` and `userAgent`, but the controller initially passed `null`.
- **Fix:** Passed `undefined` for missing request metadata while preserving nullable `expiresAt`.
- **Files modified:** `apps/api/src/modules/admin/admin-security.controller.ts`
- **Verification:** `pnpm --filter @grabit/api typecheck` passed.
- **Committed in:** `029fedf`

---

**Total deviations:** 3 auto-fixed (Rule 3: 2, Rule 1: 1)  
**Impact on plan:** No scope expansion beyond plan-owned files. Environment fixes were required for verification, and the controller type fix was necessary for correctness.

## Issues Encountered

- The package `test` script passes file arguments after `vitest run --`, so the exact API command ran the full API suite. It passed with 64 files / 641 tests.
- One patch initially landed in the parent checkout because `apply_patch` is not workdir-scoped. Those untracked files were moved into the isolated worktree before any commit, and the parent checkout was verified clean for the plan-owned paths.

## Known Stubs

None. Stub scan found only legitimate form placeholder attributes, `null` formatting logic, empty query defaults, and TanStack Query `placeholderData`; no mock-only data source or placeholder UI blocks the plan goal.

## Threat Flags

None - the new admin browser/API security surfaces are covered by the plan threat model:

- `T-25-14-01`: audit table/detail returns masked diffs and the UI additionally redacts sensitive nested keys.
- `T-25-14-02`: MFA is surfaced only as `deferred_accepted_risk`.
- `T-25-14-03`: audit/security controllers require backend `audit.read` and `security.manage` capabilities.

## Authentication Gates

None.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/admin/admin-audit.service.spec.ts src/modules/admin/admin-security.service.spec.ts && pnpm --filter @grabit/api typecheck` - PASS. Exact command ran full API suite: 64 files / 641 tests, then API typecheck passed.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `rg -n "MFA는 아직 적용되지 않았습니다|audit.read|security.manage" apps/web/app/admin/security/page.tsx apps/web/components/admin/admin-security-summary.tsx apps/web/components/admin/admin-audit-table.tsx apps/web/hooks/use-admin-security.ts` - PASS. Exact MFA copy and required capability strings are present.

## TDD Gate Compliance

Warning: the plan marked both tasks `tdd="true"`, but the user-provided ownership/write scope excluded new test files. I did not add RED test commits outside scope. Verification relied on existing service specs plus API/web typecheck and the required grep check.

## User Setup Required

None for product behavior. Fresh isolated worktrees need workspace dependencies installed and `@grabit/shared` built before typecheck.

## Next Phase Readiness

Plan 25-23 can now register `AdminAuditController` and `AdminSecurityController`, add sidebar entries for `/admin/audit` and `/admin/security`, and enable route-level E2E. If operators need a full allowlist record table, a later service/controller expansion should add a service-backed list endpoint rather than deriving it in the UI.

## Self-Check: PASSED

- Verified all seven created source files exist.
- Verified summary file exists at `.planning/phases/25-admin-operations-console/25-14-SUMMARY.md`.
- Verified task commits `029fedf` and `8bd309f` exist in git history.
- Verified no tracked file deletions were introduced by task commits.
- Verified parent checkout has no untracked plan-owned files after the patch relocation.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
