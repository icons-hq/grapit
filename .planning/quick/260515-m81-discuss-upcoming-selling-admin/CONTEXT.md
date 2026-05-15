---
quick_id: 260515-m81
slug: discuss-upcoming-selling-admin
status: planned
created: 2026-05-15
---

# Upcoming/Selling Admin Booking Context

## Locked Decisions

- D-01: Use the existing `performances.status` enum. `upcoming` means `오픈예정`, and `selling` means `오픈`. Do not add a DB field, migration, or derived persisted flag.
- D-02: When `status === 'upcoming'`, public performance UI and the admin performance list must display the start/end date range as `오픈예정`.
- D-03: Preserve actual stored `startDate` and `endDate` in forms, API payloads, DB rows, and admin edit flows.
- D-04: For upcoming performances, normal users must be blocked from booking CTA, direct booking route flow, and booking mutation APIs.
- D-05: Admin users can still book upcoming performances for testing.

## Existing Code Pointers

- Status enum and Korean labels live in `packages/shared/src/types/performance.types.ts` as `PerformanceStatus` and `STATUS_LABELS`.
- Public status badge uses `apps/web/components/performance/status-badge.tsx`; its Korean labels are sourced from shared `STATUS_LABELS`.
- Public card date range is rendered directly in `apps/web/components/performance/performance-card.tsx`.
- Public detail date range is rendered in `apps/web/app/performance/[id]/page.tsx` using `KstTime` for `startDate` and `endDate`.
- Admin performance list date range is rendered by `formatDateRange()` in `apps/web/app/admin/performances/page.tsx`.
- Admin performance filter labels are in `apps/web/components/admin/status-filter.tsx`.
- Runtime booking bypass for admins already exists in `apps/web/hooks/use-booking-availability.ts`.
- Client booking mutations live in `apps/web/hooks/use-booking.ts`; it already checks global runtime booking availability before `lockSeat`, `prepareReservation`, and payment confirm flows.
- Direct booking route entry is `apps/web/app/booking/[performanceId]/page.tsx`; actual seat/date UI is `apps/web/components/booking/booking-page.tsx`.
- Backend booking mutation guard is currently global only through `FeatureFlagsService.assertBookingEnabled(actor)`.
- `BookingController.lockSeat()` passes `{ id, role }` to `BookingService.lockSeat()`.
- `ReservationController.prepareReservation()` and `confirmPayment()` pass `{ id, role }` to `ReservationService`.
- `apps/api/src/modules/booking/booking.service.ts` can reach `showtimes.performanceId`; it should join `performances.status` before Redis lock mutation.
- `apps/api/src/modules/reservation/reservation.service.ts` already has `getShowtimeBookingContext()` for prepare flow; extend it to include performance status and enforce D-04/D-05.

## Scope Boundaries

- Do not create or edit migrations.
- Do not add a new DB column.
- Do not rewrite admin performance form date behavior.
- Do not transform API response `startDate` or `endDate`; only display surfaces should mask upcoming dates as `오픈예정`.
- Do not disable admin booking/payment tests for upcoming performances.
