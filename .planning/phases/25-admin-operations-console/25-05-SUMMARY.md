---
phase: 25-admin-operations-console
plan: "05"
subsystem: database
tags: [drizzle, admin-audit, allowlist, seat-operations, schema-contracts]

# Dependency graph
requires:
  - phase: 25-04
    provides: admin operations shared contracts
  - phase: 25-21
    provides: admin capability/security context
  - phase: 24-12
    provides: admin manual-open and booking operation audit precedent
provides:
  - generalized masked admin audit schema for D-10/D-11 sensitive actions
  - admin IP allowlist schema with source, status, and audit linkage
  - durable disabled seat inventory state
  - seat-centric operation history schema for disable/reactivate/manual-open evidence
affects: [phase-25-admin-operations-console, admin-security, seat-operations, reservation-export]

# Tech tracking
tech-stack:
  added: []
  patterns: [masked-admin-audit-schema, allowlist-audit-linkage, seat-operation-history]

key-files:
  created:
    - apps/api/src/database/schema/admin-audit-logs.ts
    - apps/api/src/database/schema/admin-access-allowlist.ts
    - apps/api/src/database/schema/seat-operation-history.ts
    - apps/api/src/database/schema/phase25-admin-operations.schema.spec.ts
  modified:
    - apps/api/src/database/schema/seat-inventories.ts
    - apps/api/src/database/schema/index.ts

key-decisions:
  - "Admin audit rows store masked changed-fields and before/after snapshots, not raw export payloads."
  - "Admin allowlist records separate source from status so env bootstrap records and temporary DB-managed exceptions remain distinguishable."
  - "Seat operation history stores durable seat identity plus previous/next status and audit linkage outside the general audit table."

patterns-established:
  - "Sensitive admin actions use dotted enum values that match capability/action names."
  - "Seat operation evidence remains seat-centric even when the generalized audit table also records the sensitive action."

requirements-completed: [ADMIN-03, ADMIN-04]

# Metrics
duration: 9min
completed: 2026-05-14
---

# Phase 25 Plan 05: Admin Operations Schema Contracts Summary

**Masked admin audit, IP allowlist, durable disabled seat state, and seat-operation history schemas for high-risk admin operations**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-14T01:18:01Z
- **Completed:** 2026-05-14T01:26:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `admin_audit_logs` with D-10 action coverage, status, actor/resource fields, reason, request context, and masked JSON diff snapshots.
- Added `admin_access_allowlist` with env/bootstrap vs DB-managed source, operational status, expiry, actor, and audit linkage.
- Added `disabled` to `seat_status` and created `seat_operation_history` for disable/reactivate/manual-open evidence tied to actor, seat identity, state transition, reason, reservation, and audit log.
- Added schema tests proving the contracts and barrel exports exist before migration generation or feature writes.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: add failing admin audit schema contract** - `4226058` (test)
2. **Task 1 GREEN: add admin audit and allowlist schemas** - `d6819c0` (feat)
3. **Task 2 RED: add failing seat operation schema contract** - `d550e34` (test)
4. **Task 2 GREEN: add seat operation history schema** - `2d7202c` (feat)

**Plan metadata:** committed by the `docs(25-05)` close-out commit.

## Files Created/Modified

- `apps/api/src/database/schema/admin-audit-logs.ts` - Generalized masked audit table and D-10 action/status enums.
- `apps/api/src/database/schema/admin-access-allowlist.ts` - IP allowlist records with source/status/expiry/audit linkage.
- `apps/api/src/database/schema/seat-operation-history.ts` - Seat-centric operation history table and action enum.
- `apps/api/src/database/schema/phase25-admin-operations.schema.spec.ts` - RED/GREEN schema contract tests for audit, allowlist, disabled seats, and seat history.
- `apps/api/src/database/schema/seat-inventories.ts` - Adds durable `disabled` seat status.
- `apps/api/src/database/schema/index.ts` - Exports the new schemas and enums.

## Decisions Made

- Kept raw reservation export payloads out of audit storage; audit rows persist masked field names and safe before/after snapshots only.
- Modeled allowlist exceptions as source/status records linked to audit rows rather than a separate table, keeping launch security scope small.
- Kept seat-operation history separate from `admin_audit_logs` so operators can query a seat-centric history view without parsing a general audit feed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored missing worktree dependencies for verification**
- **Found during:** Task 1 RED
- **Issue:** The isolated worktree had no `node_modules`, so `vitest` was unavailable and the RED gate could not execute.
- **Fix:** Ran `pnpm install --frozen-lockfile`; this restored ignored dependency directories only and did not change tracked files.
- **Files modified:** None
- **Verification:** Re-ran the RED test command and observed the intended schema-contract failures.
- **Committed in:** Not applicable; no tracked file changes.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Verification environment restored only. No product scope change.

## Issues Encountered

- The plan's `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-operations.schema.spec.ts` command runs the API suite under the existing Vitest root configuration. I also ran the targeted spec directly from `apps/api` to prove the RED and GREEN gates for this file.
- An initial patch path was checked and corrected before committing; the parent checkout has no tracked code changes from this plan.

## Verification

- `pnpm exec vitest run database/schema/phase25-admin-operations.schema.spec.ts` from `apps/api` - PASS, 5 tests.
- `pnpm --filter @grabit/shared build` - PASS.
- `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-operations.schema.spec.ts` - PASS, 58 files / 595 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Migration generation can now add durable admin audit, allowlist, disabled-seat, and seat-operation history storage.
- Later API/UI plans can implement sensitive operations against explicit schema contracts instead of client-only or ad hoc audit state.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/25-admin-operations-console/25-05-SUMMARY.md`.
- Task commits `4226058`, `d6819c0`, `d550e34`, and `2d7202c` are present in git history.
- Stub scan across created/modified schema files found no placeholder/TODO/FIXME markers that block the plan goal.
- `git status --short` showed no `STATE.md`, `ROADMAP.md`, or `REQUIREMENTS.md` edits.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
