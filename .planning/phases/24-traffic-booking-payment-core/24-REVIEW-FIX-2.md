---
phase: 24-traffic-booking-payment-core
fixed_at: 2026-05-08T10:13:19Z
review_path: .planning/phases/24-traffic-booking-payment-core/24-REVIEW-2.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Re-Review Fix Report

## Fixed Findings

### WR-01: Async DONE webhook retry cannot recover failed QR ticket issuance

**Status:** Fixed

The payment webhook controller now treats `DONE` replays as processable when the payment is already `DONE` and the reservation is already `CONFIRMED`, so retries after a post-commit QR issuance failure are no longer dropped as stale.

`PaymentService.finalizeAsyncDonePayment()` now treats already-sold seat inventory conflicts as idempotent only for confirmed reservations with an existing payment. This lets the replay reach `qrTicketService.ensureIssuedTicketForReservation()` while preserving the conflict behavior for first-time finalization.

## Verification

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts
```

Result: passed. The command exercised the API test project and completed with 53 files / 580 tests passing, including new regression coverage for:

- duplicate-pending `DONE` webhook replay after post-commit side-effect failure
- already-confirmed async `DONE` replay with already-sold seat inventory still issuing the QR ticket
