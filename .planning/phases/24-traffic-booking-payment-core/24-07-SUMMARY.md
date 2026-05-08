---
phase: 24-traffic-booking-payment-core
plan: "07"
subsystem: api
tags: [booking, reservation, redis, seatkey, policy]
requires:
  - phase: 24-06
    provides: floor-aware performance seatMaps and bookingPolicy contracts
provides:
  - floor-aware Redis seat lock identity keyed by canonical seatKey
  - event-configured max ticket enforcement in booking lock and reservation prepare flows
  - seatKey-based reservation seat persistence for cross-floor collision safety
affects: [booking-runtime, reservation-confirm, booking-ui-floor-selector]
tech-stack:
  added: []
  patterns:
    - canonical seatKey encoding for Redis lock/set membership
    - showtime-scoped booking policy lookup in backend booking/reservation services
key-files:
  created:
    - .planning/phases/24-traffic-booking-payment-core/24-07-SUMMARY.md
  modified:
    - apps/api/src/modules/booking/booking.service.ts
    - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts
key-decisions:
  - "Redis lock keys and seat status maps use canonical seatKey identity so same seat labels on different floors cannot collide."
  - "Server-side ticket limits come from booking_policies.maxTicketsPerUser, not a hardcoded MAX_SEATS constant."
  - "reservation_seats persists canonical seatKey in seatId to preserve floor identity without widening schema scope in this plan."
patterns-established:
  - "Runtime seat identity: parse floor-aware seatKey -> encode for Redis keys -> decode for read models."
  - "Reservation canonicalization: validate requested seats against floor-specific seatMaps and persist canonical seatKey."
requirements-completed: [BOOK-01, BOOK-03]
duration: 28min
completed: 2026-05-08
---

# Phase 24 Plan 07: Floor-Aware Booking Runtime Summary

**Floor-aware seatKey locking with event-policy ticket limits across booking lock, prepare, and confirm flows**

## Performance

- **Duration:** 28 min
- **Started:** 2026-05-08T07:13:00Z
- **Completed:** 2026-05-08T07:40:48Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- `BookingService` now canonicalizes runtime seat identity to `seatKey`/`floorKey`, encodes Redis lock keys safely, and exposes floor-aware lock/status semantics.
- Server-side ticket-limit enforcement now reads `booking_policies.maxTicketsPerUser` for both seat locking and reservation preparation instead of using `MAX_SEATS=4`.
- `ReservationService` now canonicalizes floor-aware seat selections, persists `seatKey` in reservation seats, and uses that identity through prepare/confirm/cancel sold-seat transitions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce floor-aware seat identity and event ticket policy in booking/reservation services** - `7c93c4c` (`test`)
2. **Task 1: Enforce floor-aware seat identity and event ticket policy in booking/reservation services** - `41f4333` (`feat`)

## Files Created/Modified
- `apps/api/src/modules/booking/booking.service.ts` - Replaced floor-blind Redis/runtime seat identity and hardcoded ticket cap with canonical `seatKey` plus policy lookup.
- `apps/api/src/modules/booking/__tests__/booking.service.spec.ts` - Added TDD coverage for floor-aware Redis keying, seat status identity, and event-configured max ticket enforcement.
- `apps/api/src/modules/reservation/reservation.service.ts` - Canonicalized floor-aware seat validation/persistence and aligned prepare/confirm flows with event-configured booking policy.
- `apps/api/src/modules/reservation/reservation.service.spec.ts` - Added regression coverage for cross-floor collision safety, policy-based ticket limits, and seatKey persistence.

## Decisions Made
- Used encoded canonical `seatKey` values for Redis lock membership so floor-aware identities remain collision-safe without breaking Redis key structure.
- Stored canonical `seatKey` in `reservation_seats.seatId` because this plan’s write scope excluded schema expansion while still requiring floor-aware reservation persistence.
- Kept post-payment self-service seat change unsupported by continuing to return `CANCEL_ONLY` semantics from reservation detail instead of inventing a mutation path.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm --filter @grabit/api test -- ...` runs the full `@grabit/api` Vitest suite in this repo configuration, so verification evidence includes the targeted specs plus the surrounding suite.
- TypeScript nullability in `getShowtimeBookingContext()` required a small follow-up fix after the green test pass; the verification sequence was rerun after the fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Backend booking runtime now exposes canonical floor-aware semantics for the separate floor-selector/state plan.
- Payment confirm and reservation-detail flows can rely on server-derived ticket policy instead of re-inferring limits from client state.

## Self-Check: PASSED

- Summary file exists on disk.
- Task commits `7c93c4c` and `41f4333` are present in git history.
