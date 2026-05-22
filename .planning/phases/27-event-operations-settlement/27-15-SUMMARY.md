---
phase: 27-event-operations-settlement
plan: 15
subsystem: admin-ui
tags: [settlement, csv-export, scanner-permissions, react-query]

requires:
  - phase: 27-03
    provides: scanner capability foundation
  - phase: 27-09
    provides: settlement backend export API
  - phase: 27-14
    provides: field monitor admin navigation context
provides:
  - Admin settlement dashboard with guarded CSV export controls
  - Finance-scoped `/admin/settlement` route and sidebar entry
  - Scanner-only permission assignment labels and test coverage
affects: [admin, settlement, field-operations, scanner-permissions]

tech-stack:
  added: []
  patterns:
    - React Query summary hook plus guarded fetch/blob CSV download hook
    - Controlled component props for UI tests without QueryClientProvider
    - Capability-gated admin sidebar item using `settlement.export`

key-files:
  created:
    - apps/web/app/admin/settlement/page.tsx
    - apps/web/components/admin/settlement-dashboard.tsx
    - apps/web/hooks/use-admin-settlement.ts
  modified:
    - apps/web/components/admin/admin-sidebar.tsx
    - apps/web/components/admin/admin-user-management.tsx
    - apps/web/components/admin/__tests__/settlement-dashboard.test.tsx
    - apps/web/components/admin/__tests__/admin-user-management.test.tsx

key-decisions:
  - "Settlement exports use backend `dataset` values instead of a UI-only exportType alias."
  - "Settlement navigation is visible only to superuser/admin or users with `settlement.export`."
  - "Scanner bundle assignment surfaces only field scan capabilities in the selected payload."

patterns-established:
  - "Sensitive CSV exports require a reason, filter summary, actor evidence, and explicit confirmation before mutation."
  - "Scanner-only users receive a denial state and no settlement export action surface."

requirements-completed: [POST-01, QR-02]

duration: 13min
completed: 2026-05-22
---

# Phase 27 Plan 15: Settlement Dashboard And Scanner Permission UI Summary

**Admin/finance settlement dashboard with guarded CSV exports, route/sidebar wiring, and scanner-only permission assignment safeguards**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-22T04:55:47Z
- **Completed:** 2026-05-22T05:08:39Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Built `SettlementDashboard` with `요약`, `입장/노쇼`, `결제/환불`, `내보내기` tabs, required filters, no raw PII preview, and four guarded D-29 export actions.
- Added `useAdminSettlementSummary()` and `useAdminSettlementExport()` for `/api/v1/admin/settlement/summary` and `/api/v1/admin/settlement/export`.
- Wired `/admin/settlement`, added finance-scoped `정산·내보내기` sidebar navigation, and exposed scanner bundle labels without settlement/export/security/content capabilities.

## Task Commits

1. **Task 1 RED:** `97b12645` test(27-15): add failing settlement dashboard export contract
2. **Task 1 GREEN:** `2e97f6ea` feat(27-15): implement settlement dashboard export UI
3. **Task 2 RED:** `c13a2b24` test(27-15): add failing scanner bundle assignment contract
4. **Task 2 GREEN:** `8f677fbd` feat(27-15): wire settlement route and scanner permission UI

## Files Created/Modified

- `apps/web/app/admin/settlement/page.tsx` - Admin route rendering the settlement dashboard.
- `apps/web/components/admin/settlement-dashboard.tsx` - Dashboard, filter UI, tabs, guarded export confirmation, scanner denial state, and masked-only sample display.
- `apps/web/hooks/use-admin-settlement.ts` - React Query summary hook and authenticated CSV blob download hook.
- `apps/web/components/admin/admin-sidebar.tsx` - Adds `정산·내보내기` after `현장 모니터` and gates it with `settlement.export`.
- `apps/web/components/admin/admin-user-management.tsx` - Adds scanner bundle and field scan/settlement capability labels.
- `apps/web/components/admin/__tests__/settlement-dashboard.test.tsx` - Covers four dataset exports, actor/filter confirmation, scanner denial, and no raw PII preview.
- `apps/web/components/admin/__tests__/admin-user-management.test.tsx` - Covers scanner-only bundle assignment payload exclusions.

## Decisions Made

- Used backend-native `SettlementExportDataset` values in UI payloads so frontend export actions match the existing NestJS settlement controller contract.
- Kept settlement export as finance/full-admin scope by checking `settlement.export` in both sidebar visibility and dashboard denial behavior.
- Kept payment/reservation/entry/refund filters visible in the UI while only sending backend-supported settlement query/export fields to the strict API schema.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored local test dependencies**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/web exec vitest ...` failed because the manual worktree had no `node_modules` install.
- **Fix:** Ran `pnpm install --frozen-lockfile` at the worktree root.
- **Files modified:** None committed; install artifacts are ignored/generated.
- **Verification:** Vitest executed and produced the expected RED failure, then passed after implementation.
- **Committed in:** Not applicable; environment repair only.

**2. [Rule 3 - Blocking] Built shared package before web typecheck**
- **Found during:** Task 2 verification
- **Issue:** `@grabit/web` typecheck could not resolve existing `@grabit/shared/...js` subpath imports until shared `dist` existed.
- **Fix:** Ran `pnpm --filter @grabit/shared build` before `pnpm --filter @grabit/web typecheck`.
- **Files modified:** None committed; generated build output is not tracked.
- **Verification:** `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** Not applicable; environment repair only.

---

**Total deviations:** 2 auto-fixed Rule 3 blocking environment issues
**Impact on plan:** No scope change; both repairs were required to run the planned verification commands in this manual worktree.

## Issues Encountered

- The manual worktree contract supplied full SHA `6cf6a7f4c7219427b53440c9fbaedcc2241f23b9`, which was not a valid local or remote object. The worktree branch and phase branch were actually at `6cf6a7f425da8be5940e501933629fea418e130e`; merge-base was verified against that exact object before edits.
- A first patch attempt targeted the default checkout instead of the manual worktree. The affected main-checkout test file was immediately reverted, and all subsequent edits were applied inside `/Users/sangwopark19/icons/grapit/.codex/worktrees/agent-phase27-15`.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/settlement-dashboard.test.tsx components/admin/__tests__/admin-user-management.test.tsx` - PASS, 12 tests.
- `pnpm --filter @grabit/shared build` - PASS, required local generated declarations for web typecheck.
- `pnpm --filter @grabit/web typecheck` - PASS.

## Known Stubs

None. Stub scan found only existing placeholder attributes, empty arrays for existing state defaults, and test-only raw PII fixtures that are asserted not to render.

## Threat Flags

None. New settlement API/export browser surface and scanner permission escalation risks were already covered by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 27-16 can use the guarded settlement UI and scanner permission labels as completed admin surfaces. The orchestrator should update shared `.planning/STATE.md` and `.planning/ROADMAP.md` after merging this manual worktree.

## Self-Check: PASSED

- Created/modified files exist on disk.
- Task commits `97b12645`, `2e97f6ea`, `c13a2b24`, and `8f677fbd` exist in git history.
- `.planning/STATE.md` and `.planning/ROADMAP.md` were not modified in this manual worktree.

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
