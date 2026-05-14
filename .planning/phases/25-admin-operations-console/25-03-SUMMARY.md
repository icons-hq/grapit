---
phase: 25-admin-operations-console
plan: "03"
subsystem: api
tags: [admin, rbac, capabilities, audit, zod, nestjs]

requires:
  - phase: 23-launch-foundation
    provides: "locale, consent, and audit foundations"
  - phase: 24-traffic-booking-payment-core
    provides: "booking, refund, seat-operation, and manual-open foundations"
provides:
  - "Admin capability bundle contract for operator, reviewer, approver, finance, and admin"
  - "Shared admin operations DTO schemas for audit, support, export, seat operation, allowlist, and security status"
  - "NestJS AdminCapabilities decorator and guard with server-side fail-closed enforcement"
affects: [admin-console, support-operations, reservation-export, seat-operations, audit-security]

tech-stack:
  added: []
  patterns:
    - "Capability bundles are additive contracts and do not create mandatory approval workflow ceremony"
    - "Existing admin role remains all-capabilities superuser"
    - "MFA is represented only as deferred_accepted_risk"

key-files:
  created:
    - packages/shared/src/schemas/admin-operations.schema.ts
    - packages/shared/src/types/admin-operations.types.ts
    - apps/api/src/common/decorators/admin-capabilities.decorator.ts
    - apps/api/src/common/guards/admin-capabilities.guard.ts
    - apps/api/src/common/guards/admin-capabilities.guard.spec.ts
    - apps/api/src/modules/admin/admin-fixtures.ts
    - apps/api/src/modules/admin/admin-fixtures.spec.ts
    - packages/shared/src/schemas/admin-operations.schema.test.ts
  modified:
    - packages/shared/src/types/user.types.ts
    - packages/shared/src/index.ts

key-decisions:
  - "Keep production role compatibility: role=admin resolves to all admin capabilities."
  - "Use fixture-only operator/reviewer/approver/finance users for tests without adding seeded production users."
  - "Represent MFA as deferred_accepted_risk only; no schema exposes MFA as pass, complete, or implemented."

patterns-established:
  - "AdminCapabilities metadata plus guard checks all required capabilities server-side."
  - "Raw reservation export and capacity-changing seat operations require an operator reason."
  - "Admin audit contracts store masked diff metadata and avoid exported raw PII values."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04]

duration: 10m45s
completed: 2026-05-14T00:34:11Z
---

# Phase 25 Plan 03: Admin Operations Contract Summary

**Admin capability bundles, operations DTO contracts, deterministic fixtures, and NestJS guard enforcement for Phase 25 admin operations.**

## Performance

- **Duration:** 10m45s
- **Started:** 2026-05-14T00:23:26Z
- **Completed:** 2026-05-14T00:34:11Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Defined shared `@grabit/shared` admin operations contracts for capabilities, audit events, support inbox rows, FAQ/notice authoring, allowlist records, reservation export filters, seat operations, and security status.
- Added fixture-only admin capability users so tests can exercise `operator`, `reviewer`, `approver`, and `finance` without changing production seed users.
- Added `@AdminCapabilities()` and `AdminCapabilitiesGuard`, with fail-closed behavior for missing users and `admin` superuser compatibility.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Define shared admin operations contracts** - `59cdcc0` (test)
2. **Task 1 GREEN: Define shared admin operations contracts** - `cd69843` (feat)
3. **Task 2 RED: Add backend capability guard** - `465f3ec` (test)
4. **Task 2 GREEN: Add backend capability guard** - `2e108ad` (feat)

## Files Created/Modified

- `packages/shared/src/schemas/admin-operations.schema.ts` - shared Zod contracts and constants for admin capabilities, support/audit/security/export/seat operations
- `packages/shared/src/types/admin-operations.types.ts` - inferred types and runtime capability resolution helpers
- `packages/shared/src/types/user.types.ts` - user profile capability metadata extension while preserving `user | admin` role compatibility
- `packages/shared/src/index.ts` - shared export surface for admin operations contracts
- `apps/api/src/modules/admin/admin-fixtures.ts` - deterministic fixture-only bundle users
- `apps/api/src/common/decorators/admin-capabilities.decorator.ts` - Nest metadata decorator for required admin capabilities
- `apps/api/src/common/guards/admin-capabilities.guard.ts` - server-side capability guard
- `packages/shared/src/schemas/admin-operations.schema.test.ts` - TDD contract tests for Task 1
- `apps/api/src/modules/admin/admin-fixtures.spec.ts` - fixture helper tests
- `apps/api/src/common/guards/admin-capabilities.guard.spec.ts` - capability guard tests

## Decisions Made

- Capability bundles are backend contracts, not a mandatory serial approval workflow.
- `admin` remains all-capabilities superuser for existing seeded admin verification.
- MFA remains an accepted-risk/deferred status in the contract and is not represented as implemented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Prepared missing local verification dependencies**
- **Found during:** Task 1 RED
- **Issue:** The isolated worktree had no `node_modules`, so `vitest` was unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile` inside the worktree.
- **Files modified:** None tracked.
- **Verification:** RED tests executed and failed for the intended missing contract files.
- **Committed in:** Not applicable; environment setup only.

**2. [Rule 3 - Blocking] Built shared package before API typecheck**
- **Found during:** Task 1 verification
- **Issue:** `pnpm --filter @grabit/api typecheck` could not resolve `@grabit/shared` until the shared package emitted its gitignored `dist` declarations.
- **Fix:** Ran `pnpm --filter @grabit/shared build` before API typecheck.
- **Files modified:** None tracked.
- **Verification:** `pnpm --filter @grabit/api typecheck` passed after shared build.
- **Committed in:** Not applicable; build artifact is gitignored.

---

**Total deviations:** 2 auto-fixed (Rule 3)
**Impact on plan:** Verification environment was prepared without changing tracked source scope.

## Issues Encountered

- The first test-file patch was created against the parent checkout path by the patch tool, then immediately removed and re-applied under `.codex/worktrees/agent-25-03`. Parent checkout status for those paths was verified clean afterward.

## Verification

- `pnpm --dir packages/shared exec vitest run schemas/admin-operations.schema.test.ts` - PASS, 5 tests
- `pnpm --dir apps/api exec vitest run modules/admin/admin-fixtures.spec.ts common/guards/admin-capabilities.guard.spec.ts` - PASS, 7 tests
- `pnpm --filter @grabit/shared typecheck` - PASS
- `pnpm --filter @grabit/shared build && pnpm --filter @grabit/api typecheck` - PASS
- `rg -n "admin-fixtures" apps/api/src --glob '!**/*.spec.ts'` - PASS, no production imports
- `rg -n "MFA|mfa|implemented|complete" packages/shared/src/schemas/admin-operations.schema.ts packages/shared/src/types/admin-operations.types.ts apps/api/src/modules/admin/admin-fixtures.ts` - PASS, only deferred MFA contract appears
- `git diff --name-only HEAD -- .planning/STATE.md .planning/ROADMAP.md` - PASS, no shared tracking edits

## Known Stubs

None.

## Threat Flags

None. The new security-relevant surface matches the plan threat model: `AdminCapabilitiesGuard` mitigates T-25-01, and `adminSecurityStatusSchema` keeps MFA at `deferred_accepted_risk` for T-25-10.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Downstream Phase 25 plans can import a single admin operations contract and protect sensitive endpoints with `@AdminCapabilities()`. Schema/migration plans can now add persistence for audit, allowlist, support, export, and seat-operation history without inventing new RBAC vocabulary.

## Self-Check: PASSED

- Created files exist on disk.
- Task commits `59cdcc0`, `cd69843`, `465f3ec`, and `2e108ad` exist in git history.
- Plan-specific verification passed.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14T00:34:11Z*
