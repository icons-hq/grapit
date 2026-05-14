---
phase: 25-admin-operations-console
plan: "06"
subsystem: database
tags: [drizzle, postgres, migrations, admin-operations, i18n, audit, support, seat-operations]

requires:
  - phase: 25-admin-operations-console
    provides: Phase 25 schema contracts from plans 25-04, 25-05, and 25-21
provides:
  - Phase 25 Drizzle migration SQL for admin operations console schema
  - Drizzle snapshot and journal metadata for migration 0015
  - Local migration apply evidence against isolated PostgreSQL 16
  - Reviewed locale enum replacement path from ja back to zh-TW
affects: [25-07, 25-08, 25-09, 25-10, 25-11, 25-12, 25-13, 25-14, 25-15, 25-22, 25-23]

tech-stack:
  added: []
  patterns:
    - Drizzle migration gates must include data transforms before enum replacement casts.
    - Worktree migration verification can use an isolated local Postgres when root .env is intentionally absent.

key-files:
  created:
    - apps/api/src/database/migrations/0015_phase25_admin_operations_console.sql
    - apps/api/src/database/migrations/meta/0015_snapshot.json
  modified:
    - apps/api/src/database/migrations/meta/_journal.json

key-decisions:
  - "Added explicit ja-to-zh-TW data conversion before recreating the locale enum so existing Phase 24/quick-task seed rows do not break migration apply."
  - "Kept the generated DROP TYPE locale replacement because it is required to remove ja and restore zh-TW, but guarded it with text casts and data updates first."
  - "Verified local apply on a separate ephemeral PostgreSQL 16 container instead of mutating the parent checkout's existing grabit-postgres container."

patterns-established:
  - "Locale enum replacements must update row values while columns are temporarily text."
  - "Migration gate summaries must distinguish exact-command environment failures from alternate local apply evidence."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04]

duration: 7m29s
completed: 2026-05-14
---

# Phase 25 Plan 06: Admin Operations Console Summary

**Reviewed and locally applied Drizzle migration `0015_phase25_admin_operations_console` for Phase 25 admin audit, support, allowlist, banner scheduling, publish lifecycle, venue transport, zh-TW, and seat-operation schema contracts.**

## Performance

- **Duration:** 7m29s
- **Started:** 2026-05-14T01:33:15Z
- **Completed:** 2026-05-14T01:40:44Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Generated `0015_phase25_admin_operations_console.sql`, `0015_snapshot.json`, and the `_journal.json` entry.
- Inspected the migration for destructive table/column/row operations; the plan grep passed.
- Fixed the generated locale enum replacement by converting existing `ja` rows back to `zh-TW` before recreating the `locale` enum.
- Applied the full migration set through `0015` against an isolated PostgreSQL 16 container on port `55432`.
- Verified Phase 25 schema contract specs: 9 tests passed.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Generate, inspect, and apply migration** - `e53d157` (`feat`)

## Files Created/Modified

- `apps/api/src/database/migrations/0015_phase25_admin_operations_console.sql` - Phase 25 migration SQL with support tables, admin audit logs, allowlist records, banner scheduling, venue transport columns, publish lifecycle fields, `disabled` seat status, seat operation history, and `zh-TW` locale restoration.
- `apps/api/src/database/migrations/meta/0015_snapshot.json` - Drizzle snapshot aligned with the Phase 25 schema contracts.
- `apps/api/src/database/migrations/meta/_journal.json` - Added journal entry `0015_phase25_admin_operations_console`.

## Decisions Made

- Kept migration scope database-only; no route-level or feature verification was run before the schema gate.
- Converted `ja` consent, audit, translation, support, and user locale values while the affected columns were `text`, then cast back to the new `locale` enum.
- Used an isolated local Postgres container because this worktree has no root `.env`, and the already-running parent `grabit-postgres` container does not contain the `grabit` role expected by this worktree's dev credentials.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing workspace dependencies**
- **Found during:** Task 1
- **Issue:** The first `drizzle-kit generate` failed with `Command "drizzle-kit" not found` because `node_modules` was absent in the worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile`; no lockfile changes were produced.
- **Files modified:** None tracked.
- **Verification:** Re-running `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase25_admin_operations_console` generated migration `0015`.
- **Committed in:** `e53d157`

**2. [Rule 1 - Bug] Added ja-to-zh-TW data transform before locale enum replacement**
- **Found during:** Task 1
- **Issue:** Generated SQL recreated `locale` as `ko,en,th,zh-CN,zh-TW` but did not convert existing `ja` rows from migration `0014`; local migrate failed with `invalid input value for enum locale: "ja"`.
- **Fix:** Added update statements before `DROP TYPE "public"."locale"` to convert `ja` values to `zh-TW` and restore Traditional Chinese consent text.
- **Files modified:** `apps/api/src/database/migrations/0015_phase25_admin_operations_console.sql`
- **Verification:** `DATABASE_URL=postgresql://grabit:grapit_dev@localhost:55432/grabit pnpm --filter @grabit/api exec drizzle-kit migrate` completed with `[✓] migrations applied successfully!`.
- **Committed in:** `e53d157`

**3. [Rule 3 - Blocking] Used isolated local Postgres for migration apply**
- **Found during:** Task 1
- **Issue:** The plan's exact migrate command failed in this worktree because root `.env` is absent and `DATABASE_URL` was undefined. The existing `grabit-postgres` container belongs to the parent checkout and rejected this worktree's dev role with `role "grabit" does not exist`.
- **Fix:** Started an ephemeral PostgreSQL 16 container named `grabit-agent-25-06-postgres` on port `55432`, applied migrations with the committed dev-only credentials from `.env.example`, then stopped the container.
- **Files modified:** None tracked.
- **Verification:** Full Drizzle migrate succeeded on the isolated DB; locale enum and table existence were queried after apply.
- **Committed in:** `e53d157`

---

**Total deviations:** 3 auto-fixed (Rule 1: 1, Rule 3: 2)  
**Impact on plan:** The migration gate was completed without changing application scope. The exact worktree `.env` deficiency remains documented, and local apply evidence is real rather than inferred.

## Issues Encountered

- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` failed with `url: undefined` because this worktree has no root `.env`.
- `DATABASE_URL=postgresql://grabit:grapit_dev@localhost:5432/grabit ... migrate` failed against the already-running parent compose container because that DB does not have role `grabit`.
- Initial generated SQL failed against a clean local DB until the `ja -> zh-TW` transform was added.

## Known Stubs

None.

## Threat Flags

None - the migration SQL review, locale enum replacement, and schema gate evidence are covered by the plan threat model.

## Authentication Gates

None.

## User Setup Required

No product setup is required. For future exact local use of the documented `DOTENV_CONFIG_PATH=../../.env` migrate command in this worktree, provide a root `.env` or export `DATABASE_URL` explicitly.

## Verification

- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase25_admin_operations_console` - PASS; generated `0015`, and the post-patch rerun reported `No schema changes, nothing to migrate`.
- `! (rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|RENAME TO" apps/api/src/database/migrations/0015_phase25_admin_operations_console.sql | rg -v "DELETE FROM \"consent_items\" WHERE \"locale\" = 'ja'")` - PASS.
- Manual destructive review - PASS for table/column/row destruction; noted intentional `DROP TYPE "public"."locale"` after text casts and `ja -> zh-TW` data conversion.
- `DATABASE_URL=postgresql://grabit:grapit_dev@localhost:55432/grabit pnpm --filter @grabit/api exec drizzle-kit migrate` - PASS; isolated PostgreSQL 16 applied all migrations through `0015`.
- DB assertion: `locale` enum labels are `ko`, `en`, `th`, `zh-CN`, `zh-TW`; no `ja` label remains.
- DB assertion: `consent_items` contains 7 rows each for `ko`, `en`, `th`, `zh-CN`, and `zh-TW`.
- DB assertion: `admin_audit_logs`, `support_threads`, and `seat_operation_history` exist.
- Acceptance token check - PASS for `zh-TW`, venue/transport fields, banner scheduling, support tables, admin audit logs, allowlist, `disabled`, and `seat_operation_history`.
- `pnpm --filter @grabit/api exec vitest run src/database/schema/phase25-admin-content.schema.spec.ts src/database/schema/phase25-admin-operations.schema.spec.ts` - PASS, 2 files / 9 tests.

## Next Phase Readiness

Downstream Phase 25 feature plans can now depend on real migration SQL and snapshot metadata for admin operations console schema. Feature verification should use the migrated contract from `0015`, while preserving the Phase 25 decision that MFA remains deferred/accepted risk rather than PASS evidence.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/25-admin-operations-console/25-06-SUMMARY.md`.
- Verified migration SQL, snapshot, and journal files exist on disk.
- Verified task commit `e53d157` exists in git history.
- Verified no tracked file deletions were introduced by the task commit.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
