---
phase: 24-traffic-booking-payment-core
plan: 22
subsystem: ui
tags: [react, nextjs, booking, svg, playwright, vitest]
requires:
  - phase: 24-16
    provides: "floor-aware booking summary and floor persistence in booking-page"
provides:
  - "overlay-safe SeatMapViewer click handling for visible seat-number labels"
  - "unit regression for centered seat-label selection and non-interactive checkmarks"
  - "route-stubbed floor-browser browser regression for desktop/mobile center interactions"
affects: [booking-page, seat-map-viewer, human-uat, payment-flow]
tech-stack:
  added: []
  patterns: [processed-svg overlay normalization, visible-center browser regression]
key-files:
  created: []
  modified:
    - apps/web/components/booking/seat-map-viewer.tsx
    - apps/web/components/booking/__tests__/seat-map-viewer.test.tsx
    - apps/web/e2e/booking-floor-selection.spec.ts
    - .planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md
    - .planning/phases/24-traffic-booking-payment-core/24-22-SUMMARY.md
key-decisions:
  - "Seat-number overlays are normalized during processed SVG generation with seat overlay metadata plus `pointer-events:none`, instead of teaching tests to click rect edges."
  - "The floor-browser regression stubs the real booking-page data flow and clicks the visible seat-label center coordinates, not `[data-seat-id]` shortcuts."
patterns-established:
  - "Vendor SVG overlays should be normalized before `dangerouslySetInnerHTML` so seat hit targets stay stable across desktop and mobile."
  - "Booking browser regressions should prove the visible interaction contract through summary/timer/CTA or floor-selection state, not synthetic DOM shortcuts."
requirements-completed: [BOOK-01, BOOK-02]
duration: 24min
completed: 2026-05-10
---

# Phase 24 Plan 22: Seat Label Hit Targets Summary

**SeatMapViewer now treats visible seat-number overlays as safe seat hit targets, and `/booking/floor-browser` regression coverage proves centered label interactions still drive floor-aware booking state.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-05-10T12:34:00Z
- **Completed:** 2026-05-10T12:57:56Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Processed SVG output now neutralizes vendor seat-number overlays before they can swallow centered clicks over `A-1`.
- Unit coverage directly clicks the visible label text and keeps sold-seat blocking plus decorative checkmark non-interactivity intact.
- A new Playwright regression drives the real booking page through `/booking/floor-browser`, verifies desktop summary/timer/CTA updates from centered label clicks, and re-checks mobile-sized selection state plus 1F/2F persistence.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harden `SeatMapViewer` against seat-number text overlay interception**
   - `7602a05` (`test`) RED: failing centered seat-label regression
   - `e88cc41` (`feat`) GREEN: processed SVG overlay normalization and passing unit coverage
2. **Task 2: Add a browser regression for desktop/mobile center-click selection across floors**
   - `42b03e4` (`test`) RED: failing `/booking/floor-browser` browser contract
   - `5c830a9` (`feat`) GREEN: route-stubbed desktop/mobile regression with floor persistence coverage
3. **Task 3: Resolve Human UAT test 4 and summarize the hit-target fix**
   - This commit updates `24-HUMAN-UAT.md` and records the execution summary in `24-22-SUMMARY.md`

## Files Created/Modified

- `apps/web/components/booking/seat-map-viewer.tsx` - Adds processed-SVG overlay normalization and overlay-aware event resolution without changing the floor-aware renderer contract.
- `apps/web/components/booking/__tests__/seat-map-viewer.test.tsx` - Reproduces the centered label click failure with inline SVG and keeps checkmark pointer-events coverage.
- `apps/web/e2e/booking-floor-selection.spec.ts` - Stubs the booking route contract for `/booking/floor-browser` and validates visible seat-label center interactions on desktop and mobile-sized Chromium.
- `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md` - Marks test 4 resolved with reproducible command evidence.
- `.planning/phases/24-traffic-booking-payment-core/24-22-SUMMARY.md` - Captures the execution record for this gap-closure plan.

## Decisions Made

- Overlay fixes live in the processed SVG layer so uploaded vendor maps become safe before event delegation runs.
- Browser coverage targets visible seat-label center coordinates instead of `[data-seat-id]` locators, because the human UAT failure was a rendered hit-target issue rather than a data-flow bug.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Mobile regression needed viewport-coordinate tapping because `SeatMapViewer` intentionally boots mobile at `initialScale=1.4`; relative locator positions were less reliable than tapping the visible seat-label center.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Human UAT test 4 is now closed with automated evidence, so Phase 24 no longer carries the seat-label hit-target blocker.
- Confirm/payment flows can rely on centered seat interactions without reintroducing edge-click workarounds in future browser tests.

## Verification

- `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx`
- `pnpm --filter @grabit/web exec playwright test e2e/booking-floor-selection.spec.ts --project=chromium --reporter=line`

## Self-Check: PASSED

- Summary artifact path: `.planning/phases/24-traffic-booking-payment-core/24-22-SUMMARY.md`
- Task commit hashes present in `git log --oneline --all`: `7602a05`, `e88cc41`, `42b03e4`, `5c830a9`

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-10*
