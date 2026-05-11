---
phase: 24-traffic-booking-payment-core
reviewed: 2026-05-08T10:22:38Z
depth: standard
mode: focused-re-review
commit_reviewed: 17eb87a
context_files:
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-3.md
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-FIX-3.md
files_reviewed: 6
files_reviewed_list:
  - apps/api/src/modules/payment/payment.service.ts
  - apps/api/src/modules/payment/payment.service.spec.ts
  - apps/api/src/modules/payment/payment-webhook.controller.ts
  - apps/api/src/modules/payment/toss-webhook.controller.spec.ts
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-3.md
  - .planning/phases/24-traffic-booking-payment-core/24-REVIEW-FIX-3.md
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 24: Focused Code Review Report

**Reviewed:** 2026-05-08T10:22:38Z
**Depth:** standard, focused re-review
**Commit Reviewed:** `17eb87a fix(24): validate async DONE replay identity`
**Files Reviewed:** 6
**Status:** issues_found

## Summary

CR-01 is only partially fixed. The same-amount `CONFIRMED`/`DONE` replay path now validates existing payment identity before QR retry, and the valid replay no longer rewrites payment rows or re-sells seats.

However, the amount-mismatch branch still runs before the new identity validation. A provider-authenticated `DONE` replay with the same `orderId`, different `paymentKey`, and mismatched `totalAmount` can still overwrite the existing successful payment row as `ABORTED`. This is the same payment identity/data integrity class as CR-01, so CR-01 remains open.

Verification context supplied by the caller:

```bash
pnpm --filter @grabit/api test -- modules/payment/toss-webhook.controller.spec.ts modules/payment/payment.service.spec.ts
pnpm test
pnpm build
```

Result supplied by the caller: passed.

## Critical Issues

### CR-01: Amount-mismatched DONE replay can still overwrite an existing payment identity

**Classification:** BLOCKER
**File:** `apps/api/src/modules/payment/payment.service.ts:305`
**Also affects:** `apps/api/src/modules/payment/payment-webhook.controller.ts:179`, `apps/api/src/modules/payment/payment.service.ts:284`, `apps/api/src/modules/payment/payment.service.ts:614`

**Issue:** `PaymentWebhookController.shouldIgnorePaymentEvent()` intentionally lets `DONE` replay events through when progress is already `paymentStatus === 'DONE'` and reservation is `CONFIRMED` or `PENDING_PAYMENT`. `PaymentService.upsertAsyncPaymentProgress()` then looks up an existing payment by `tossOrderId OR paymentKey`, but the `DONE` amount-mismatch branch executes before `assertExistingPaymentMatchesWebhook()`.

That means this replay still corrupts the original payment row:

1. Existing row: `tossOrderId = GRP-ASYNC-DONE`, `paymentKey = pay_original_done`, `amount = 150000`, `status = DONE`.
2. Incoming replay: `orderId = GRP-ASYNC-DONE`, `paymentKey = pay_different_done`, `totalAmount = 149000`, `status = DONE`.
3. The OR lookup finds the original payment by order id.
4. The amount mismatch path calls `storeRejectedWebhookPayment()` before identity validation.
5. `storeRejectedWebhookPayment()` updates `payments.id = existingPayment.id` with the replay's `paymentKey`, amount, and `ABORTED` status.

The new regression test covers mismatched payment identity only when the amount matches, and the amount-mismatch test covers only the no-existing-payment path. It does not cover this confirmed replay corruption path.

**Fix:** Validate existing payment ownership and immutable provider identity before any amount-mismatch storage that updates an existing row. If the incoming webhook does not exactly match the existing payment identity, reject it without calling `storeRejectedWebhookPayment()`:

```ts
const identityMismatch =
  existingPayment
  && (
    existingPayment.reservationId !== reservation.id
    || existingPayment.paymentKey !== payload.data.paymentKey
    || existingPayment.tossOrderId !== payload.data.orderId
  );

if (identityMismatch) {
  throw new BadRequestException('결제 정보가 예매와 일치하지 않습니다');
}

if (paymentStatus === 'DONE' && payload.data.totalAmount !== reservation.totalAmount) {
  await this.storeRejectedWebhookPayment({
    payload,
    reservation,
    existingPayment,
    provider,
    method,
    amount: payload.data.totalAmount ?? 0,
    asyncStatus: 'payment_amount_mismatch',
  });
  throw new BadRequestException('결제 금액이 일치하지 않습니다');
}
```

Add coverage for a `CONFIRMED`/`DONE` replay with same `orderId`, different `paymentKey`, and mismatched `totalAmount`; it should reject and must not call payment update, QR issuance, or seat broadcast.

---

_Reviewed: 2026-05-08T10:22:38Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard, focused re-review_
