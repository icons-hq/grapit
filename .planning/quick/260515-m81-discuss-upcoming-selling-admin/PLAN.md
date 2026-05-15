---
quick_id: 260515-m81
slug: discuss-upcoming-selling-admin
status: planned
created: 2026-05-15
type: quick
files_to_change:
  - packages/shared/src/types/performance.types.ts
  - apps/web/components/performance/status-badge.tsx
  - apps/web/components/performance/__tests__/status-badge.test.tsx
  - apps/web/components/performance/performance-card.tsx
  - apps/web/components/performance/__tests__/performance-card.test.tsx
  - apps/web/app/performance/[id]/page.tsx
  - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  - apps/web/app/admin/performances/page.tsx
  - apps/web/app/admin/performances/__tests__/admin-performances-page.test.tsx
  - apps/web/components/admin/status-filter.tsx
  - apps/web/components/admin/performance-form.tsx
  - packages/shared/src/schemas/performance.schema.ts
  - apps/api/src/modules/admin/admin.service.ts
  - apps/web/app/booking/[performanceId]/page.tsx
  - apps/web/components/booking/booking-page.tsx
  - apps/web/hooks/use-booking.ts
  - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
  - apps/web/hooks/__tests__/use-booking.test.tsx
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
---

# Quick Task Plan

## Goal

Implement upcoming/selling display and booking policy using existing `performances.status` only: `upcoming` displays as `오픈예정`, `selling` displays as `오픈`, public users cannot book upcoming performances, and admins can still book them for testing.

## Tasks

### 1. Update visible status/date surfaces

Files:
- `packages/shared/src/types/performance.types.ts`
- `apps/web/components/performance/status-badge.tsx`
- `apps/web/components/performance/__tests__/status-badge.test.tsx`
- `apps/web/components/performance/performance-card.tsx`
- `apps/web/components/performance/__tests__/performance-card.test.tsx`
- `apps/web/app/performance/[id]/page.tsx`
- `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`
- `apps/web/app/admin/performances/page.tsx`
- `apps/web/app/admin/performances/__tests__/admin-performances-page.test.tsx`
- `apps/web/components/admin/status-filter.tsx`

Actions:
- Per D-01, change Korean `STATUS_LABELS` so `upcoming: '오픈예정'` and `selling: '오픈'`; keep enum values unchanged.
- Keep non-Korean localized labels unchanged unless the existing test requires a narrow adjustment.
- In `PerformanceCard`, if `performance.status === 'upcoming'`, render the date line as exactly `오픈예정`; otherwise keep the existing formatted `startDate ~ endDate`.
- In `PerformanceDetailPage`, if `performance.status === 'upcoming'`, render the date row value as exactly `오픈예정` instead of two `KstTime` values; otherwise keep current date rendering.
- In `AdminPerformancesPage`, change `formatDateRange` or its call site to receive the full performance/status and show `오픈예정` for upcoming rows only.
- In `StatusFilter`, update filter labels to `오픈` and `오픈예정` for `selling` and `upcoming`.
- In `PerformanceForm`, add an admin-visible two-option sale status selector: `upcoming=오픈예정`, `selling=오픈`.
- In shared performance schema and admin service, persist the selected existing `status` value on create/update. Keep DB schema unchanged per D-01 and keep stored dates unchanged per D-03.

Verify:
- `pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx components/performance/__tests__/performance-card.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx app/admin/performances/__tests__/admin-performances-page.test.tsx`
- `pnpm --filter @grabit/web typecheck`

Done:
- Korean badges/filter labels show `오픈` and `오픈예정`.
- Upcoming public card/detail and admin list rows show `오픈예정` instead of stored dates.
- Selling/closing/ended displays keep their real dates.
- Stored/API/form dates remain untouched.
- Admin can choose and save only `오픈예정` or `오픈` from the registration/edit form.

### 2. Block public frontend booking for upcoming performances while preserving admin test flow

Files:
- `apps/web/app/performance/[id]/page.tsx`
- `apps/web/app/booking/[performanceId]/page.tsx`
- `apps/web/components/booking/booking-page.tsx`
- `apps/web/hooks/use-booking.ts`
- `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx`
- `apps/web/hooks/__tests__/use-booking.test.tsx`

Actions:
- Per D-04/D-05, treat `performance.status === 'upcoming' && user.role !== 'admin'` as a booking-disabled state on the client, independent of global `BOOKING_ENABLED`.
- On performance detail, hide both desktop and mobile booking CTA for public upcoming performances and show the existing booking-disabled copy (`예매는 추후 오픈 예정입니다`) or current localized equivalent.
- In direct booking flow, prevent public upcoming performances from rendering selectable date/seat/payment progression. Use `BookingPage` or route-level guard to show the same disabled surface before `DatePicker`, `ShowtimeChips`, `SeatMapViewer`, and proceed buttons are available.
- Keep admin behavior unchanged: admin users see CTA, can enter the booking page, can select seats, and can continue to payment even when performance status is upcoming.
- In `use-booking.ts`, add client-side defense so `useLockSeat`, `usePrepareReservation`, and `useConfirmPayment` refuse public upcoming performance attempts when cached performance detail/store context can identify the performance. Keep backend as the source of truth.

Verify:
- `pnpm --filter @grabit/web exec vitest run hooks/__tests__/booking-disabled-runtime.test.tsx hooks/__tests__/use-booking.test.tsx`
- `pnpm --filter @grabit/web typecheck`

Done:
- Public users cannot reach an interactive booking selection/payment path for upcoming performances.
- Public mutation hooks do not call APIs when the cached performance is upcoming.
- Admin users still pass the same frontend paths for upcoming performances.

### 3. Enforce upcoming booking block in backend APIs

Files:
- `apps/api/src/modules/booking/booking.service.ts`
- `apps/api/src/modules/booking/__tests__/booking.service.spec.ts`
- `apps/api/src/modules/reservation/reservation.service.ts`
- `apps/api/src/modules/reservation/reservation.service.spec.ts`

Actions:
- Per D-01, do not add schema or migration work. Read existing `performances.status` through joins from `showtimes.performanceId`.
- In `BookingService.lockSeat`, fetch the showtime's performance status before Redis mutation. If status is `upcoming` and actor role is not `admin`, throw `ForbiddenException` with the existing booking disabled message before Redis/seat inventory mutation.
- Preserve admin bypass: admin actor proceeds to the current unavailable-seat and Redis lock validations even for upcoming performances.
- In `ReservationService`, extend `getShowtimeBookingContext()` to include `performanceStatus`.
- In `prepareReservation`, reject public upcoming performances before creating or returning a pending reservation; admin actor should continue through existing consent, amount, lock ownership, and transaction validation.
- `confirmAndCreateReservation` remains protected by the earlier lock/prepare gates; do not add a new pre-confirm lookup that can disturb existing payment idempotency and recovery behavior.
- Keep `FeatureFlagsService.assertBookingEnabled(actor)` behavior unchanged; performance status blocking is additive to the global booking flag.

Verify:
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/booking.service.spec.ts src/modules/reservation/reservation.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`

Done:
- `POST /api/v1/booking/seats/lock` rejects public upcoming bookings before Redis writes.
- `POST /api/v1/reservations/prepare` rejects public upcoming bookings before pending reservation creation.
- Public users cannot create the pending reservation needed for `POST /api/v1/payments/confirm` while the performance is upcoming.
- Admin role can still execute lock/prepare/confirm paths for upcoming performances.

## Final Verification

- `pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx components/performance/__tests__/performance-card.test.tsx app/performance/[id]/__tests__/performance-detail-formatting.test.tsx app/admin/performances/__tests__/admin-performances-page.test.tsx hooks/__tests__/booking-disabled-runtime.test.tsx hooks/__tests__/use-booking.test.tsx`
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/booking.service.spec.ts src/modules/reservation/reservation.service.spec.ts`
- `pnpm --filter @grabit/web typecheck`
- `pnpm --filter @grabit/api typecheck`
- `git diff --check`

## Out Of Scope

- DB migration or new performance status field.
- Changing stored `startDate`/`endDate`.
- Changing admin performance edit forms/API payload preservation.
- Broad copy/i18n redesign beyond the necessary Korean status label change and existing disabled booking copy.
