---
status: complete
quick_id: 260515-jao
slug: admin-svg-range-selection-and-shared-sea
date: 2026-05-15
---

# Admin SVG Range Selection And Shared Seat Tiers

## Goal

Replace brush-style drag assignment with rectangular range assignment, and make seat tier structure shared across floor seat maps so admins add/edit tiers once instead of per floor.

## Plan

- Change `VisualSeatTierEditor` drag mode from brush paint to rectangle range selection.
- Select seats by intersecting each SVG seat element's bounding box with the drawn rectangle, then commit one batched tier assignment.
- Add shared seat tier controls to `FloorSeatMapEditor` that sync tier name/color/add/remove across all floors while preserving per-floor `seatIds`.
- Make per-floor `TierEditor` read tier structure from the shared controls and only edit seat assignments.
- Add focused regression tests for range selection and shared tier synchronization.

## Result

- Confirmed rectangular drag range assignment is feasible because SVG seats are DOM elements with `[data-seat-id]`, so their client bounding boxes can be intersected with the user-drawn selection rectangle.
- Replaced brush-style drag assignment with range selection in `VisualSeatTierEditor`.
- Added shared seat tier structure controls in `FloorSeatMapEditor` so tier add/name/color/delete applies across all floors while floor-specific `seatIds` remain separate.
- Kept existing per-floor direct seat ID input and controlled `SvgPreview -> PerformanceForm` flow intact.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/visual-seat-tier-editor.test.tsx components/admin/__tests__/floor-seat-map-editor.test.tsx components/admin/__tests__/svg-preview.test.tsx`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/web lint` (passed with pre-existing warnings)
- `git diff --check`
