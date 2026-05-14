---
quick_id: 260514-vlt
slug: venue-layout-template-seats
status: complete
completed_at: 2026-05-14T13:39:00+09:00
branch: quick/venue-layout-template-seats
---

# Quick Task 260514-vlt - Summary

## Completed

- Added venue layout template schema contracts, performance seat tier/assignment contracts, and migration `0015_venue_layout_template_seats.sql`.
- Extended runtime seat identity capacity by widening seat key columns and allowing `disabled` seat inventory status.
- Added admin server-side validation for duplicate floor keys, duplicate seat assignments, unknown tier names, and seat assignment count overflow before persistence.
- Replaced the textarea-first admin seat assignment flow with a visual SVG click editor while preserving the legacy `SeatMapConfig` payload.
- Updated booking runtime to prefer `data-seat-key`, keep legacy `data-seat-id` fallback, and treat `held`/`disabled` as unavailable.
- Addressed final review findings: aligned `seat_inventories.seat_id` to the 120-character runtime key limit, subtracts `disabled` seats from queue availability, and URL-encodes unlock seat keys.
- Completed the remaining cutover work by mirroring saved legacy `seatMaps[]` into `venue_layouts`, `venue_layout_floors`, `venue_layout_seats`, `performance_seat_tiers`, and `performance_seat_assignments` in the same admin transaction.
- Added `seat_maps.venue_layout_id` as the compatibility bridge so legacy API responses still work while runtime can detect template-backed maps.
- Updated reservation canonical price/tier lookup to use performance seat assignment overlays first, falling back to legacy `seatMaps[].seatConfig` only when no template-backed overlay exists.
- Tightened admin validation so detected SVG seats must be assigned to a tier before save.

## Verification

- PASS: `pnpm install --offline`
- PASS: `pnpm --filter @grabit/shared build`
- PASS: `pnpm --filter @grabit/shared typecheck`
- PASS: `pnpm --filter @grabit/api typecheck`
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/shared test`
- PASS: `pnpm --filter @grabit/api test`
- PASS: `pnpm --filter @grabit/web test`
- PASS: `git diff --check`

## Notes

- Legacy `seatMaps[]` remains as a response adapter and edit compatibility layer, but new admin saves now persist the template/overlay rows used by the runtime lookup path.
- Migration `0015` follows the existing SQL-only migration pattern already present for manual migrations such as `0011` and `0013`.
- Web tests still emit existing jsdom/React act warnings in unrelated cases, but all assertions pass.
