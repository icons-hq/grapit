---
phase: 27-event-operations-settlement
plan: 05
subsystem: database
tags: [drizzle, postgres, ticket-scan-events, admin-audit, migration]

requires:
  - phase: 27-event-operations-settlement
    provides: 27-01/27-02 field-operation shared contracts and RED API expectations
provides:
  - ticket_scan_events append-only scan evidence schema
  - field scan and settlement admin audit actions
  - deterministic 0023 local/test migration and Drizzle snapshot
  - local PostgreSQL migration apply evidence
affects: [field-operations, offline-sync, field-monitor, settlement-export]

tech-stack:
  added: []
  patterns:
    - Drizzle pgTable with redacted evidence columns and partial unique idempotency guard
    - Admin audit action taxonomy extended before API implementation

key-files:
  created:
    - apps/api/src/database/schema/ticket-scan-events.ts
    - apps/api/src/database/schema/phase27-ticket-scan-events.schema.spec.ts
    - apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql
    - apps/api/src/database/migrations/meta/0023_snapshot.json
  modified:
    - apps/api/src/database/schema/index.ts
    - apps/api/src/database/schema/admin-audit-logs.ts
    - apps/api/src/modules/admin/admin-audit.service.ts
    - apps/api/src/modules/admin/admin-fixtures.ts
    - packages/shared/src/schemas/admin-operations.schema.ts
    - apps/api/src/database/migrations/meta/_journal.json

key-decisions:
  - "ticket_scan_events stores maskedJti and deviceAttemptId only; raw QR token/JTI/PII/payment/cookie columns are forbidden."
  - "deviceAttemptId has both lookup index and partial unique index for offline sync idempotency."
  - "Drizzle generated a drifted 0024 migration because snapshots after 0015 are absent; 0023 was hand-normalized to only Phase 27 scan-event/audit changes."
  - "Root .env was absent, so the migration gate used an isolated Docker PostgreSQL 16 fixture with temporary .env for the exact migrate command."

patterns-established:
  - "Scan evidence table references ticket, reservation, showtime, and scanner user while keeping priorScanEventId nullable for replay linkage."
  - "Field scan audit actions use field.scan.verify, field.scan.consume, field.scan.offline_sync, and settlement.export."

requirements-completed: [QR-02, FIELD-01, POST-01]

duration: 15m27s
completed: 2026-05-22
---

# Phase 27 Plan 05: Scan Event Persistence + Migration Summary

**Append-only ticket scan evidence with redacted QR references, offline sync idempotency, scan/settlement audit actions, and a green local PostgreSQL migration gate.**

## Performance

- **Duration:** 15m27s
- **Started:** 2026-05-22T02:55:46Z
- **Completed:** 2026-05-22T03:11:13Z
- **Tasks:** 3 completed
- **Files modified:** 13

## Accomplishments

- Added `ticketScanEvents` with scan result/source/sync-state enums, ticket/reservation/showtime/scanner references, masked JTI, rejection metadata, replay linkage, and offline `deviceAttemptId` idempotency indexes.
- Extended `admin_audit_action` schema/service contracts with field scan and settlement audit actions before downstream API plans rely on them.
- Added deterministic `0023_phase27_ticket_scan_events.sql`, aligned `_journal.json` and `0023_snapshot.json`, and verified migration apply against isolated local PostgreSQL 16.

## Task Commits

1. **Task 1 RED: Add scan-event schema contract** - `52cf9c09` (test)
2. **Task 1 GREEN: Add scan-event and audit action schema** - `e44cd273` (feat)
3. **Task 2: Generate or write Phase 27 migration** - `dd142d14` (chore)
4. **Task 3: Apply and verify local/test schema migration** - `79f3ef26` (chore, empty verification commit)

**Plan metadata:** recorded by the final SUMMARY docs commit.

## Files Created/Modified

- `apps/api/src/database/schema/ticket-scan-events.ts` - Drizzle table and enums for durable scan evidence.
- `apps/api/src/database/schema/phase27-ticket-scan-events.schema.spec.ts` - TDD contract for scan event fields, indexes, forbidden raw columns, and audit actions.
- `apps/api/src/database/schema/index.ts` - Schema barrel export for scan-event table and enums.
- `apps/api/src/database/schema/admin-audit-logs.ts` - Admin audit enum additions for scan and settlement actions.
- `apps/api/src/modules/admin/admin-audit.service.ts` - Service action list aligned with the database enum.
- `apps/api/src/modules/admin/admin-fixtures.ts` - Scanner fixture added for shared scanner bundle compatibility.
- `packages/shared/src/schemas/admin-operations.schema.ts` - Shared audit event schema accepts `field.scan.offline_sync`.
- `apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql` - Deterministic migration SQL.
- `apps/api/src/database/migrations/meta/_journal.json` and `0023_snapshot.json` - Drizzle metadata for the exact 0023 tag.

## Verification

- `pnpm --dir packages/shared exec vitest run src/schemas/admin-operations.schema.test.ts` - PASS, 11 tests.
- `pnpm --dir apps/api exec vitest run database/schema/phase27-ticket-scan-events.schema.spec.ts database/schema/phase25-admin-operations.schema.spec.ts modules/admin/admin-audit.service.spec.ts modules/admin/admin-fixtures.spec.ts` - PASS, 17 tests.
- `pnpm --filter @grabit/api typecheck` - PASS after `pnpm --filter @grabit/shared build` prepared local declarations.
- `test -f apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql && rg "ticket_scan_events|field.scan.consume|settlement.export" apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql` - PASS.
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` - PASS against temporary root `.env` pointing to isolated Docker PostgreSQL 16 fixture; temp `.env` was removed afterward.

## TDD Gate Compliance

- RED commit exists: `52cf9c09` added failing schema/audit contract tests.
- GREEN commit exists after RED: `e44cd273` implemented schema and audit contracts.
- Refactor commit: none needed.

## Decisions Made

- Used `maskedJti` instead of raw token/JTI storage to preserve the Phase 27 no-leakage rule.
- Kept scanner capability `field.scan.sync` as the shared permission name, while audit evidence uses the plan-required `field.scan.offline_sync` action.
- Kept migration SQL narrow to Phase 27 changes because generated `0024_conscious_hulk.sql` included historical drift from missing post-0015 snapshots.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored local test dependencies**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/api test ...` could not find `vitest` because the manual worktree had no `node_modules`.
- **Fix:** Ran `pnpm install` in the manual worktree.
- **Files modified:** none committed; dependency install output is ignored.
- **Verification:** RED test then failed for the intended missing scan-event/audit contracts.
- **Committed in:** not applicable.

**2. [Rule 3 - Blocking] Built shared declarations for API typecheck**
- **Found during:** Task 1 GREEN
- **Issue:** `@grabit/api typecheck` could not resolve `@grabit/shared` until local shared `dist` declarations existed.
- **Fix:** Ran `pnpm --filter @grabit/shared build` before API typecheck.
- **Files modified:** none committed; generated `dist` is ignored.
- **Verification:** `pnpm --filter @grabit/api typecheck` passed.
- **Committed in:** not applicable.

**3. [Rule 3 - Blocking] Aligned scanner fixture and shared audit event action contract**
- **Found during:** Task 1 GREEN
- **Issue:** API typecheck exposed a missing scanner fixture and shared `AdminAuditEvent` did not accept the plan-required `field.scan.offline_sync` action.
- **Fix:** Added scanner fixture coverage and extended shared audit action schema.
- **Files modified:** `apps/api/src/modules/admin/admin-fixtures.ts`, `apps/api/src/modules/admin/admin-fixtures.spec.ts`, `packages/shared/src/schemas/admin-operations.schema.ts`.
- **Verification:** shared admin contract tests and API typecheck passed.
- **Committed in:** `e44cd273`.

**4. [Rule 3 - Blocking] Normalized drifted Drizzle generation output**
- **Found during:** Task 2
- **Issue:** `drizzle-kit generate` emitted `0024_conscious_hulk.sql` with historical schema changes because repository metadata has `_journal.json` entries beyond the latest checked-in snapshot.
- **Fix:** Removed the alternate generated SQL, wrote exact `0023_phase27_ticket_scan_events.sql`, renamed snapshot metadata to `0023_snapshot.json`, and updated the journal tag.
- **Files modified:** `apps/api/src/database/migrations/0023_phase27_ticket_scan_events.sql`, `apps/api/src/database/migrations/meta/_journal.json`, `apps/api/src/database/migrations/meta/0023_snapshot.json`.
- **Verification:** migration grep, JSON parse, no-alternate-filename check, and local migrate all passed.
- **Committed in:** `dd142d14`.

---

**Total deviations:** 4 auto-fixed (Rule 3: 4)
**Impact on plan:** No scope creep; fixes were required to execute the planned TDD, typecheck, migration generation, and local migration gates.

## Issues Encountered

- Root `.env` was absent in the manual worktree. The exact migrate command was verified by creating a temporary `.env` pointed at an isolated Docker PostgreSQL 16 fixture, then removing it after success.
- Initial `apply_patch` defaulted outside the manual worktree for one uncommitted test file. The file was immediately removed from the main repo before any commit, and all subsequent edits used absolute worktree paths verified against `git rev-parse --show-toplevel`.

## Known Stubs

None. Stub scan hits were existing empty-object/empty-array defaults in tests/service helper signatures, not UI or data-source placeholders.

## Threat Flags

None beyond the plan threat model. The new `ticket_scan_events` table and `admin_audit_action` additions are the intended mitigations for the Phase 27 scan/offline/settlement trust boundaries.

## User Setup Required

None. No production migration was run. Production migration remains CI/CD-managed with injected `DATABASE_URL`.

## Next Phase Readiness

Downstream field-operations API, monitor aggregation, offline sync, and settlement export plans can now depend on durable `ticket_scan_events` evidence and the scan/settlement audit action taxonomy. API plans should still build direct behavior tests for duplicate/tamper/refund/wrong-showtime resolution before claiming QR-02/FIELD-01 end-to-end success.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/27-event-operations-settlement/27-05-SUMMARY.md`.
- Key created files exist: `ticket-scan-events.ts`, `phase27-ticket-scan-events.schema.spec.ts`, `0023_phase27_ticket_scan_events.sql`, and `0023_snapshot.json`.
- Task commits found: `52cf9c09`, `e44cd273`, `dd142d14`, `79f3ef26`.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
