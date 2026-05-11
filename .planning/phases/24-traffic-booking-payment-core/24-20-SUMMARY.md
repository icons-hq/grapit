---
phase: 24-traffic-booking-payment-core
plan: "20"
subsystem: ui
tags: [queue, booking, playwright, e2e, accessibility]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Queue waiting surface and initial browser coverage from 24-08
provides:
  - Stable metric selector contract for queue waiting tiles
  - Strict-safe Playwright assertions scoped to queue metric tiles and headings
affects: [queue, booking, browser-verification, i18n]
tech-stack:
  added: []
  patterns:
    - Scope repeated localized copy checks to explicit surface contracts instead of page-level text
    - Use labeled metric groups plus `data-testid` for queue waiting metrics that must stay stable across helper copy changes
key-files:
  created:
    - .planning/phases/24-traffic-booking-payment-core/24-20-SUMMARY.md
  modified:
    - apps/web/components/booking/queue-waiting.tsx
    - apps/web/e2e/booking-queue.spec.ts
key-decisions:
  - "Queue metric tiles expose explicit `queue-metric-*` test ids so browser assertions do not depend on DOM order."
  - "Queue headings use role-based assertions and metric content is checked inside each tile, removing `.first()`/`.nth()` weakening."
patterns-established:
  - "Repeated i18n labels in helper prose should be tested through scoped locators, not page-wide text searches."
requirements-completed:
  - TRAF-01
  - TRAF-02
duration: ~10m
completed: 2026-05-10
---

# Phase 24 Plan 20: Queue Metric Locator Stabilization Summary

**`QueueWaiting` metric tiles now expose stable selectors, and the queue E2E spec verifies localized position, ETA, and remaining-seat content inside those tiles instead of ambiguous page-level copy.**

## Performance

- **Duration:** ~10m
- **Started:** 2026-05-10T17:41:00+09:00
- **Completed:** 2026-05-10T17:50:32+09:00
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added an explicit selector/accessibility contract for queue position, ETA, and remaining-seat metrics in `QueueWaiting`.
- Rewrote the waiting-state Playwright assertions to target metric tiles and heading roles rather than duplicated page text.
- Preserved the existing Korean queue title and helper copy while removing strict-locator ambiguity.

## Task Commits

1. **Task 1: Add stable queue metric semantics and scope the waiting-state assertions to them** - `b18462e` (`fix`)

## Files Created/Modified

- `apps/web/components/booking/queue-waiting.tsx` - Adds labeled metric groups with stable `queue-metric-*` selectors for the three waiting metrics.
- `apps/web/e2e/booking-queue.spec.ts` - Scopes localized queue assertions to the metric tiles and role-based headings, removing ambiguous page-level `getByText(...)`.
- `.planning/phases/24-traffic-booking-payment-core/24-20-SUMMARY.md` - Execution record for this plan.

## Decisions Made

- Used explicit `data-testid` contracts on the metric tiles instead of relying on DOM order or copy changes.
- Replaced page-level text and `.first()` heading assertions with metric-scoped `getByTestId(...)` checks and `getByRole('heading', ...)`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web exec playwright test e2e/booking-queue.spec.ts --project=chromium --reporter=line` - PASS (`4 passed`)
- `rg -n "queue-metric-position|queue-metric-eta|queue-metric-remaining-seats|\\.first\\(|\\.nth\\(" apps/web/components/booking/queue-waiting.tsx apps/web/e2e/booking-queue.spec.ts` - PASS (stable metric selectors present; `.first()` / `.nth()` absent from the owned queue spec)

## Next Phase Readiness

- Downstream queue verification can rely on stable metric-tile selectors even when localized helper prose repeats the same labels.
- The queue waiting browser slice is green and no longer depends on ambiguous page-level localized text.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-20-SUMMARY.md`.
- Task commit `b18462e` exists in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-10*
