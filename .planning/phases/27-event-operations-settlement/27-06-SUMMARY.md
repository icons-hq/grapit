---
phase: 27-event-operations-settlement
plan: 06
subsystem: api
tags: [nestjs, drizzle, qr-ticket, field-operations, admin-capabilities]

requires:
  - phase: 27-event-operations-settlement
    provides: "27-02 buyer QR URL/token contract and 27-05 ticket_scan_events schema"
provides:
  - "Scanner verify API that opens QR tokens without consuming tickets"
  - "Manual consume API with conditional transactional ticket update and scan events"
  - "FieldOperationsModule registered in AppModule with scanner-only capability gates"
affects: [field-operations, qr-ticket, admin-capabilities, event-day-operations]

tech-stack:
  added: []
  patterns:
    - "NestJS field operations module with RolesGuard plus AdminCapabilitiesGuard"
    - "Drizzle conditional update inside consume transaction"
    - "Redacted QR token references via sha256 digest"

key-files:
  created:
    - apps/api/src/modules/field-operations/field-check-in.service.ts
    - apps/api/src/modules/field-operations/field-check-in.controller.ts
    - apps/api/src/modules/field-operations/field-operations.module.ts
  modified:
    - apps/api/src/modules/field-operations/field-check-in.service.spec.ts
    - apps/api/src/modules/ticket/qr-ticket.service.ts
    - apps/api/src/app.module.ts

key-decisions:
  - "Scanner verify remains read-only; only consume performs the conditional ticket state update."
  - "Duplicate and already-used consume attempts return explicit outcomes and record scan/audit evidence."
  - "Scanner endpoints use admin role plus exact field.scan.verify / field.scan.consume capabilities, not @Public routes."

patterns-established:
  - "Field scanner responses expose redactedTokenRef and maskedJti only, never raw QR token or full JTI."
  - "Manual entry consume uses active + unused conditional update to prevent two successful entries."

requirements-completed: [QR-02]

duration: 12min
completed: 2026-05-22
---

# Phase 27 Plan 06: Scanner Verify And Consume Summary

**Online scanner verification stays read-only, while manual `입장 처리` consumes active tickets through a transactional, redacted, capability-protected API.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-22T03:18:26Z
- **Completed:** 2026-05-22T03:30:18Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added `FieldCheckInService.verify()` that calls `QrTicketService.verifyTicketForScannerContract()`, returns operator-safe ticket context, and never mutates ticket usage state.
- Added manual `consume()` with duplicate/already-used detection, conditional active-unused ticket update, scan event creation, and `field.scan.consume` audit evidence.
- Added `FieldCheckInController` and `FieldOperationsModule`, then registered the module in `AppModule` with scanner-only capability gates.

## Task Commits

1. **Task 1: Implement FieldCheckInService verify without consume** - `fa665eea` (feat)
2. **Task 2: Implement atomic manual consume** - `25de4a99` (feat)
3. **Task 3: Wire scanner-only controller and module** - `0b2d6af9` (feat)

## Files Created/Modified

- `apps/api/src/modules/field-operations/field-check-in.service.ts` - verify/consume orchestration, redaction, scan event writes, audit evidence.
- `apps/api/src/modules/field-operations/field-check-in.controller.ts` - `/field/check-in/verify` and `/field/check-in/consume` scanner endpoints.
- `apps/api/src/modules/field-operations/field-operations.module.ts` - Nest module registration for field operations.
- `apps/api/src/modules/field-operations/field-check-in.service.spec.ts` - RED contract circular stringify fix for Drizzle table assertion.
- `apps/api/src/modules/ticket/qr-ticket.service.ts` - scanner contract now includes ticket ID and reservation number.
- `apps/api/src/app.module.ts` - imports `FieldOperationsModule`.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-check-in.service.spec.ts src/modules/ticket/qr-ticket.service.spec.ts` - PASS, 14/14 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `rg "FieldOperationsModule|field.scan.verify|field.scan.consume|@Public\\(" apps/api/src/app.module.ts apps/api/src/modules/field-operations` - PASS: module and exact capabilities present; no `@Public()` scanner action.

## Decisions Made

- Kept scanner endpoints outside `admin` controller namespace and protected them with the same `RolesGuard` + `AdminCapabilitiesGuard` pattern used by admin operations.
- Used `redactedTokenRef = sha256(token).slice(0, 16)` so scan results can correlate attempts without leaking raw QR tokens.
- Treated the existing combined RED spec as the execution contract: Task 1 introduced the service surface, and Task 2 hardened consume transaction semantics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing worktree dependencies**
- **Found during:** RED verification before Task 1
- **Issue:** `pnpm --filter @grabit/api exec vitest ...` failed because `vitest` was not installed in this manual worktree.
- **Fix:** Ran `pnpm install`; lockfile was unchanged and no tracked dependency files changed.
- **Files modified:** None tracked.
- **Verification:** Targeted Vitest command ran successfully afterward.
- **Committed in:** Not committed; generated `node_modules` is ignored.

**2. [Rule 1 - Bug] Fixed circular stringify assertion in RED spec**
- **Found during:** Task 1
- **Issue:** The RED spec attempted `JSON.stringify(db.update.mock.calls[0])` on a Drizzle table object, producing a circular structure error.
- **Fix:** Added a JSON replacer for the `tickets` table in the assertion while preserving the verify read-only check.
- **Files modified:** `apps/api/src/modules/field-operations/field-check-in.service.spec.ts`
- **Verification:** `field-check-in.service.spec.ts` passed.
- **Committed in:** `fa665eea`

**3. [Rule 3 - Blocking] Built shared package before API typecheck**
- **Found during:** Task 3 verification
- **Issue:** Fresh `pnpm install` left `packages/shared/dist` absent, causing `@grabit/shared` imports to fail during API typecheck.
- **Fix:** Ran `pnpm --filter @grabit/shared build`; generated dist artifacts are ignored and not committed.
- **Files modified:** None tracked.
- **Verification:** `pnpm --filter @grabit/api typecheck` passed.
- **Committed in:** Not committed; generated dist is ignored.

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking issues)
**Impact on plan:** No scope creep. Fixes were required to execute the planned test/typecheck gates in a clean manual worktree.

## Issues Encountered

- The existing RED contract exercised verify and consume in one spec. Task 1 therefore included minimal consume scaffolding to keep the contract runnable; Task 2 then made consume transactional and auditable as planned.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Threat Flags

None - new scanner endpoints and consume transaction are covered by the plan threat model.

## Next Phase Readiness

- Online scanner verify/consume API is ready for the Phase 27 scanner UI/offline sync plans.
- Remaining Phase 27 work should preserve the same redaction and capability boundary for offline sync, field monitor, and settlement surfaces.

## Self-Check: PASSED

- Created files exist: `field-check-in.service.ts`, `field-check-in.controller.ts`, `field-operations.module.ts`.
- Task commits exist: `fa665eea`, `25de4a99`, `0b2d6af9`.
- No edits were made to `.planning/STATE.md` or `.planning/ROADMAP.md`.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
