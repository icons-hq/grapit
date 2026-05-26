---
phase: 27-event-operations-settlement
plan: 07
subsystem: api
tags: [field-operations, offline-sync, scanner, nestjs, drizzle]

requires:
  - phase: 27-event-operations-settlement
    provides: scanner check-in service, scan-event schema, scanner capability contract
provides:
  - Server-authoritative offline sync conflict resolution for pending scan attempts
  - Scanner-only POST /field/check-in/offline-sync API protected by field.scan.sync
  - offline_sync scan event source/sync-state propagation through FieldCheckInService
affects: [field-monitor, scanner-ui, offline-sync-ui, settlement-evidence]

tech-stack:
  added: []
  patterns:
    - Reuse FieldCheckInService.consume as the only server-final offline sync resolver
    - Keep endpoint capability field.scan.sync separate from audit action field.scan.offline_sync

key-files:
  created:
    - apps/api/src/modules/field-operations/offline-sync.service.ts
    - apps/api/src/modules/field-operations/offline-sync.controller.ts
  modified:
    - apps/api/src/modules/field-operations/offline-sync.service.spec.ts
    - apps/api/src/modules/field-operations/field-check-in.service.ts
    - apps/api/src/modules/field-operations/field-operations.module.ts

key-decisions:
  - "Offline sync calls FieldCheckInService.consume for every pending attempt instead of trusting client local acceptance."
  - "Scan events created during recovered offline sync are tagged with source=offline_sync and syncState=synced/rejected."
  - "The API permission remains field.scan.sync, while durable admin audit uses the existing field.scan.offline_sync action enum."

patterns-established:
  - "OfflineSyncService deduplicates pending attempts by deviceAttemptId before server consume."
  - "Scanner-only field endpoints use RolesGuard plus AdminCapabilitiesGuard on the method."

requirements-completed: [QR-02, FIELD-01]

duration: 10min
completed: 2026-05-22
---

# Phase 27 Plan 07: Offline Sync Endpoint Summary

**Server-authoritative offline scan sync that converts local pending attempts into synced/rejected outcomes through scanner consume logic.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-22T03:41:43Z
- **Completed:** 2026-05-22T03:51:33Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `OfflineSyncService.syncPendingAttempts()` to process only pending local attempts, dedupe by `deviceAttemptId`, call server consume resolution, and return per-attempt `synced` or `rejected` results.
- Extended `FieldCheckInService` scan event context so recovered offline sync attempts are recorded as `source='offline_sync'` with `syncState='synced'` or `syncState='rejected'`.
- Added `OfflineSyncController` at `POST /field/check-in/offline-sync`, protected by `AdminCapabilities('field.scan.sync')`, and registered it in `FieldOperationsModule`.

## Task Commits

1. **Task 1 RED: Offline sync idempotency contract** - `2e99a186` (test)
2. **Task 1 GREEN: Offline sync conflict resolution** - `9c6cc718` (feat)
3. **Task 2: Scanner-only offline sync endpoint** - `94624cb1` (feat)

## Files Created/Modified

- `apps/api/src/modules/field-operations/offline-sync.service.ts` - Offline sync orchestration, pending-only filtering, device attempt dedupe, consume resolution mapping, redacted rejection handling, and audit write.
- `apps/api/src/modules/field-operations/offline-sync.controller.ts` - Scanner-only sync route with shared Zod request validation and `field.scan.sync` capability guard.
- `apps/api/src/modules/field-operations/field-check-in.service.ts` - Scan event source/sync-state context support for offline sync evidence.
- `apps/api/src/modules/field-operations/field-operations.module.ts` - Controller/service registration and export.
- `apps/api/src/modules/field-operations/offline-sync.service.spec.ts` - RED idempotency coverage plus audit action alignment with existing enum.

## Decisions Made

- Reused `FieldCheckInService.consume()` for server finality so offline sync follows the same duplicate, tamper, refunded/cancelled, expired, wrong-showtime, and already-used conflict path as online scans.
- Kept local offline acceptance non-final: only `entered` from server consume maps to `synced`; every other consume outcome maps to `rejected`.
- Used `field.scan.offline_sync` for audit rows because the existing database enum and Phase 27 scan-audit taxonomy already reserve that action, while `field.scan.sync` remains the endpoint capability name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added offline scan-event source propagation**
- **Found during:** Task 1 (OfflineSyncService conflict resolution)
- **Issue:** The task files listed only offline sync service/spec, but plan correctness required `ticket_scan_events.source='offline_sync'`; the existing consume path always wrote `source='online'`.
- **Fix:** Extended `FieldScannerContext` and scan event persistence to accept `scanSource='offline_sync'` and derive `syncState='synced'/'rejected'`.
- **Files modified:** `apps/api/src/modules/field-operations/field-check-in.service.ts`
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-check-in.service.spec.ts src/modules/field-operations/offline-sync.service.spec.ts`
- **Committed in:** `9c6cc718`

**2. [Rule 1 - Bug] Aligned stale RED audit expectation with existing audit enum**
- **Found during:** Task 1 (OfflineSyncService conflict resolution)
- **Issue:** The RED spec expected audit action `field.scan.sync`, but the committed admin audit enum and Phase 27 schema use `field.scan.offline_sync` for durable audit rows.
- **Fix:** Updated the spec and implementation to audit `field.scan.offline_sync` while keeping route authorization on `field.scan.sync`.
- **Files modified:** `apps/api/src/modules/field-operations/offline-sync.service.spec.ts`, `apps/api/src/modules/field-operations/offline-sync.service.ts`
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/offline-sync.service.spec.ts`
- **Committed in:** `9c6cc718`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 2: 1)
**Impact on plan:** Both fixes were required to satisfy the plan's security/evidence contract without expanding API privilege scope.

## Issues Encountered

- The manual worktree initially had no `node_modules`, so `pnpm --filter @grabit/api exec vitest ...` could not find `vitest`. Fixed by running `pnpm install --frozen-lockfile`; no tracked files changed.
- `@grabit/api` typecheck needed the local `@grabit/shared` package build artifact. Fixed by running `pnpm --filter @grabit/shared build`; no tracked files changed.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/offline-sync.service.spec.ts` - PASS (8 tests)
- `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-check-in.service.spec.ts src/modules/field-operations/offline-sync.service.spec.ts` - PASS (15 tests)
- `pnpm --filter @grabit/api typecheck` - PASS
- `rg "AdminCapabilities('field.scan.sync')" apps/api/src/modules/field-operations/offline-sync.controller.ts` - PASS
- `rg "@Public\\(" apps/api/src/modules/field-operations/offline-sync.controller.ts` - PASS no matches

## TDD Gate Compliance

- RED commit exists: `2e99a186`
- GREEN commit exists after RED: `9c6cc718`
- Refactor commit: not needed

## Next Phase Readiness

Offline sync API is ready for later scanner UI, field monitor, and offline browser queue plans. Downstream UI must call `POST /api/v1/field/check-in/offline-sync` and continue treating local pending state as non-final until this server response returns `synced` or `rejected`.

## Self-Check: PASSED

- Created files found: `27-07-SUMMARY.md`, `offline-sync.service.ts`, `offline-sync.controller.ts`
- Commits found: `2e99a186`, `9c6cc718`, `94624cb1`
- Shared tracking files untouched: `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
