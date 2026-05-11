---
phase: 24-traffic-booking-payment-core
plan: 09
subsystem: payments
tags: [toss-payments, nestjs, webhook, reservation, booking, payment-deadline]

requires:
  - phase: 24-04
    provides: "queue admission window fields and booking admission contract"
  - phase: 24-07
    provides: "phase 24 booking/payment schema fields for async payment and deadlines"
provides:
  - "Toss payment branch matrix for domestic card, overseas card, and FOREIGN_EASY_PAY"
  - "Replay-safe Toss webhook ledger handling with duplicate/out-of-order guards"
  - "Server-side 7-minute payment deadline persistence plus async recovery completion rules"
affects: [booking, reservation, payment, queue]

tech-stack:
  added: []
  patterns:
    - "Explicit Toss branch endpoint for widget-compatible request payloads"
    - "Webhook ledger first, then async payment-state application"
    - "Server-owned paymentDeadlineAt separate from admission/seat-lock windows"

key-files:
  created:
    - apps/api/src/modules/payment/payment.controller.ts
    - apps/api/src/modules/payment/payment-webhook.controller.ts
    - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
  modified:
    - apps/api/src/modules/payment/payment.module.ts
    - apps/api/src/modules/payment/payment.service.ts
    - apps/api/src/modules/payment/payment.service.spec.ts
    - apps/api/src/modules/reservation/reservation.service.ts
    - apps/api/src/modules/reservation/reservation.service.spec.ts

key-decisions:
  - "Expose Toss branch payload through POST /payments/branch instead of widening the existing reservation prepare contract."
  - "Persist webhook ledger rows before applying async payment state and ignore stale payment events once cancel/failure wins."
  - "Compute paymentDeadlineAt on the server at prepare time and allow async DONE recovery only until the stored admission active window ends."

patterns-established:
  - "Domestic card and overseas card stay on sync confirm; foreign wallets move to pendingUrl plus webhook."
  - "Async DONE payment can finalize reservation later without re-calling Toss confirm."
  - "Expired pending reservations are failed server-side when no handoff progress exists."

requirements-completed: [BOOK-02, PAY-02]

duration: 15min
completed: 2026-05-08
---

# Phase 24 Plan 09: Payment Core Summary

**Toss sync/async branch orchestration with replay-safe webhook ingestion and a server-owned 7-minute payment deadline**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-08T07:54:03Z
- **Completed:** 2026-05-08T08:09:10Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- `PaymentService` now resolves an explicit Toss branch matrix for domestic card, overseas card (`useInternationalCardOnly=true`), and `FOREIGN_EASY_PAY` with `pendingUrl`.
- `PaymentWebhookController` now persists `payment_webhook_events` first, short-circuits duplicate `eventId` replay, and ignores stale `PAYMENT_STATUS_CHANGED` events after cancel/failure terminal states.
- `ReservationService` now computes and stores `paymentDeadlineAt = preparedAt + 7 minutes`, preserves admission recovery timestamps separately, expires stale pending reservations, and finalizes async `DONE` payments during recovery without re-confirming against Toss.

## Task Commits

Each task was committed atomically through TDD RED/GREEN commits:

1. **Task 1: Add provider-specific Toss request branching for sync and async methods**
   - `3d49097` (`test`)
   - `2eadcdc` (`feat`)
2. **Task 2: Implement webhook idempotency for replay and out-of-order async events**
   - `725f1e5` (`test`)
   - `b331d10` (`feat`)
3. **Task 3: Enforce the 7-minute payment deadline, amount integrity, and expiry cascade**
   - `e46a746` (`test`)
   - `5a7d815` (`feat`)

## Files Created/Modified
- `apps/api/src/modules/payment/payment.controller.ts` - Toss widget path가 사용할 branch payload endpoint
- `apps/api/src/modules/payment/payment-webhook.controller.ts` - Toss webhook intake, duplicate replay ack, stale event ignore logic
- `apps/api/src/modules/payment/payment.service.ts` - branch matrix, webhook ledger persistence helper, async payment progress upsert
- `apps/api/src/modules/payment/payment.module.ts` - payment/webhook controllers wiring
- `apps/api/src/modules/payment/payment.service.spec.ts` - domestic/overseas/foreign easy-pay branch RED/GREEN coverage
- `apps/api/src/modules/payment/toss-webhook.controller.spec.ts` - duplicate replay, stale payment event, cancel apply coverage
- `apps/api/src/modules/reservation/reservation.service.ts` - server-side payment deadline persistence, expired pending fail-fast, async DONE recovery finalize
- `apps/api/src/modules/reservation/reservation.service.spec.ts` - deadline/tampering/recovery regression coverage

## Decisions Made

- `paymentDeadlineAt` is no longer trusted from the client; the server calculates it with `PAYMENT_DEADLINE_MINUTES = 7`.
- Async foreign-wallet success does not immediately reuse the sync confirm flow. Webhooks record payment progress first, and reservation finalization can later consume a stored `DONE` payment during recovery.
- The 10-minute recovery boundary is enforced from persisted admission timestamps, not from the 7-minute payment deadline alone.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Concurrent Wave 6 web-booking edits were present in `apps/web/components/booking/*`. They were left untouched and excluded from staging.
- Final plan verification found two reservation-service TypeScript issues after behavior landed (`PaymentStatus` import and a legacy mock narrowing path). They were corrected before the final verification rerun.

## User Setup Required

None - no external service or dashboard setup changed in this plan.

## Next Phase Readiness

- Web booking UI can consume `POST /payments/branch` to request Toss widget branch parameters without inventing a custom payment UI.
- Reservation recovery/UI work can now rely on persisted `paymentDeadlineAt`, admission recovery timestamps, and async webhook payment progress.
- ROADMAP/STATE updates were intentionally skipped per wave orchestration instructions.

## Self-Check: PASSED

- `24-09-SUMMARY.md` exists on disk.
- Task commits `3d49097`, `2eadcdc`, `725f1e5`, `b331d10`, `e46a746`, `5a7d815` are present in git history.
