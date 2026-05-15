---
quick_id: 260515-ldb
slug: seat-map-center
status: complete
date: 2026-05-15
---

# Quick Task 260515-ldb Summary

## Result

Completed. The booking seat-map viewer now centers the SVG map horizontally and vertically inside the transform viewport while preserving zoom/pan, MiniMap, mobile initial scale, SVG sanitization, and seat click behavior.

## Changes

- Added a `TransformComponent` props spy and regression test for the viewport/content centering contract.
- Updated `SeatMapViewer` transform wrapper/content classes to use flex centering with the existing desktop/mobile minimum heights.
- Kept the inline SVG container full-width and bounded by `max-w-full` so responsive SVG rendering remains intact.

## Verification

- `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx` passed: 65 files, 413 tests.
- `pnpm --filter @grabit/web lint -- components/booking/seat-map-viewer.tsx components/booking/__tests__/seat-map-viewer.test.tsx` passed with 0 errors and 28 pre-existing warnings.
- `git diff --check -- apps/web/components/booking/seat-map-viewer.tsx apps/web/components/booking/__tests__/seat-map-viewer.test.tsx` passed.

## Deviations

None.

## Known Stubs

None.

## Self-Check: PASSED

- SUMMARY file exists.
- Stub scan found no UI-blocking placeholder data in the modified files.
- Threat surface scan found no new network, auth, file, schema, or trust-boundary surface; existing SVG fetch/sanitize/inline render path was preserved.
