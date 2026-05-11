---
phase: 24-traffic-booking-payment-core
plan: 15
subsystem: ui
tags: [react, nextjs, admin, seat-map, booking-policy]
requires:
  - phase: 24-06
    provides: floor-aware seatMaps and bookingPolicy contracts
provides:
  - Reusable floor seat map editor with duplicate floorKey validation
  - Admin performance form wiring for seatMaps and bookingPolicy payloads
  - Controlled multi-floor SVG preview reuse with existing SVG safety checks
affects: [admin-console, booking-ui, payment-policy]
tech-stack:
  added: []
  patterns:
    - Reuse SvgPreview in controlled form mode instead of creating a second SVG upload path
    - Validate duplicate floorKey values inline before submit and keep correction state in the editor
key-files:
  created:
    - apps/web/components/admin/floor-seat-map-editor.tsx
    - apps/web/components/admin/__tests__/floor-seat-map-editor.test.tsx
  modified:
    - apps/web/hooks/use-admin.ts
    - apps/web/components/admin/performance-form.tsx
    - apps/web/components/admin/svg-preview.tsx
key-decisions:
  - Reused the existing SvgPreview validation/upload flow via controlled props so multi-floor upload stays on the same safety path.
  - Disabled generic create/update mutation toasts in use-admin and handled duplicate floorKey correction inline in PerformanceForm.
patterns-established:
  - Multi-floor admin inputs are owned by PerformanceForm and edited through a reusable FloorSeatMapEditor value/onChange contract.
  - Floor duplicate errors surface in a persistent editor alert instead of resetting seat-map rows.
requirements-completed: [BOOK-01, BOOK-03]
duration: 11min
completed: 2026-05-08
---

# Phase 24 Plan 15: Admin Floor Editor Summary

**Multi-floor admin seat-map editing with inline duplicate `floorKey` correction and booking-policy payload wiring**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-08T07:17:30Z
- **Completed:** 2026-05-08T07:28:31Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `FloorSeatMapEditor` so operators can manage per-floor `floorKey`, `floorLabel`, `sortOrder`, `svgUrl`, and preview blocks in one place.
- Wired `PerformanceForm` to submit `seatMaps` and `bookingPolicy` directly, including `maxTicketsPerUser`, `allowedPaymentMethods`, `changePolicyEnabled`, cancelled-seat hold settings, and manual-open policy state.
- Adapted `SvgPreview` to work in controlled form mode, preserving the existing SVG safety and preview pipeline without introducing a second upload path.

## Task Commits

1. **Task 1: Add floor-aware admin hook payloads and the reusable floor editor component** - `bdf660d` (`feat`)
2. **Task 2: Wire multi-floor SVG preview and booking-policy controls into the performance form** - `9802bde` (`feat`)

## Files Created/Modified

- `apps/web/components/admin/floor-seat-map-editor.tsx` - Reusable multi-floor editor with duplicate `floorKey` detection and row-level metadata editing.
- `apps/web/components/admin/__tests__/floor-seat-map-editor.test.tsx` - Regression coverage for duplicate `floorKey` detection and server correction alert rendering.
- `apps/web/components/admin/performance-form.tsx` - Form defaults, seat-map wiring, booking-policy controls, and inline duplicate correction flow.
- `apps/web/components/admin/svg-preview.tsx` - Controlled preview mode for form-owned seat-map rows while keeping existing SVG validation and upload behavior.
- `apps/web/hooks/use-admin.ts` - Floor-aware seat-map save typing and create/update mutations with form-owned error handling.

## Decisions Made

- `SvgPreview` was converted into a dual-mode component instead of introducing a new uploader, because the plan explicitly required keeping the existing SVG safety path intact.
- Duplicate `floorKey` handling lives at the form/editor boundary so row state survives both client-side rejection and server-side `422` correction.

## Deviations from Plan

None - plan executed within the owned web/admin scope.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` is still failing outside this plan's ownership scope. Current failures are in:
  - `app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`
  - `app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx`
  - `hooks/__tests__/use-booking.test.tsx`
- These failures are pre-existing fallout from floor-aware shared contract changes and were not modified here per the ownership constraint.

## Verification

- `pnpm --filter @grabit/web exec vitest run components/admin` ✅
- `pnpm --filter @grabit/web test -- components/admin` ✅
- `pnpm --filter @grabit/web typecheck` ❌
  - Fails only in out-of-scope test fixtures/mocks listed above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Admin UI can now author floor-aware `seatMaps` and `bookingPolicy` data before Phase 25 console expansion.
- Downstream booking/payment plans can consume explicit policy payloads instead of inferring them from legacy single-seat-map state.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-15-SUMMARY.md`.
- Task commits `bdf660d` and `9802bde` exist in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
