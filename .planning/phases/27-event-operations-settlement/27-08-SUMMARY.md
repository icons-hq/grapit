---
phase: 27-event-operations-settlement
plan: 08
subsystem: field-operations
tags: [nestjs, drizzle, field-monitor, qr-scan, rbac]

requires:
  - phase: 27-event-operations-settlement
    provides: field scan events, scanner capabilities, offline sync contracts
provides:
  - KPI-first field monitor aggregation for entered/not-entered, entry rate, duplicate/rejected scans, offline pending/synced counts, and D-26 alerts
  - Guarded field monitor API endpoints for summary and secondary redacted logs
affects: [field-operations, admin-operations, event-day-monitoring]

tech-stack:
  added: []
  patterns:
    - NestJS controller/service with RolesGuard plus AdminCapabilitiesGuard
    - Drizzle aggregate read model over reservations, payments, tickets, showtimes, performances, and ticket_scan_events
    - Redacted allowlist mapping for secondary scan logs

key-files:
  created:
    - apps/api/src/modules/field-operations/field-monitor.service.ts
    - apps/api/src/modules/field-operations/field-monitor.controller.ts
  modified:
    - apps/api/src/modules/field-operations/field-operations.module.ts

key-decisions:
  - "Field monitor summary uses field.scan.verify so scanner/admin staff can read showtime-scoped KPI health without settlement or export access."
  - "Secondary monitor logs require audit.read and return only allowlisted redacted fields."
  - "The API returns updatedAt plus lastUpdatedAt/alerts aliases to satisfy the D-24 plan language while preserving existing shared schema naming."

patterns-established:
  - "KPI-first monitor response: summary metrics are returned before secondary log rows."
  - "D-26 alert categories are normalized from scan event result/sync-state signals."
  - "Monitor log rows are constructed through an allowlist mapper instead of returning raw DB rows."

requirements-completed: [FIELD-01]

duration: 10m07s
completed: 2026-05-22
---

# Phase 27 Plan 08: Event-Day Field Monitor API Summary

**KPI-first event-day field monitor API with D-24 operational counts, D-26 abnormal alerts, and redacted secondary scan logs.**

## Performance

- **Duration:** 10m07s
- **Started:** 2026-05-22T04:14:28Z
- **Completed:** 2026-05-22T04:24:35Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `FieldMonitorService.getSummary()` over reservation/payment/ticket/showtime/scan-event data with entered, not-entered, entry rate, duplicate/rejected scan, offline pending, offline synced, alert, and freshness fields.
- Added D-26 alert normalization for duplicate spike, rejected/tampered scan, refunded/cancelled attempt, offline backlog, and sync failure categories.
- Added `FieldMonitorController` under `field/monitor` with capability-guarded `summary` and `logs` endpoints.
- Registered the monitor controller/service in `FieldOperationsModule`.
- Preserved raw token/JTI/PII redaction by returning secondary log rows through an allowlist mapper only.

## Task Commits

1. **Task 1: Implement KPI-first monitor aggregation** - `2ddf5169` (feat)
2. **Task 2: Wire monitor endpoint with admin capability protection** - `9dc58f76` (feat)

## Files Created/Modified

- `apps/api/src/modules/field-operations/field-monitor.service.ts` - Aggregates field monitor KPIs, normalizes alerts, and maps redacted scan log rows.
- `apps/api/src/modules/field-operations/field-monitor.controller.ts` - Adds authenticated/capability-guarded monitor summary and secondary log endpoints.
- `apps/api/src/modules/field-operations/field-operations.module.ts` - Registers the monitor controller/service with the field operations module.

## Decisions Made

- Summary access uses `field.scan.verify` so scanner-only accounts can read showtime-scoped operational health without gaining settlement/export privileges.
- Secondary scan logs use `audit.read`, keeping log drill-down restricted to admin/finance/reviewer-style audit readers.
- Monitor response includes both `latestAbnormalAlerts`/`updatedAt` and `alerts`/`lastUpdatedAt` aliases to bridge the shared schema and the plan acceptance language.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Environment] Restored local verification dependencies**
- **Found during:** Task 1 RED verification
- **Issue:** `pnpm --filter @grabit/api exec vitest ...` failed because this manual worktree had no `node_modules`, so the `vitest` binary was unavailable.
- **Fix:** Ran `pnpm install`, then built `@grabit/shared` before the final typecheck because the package exports resolve through `packages/shared/dist`.
- **Files modified:** Ignored local dependency/build artifacts only; no tracked source files.
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-monitor.service.spec.ts` and `pnpm --filter @grabit/api typecheck` both passed.
- **Committed in:** N/A - environment setup only.

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** Verification environment repair only. No product scope change.

## TDD Gate Compliance

- RED contract already existed from prior Phase 27 work (`69f83c65 test(27-02): add offline sync and field monitor contracts`).
- RED was re-verified in this plan: the field monitor spec failed before implementation because `field-monitor.service.ts` did not exist.
- GREEN was committed in `2ddf5169`.

## Issues Encountered

- `@grabit/shared` must be built before `@grabit/api typecheck` in a fresh manual worktree because the API package resolves shared types through `packages/shared/dist`.
- A first patch attempt targeted the parent repo path instead of the manual worktree; the accidental untracked file was removed immediately, and the parent repo was checked clean for that path before continuing.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - stub scan found only legitimate empty-array initialization and null filtering in implementation code.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: monitor-api-surface | `apps/api/src/modules/field-operations/field-monitor.controller.ts` | New monitor read API surface crosses scanner/admin trust boundary; mitigated with `RolesGuard` plus `AdminCapabilitiesGuard` and no settlement/export endpoint. |

## Verification

- PASS: `pnpm --filter @grabit/api exec vitest run src/modules/field-operations/field-monitor.service.spec.ts`
- PASS: `pnpm --filter @grabit/api typecheck`
- PASS: Acceptance grep confirmed required KPI fields, D-26 alert categories, and no raw token/JTI/PII literals in the service implementation.

## Next Phase Readiness

Plan 27-08 is ready for downstream UI/admin integration. Field monitor consumers can call the summary endpoint for KPI-first data and the audit-restricted logs endpoint for secondary drill-down.

## Self-Check: PASSED

- FOUND: `apps/api/src/modules/field-operations/field-monitor.service.ts`
- FOUND: `apps/api/src/modules/field-operations/field-monitor.controller.ts`
- FOUND: `.planning/phases/27-event-operations-settlement/27-08-SUMMARY.md`
- FOUND commit: `2ddf5169`
- FOUND commit: `9dc58f76`

---
*Phase: 27-event-operations-settlement*
*Completed: 2026-05-22*
