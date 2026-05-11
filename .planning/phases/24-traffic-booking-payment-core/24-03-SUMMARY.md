---
phase: 24-traffic-booking-payment-core
plan: "03"
subsystem: database
tags: [drizzle, postgres, migrations, booking, payments, refunds, qr]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Phase 24 booking-core schema contracts from 24-02
provides:
  - reviewed and locally applied Phase 24 booking-core migration SQL
  - Drizzle snapshot and journal metadata for floor-aware booking storage
  - verified root-.env migration command path for downstream runtime plans
affects: [24-04, 24-06, 24-07, 24-09, 24-11, 24-12, 24-13, 24-15, 24-16, 24-17]
tech-stack:
  added: []
  patterns:
    - repo-root Drizzle generate/migrate commands with explicit DOTENV_CONFIG_PATH
    - expand-only migration review with manual inspection for legacy uniqueness replacement
key-files:
  created:
    - apps/api/src/database/migrations/0012_phase24_booking_core.sql
    - apps/api/src/database/migrations/meta/0012_snapshot.json
  modified:
    - apps/api/src/database/migrations/meta/_journal.json
key-decisions:
  - "Both Drizzle commands were executed from the repo root with the exact `DOTENV_CONFIG_PATH=../../.env` prefix so migration env resolution does not depend on `pnpm --filter` cwd behavior."
  - "The generated `DROP INDEX` statements were accepted because they replace legacy single-floor uniqueness with floor-aware uniqueness and do not remove tables, columns, or row data."
  - "D-10 legacy single-floor backfill was satisfied by reviewed `DEFAULT '1F' NOT NULL` and `DEFAULT '1층' NOT NULL` additions before local apply."
patterns-established:
  - "Phase 24 migration gates must prove exact command shape, destructive-statement grep, and local migrate apply in the same execution."
  - "Floor-aware schema rollout can use additive columns plus uniqueness replacement without destructive row rewrites."
requirements-completed: [BOOK-01, BOOK-02, BOOK-03, PAY-02, REFUND-01, REFUND-02, QR-01]
duration: 12m
completed: 2026-05-08
---

# Phase 24 Plan 03: Traffic + Booking + Payment Core Summary

**Reviewed and locally applied Drizzle migration `0012_phase24_booking_core` for floor-aware booking storage, payment/refund ledgers, webhook durability, and QR ticket persistence.**

## Performance

- **Duration:** 12m
- **Started:** 2026-05-08T15:02:00+09:00
- **Completed:** 2026-05-08T15:14:07+09:00
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Generated `0012_phase24_booking_core.sql`, `0012_snapshot.json`, and the matching `_journal.json` entry from the Phase 24 schema contracts.
- Reviewed the SQL for D-10 and expand-only safety: no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, type rewrite, or rename statements were present, and legacy floor defaults were encoded in the column additions.
- Applied the migration locally with the exact repo-root `DOTENV_CONFIG_PATH=../../.env` command, then reran the gate to confirm Drizzle reported no further schema changes.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Generate, review, and apply the Phase 24 migration** - `d948494` (`feat`)

## Files Created/Modified

- `apps/api/src/database/migrations/0012_phase24_booking_core.sql` - Phase 24 booking-core migration SQL with floor-aware columns, payment/refund/ticket/webhook/audit tables, and required uniqueness changes.
- `apps/api/src/database/migrations/meta/0012_snapshot.json` - Drizzle schema snapshot aligned with the new booking-core contracts.
- `apps/api/src/database/migrations/meta/_journal.json` - Recorded `0012_phase24_booking_core` in the Drizzle migration journal.

## Decisions Made

- Kept the exact root-command prefix `DOTENV_CONFIG_PATH=../../.env` for both Drizzle commands so the monorepo root `.env` is the only env source used by the migration gate.
- Accepted the generated legacy index replacement on `seat_maps` and `seat_inventories` because D-10 multi-floor rows cannot coexist with the old single-floor uniqueness constraints.
- Treated `DEFAULT '1F' NOT NULL` and `DEFAULT '1층' NOT NULL` on new floor columns as the explicit legacy backfill mechanism required before downstream runtime work.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None - the reviewed migration surface stayed inside the plan threat model.

## User Setup Required

None - local migration prerequisites were already available.

## Verification

- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase24_booking_core` - PASS, generated `apps/api/src/database/migrations/0012_phase24_booking_core.sql`
- `! rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN .* TYPE|RENAME TO" apps/api/src/database/migrations/*phase24*booking*core*.sql` - PASS, no matches
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` - PASS, migrations applied successfully
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase24_booking_core && ! rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN .* TYPE|RENAME TO" apps/api/src/database/migrations/*phase24*booking*core*.sql && DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` - PASS, rerun reported `No schema changes, nothing to migrate` before a clean migrate check

## Next Phase Readiness

- Downstream Phase 24 runtime plans can now depend on concrete migrated tables and columns rather than speculative schema contracts.
- Local database shape matches the Phase 24 booking-core snapshot, including floor-aware seat storage and payment/refund/webhook/QR persistence surfaces.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-03-SUMMARY.md`.
- Verified task commit `d948494` exists in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
