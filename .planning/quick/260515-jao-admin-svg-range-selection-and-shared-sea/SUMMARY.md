# Quick Task 260515-jao Summary

## Scope

Admin SVG seat tier editing now supports rectangular range assignment instead of brush-style drag paint, and multi-floor seat maps use shared tier structure controls.

## Changes

- `VisualSeatTierEditor`
  - Added `범위 배정` mode.
  - Uses pointer/mouse drag coordinates to draw a selection rectangle.
  - Selects every `[data-seat-id]` whose `getBoundingClientRect()` intersects the selection rectangle.
  - Commits selected seats once on pointer/mouse release.
  - Moves seats from any existing tier into the active tier without toggling active-tier seats off.

- `FloorSeatMapEditor`
  - Added `통합 좌석등급` controls.
  - Adding, renaming, recoloring, or deleting a tier is synchronized across all floors.
  - Per-floor assigned `seatIds` are preserved when tier metadata changes.

- `TierEditor` / `SvgPreview` / `PerformanceForm`
  - Added an opt-out for tier structure editing in per-floor previews.
  - Floor-level editors still support direct seat ID assignment.
  - API payload, DB schema, and `seatConfig.tiers` structure are unchanged.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/visual-seat-tier-editor.test.tsx components/admin/__tests__/floor-seat-map-editor.test.tsx components/admin/__tests__/svg-preview.test.tsx`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/web lint`
- `git diff --check`

## Notes

- This intentionally implements rectangular range selection only. Lasso selection and erase mode remain out of scope.
- Range selection is optimized for admin desktop/tablet workflows; mobile-specific gesture handling can be added later if needed.
