---
phase: 24-traffic-booking-payment-core
plan: 16
subsystem: ui
tags: [react, nextjs, booking, zustand, vitest]
requires:
  - phase: 24-06
    provides: "Phase 24 performance contract with seatMaps[] and bookingPolicy fields"
  - phase: 24-07
    provides: "Floor-aware backend booking semantics using seatKey and event ticket policy"
provides:
  - "Sticky floor selector UI for multi-floor booking"
  - "Floor-aware client booking state and lock/prepare mutation wiring"
  - "Grouped booking summary with policy-driven ticket-limit guidance"
affects: [booking-confirm, payment-flow, seat-map-viewer, performance-detail-tests]
tech-stack:
  added: []
  patterns: [floor-aware seatKey normalization, policy-driven booking copy]
key-files:
  created:
    - apps/web/components/booking/floor-selector.tsx
    - apps/web/components/booking/__tests__/floor-selector.test.tsx
    - .planning/phases/24-traffic-booking-payment-core/24-16-SUMMARY.md
  modified:
    - apps/web/components/booking/booking-page.tsx
    - apps/web/stores/use-booking-store.ts
    - apps/web/hooks/use-booking.ts
    - apps/web/hooks/__tests__/use-booking.test.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
key-decisions:
  - "Selected seats stay floor-aware in the Zustand store with seatKey as the canonical removal/deduplication key."
  - "booking-page renders its own grouped summary instead of reusing the old panel/sheet so the hardcoded max-4 copy disappears without changing shared booking row components."
patterns-established:
  - "Renderer-local seat highlighting uses raw seatId only for the active floor; store/mutations keep floorKey and seatKey end-to-end."
  - "Visible ticket-limit and post-payment guidance come from performance.bookingPolicy rather than UI constants."
requirements-completed: [BOOK-01, BOOK-03]
duration: 23min
completed: 2026-05-08
---

# Phase 24 Plan 16: Floor-Aware Booking Summary

**Multi-floor booking now keeps seat selections across floor switches, sends floor-aware mutation payloads, and shows event-policy ticket guidance instead of the old max-4 copy.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-05-08T07:50:25Z
- **Completed:** 2026-05-08T08:13:05Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `use-booking-store` and `use-booking` now normalize `floorKey`, `floorLabel`, and `seatKey`, and send runtime floor-aware payloads for lock/prepare requests.
- `booking-page` now renders a sticky `FloorSelector`, projects seat status per floor, and groups selected seats by floor label while preserving selections across floor switches.
- Booking UI copy now uses `performance.bookingPolicy.maxTicketsPerUser` and explicitly routes post-payment seat changes to cancellation/refund guidance.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add floor-aware booking state and request wiring in the web store/hook**
   - `2464732` (`test`) RED: failing hook tests for floor-aware lock/prepare behavior
   - `b427747` (`feat`) GREEN: floor-aware store normalization and booking mutation wiring
2. **Task 2: Render the floor selector and grouped booking summary without breaking existing seat-map UX**
   - `ed48331` (`test`) RED: failing booking-page floor selector tests
   - `05710b6` (`feat`) GREEN: sticky floor selector, grouped summary UI, and compatibility fixture fixes

## Files Created/Modified

- `apps/web/stores/use-booking-store.ts` - Normalizes seat selections into a floor-aware store contract and removes seats by `seatKey`.
- `apps/web/hooks/use-booking.ts` - Converts lock requests to runtime seat keys and derives prepare payload policy/seats from the floor-aware cache/store.
- `apps/web/components/booking/floor-selector.tsx` - Sticky `ToggleGroup` floor navigation with per-floor selection counts.
- `apps/web/components/booking/booking-page.tsx` - Active-floor seat projection, grouped summaries, policy copy, and custom desktop/mobile booking summary surfaces.
- `apps/web/components/booking/__tests__/floor-selector.test.tsx` - Booking-page integration tests for floor switching and policy copy.
- `apps/web/hooks/__tests__/use-booking.test.tsx` - Hook-level TDD coverage for floor-aware lock and prepare payloads.
- `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx` - Compatibility fixture update for the shared `PerformanceWithDetails` contract.
- `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx` - Compatibility fixture update for the shared `PerformanceWithDetails` contract.

## Decisions Made

- Keep `seatKey` as the canonical identity in client state and mutation payloads while converting back to raw `seatId` only for the current floor’s SVG renderer.
- Replace the old `SeatSelectionPanel`/`SeatSelectionSheet` path inside `booking-page` rather than widening their props, because the plan only needed grouped floor summaries in booking and the existing components hardcoded `최대 4석`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Patched legacy performance detail fixtures to match the shared floor-aware contract**
- **Found during:** Task 2 verification
- **Issue:** `pnpm --filter @grabit/web typecheck` failed because two pre-existing performance detail test fixtures still omitted `seatMaps` and `bookingPolicy` from `PerformanceWithDetails`.
- **Fix:** Added minimal `seatMaps: []` and `bookingPolicy` fixture data so web typecheck could validate against the shared Phase 24 contract.
- **Files modified:** `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`, `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx`
- **Verification:** `pnpm --filter @grabit/web typecheck`
- **Committed in:** `05710b6`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was limited to compatibility fixtures needed to close verification. No product scope changed.

## Issues Encountered

- Radix `ToggleGroup` exposes floor tabs as `role="radio"` rather than `button`, so the Task 2 RED test needed a small matcher correction before the implementation could be verified correctly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Booking UI now provides the floor-aware client state that confirm/payment screens can consume without collapsing same-label seats across floors.
- The separate payment/refund work can rely on grouped floor-aware selections and event-policy copy already being present in the web booking surface.

## Verification

- `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx`
- `pnpm --filter @grabit/web test -- components/booking/__tests__/floor-selector.test.tsx hooks/__tests__/use-booking.test.tsx`
- `pnpm --filter @grabit/web typecheck`

## Self-Check: PASSED

- Summary artifact exists at `.planning/phases/24-traffic-booking-payment-core/24-16-SUMMARY.md`.
- Task commit hashes `2464732`, `b427747`, `ed48331`, and `05710b6` are present in `git log --oneline --all`.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
