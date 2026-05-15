---
status: complete
quick_id: 260515-hee
slug: admin-svg-seat-tier-editor-drag-paint-as
date: 2026-05-15
---

# Summary

Added brush-style drag paint assignment to the admin SVG seat tier editor.

## Changes

- Added a `드래그 배정` toggle to `VisualSeatTierEditor`.
- Preserved existing click and keyboard assignment behavior when drag mode is off.
- Batched drag assignment so `onChange` fires once on pointer release/cancel instead of once per seat.
- Kept paint-only semantics: dragged seats move to the active tier and are not toggled off when already assigned.
- Added regression coverage for drag paint, reassignment, non-toggle behavior, pointer cancel, and controlled `SvgPreview` batching.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/visual-seat-tier-editor.test.tsx components/admin/__tests__/svg-preview.test.tsx`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/web lint` (passed with existing warnings)
