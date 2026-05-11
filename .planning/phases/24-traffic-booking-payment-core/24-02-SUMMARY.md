---
phase: 24-traffic-booking-payment-core
plan: "02"
subsystem: database
tags: [drizzle, postgres, booking, payments, refunds, qr, webhook]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Phase 24 shared booking-core queue/floor/payment/refund/QR contracts from 24-01
provides:
  - floor-aware seat map and seat inventory schema contracts
  - reservation admission trace and payment deadline persistence
  - booking policy, refund, QR ticket, webhook ledger, and manual-open audit tables
affects: [24-03, 24-06, 24-07, 24-09, 24-11, 24-12, 24-13, 24-15]
tech-stack:
  added: []
  patterns:
    - additive floor-aware seat identity storage with legacy-safe defaults
    - separate durable ledgers for payment branch state, refund progression, webhook replay, and manual exceptions
key-files:
  created:
    - apps/api/src/database/schema/booking-policies.ts
    - apps/api/src/database/schema/refunds.ts
    - apps/api/src/database/schema/tickets.ts
    - apps/api/src/database/schema/payment-webhook-events.ts
    - apps/api/src/database/schema/booking-operation-audit-logs.ts
  modified:
    - apps/api/src/database/schema/seat-maps.ts
    - apps/api/src/database/schema/seat-inventories.ts
    - apps/api/src/database/schema/reservations.ts
    - apps/api/src/database/schema/payments.ts
    - apps/api/src/database/schema/index.ts
    - apps/api/src/database/schema/phase24-booking-core.schema.spec.ts
key-decisions:
  - "New floor/payment/admission fields use defaults or nullable trace columns so legacy rows can be backfilled in 24-03 without destructive row rewrites."
  - "Webhook ledger rows persist raw payload plus optional payment/reservation linkage, allowing out-of-order or pre-link events to be stored before reconciliation."
  - "Booking policy allowed payment methods are stored as a JSONB array to keep Phase 24 payment-method rollout flexible without freezing an enum too early."
patterns-established:
  - "Seat persistence now separates display seatId from canonical floorKey plus seatKey."
  - "Async financial state is split across payments, refunds, payment_webhook_events, and booking_operation_audit_logs instead of being inferred from a single status field."
requirements-completed: [TRAF-01, BOOK-01, BOOK-02, BOOK-03, PAY-02, REFUND-01, REFUND-02, QR-01]
duration: 7m 27s
completed: 2026-05-08
---

# Phase 24 Plan 02: Traffic + Booking + Payment Core Summary

**Floor-aware seat maps, reservation admission/payment timing, refund state, QR ticket rows, and replay-safe payment webhook/audit ledgers were added to the Phase 24 Drizzle schema.**

## Performance

- **Duration:** 7m 27s
- **Started:** 2026-05-08T14:54:07+09:00
- **Completed:** 2026-05-08T15:01:34+09:00
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Expanded `seat_maps`, `seat_inventories`, `reservations`, and `payments` for floor-aware identity, held-cancelled seat metadata, reservation admission traces, separate payment deadlines, and overseas-payment evidence.
- Added `booking_policies`, `refunds`, and `tickets` so event policy, visible refund progression, QR issuance, and D-1 email scheduling all have durable storage.
- Added `payment_webhook_events` and `booking_operation_audit_logs`, then exported all Phase 24 schema tables through `schema/index.ts` for Drizzle migration generation and downstream runtime work.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing schema contract for floor-aware booking core storage** - `dc89704` (`test`)
2. **Task 1 GREEN: Add core booking storage schema fields and booking policy table** - `8a2faf3` (`feat`)
3. **Task 2 RED: Add failing schema contract for refund and QR persistence** - `8eed515` (`test`)
4. **Task 2 GREEN: Add refund and QR ticket tables** - `2096158` (`feat`)
5. **Task 3 RED: Add failing schema contract for webhook and manual-open audit durability** - `b66f394` (`test`)
6. **Task 3 GREEN: Add webhook ledger, manual-open audit table, and schema exports** - `f8e644a` (`feat`)

## Files Created/Modified

- `apps/api/src/database/schema/seat-maps.ts` - Adds `floorKey`, `floorLabel`, and `sortOrder` with per-performance floor uniqueness.
- `apps/api/src/database/schema/seat-inventories.ts` - Adds floor-aware seat identity plus held-cancelled delayed-reopen metadata.
- `apps/api/src/database/schema/reservations.ts` - Persists queue admission binding and separate `paymentDeadlineAt`.
- `apps/api/src/database/schema/payments.ts` - Persists payment provider, currency, async branch state, pending URL, and disclaimer evidence.
- `apps/api/src/database/schema/booking-policies.ts` - Stores per-performance max ticket, payment-method, hold-window, and manual-open policy.
- `apps/api/src/database/schema/refunds.ts` - Stores user-visible refund state transitions and provider/result metadata.
- `apps/api/src/database/schema/tickets.ts` - Stores QR issuance, `secretVersion`, and D-1 email scheduling timestamps.
- `apps/api/src/database/schema/payment-webhook-events.ts` - Stores durable webhook replay/idempotency ledger rows.
- `apps/api/src/database/schema/booking-operation-audit-logs.ts` - Stores immutable manual-open exception audit rows.
- `apps/api/src/database/schema/index.ts` - Exports new Phase 24 schema tables for Drizzle and runtime consumers.
- `apps/api/src/database/schema/phase24-booking-core.schema.spec.ts` - Extends the schema contract gate with RED/GREEN assertions for all new storage surfaces.

## Decisions Made

- Used legacy-safe defaults for `seat_maps.floorKey/floorLabel/sortOrder` and nullable trace columns for new reservation admission fields so existing data can be migrated in Phase 24-03 without destructive row edits.
- Kept `seatId` for display compatibility while adding canonical `seatKey` and `floorKey` storage, so later runtime plans can move to floor-aware locking without losing existing labels.
- Stored webhook raw payloads and optional linkage fields in `payment_webhook_events` so async provider events can be written before full reconciliation succeeds.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed
**Impact on plan:** None.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None - new security-relevant storage surfaces were already covered by the plan threat model.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/database/schema/phase24-booking-core.schema.spec.ts` - PASS, 6 tests
- `rg -n "floorKey|floorLabel|sortOrder|seatKey|reopenHoldUntil|held_cancelled|paymentDeadlineAt|provider|currency|asyncStatus|disclaimerAcceptedAt|maxTicketsPerUser|allowedPaymentMethods" apps/api/src/database/schema/seat-maps.ts apps/api/src/database/schema/seat-inventories.ts apps/api/src/database/schema/reservations.ts apps/api/src/database/schema/payments.ts apps/api/src/database/schema/booking-policies.ts` - PASS
- `rg -n "requested|sent_to_pg|processing_at_pg|completed|failed|provider|resultCode|failureReason" apps/api/src/database/schema/refunds.ts` - PASS
- `rg -n "qrTokenJti|secretVersion|issuedAt|emailScheduledAt|emailSentAt" apps/api/src/database/schema/tickets.ts` - PASS
- `rg -n "eventId|eventType|payload|receivedAt|processedAt|processingResultCode" apps/api/src/database/schema/payment-webhook-events.ts` - PASS
- `rg -n "operatorUserId|action|seatKey|reservationId|createdAt" apps/api/src/database/schema/booking-operation-audit-logs.ts` - PASS
- `rg -n "paymentWebhookEvents|bookingOperationAuditLogs|refunds|tickets" apps/api/src/database/schema/index.ts` - PASS
- `pnpm --filter @grabit/api typecheck` - PASS

## Next Phase Readiness

- Ready for `24-03` migration generation/apply review with one schema index entrypoint that includes floors, policies, refunds, QR tickets, webhook ledgers, and manual-open audit storage.
- Downstream runtime plans can now rely on durable columns/tables instead of inferring payment deadline, refund progress, or QR scheduling from transient lock state.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-02-SUMMARY.md`.
- Verified task commits exist in git history: `dc89704`, `8a2faf3`, `8eed515`, `2096158`, `b66f394`, `f8e644a`.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
