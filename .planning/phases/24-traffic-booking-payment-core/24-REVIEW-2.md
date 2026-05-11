---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-08T10:08:59Z
depth: standard
mode: focused-re-review
context_files:
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW.md
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-FIX.md
files_reviewed: 26
files_reviewed_list:
  - .env.example
  - apps/api/src/database/migrations/0012_phase24_booking_core.sql
  - apps/api/src/database/migrations/meta/0012_snapshot.json
  - apps/api/src/database/schema/booking-operation-audit-logs.ts
  - apps/api/src/database/schema/phase24-booking-core.schema.spec.ts
  - apps/api/src/database/schema/seat-inventories.ts
  - apps/api/src/modules/admin/admin-booking.controller.ts
  - apps/api/src/modules/admin/admin-booking.service.ts
  - apps/api/src/modules/admin/admin-booking.service.spec.ts
  - apps/api/src/modules/admin/admin.module.ts
  - apps/api/src/modules/booking/booking.service.ts
  - apps/api/src/modules/booking/__tests__/booking.service.spec.ts
  - apps/api/src/modules/booking/__tests__/dto.spec.ts
  - apps/api/src/modules/payment/payment-webhook.controller.ts
  - apps/api/src/modules/payment/payment.module.ts
  - apps/api/src/modules/payment/payment.service.ts
  - apps/api/src/modules/payment/payment.service.spec.ts
  - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
  - apps/api/src/modules/payment/toss-webhook.guard.ts
  - apps/api/src/modules/payment/toss-webhook.guard.spec.ts
  - apps/api/src/modules/refund/refund.service.ts
  - apps/api/src/modules/refund/refund.service.spec.ts
  - apps/api/src/modules/reservation/reservation.service.ts
  - apps/api/src/modules/reservation/reservation.service.spec.ts
  - apps/api/src/modules/ticket/qr-ticket.service.ts
  - apps/api/src/modules/ticket/qr-ticket.service.spec.ts
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 24: Code Review Re-Review Report

**Reviewed:** 2026-05-08T10:08:59Z
**Depth:** standard, focused re-review
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Re-reviewed the Phase 24 fixes for CR-01..CR-05 and WR-01..WR-02 against the prior review and fix report. The original findings are materially addressed in the primary success paths, and the focused test suite passes. One serious robustness regression remains in the CR-02 async DONE webhook fix: a post-commit QR ticket issuance failure is not recoverable by webhook retry.

Verification run:

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.guard.spec.ts modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts modules/reservation/reservation.service.spec.ts modules/booking/__tests__/booking.service.spec.ts modules/booking/__tests__/dto.spec.ts modules/admin/admin-booking.service.spec.ts modules/refund/refund.service.spec.ts modules/ticket/qr-ticket.service.spec.ts database/schema/phase24-booking-core.schema.spec.ts
```

Result: 53 files / 578 tests passed.

## Fixed Items Verification

- CR-01: Fixed. `POST /payments/toss/webhook` is `@Public()` and guarded by `TossWebhookGuard`; missing/invalid shared secret fails closed.
- CR-02: Partially fixed. Async DONE now confirms reservations, marks seats sold, broadcasts, and calls QR issuance in the normal path. See WR-01 for the remaining retry regression.
- CR-03: Fixed. Existing DONE payments are revalidated for reservation id, payment key, order id, and amount before redirect confirmation reuses them; mismatched DONE webhooks are rejected before finalization.
- CR-04: Fixed. `held_cancelled` seats are blocked in `lockSeat()` and surfaced as `held` in seat status.
- CR-05: Fixed. Admin refunds delegate to `RefundService.requestAdminRefund()`, write refund ledger/audit rows, and use delayed `held_cancelled` seat release.
- WR-01: Fixed. QR token verification now checks persisted ticket state, including status, expiry, `usedAt`, and `revokedAt`.
- WR-02: Fixed. `seat_key` is backfilled, set `NOT NULL`, reflected in Drizzle schema and snapshot, and covered by schema tests.

## Warnings

### WR-01: Async DONE webhook retry cannot recover failed QR ticket issuance

**Classification:** WARNING
**File:** `apps/api/src/modules/payment/payment.service.ts:491`
**Also affects:** `apps/api/src/modules/payment/payment-webhook.controller.ts:179`

**Issue:** `finalizeAsyncDonePayment()` commits the reservation/payment/seat transaction first, then issues the QR ticket afterward. If `qrTicketService.ensureIssuedTicketForReservation()` throws after the transaction commits, the controller marks the webhook event failed and rethrows. On Toss retry, the payment is already `DONE` and the reservation is already `CONFIRMED`; `shouldIgnorePaymentEvent()` treats that incoming DONE event as stale unless the reservation is still `PENDING_PAYMENT`, so the retry can mark the event processed without retrying QR issuance. If the ignore branch were bypassed, the current seat finalization is also not idempotent for already-sold rows, so it can throw before reaching QR issuance. Result: an async paid booking can remain confirmed/sold without the intended automatic QR ticket issuance/email side effect.

**Fix:** Make DONE webhook finalization idempotent across post-commit effects. For a duplicate-pending or previously failed DONE event where payment is `DONE` and reservation is `CONFIRMED`, re-read the payment and call `ensureIssuedTicketForReservation()` before marking the webhook processed. Alternatively, move QR issuance into a durable outbox/job created in the same transaction, and only mark the webhook processed after the ticket row or ticket job is guaranteed. Treat already-sold seats for the same reservation as idempotent success in the retry path.

---

_Reviewed: 2026-05-08T10:08:59Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
