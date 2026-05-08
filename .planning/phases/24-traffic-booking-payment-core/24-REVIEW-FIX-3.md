---
phase: 24-traffic-booking-payment-core
fixed_at: 2026-05-08T10:19:53Z
review_path: .planning/phases/24-traffic-booking-payment-core/24-REVIEW-3.md
iteration: 3
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Re-Review Fix Report

## Fixed Findings

### CR-01: Confirmed DONE replay can overwrite an existing payment identity

**Status:** Fixed

`WebhookPaymentSnapshot` now includes immutable provider identity fields: `paymentKey`, `tossOrderId`, `amount`, and `status`.

`PaymentService.finalizeAsyncDonePayment()` now validates existing payment identity before any update. A webhook with a mismatched payment key, order id, or amount is rejected before transaction work or QR issuance.

Already-confirmed `DONE` retries are now handled as a narrow idempotent branch: when the reservation is `CONFIRMED` and the existing payment is already `DONE`, the service validates identity and retries only `qrTicketService.ensureIssuedTicketForReservation()`. It no longer rewrites the payment row or reruns seat finalization.

## Verification

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts
```

Result: passed. Vitest executed the API test project and completed with 53 files / 581 tests passing.
