---
phase: 27-event-operations-settlement
plan: "02"
subsystem: api-testing
tags: [vitest, red-contracts, field-operations, settlement-export, scanner-rbac]

requires:
  - phase: 27-event-operations-settlement
    provides: "Plan 27-01 shared field-operation DTOs, scanner bundle, and settlement.export capability vocabulary"
  - phase: 24-traffic-booking-payment-core
    provides: "QR ticket issuance and scanner contract baseline"
  - phase: 25-admin-operations-console
    provides: "admin audit, export, and booking operation test patterns"
provides:
  - "Backend RED contract for scanner verify/consume outcomes and usedAt mutation boundary"
  - "Backend RED contract for offline pending sync server re-verification and monitor KPI aggregation"
  - "Backend RED contract for settlement export datasets, safe CSV generation, scanner denial, and audit metadata"
affects: [field-operations, qr-scanner, offline-sync, field-monitor, settlement-export]

tech-stack:
  added: []
  patterns:
    - "Wave 0 backend tests remain intentionally RED until service implementations land"
    - "Static contract verification is the completion gate for this plan"
    - "Scanner/monitor/settlement results assert no raw token, raw JTI, payment key, cookie, phone, or email leakage"

key-files:
  created:
    - apps/api/src/modules/field-operations/field-check-in.service.spec.ts
    - apps/api/src/modules/field-operations/offline-sync.service.spec.ts
    - apps/api/src/modules/field-operations/field-monitor.service.spec.ts
    - apps/api/src/modules/admin/settlement-export.service.spec.ts
  modified: []

key-decisions:
  - "Kept Plan 27-02 as RED-contract-only work; no runtime service files were created."
  - "Used static grep gates instead of Vitest because the future services are intentionally absent until implementation plans."
  - "Settlement export authorization is driven by settlement.export; scanner-only users must be denied."

patterns-established:
  - "FieldCheckInService contract exposes verify and consume as separate operations; verify must not mutate tickets.usedAt."
  - "OfflineSyncService contract syncs only pending attempts and sends every recovered attempt through server re-verification."
  - "FieldMonitorService contract returns KPI fields before secondary log rows."
  - "SettlementExportService contract uses safeCsvRows for all export datasets and writes metadata-only audit evidence."

requirements-completed: [QR-02, FIELD-01, POST-01]

duration: 8m05s
completed: 2026-05-22T02:49:30Z
---

# Phase 27 Plan 02: Backend RED Contracts Summary

**Executable backend RED contracts for field check-in, offline sync, event-day monitoring, and settlement export before runtime implementation.**

## Performance

- **Duration:** 8m05s
- **Started:** 2026-05-22T02:41:25Z
- **Completed:** 2026-05-22T02:49:30Z
- **Tasks:** 3
- **Files modified:** 4 test files plus this summary

## Accomplishments

- Added check-in contract tests covering normal entry, duplicate/already-used context, tampered token, refunded/cancelled, expired, wrong-showtime, and no raw token/JTI/PII leakage.
- Added offline sync contract tests proving pending-only local semantics and server re-verification for duplicate, tampered, refunded/cancelled, expired, and wrong-showtime conflicts.
- Added field monitor contract tests for KPI-first summary counts and abnormal alerts without raw scan leakage.
- Added settlement export contract tests for four required datasets, `safeCsvRows` formula neutralization, `settlement.export` authorization, scanner-only denial, and metadata-only audit evidence.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add check-in consume outcome tests** - `f9f55b3f` (test)
2. **Task 2: Add offline sync and monitor tests** - `69f83c65` (test)
3. **Task 3: Add settlement export API tests** - `62750811` (test)

## Files Created/Modified

- `apps/api/src/modules/field-operations/field-check-in.service.spec.ts` - RED contract for `FieldCheckInService.verify()` and `consume()` outcomes, duplicate prior context, `usedAt` mutation boundary, and sensitive-data redaction.
- `apps/api/src/modules/field-operations/offline-sync.service.spec.ts` - RED contract for pending-only offline sync and recovered server conflict resolution.
- `apps/api/src/modules/field-operations/field-monitor.service.spec.ts` - RED contract for KPI-first event-day monitor summaries, abnormal alerts, and redacted scan logs.
- `apps/api/src/modules/admin/settlement-export.service.spec.ts` - RED contract for settlement datasets, safe CSV generation, scanner-only denial, and audit metadata.

## Decisions Made

- No `FieldCheckInService`, `OfflineSyncService`, `FieldMonitorService`, or `SettlementExportService` runtime implementation files were added in this plan. This keeps Wave 0 as executable contract setup only.
- Vitest was not run because the plan explicitly states these specs are expected to remain RED until implementation plans 27-06, 27-07, 27-08, and 27-09.
- Static verification was treated as the authoritative completion gate for this Wave 0 plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Recovered accidental parent-checkout patch target**
- **Found during:** Task 1 (Add check-in consume outcome tests)
- **Issue:** The first `apply_patch` call used the tool default cwd and created `field-check-in.service.spec.ts` in the parent checkout instead of the required manual worktree.
- **Fix:** Removed only the accidentally created untracked parent-checkout file, verified the parent target was clean, then re-applied the patch using a worktree-derived absolute path guarded by `git rev-parse --show-toplevel`.
- **Files modified:** `apps/api/src/modules/field-operations/field-check-in.service.spec.ts`
- **Verification:** Parent path no longer showed the accidental file; worktree static Task 1 gate passed.
- **Committed in:** `f9f55b3f`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Execution-environment correction only. Product/test scope remained exactly the planned RED backend contract surface.

## Issues Encountered

- No authentication gates occurred.
- The plan intentionally skipped backend Vitest execution because imported service files do not exist yet. Static inspection gates passed instead.

## Verification

- `test -f apps/api/src/modules/field-operations/field-check-in.service.spec.ts && rg "FieldCheckInService|verifyTicketForScannerContract" ... && rg "normal|duplicate|already_used|tampered|refunded|cancelled|expired|wrong-showtime|already-used" ... && rg "usedAt|raw.*(token|JTI)|payment key|phone|email" ...` - PASS
- `test -f apps/api/src/modules/field-operations/offline-sync.service.spec.ts && test -f apps/api/src/modules/field-operations/field-monitor.service.spec.ts && rg "pending|synced|rejected|server.*re-?verif|duplicate|tampered|wrong-showtime" ... && rg "entered|not-entered|entry rate|duplicate scans|rejected scans|offline pending|offline synced|abnormal alerts" ...` - PASS
- `test -f apps/api/src/modules/admin/settlement-export.service.spec.ts && rg "entry_status|no_show_reservations|reservation_payment_refund_summary|settlement_accounting_input" ... && rg "safeCsvRows|formula|scanner-only|settlement.export" ...` - PASS
- `git diff --name-only HEAD -- .planning/STATE.md .planning/ROADMAP.md` - PASS, no shared tracking edits
- Stub scan over created specs - PASS, no placeholder/TODO/FIXME stubs
- Threat surface scan over created specs - PASS, no new runtime endpoints, schema tables, network calls, or file access patterns

## TDD Gate Compliance

Plan 27-02 is an execute-type Wave 0 RED-contract plan. The RED commits are present as `test(27-02)` commits; GREEN implementation commits are intentionally deferred to plans 27-06 through 27-09 per the plan verification section.

## Known Stubs

None.

## Threat Flags

None. This plan adds tests only; no new runtime trust boundary was introduced beyond the threat model already captured in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for downstream backend implementation plans to make these RED contracts green while preserving scanner-only authorization, server-authoritative scan outcomes, offline conflict resolution, KPI-first monitor output, and metadata-only settlement audit evidence.

## Self-Check: PASSED

- Created spec files and SUMMARY.md exist on disk.
- Task commits `f9f55b3f`, `69f83c65`, and `62750811` exist in git history.
- Plan-level static verification gates passed.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22T02:49:30Z*
