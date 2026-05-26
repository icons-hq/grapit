---
phase: 27-event-operations-settlement
plan: 14
subsystem: field-operations-ui
tags: [field-monitor, react-query, admin-sidebar, event-operations, qr-scan]

requires:
  - phase: 27-event-operations-settlement
    provides: Plan 27-03 scanner capability foundations
  - phase: 27-event-operations-settlement
    provides: Plan 27-08 field monitor API summary/offline counts
provides:
  - KPI-first admin field monitor component
  - React Query field monitor summary/log hooks with visible 10-second polling
  - Admin /admin/field-monitor route and operations sidebar entry
affects: [field-operations, admin-navigation, scanner-only-access]

tech-stack:
  added: []
  patterns:
    - Controlled-or-query-backed React component for admin monitor surfaces
    - Scanner-only users hidden from full admin sidebar based on capability snapshot

key-files:
  created:
    - apps/web/app/admin/field-monitor/page.tsx
    - apps/web/components/field/field-monitor.tsx
    - apps/web/hooks/use-field-monitor.ts
  modified:
    - apps/web/components/field/__tests__/field-monitor.test.tsx
    - apps/web/components/admin/admin-sidebar.tsx
    - .planning/phases/27-event-operations-settlement/deferred-items.md

key-decisions:
  - "FieldMonitor reads Plan 27-08 API summary fields directly and keeps offline pending/synced as separate KPIs."
  - "Scanner-only capability users are suppressed from the full admin sidebar rather than adding scanner links to admin navigation."

patterns-established:
  - "Monitor polling uses React Query refetchInterval guarded by document.visibilityState."
  - "Monitor rows normalize only redacted ticket references and never render raw token, JTI, email, phone, or full user-agent values."

requirements-completed: [FIELD-01]

duration: 13min
completed: 2026-05-22
---

# Phase 27 Plan 14: Field Monitor Admin Surface Summary

**KPI-first field monitor admin surface with event/showtime filters, pinned abnormal alerts, visible-only 10-second polling, and scanner-only sidebar exclusion**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-22T04:37:29Z
- **Completed:** 2026-05-22T04:50:28Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `FieldMonitor` with 8 KPI cards before scan logs: entered, not-entered, entry rate, duplicate scans, rejected scans, offline pending, offline synced, and latest abnormal alerts.
- Added `useFieldMonitorSummary()` and `useFieldMonitorLogs()` against `/api/v1/field/monitor`, with `refetchInterval: 10_000` only while the document is visible and explicit manual refresh support.
- Added `/admin/field-monitor` and `현장 모니터` under the admin `운영` navigation group while hiding the full admin sidebar for scanner-only capability users.

## Task Commits

1. **Task 1 RED: Field monitor contract** - `c273ba37` (test)
2. **Task 1 GREEN: Field monitor component/hook** - `347500da` (feat)
3. **Task 2: Admin route/sidebar wiring** - `a4af44d8` (feat)
4. **Task 1 REFACTOR: Import cleanup** - `bd4f1211` (refactor)

## Files Created/Modified

- `apps/web/components/field/__tests__/field-monitor.test.tsx` - TDD contract for KPI ordering, D-24 metrics, D-26 alerts, raw data redaction, and polling/manual refresh hook behavior.
- `apps/web/components/field/field-monitor.tsx` - KPI-first monitor UI, filters, alert panel, sanitized scan log table, and controlled/test data normalization.
- `apps/web/hooks/use-field-monitor.ts` - React Query summary/log hooks for field monitor endpoints.
- `apps/web/app/admin/field-monitor/page.tsx` - Admin route rendering `FieldMonitor`.
- `apps/web/components/admin/admin-sidebar.tsx` - Operations nav link and scanner-only sidebar suppression.
- `.planning/phases/27-event-operations-settlement/deferred-items.md` - Out-of-scope typecheck failures noted for phase tracking.

## Decisions Made

- Used the API summary contract names (`enteredCount`, `offlinePendingCount`, `offlineSyncedCount`) as the component's primary shape and kept legacy/test aliases only as normalization input.
- Kept logs secondary and sanitized: the UI renders reservation number, outcome, sync state, scanner account, redacted ticket reference, and timestamp only.
- Treated scanner-only sidebar suppression as a client-side UX/access boundary complement; backend guards remain the authority for route/API authorization.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed locked workspace dependencies for test execution**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/web exec vitest ...` failed because the `vitest` binary was not installed in the manual worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile`; lockfile and tracked package files were unchanged.
- **Files modified:** None tracked
- **Verification:** RED test then failed for the expected missing `field-monitor` module; final targeted field monitor test passed.
- **Committed in:** N/A, generated dependency install artifacts are ignored.

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** No scope expansion; required to execute the planned TDD verification.

## Issues Encountered

- The manual worktree contract's full base hash `312cf4bf74cfab136f453776a75824840a0aeb47` was not a valid local or remote object. The worktree HEAD resolved to `312cf4bfa4c6f5762b2d1e577060ec616cf83c9d`, the same `312cf4bf` phase tracking commit prefix, and all commits were made on `worktree-agent-phase27-14`.
- `pnpm --filter @grabit/web typecheck` still fails outside Plan 27-14 scope on missing `components/admin/settlement-dashboard`, existing `admin-user-management` scanner/settlement label-map drift, and pre-existing `components/i18n/locale-switcher.tsx` shared locale import/type issues. No typecheck errors were reported from the new Plan 27-14 files.

## Verification

- PASS: `pnpm --filter @grabit/web exec vitest run components/field/__tests__/field-monitor.test.tsx` - 4 tests passed.
- PASS: `pnpm --filter @grabit/web exec vitest run components/field/__tests__/field-monitor.test.tsx components/field/__tests__/scanner-check-in.test.tsx` - 15 tests passed.
- PASS: `/admin/field-monitor` page exists.
- PASS: Sidebar contains `현장 모니터` at `/admin/field-monitor`.
- PASS: `FieldMonitor` and `use-field-monitor` do not import scanner offline store/UI modules.
- FAIL (out of scope): `pnpm --filter @grabit/web typecheck` fails on sibling/future-plan files listed under Issues Encountered.

## Known Stubs

None. Input placeholders such as `event ID`, `showtime ID`, and `scanner account` are filter control placeholders, not unwired UI data stubs.

## Threat Flags

None beyond the plan threat model. The new browser/API and admin navigation surfaces correspond to T-27-14-TOKEN-LEAK, T-27-14-AUTHZ, T-27-14-OFFLINE-FALSE-PASS, and T-27-14-ALERT-BLINDSPOT mitigations already declared in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The field monitor UI can consume the Plan 27-08 monitor endpoints and is reachable from the admin operations sidebar. Settlement/export UI work remains for later Phase 27 plans, and the existing out-of-scope typecheck failures should be cleared by their owning plans before final phase verification.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*

## Self-Check: PASSED

- Confirmed all created/modified plan files exist.
- Confirmed task commits `c273ba37`, `347500da`, `a4af44d8`, and `bd4f1211` exist in git history.
- Confirmed `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified in this worktree.
