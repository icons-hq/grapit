---
phase: 24-traffic-booking-payment-core
plan: "01"
subsystem: shared-contracts
tags: [booking, zod, dto, queue, refund, qr]
requires:
  - phase: 23-launch-foundation
    provides: booking-disabled runtime gate, booking consent contract, shared locale/legal/auth foundations
provides:
  - Phase 24 shared queue admission contract
  - floor-aware booking seat DTO/schema surface
  - payment deadline, refund timeline, cancelled-seat hold, and QR ticket contracts
affects: [24-02, 24-03, 24-04, 24-07, 24-09, 24-10, 24-11, 24-13, 24-14, 24-16, 24-17]
tech-stack:
  added: []
  patterns: [floor-aware-seat-identity, explicit-payment-deadline, nested-refund-qr-contracts]
key-files:
  created: [apps/api/src/database/schema/phase24-booking-core.schema.spec.ts]
  modified:
    [
      packages/shared/src/types/booking.types.ts,
      packages/shared/src/schemas/booking.schema.ts,
      packages/shared/src/index.ts,
      packages/shared/src/schemas/booking.schema.test.ts,
    ]
key-decisions:
  - "Legacy SeatSelection base는 유지하고 canonical booking DTO에는 FloorAwareSeatSelection을 연결해 Phase 24 contract를 선행 고정한다."
  - "Queue admission, booking policy, payment method, refund timeline, cancelled-seat hold, QR ticket을 nested object로 명시해 이후 plan들이 단일 seatId/lock TTL에 의존하지 않게 한다."
patterns-established:
  - "Prepare/Detail contracts require floorKey, floorLabel, seatKey rather than inferring identity from seatId alone."
  - "Payment timing and post-payment state are modeled explicitly with paymentDeadlineAt, refundTimeline, cancelledSeatHold, and qrTicket."
requirements-completed: [TRAF-01, BOOK-01, BOOK-02, BOOK-03, PAY-02, REFUND-01, REFUND-02, QR-01]
duration: 4m 49s
completed: 2026-05-08
---

# Phase 24 Plan 01: Traffic + Booking + Payment Core Summary

**Queue admission, floor-aware seat identity, payment deadline, refund timeline, and QR ticket contracts were locked into shared DTO/zod surfaces before Phase 24 runtime/schema fan-out.**

## Performance

- **Duration:** 4m 49s
- **Started:** 2026-05-08T14:36:23+09:00
- **Completed:** 2026-05-08T05:41:12Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added a RED API-side contract spec that fails without queue admission, floor-aware seat identity, payment deadline, refund timeline, and QR ticket surfaces.
- Expanded `@grabit/shared` booking DTOs and zod schemas with `QueueAdmissionContext`, `FloorAwareSeatSelection`, `BookingPolicy`, `PaymentMethod`, `RefundTimeline`, `CancelledSeatHold`, and `QrTicket`.
- Kept shared barrel exports aligned and updated the shared booking schema test fixture so the new contract verifies cleanly.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the RED contract test for Phase 24 shared booking fields** - `22eccdd` (`test`)
2. **Task 2: Implement shared booking DTOs, zod schemas, and exports** - `af98923` (`feat`)

## Files Created/Modified

- `apps/api/src/database/schema/phase24-booking-core.schema.spec.ts` - Phase 24 RED/GREEN contract gate for shared booking-core surfaces.
- `packages/shared/src/types/booking.types.ts` - Queue/floor/payment/refund/QR DTO definitions for downstream Phase 24 work.
- `packages/shared/src/schemas/booking.schema.ts` - Zod schemas that enforce floor-aware seat identity and explicit payment/refund/QR state.
- `packages/shared/src/index.ts` - Shared barrel export surface for the new booking contracts.
- `packages/shared/src/schemas/booking.schema.test.ts` - Shared fixture/test updates required to verify the new contract.

## Decisions Made

- Legacy `SeatSelection` shape remains as a base display fragment, while request/detail DTOs now require `FloorAwareSeatSelection` so existing repo-wide call sites do not all have to move in the same commit.
- Payment timing and post-payment behavior are expressed as explicit fields instead of being inferred from lock TTL or reservation status alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated shared booking schema test fixtures for the new required contract**
- **Found during:** Task 2 (Implement shared booking DTOs, zod schemas, and exports)
- **Issue:** `packages/shared/src/schemas/booking.schema.test.ts` still built `prepareReservationSchema` inputs with single-floor `seatId`-only fixtures, so the required Phase 24 contract could not verify green.
- **Fix:** Updated the existing shared test fixture to include queue admission, floor-aware seat keys, payment deadline, and response/detail refund/QR assertions.
- **Files modified:** `packages/shared/src/schemas/booking.schema.test.ts`
- **Verification:** `pnpm --filter @grabit/shared test -- booking.schema.test.ts`
- **Committed in:** `af98923`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was required to keep the repo’s existing shared verification target aligned with the new contract. No broader scope creep.

## Issues Encountered

- One API spec fixture used a non-UUID reservation id during the first GREEN run. The fixture was corrected inline before the final verification pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 24 downstream plans now have one canonical shared contract for queue admission, floor-aware booking, payment deadline, refund state, delayed reopen metadata, and QR issuance.
- The current booking runtime is not yet wired to emit or consume these fields; Phase 24 schema/runtime plans must adopt the contract before any booking re-enable work.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-01-SUMMARY.md`
- Verified task commits exist in git history: `22eccdd`, `af98923`
