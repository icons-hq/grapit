---
phase: 27-event-operations-settlement
plan: 03
subsystem: testing
tags: [phase27, qr, scanner, offline-sync, field-monitor, settlement, playwright, vitest]

requires:
  - phase: 26-m1-canary-cutover-gates
    provides: QR metadata visibility, raw-token non-rendering patterns, and booking-complete/My Page route mocks
provides:
  - Buyer QR component RED contracts for scannable QR image, protected URL, and raw token/JTI non-rendering
  - Scanner component RED contracts for verify-first entry processing, rejected states, offline pending state, and regular-user denial
  - Field monitor and settlement dashboard RED contracts for KPI-first operations, export confirmation, and scanner-only denial
  - Phase 27 Playwright RED contracts for buyer QR to scanner check-in, duplicate rejection, and offline pending/sync/rejected flows
affects: [field-operations, buyer-qr, scanner-ui, admin-settlement, phase27-wave0]

tech-stack:
  added: []
  patterns:
    - Testing Library RED contracts import future components and assert UI-SPEC copy directly
    - Playwright route mocks extend Phase 26 raw-secret negative assertion patterns
    - Static inspection gates are the only automated verification for this Wave 0 contract plan

key-files:
  created:
    - apps/web/components/field/__tests__/qr-ticket-image.test.tsx
    - apps/web/components/field/__tests__/scanner-check-in.test.tsx
    - apps/web/components/field/__tests__/field-monitor.test.tsx
    - apps/web/components/admin/__tests__/settlement-dashboard.test.tsx
    - apps/web/e2e/phase27-qr-check-in.spec.ts
    - apps/web/e2e/phase27-offline-sync.spec.ts
  modified: []

key-decisions:
  - "Plan 27-03 is RED/static-only by design; Vitest and Playwright commands were not run because the future components/routes are expected to be missing until later Phase 27 plans."
  - "Scanner-only access is asserted without full admin sidebar labels in both component and browser contracts."
  - "Real phone-camera and venue-like offline rehearsal remain manual-only evidence for Plan 27-16."

patterns-established:
  - "QR contract tests require a 200px minimum QR region and a protected HTTPS /field/check-in URL without visible raw token/JTI/full URL text."
  - "Scanner tests model server verification as final authority and require manual 입장 처리 before any processed state."
  - "Monitor/settlement tests keep KPI/dashboard summaries before raw logs or export actions."

requirements-completed: [QR-02, FIELD-01, POST-01]

duration: 10 min
completed: 2026-05-22
---

# Phase 27 Plan 03: Web RED Contracts Summary

**Buyer QR, scanner, offline sync, field monitor, and settlement UI requirements are now captured as executable RED contracts before implementation.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-22T02:39:00Z
- **Completed:** 2026-05-22T02:49:35Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added buyer QR and scanner component contracts for scannable QR output, token non-rendering, manual entry processing, duplicate/rejected states, offline pending copy, and regular-member denial.
- Added field monitor and settlement dashboard component contracts for KPI-first operations, abnormal alerts, no raw PII/token previews, export confirmation, reason gating, and scanner-only denial.
- Added Phase 27 Playwright contracts for buyer QR to `/field/check-in`, scanner-only consume, duplicate rejection, offline pending sync, and rejected conflict states.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add buyer QR and scanner component tests** - `38ae96cb` (test)
2. **Task 2: Add monitor and settlement component tests** - `d1188ab9` (test)
3. **Task 3: Add Phase 27 Playwright contracts** - `ba981b55` (test)

## Files Created/Modified

- `apps/web/components/field/__tests__/qr-ticket-image.test.tsx` - RED contract for `QrTicketImage`, including 200px QR region, HTTPS check-in URL, buyer-safe metadata, and raw token/JTI/full URL non-rendering.
- `apps/web/components/field/__tests__/scanner-check-in.test.tsx` - RED contract for `ScannerCheckIn`, including processable entry, duplicate/refunded/tampered/wrong-showtime rejection, offline pending, member denial, and no full admin sidebar.
- `apps/web/components/field/__tests__/field-monitor.test.tsx` - RED contract for `FieldMonitor`, including 4-8 KPI cards before logs, abnormal alerts, offline counts, and raw token/PII non-rendering.
- `apps/web/components/admin/__tests__/settlement-dashboard.test.tsx` - RED contract for `SettlementDashboard`, including tabs, dashboard-before-export ordering, export confirmation/reason gating, raw PII non-preview, and scanner-only denial.
- `apps/web/e2e/phase27-qr-check-in.spec.ts` - Playwright RED contract for buyer QR, protected `/field/check-in`, regular-user denial, manual scanner consume, and duplicate rejection.
- `apps/web/e2e/phase27-offline-sync.spec.ts` - Playwright RED contract for offline pending, recovered connectivity sync, and rejected conflict states.

## Decisions Made

- Followed the plan's Wave 0 contract strategy: static inspection only, no Vitest or Playwright execution, because implementation plans 27-10 through 27-15 will add the missing components/routes.
- Kept scanner-only UI contracts separate from the full admin shell by asserting absence of full admin sidebar labels.
- Documented phone-camera and venue-like offline verification as manual-only Plan 27-16 evidence instead of simulating it as PASS.

## Deviations from Plan

None - plan executed as written. The only verification used was the plan-specified static contract inspection.

## Issues Encountered

- An initial patch attempt wrote untracked test files under the repository root tool cwd instead of the manual worktree. Those untracked files were removed before any commit, and the same files were recreated under `/Users/sangwopark19/icons/grapit/.codex/worktrees/agent-phase27-03`. The main repo touched-path status was clean afterward.

## Verification

- Task 1 static gate passed:
  `test -f ...qr-ticket-image.test.tsx && test -f ...scanner-check-in.test.tsx && rg "QR 티켓이 준비되었습니다|현장 검표 결과가 최종 입장 기준입니다|raw.*(token|JTI)|200px|qr" ... && rg "입장 가능 티켓입니다|이미 입장 처리된 티켓입니다|확인할 수 없는 QR입니다|보류 상태는 최종 입장 증거가 아닙니다|이 티켓을 검표할 권한이 없습니다" ...`
- Task 2 static gate passed:
  `test -f ...field-monitor.test.tsx && test -f ...settlement-dashboard.test.tsx && rg "entered|not-entered|entry rate|duplicate scans|rejected scans|offline pending|offline synced|latest abnormal" ... && rg "요약|입장/노쇼|결제/환불|내보내기|정산 데이터를 내보내시겠습니까|scanner-only" ...`
- Task 3 static gate passed:
  `test -f ...phase27-qr-check-in.spec.ts && test -f ...phase27-offline-sync.spec.ts && rg "/field/check-in|입장 처리가 완료되었습니다|duplicate|raw.*(token|JTI)" ... && rg "offline|pending|sync|rejected" ...`
- Per plan instruction, web Vitest and Playwright commands were not run; these tests are intentionally RED until later implementation plans create the referenced components, routes, and browser flows.

## Known Stubs

None. The created files are RED contract tests with fixtures, not implementation stubs.

## Threat Flags

None. This plan added tests for the threat surfaces already listed in the plan threat model and did not add production routes, auth paths, file access, or schema changes.

## User Setup Required

None.

## Next Phase Readiness

Implementation plans can now target the explicit contracts for buyer QR rendering, scanner-only check-in, offline sync, field monitor, and settlement/export UI. The tests are expected to turn green only after the corresponding components, routes, guards, and API contracts are implemented.

## Self-Check: PASSED

- Created files exist on disk: all 6 planned RED contract files were found.
- Commits exist: `38ae96cb`, `d1188ab9`, and `ba981b55` were found in git log.
- Shared tracking files were not modified: `.planning/STATE.md` and `.planning/ROADMAP.md` remained untouched in this worktree.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
