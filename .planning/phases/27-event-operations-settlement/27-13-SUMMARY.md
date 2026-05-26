---
phase: 27-event-operations-settlement
plan: 13
subsystem: field-operations
tags: [qr, field-scanner, offline-sync, indexeddb, idb, playwright]
requires:
  - phase: 27-event-operations-settlement
    provides: scanner check-in route, scanner-only auth capability, and offline-sync API contracts from earlier Phase 27 plans
provides:
  - IndexedDB-backed pending scan attempt store for scanner offline fallback
  - Scanner offline sync status UI with pending, synced, and rejected outcomes
  - Browser E2E coverage for offline pending storage, sync recovery, and rejected conflict handling
affects: [QR-02, FIELD-01, field-scanner, offline-sync]
tech-stack:
  added: []
  patterns:
    - idb openDB object store writes await transaction completion before pending UI confirmation
    - local pending scan state is warning-only until the server sync resolves a terminal outcome
key-files:
  created:
    - apps/web/lib/field/offline-scan-store.ts
    - apps/web/components/field/offline-sync-status.tsx
  modified:
    - apps/web/components/field/scanner-check-in.tsx
    - apps/web/hooks/use-field-operations.ts
    - apps/web/app/field/check-in/page.tsx
    - apps/web/components/field/__tests__/scanner-check-in.test.tsx
    - apps/web/e2e/phase27-offline-sync.spec.ts
key-decisions:
  - "Offline scan attempts store scanner/showtime/event scope and redacted token references, not raw QR tokens or buyer PII."
  - "Browser offline detection short-circuits consume calls to avoid hanging fetches and records warning-only pending attempts."
  - "Offline sync results remain visible as pending/synced/rejected rows; local pending is never rendered as final entry success."
patterns-established:
  - "IndexedDB pending-scan writes await tx.done before UI reports local persistence."
  - "Scanner offline status renders before ticket details so backlog state is seen before current ticket metadata."
requirements-completed: [QR-02, FIELD-01]
duration: 15m58s
completed: 2026-05-22
---

# Phase 27 Plan 13: Offline Scan Sync Summary

**IndexedDB-backed scanner offline pending queue with sync status UI and recovered/rejected E2E coverage**

## Performance

- **Duration:** 15m58s
- **Started:** 2026-05-22T04:15:48Z
- **Completed:** 2026-05-22T04:31:46Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added `offline-scan-store.ts` with an `idb` object store keyed by `deviceAttemptId`, indexed by `showtimeId` and `syncState`, and transaction completion via `tx.done`.
- Stored only scanner, event, showtime, timestamp, sync state, and redacted token references for pending scan attempts.
- Added the scanner offline sync panel before ticket identity details, showing pending/synced/rejected counts and row-level reason labels.
- Wired the field check-in page to save network-failed consumes locally, sync pending attempts to `/api/v1/field/check-in/offline-sync`, and keep terminal outcomes visible.
- Updated component and browser tests for offline pending, sync recovery, rejected conflict, and no raw secret rendering.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: offline pending scan store test** - `ac8c5792` (test)
2. **Task 1 GREEN: offline pending scan store** - `9f493548` (feat)
3. **Task 2 RED: offline sync status UI test** - `c187c8cc` (test)
4. **Task 2 GREEN: offline sync status and recovery flow** - `6f40f0c6` (feat)

_Note: TDD tasks used separate RED and GREEN commits._

## Files Created/Modified

- `apps/web/lib/field/offline-scan-store.ts` - IndexedDB pending scan store with `pendingScanAttempts`, `showtimeId` and `syncState` indexes, safe field projection, and test reset helper.
- `apps/web/components/field/offline-sync-status.tsx` - Scanner-visible offline sync status panel with warning copy, counts, rows, reason labels, and sync action.
- `apps/web/components/field/scanner-check-in.tsx` - Replaced inline offline queue card with `OfflineSyncStatus` and moved it before ticket identity details.
- `apps/web/hooks/use-field-operations.ts` - Added offline-sync mutation and response normalization.
- `apps/web/app/field/check-in/page.tsx` - Loads local pending attempts, records browser/network offline consumes, seeds E2E conflict attempts, and persists sync outcomes.
- `apps/web/components/field/__tests__/scanner-check-in.test.tsx` - Added TDD coverage for safe offline store fields and offline sync status placement/counts/reasons.
- `apps/web/e2e/phase27-offline-sync.spec.ts` - Added browser assertions for offline pending storage, sync success, rejected conflict, and raw secret suppression.

## Decisions Made

- Kept local offline attempts as warning-only UI state. A locally pending scan never becomes final entry success until the server sync endpoint returns a terminal result.
- Used redacted token references for local storage and sync payloads to avoid raw QR token/JTI/URL/payment/cookie/IP/buyer PII exposure.
- Short-circuited consume when `navigator.onLine === false` so scanner feedback is immediate instead of waiting for browser fetch failure timing.
- Left `.planning/STATE.md` and `.planning/ROADMAP.md` untouched because this executor was running in a manual worktree and the orchestrator owns shared tracking after wave merge.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hydrated fresh worktree dependencies**
- **Found during:** Task 1 RED verification
- **Issue:** The manual worktree did not have runnable web test dependencies available.
- **Fix:** Ran `pnpm install --offline` inside the manual worktree.
- **Files modified:** None tracked.
- **Verification:** Vitest was able to run and fail for the intended missing offline store import.
- **Committed in:** Not applicable, no tracked file changes.

**2. [Rule 3 - Blocking] Built shared package output for E2E module resolution**
- **Found during:** Task 2 GREEN verification
- **Issue:** Playwright E2E could not resolve generated `@grabit/shared` output in the fresh worktree.
- **Fix:** Ran `pnpm --filter @grabit/shared build`.
- **Files modified:** None tracked.
- **Verification:** `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- phase27-offline-sync.spec.ts` passed.
- **Committed in:** Not applicable, generated outputs were not tracked.

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both deviations were environment hydration steps required to run the planned tests. No product scope was added.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` still fails due unrelated Phase 27 files outside this plan's write scope:
  - `components/admin/__tests__/settlement-dashboard.test.tsx` imports missing `../settlement-dashboard`.
  - `components/admin/admin-user-management.tsx` is missing newly required `scanner` role and field/settlement capability labels.
  - `components/field/__tests__/field-monitor.test.tsx` imports missing `../field-monitor`.
- These failures were not introduced by plan 27-13 changes and were left for the owning parallel plans or wave merge owner.

## Verification

- **PASS:** `pnpm --filter @grabit/web exec vitest run components/field/__tests__/scanner-check-in.test.tsx --reporter=dot` - 11 tests passed.
- **PASS:** `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- phase27-offline-sync.spec.ts` - 2 tests passed.
- **CAVEAT:** `pnpm --filter @grabit/web typecheck` failed on unrelated files listed under Issues Encountered.

## Known Stubs

None. Stub scan found no TODO/FIXME/placeholder/coming soon text or hardcoded empty UI data in the files created or modified by this plan.

## Auth Gates

None.

## Threat Flags

None. The security-relevant surface was already in the plan threat model: local IndexedDB pending scans and offline sync payload handling. Implementation limits stored/sent local data to redacted references and scanner/showtime scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Scanner check-in can preserve network-failed attempts locally and show that they are not final entry proof.
- The sync UI exposes pending, synced, and rejected terminal states for field operators.
- Remaining readiness caveat is the unrelated Phase 27 `typecheck` debt in admin/field-monitor files.

## Self-Check: PASSED

- Created files exist: `apps/web/lib/field/offline-scan-store.ts`, `apps/web/components/field/offline-sync-status.tsx`, and this summary.
- Task commits exist: `ac8c5792`, `9f493548`, `c187c8cc`, `6f40f0c6`.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
