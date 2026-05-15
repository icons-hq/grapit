---
status: complete
quick_id: 260515-hee
slug: admin-svg-seat-tier-editor-drag-paint-as
date: 2026-05-15
---

# Admin SVG Seat Tier Editor Drag Paint Assignment

## Goal

Add brush-style drag paint assignment to the admin SVG seat tier editor so admins can assign many SVG seats to a tier without clicking each seat individually.

## Plan

- Add a `드래그 배정` toggle inside `VisualSeatTierEditor`.
- Keep existing click and keyboard assignment behavior unchanged when drag mode is off.
- When drag mode is on, collect seats during pointer drag and commit one batched `onChange` on pointer release/cancel.
- Use paint-only semantics: painted seats are assigned to the active tier, moved from other tiers, and not toggled off when already assigned to the active tier.
- Add focused unit tests for drag paint, reassignment, non-toggle behavior, and controlled `SvgPreview` batching.
