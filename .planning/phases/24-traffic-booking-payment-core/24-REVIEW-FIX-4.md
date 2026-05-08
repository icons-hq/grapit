---
phase: 24-traffic-booking-payment-core
fixed_at: 2026-05-08T10:24:30Z
review_path: .planning/phases/24-traffic-booking-payment-core/24-REVIEW-4.md
iteration: 4
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 24: Code Review Re-Review Fix Report

## Fixed Findings

### CR-01: Amount-mismatched DONE replay can still overwrite an existing payment identity

**Status:** Fixed

`PaymentService.upsertAsyncPaymentProgress()` now validates an existing payment's immutable provider identity before entering the `DONE` amount-mismatch storage path. A replay with the same Toss order id but a different payment key is rejected before `storeRejectedWebhookPayment()` can update the existing payment row.

The existing full identity validation still runs before normal `DONE` finalization and QR retry, including the amount check for already stored payments.

## Verification

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts
```

Result: passed. Vitest executed the API test project and completed with 53 files / 582 tests passing.
