---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-08T10:16:56Z
depth: standard
mode: focused-re-review
context_files:
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-2.md
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-FIX-2.md
files_reviewed: 11
files_reviewed_list:
  - apps/api/src/modules/payment/payment-webhook.controller.ts
  - apps/api/src/modules/payment/payment.service.ts
  - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
  - apps/api/src/modules/payment/payment.service.spec.ts
  - apps/api/src/modules/ticket/qr-ticket.service.ts
  - apps/api/src/database/schema/payment-webhook-events.ts
  - apps/api/src/database/schema/payments.ts
  - apps/api/src/database/schema/reservations.ts
  - apps/api/src/database/schema/reservation-seats.ts
  - apps/api/src/database/schema/seat-inventories.ts
  - apps/api/src/database/schema/tickets.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 24: Code Review Re-Review Report

**Reviewed:** 2026-05-08T10:16:56Z
**Depth:** standard, focused re-review
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Re-reviewed the final fix for `24-REVIEW-2.md` WR-01. The original retry gap is fixed for the intended same-event retry path: a failed async `DONE` webhook whose reservation/payment were already committed as `CONFIRMED`/`DONE` is no longer dropped as stale, and `finalizeAsyncDonePayment()` can reach `qrTicketService.ensureIssuedTicketForReservation()` even when the seat inventory is already `sold`.

However, the fix widened the confirmed `DONE` replay path without revalidating the existing payment identity. That introduces a payment data integrity regression before this should ship.

Verification run:

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts
```

Result: passed. Vitest executed the API test project, 53 files / 580 tests passed.

## Fixed Items Verification

- REVIEW-2 WR-01 retry path: Partially fixed. Duplicate-pending `DONE` webhook retries after a post-commit QR issuance failure now reach QR issuance.
- New regression: A confirmed `DONE` replay can now mutate the existing payment record with mismatched provider identifiers. See CR-01.

## Critical Issues

### CR-01: Confirmed DONE replay can overwrite an existing payment identity

**Classification:** BLOCKER
**File:** `apps/api/src/modules/payment/payment-webhook.controller.ts:179`
**Also affects:** `apps/api/src/modules/payment/payment.service.ts:280`, `apps/api/src/modules/payment/payment.service.ts:388`, `apps/api/src/modules/payment/payment.service.ts:408`

**Issue:** The final fix makes `shouldIgnorePaymentEvent()` return `false` for every incoming `DONE` event when current progress is already `paymentStatus === 'DONE'` and `reservationStatus === 'CONFIRMED'`. That is broader than the failed duplicate-pending retry case. Once the event reaches `PaymentService`, the existing payment lookup matches by `tossOrderId OR paymentKey`, but `WebhookPaymentSnapshot` only keeps `id` and `reservationId`. `finalizeAsyncDonePayment()` then validates only the reservation id before updating the existing payment row with `payload.data.paymentKey` and `payload.data.orderId`.

A later provider-authenticated `DONE` event with the same `orderId` but a different `paymentKey` therefore passes the replay path and rewrites `payments.payment_key`. That key is the provider identifier used by cancellation/refund flows, so corrupting it can make future refunds fail or target the wrong provider payment. Before commit `e2e4940`, this confirmed `DONE` path was ignored as stale and did not perform the destructive update.

**Fix:** Preserve the retry behavior, but revalidate immutable payment identity before updating an existing payment. Include `paymentKey`, `tossOrderId`, `amount`, and `status` in `WebhookPaymentSnapshot`, then reject mismatches:

```ts
if (
  existingPayment
  && (
    existingPayment.reservationId !== reservation.id
    || existingPayment.paymentKey !== payload.data.paymentKey
    || existingPayment.tossOrderId !== payload.data.orderId
    || existingPayment.amount !== reservation.totalAmount
  )
) {
  throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
}
```

For the already-confirmed retry case, prefer a narrower idempotent branch that verifies the existing payment and calls `ensureIssuedTicketForReservation()` without rewriting immutable payment identifiers. Add regression coverage for a `CONFIRMED`/`DONE` replay where `existingPayment.paymentKey !== payload.data.paymentKey`; it should reject and must not call payment update or QR issuance.

---

_Reviewed: 2026-05-08T10:16:56Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
