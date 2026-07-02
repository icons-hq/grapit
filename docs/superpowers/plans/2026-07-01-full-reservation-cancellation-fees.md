# Full Reservation Cancellation Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the per-Ticket Item cancellation-fee policy to buyer and admin Full Reservation Cancellation while keeping buyer-facing partial cancellation disabled.

**Architecture:** `RefundService` becomes the authoritative Full Reservation Cancellation path. It calculates a request-time Cancellation Quote from Ticket Items, stores per-item amounts on `ticket_items`, stores the reservation summary in `refunds.provider_metadata`, sends either full or provider partial cancellation to Toss, and finalizes reservation/ticket/seat state from the stored quote. The buyer UI and admin UI consume the same shared quote contract.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL migrations, Toss Payments SDK wrapper, Next.js 16, React 19, Zod shared schemas, Vitest.

---

## Current Decisions

- Domain terms live in `CONTEXT.md`.
- Policy decision lives in `docs/adr/0002-use-nol-ticket-cancellation-fee-policy.md`.
- Buyer-facing cancellation remains Full Reservation Cancellation only.
- Admin default cancellation uses the same policy, with explicit full-refund and entered-ticket overrides.
- Production read-only aggregate on `grapit-db` found `CONFIRMED` reservations with missing `ticket_items`: `0`.

## File Map

- Modify `apps/api/src/database/migrations/0032_full_reservation_cancellation_fees.sql`: add `PARTIAL_CANCELED`, correct `CONFIRMED.cancel_deadline`.
- Modify `apps/api/src/database/migrations/meta/_journal.json`: register migration `0032_full_reservation_cancellation_fees`.
- Modify `apps/api/src/database/schema/payments.ts`: add local `PARTIAL_CANCELED` enum value.
- Modify `packages/shared/src/schemas/booking.schema.ts`: add `CancellationQuote` response contract, admin override request fields, and `PARTIAL_CANCELED`.
- Modify `packages/shared/src/types/booking.types.ts`: mirror the new schema types.
- Modify `apps/api/src/modules/refund/refund.service.ts`: quote calculation, just-in-time Ticket Item backfill, request-time quote persistence, provider partial cancellation, retry metadata.
- Modify `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts`: finalize full reservation cancellation using stored quote and set payment `PARTIAL_CANCELED` when fees remain.
- Modify `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts`: reuse stored quote for retries.
- Modify `apps/api/src/modules/payment/payment.service.ts` and `apps/api/src/modules/payment/payment-webhook.controller.ts`: accept local `PARTIAL_CANCELED` and route provider partial cancellation for stored full-reservation quotes.
- Modify `apps/api/src/modules/admin/admin-booking.service.ts` and `apps/api/src/modules/admin/admin-booking.controller.ts`: admin default policy plus explicit overrides.
- Modify `apps/web/hooks/use-reservations.ts`: preview and admin override payloads.
- Modify `apps/web/components/reservation/cancel-confirm-modal.tsx`: quote breakdown.
- Modify `apps/web/components/reservation/reservation-detail.tsx`: use quote preview/response values instead of total amount.
- Modify `apps/web/components/admin/admin-booking-detail-modal.tsx`: default policy amount plus override controls.
- Modify `apps/web/messages/ko.json`: cancellation quote and admin override labels.
- Modify tests near touched modules.

## Task 1: Shared Contracts And Migration

**Files:**
- Create: `apps/api/src/database/migrations/0032_full_reservation_cancellation_fees.sql`
- Modify: `apps/api/src/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/database/schema/payments.ts`
- Modify: `packages/shared/src/schemas/booking.schema.ts`
- Modify: `packages/shared/src/types/booking.types.ts`
- Test: `packages/shared/src/schemas/booking.schema.test.ts`

- [ ] **Step 1: Add failing shared schema tests**

Add tests that parse:

```ts
expect(paymentInfoSchema.parse({
  paymentKey: 'pk_live',
  method: 'CARD',
  amount: 100000,
  status: 'PARTIAL_CANCELED',
  paidAt: '2026-07-01T10:00:00.000Z',
})).toMatchObject({ status: 'PARTIAL_CANCELED' });

expect(refundPreviewResponseSchema.parse({
  reservationId: '00000000-0000-4000-8000-000000000001',
  reservationNumber: 'GRP-20260701-ABCDE',
  paymentKey: 'pk_live',
  refundableAmount: 70000,
  canRequestRefund: true,
  cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
  refundTimeline: null,
  cancellationQuote: {
    originalPaymentAmount: 100000,
    ticketSubtotal: 98000,
    ticketServiceFeeTotal: 2000,
    cancellationFeeTotal: 30000,
    serviceFeeRefundTotal: 0,
    refundableAmount: 70000,
    policyCodes: ['SHOW_DAY_2_TO_1'],
    items: [{
      ticketItemId: '00000000-0000-4000-8000-000000000101',
      ticketPrice: 100000,
      serviceFee: 2000,
      cancellationFee: 30000,
      serviceFeeRefund: 0,
      refundableAmount: 70000,
      policyCode: 'SHOW_DAY_2_TO_1',
    }],
  },
})).toMatchObject({ refundableAmount: 70000 });
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @grabit/shared test -- schemas/booking.schema.test.ts
```

Expected: fail because `PARTIAL_CANCELED` and `cancellationQuote` are not in shared schemas.

- [ ] **Step 3: Implement shared contract and migration**

Add `PARTIAL_CANCELED` to the shared payment status schemas/types and Drizzle payment enum. Add cancellation quote schemas using the existing `ticketItemCancellationPolicyCodeSchema` shape. Create migration:

```sql
ALTER TYPE "public"."payment_status" ADD VALUE IF NOT EXISTS 'PARTIAL_CANCELED';--> statement-breakpoint

UPDATE "reservations" r
SET "cancel_deadline" = (
  (
    date_trunc('day', s."date_time" AT TIME ZONE 'Asia/Seoul')
    - interval '1 millisecond'
  ) AT TIME ZONE 'Asia/Seoul'
)
FROM "showtimes" s
WHERE r."showtime_id" = s."id"
  AND r."status" = 'CONFIRMED';
```

Register `0032_full_reservation_cancellation_fees` in `_journal.json` with `idx: 33`.

- [ ] **Step 4: Run shared tests to verify GREEN**

Run:

```bash
pnpm --filter @grabit/shared test -- schemas/booking.schema.test.ts
```

Expected: pass.

## Task 2: API Quote Calculation And Backfill

**Files:**
- Modify: `apps/api/src/modules/refund/refund.service.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Test: `apps/api/src/modules/refund/refund.service.spec.ts`

- [ ] **Step 1: Add failing quote tests**

Add tests in `refund.service.spec.ts` for:

```ts
it('previews full-reservation cancellation with per-ticket D-2 fees', async () => {
  const context = createSeatLevelContext({
    reservationCreatedAt: new Date('2026-07-01T03:00:00.000Z'),
    showtimeAt: new Date('2026-07-18T10:00:00.000Z'),
    now: new Date('2026-07-16T00:10:00.000+09:00'),
    ticketItems: [{ price: 100000, serviceFee: 2000 }],
  });
  vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
  vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null as never);

  const result = await service.getRefundPreview('reservation-1', 'user-1');

  expect(result.refundableAmount).toBe(70000);
  expect(result.cancellationQuote).toMatchObject({
    originalPaymentAmount: 102000,
    cancellationFeeTotal: 30000,
    serviceFeeRefundTotal: 0,
    refundableAmount: 70000,
  });
});
```

Add another test for missing Ticket Items:

```ts
it('backfills missing ticket items before quote calculation for confirmed reservations', async () => {
  await service.getRefundPreview('legacy-reservation', 'user-1');
  expect(backfillSpy).toHaveBeenCalledWith('legacy-reservation');
});
```

- [ ] **Step 2: Run API test to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts
```

Expected: fail because preview still uses `context.payment.amount` and no backfill hook exists.

- [ ] **Step 3: Implement quote builder**

Move the current ticket-item policy logic into a reusable refund quote helper inside `RefundService` or a small local module under `apps/api/src/modules/refund/`. The helper must return:

```ts
type FullReservationCancellationQuote = {
  originalPaymentAmount: number;
  ticketSubtotal: number;
  ticketServiceFeeTotal: number;
  cancellationFeeTotal: number;
  serviceFeeRefundTotal: number;
  refundableAmount: number;
  policyCodes: TicketItemCancellationPolicyCode[];
  items: Array<{
    ticketItemId: string;
    ticketPrice: number;
    serviceFee: number;
    cancellationFee: number;
    serviceFeeRefund: number;
    refundableAmount: number;
    policyCode: TicketItemCancellationPolicyCode;
  }>;
};
```

Use KST day ordinals. Same-day booking returns service fee refund. Show-date D-2/D-1 returns 30%.

- [ ] **Step 4: Implement just-in-time backfill**

If a `CONFIRMED` reservation has `reservation_seats` but zero `ticket_items`, insert missing Ticket Items from `reservation_seats`, `payments`, and `showtimes` using the same seat identity logic as `0024_ticket_items.sql`. This path is idempotent and only runs before quote calculation.

- [ ] **Step 5: Run API quote tests**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts
```

Expected: the new quote/backfill tests pass.

## Task 3: Provider Cancellation And Finalization

**Files:**
- Modify: `apps/api/src/modules/refund/refund.service.ts`
- Modify: `apps/api/src/modules/payment/payment-cancel-policy.ts`
- Modify: `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts`
- Modify: `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts`
- Test: `apps/api/src/modules/refund/refund.service.spec.ts`
- Test: `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts`
- Test: `apps/api/src/modules/jobs/refund-cancel-retry.worker.spec.ts`
- Test: `apps/api/src/modules/payment/payment-cancel-policy.spec.ts`

- [ ] **Step 1: Add failing provider tests**

Add tests that assert:

```ts
expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith('pay-key-1', '일정 변경', {
  cancelAmount: 70000,
  idempotencyKey: 'refund-cancel:refund-1',
  secretKeyScope: 'default',
});
```

For non-KRW provider charge snapshots:

```ts
expect(command.options).toMatchObject({
  cancelAmount: 70,
  currency: 'USD',
});
```

Finalizer tests must assert `payments.status` becomes `PARTIAL_CANCELED` when `cancellationFeeTotal > 0`, and `CANCELED` when `refundableAmount === originalPaymentAmount`.

- [ ] **Step 2: Run provider tests to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/payment/payment-cancel-policy.spec.ts src/modules/refund/refund.service.spec.ts src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts src/modules/jobs/refund-cancel-retry.worker.spec.ts
```

Expected: fail because full refunds omit `cancelAmount` and finalizer always writes `CANCELED`.

- [ ] **Step 3: Implement stored quote provider request**

Store quote summary in `refunds.provider_metadata.cancellationQuote`. Build Toss cancel request with `cancelAmount` when `quote.refundableAmount < payment.amount`; omit `cancelAmount` for full refund. Use the existing provider-currency allocation logic for PayPal/foreign easy pay.

- [ ] **Step 4: Finalize from stored quote**

Update all Ticket Items using stored quote item amounts. Set payment status:

```ts
const paymentStatus = quote.cancellationFeeTotal > 0 ? 'PARTIAL_CANCELED' : 'CANCELED';
```

Set reservation `CANCELLED`, revoke tickets, inactivate benefits, and keep delayed seat reopen behavior.

- [ ] **Step 5: Retry/webhook uses stored quote**

Retry worker loads `refunds.provider_metadata.cancellationQuote` and reuses it. Webhook reconciliation for provider partial cancellation maps to the existing refund request when the stored quote cancel amount matches.

- [ ] **Step 6: Run provider/finalizer tests**

Run the same command from Step 2.

Expected: pass.

## Task 4: Admin Overrides

**Files:**
- Modify: `packages/shared/src/schemas/booking.schema.ts`
- Modify: `apps/api/src/modules/admin/admin-booking.controller.ts`
- Modify: `apps/api/src/modules/admin/admin-booking.service.ts`
- Modify: `apps/web/components/admin/admin-booking-detail-modal.tsx`
- Modify: `apps/web/hooks/use-reservations.ts`
- Test: `apps/api/src/modules/admin/admin-booking.service.spec.ts`
- Test: `apps/web/components/admin/__tests__/admin-booking-dashboard.test.tsx`

- [ ] **Step 1: Add failing admin tests**

Add tests for:

```ts
await service.refundBooking('reservation-1', 'admin-1', '관리자 환불', {
  fullRefundOverride: true,
  enteredTicketOverride: true,
});
expect(mockRefundService.requestAdminRefund).toHaveBeenCalledWith(
  'reservation-1',
  'admin-1',
  '관리자 환불',
  { fullRefundOverride: true, enteredTicketOverride: true },
);
```

Add UI test asserting two unchecked controls are shown:

```ts
expect(screen.getByLabelText('수수료 없이 전액 환불')).not.toBeChecked();
expect(screen.getByLabelText('입장 처리된 티켓도 강제 취소')).not.toBeChecked();
```

- [ ] **Step 2: Run admin tests to verify RED**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts
pnpm --filter @grabit/web test -- components/admin/__tests__/admin-booking-dashboard.test.tsx
```

Expected: fail because override payloads and UI controls do not exist.

- [ ] **Step 3: Implement admin overrides**

Extend admin refund input:

```ts
{
  reason: string;
  fullRefundOverride?: boolean;
  enteredTicketOverride?: boolean;
}
```

Default admin cancellation passes both flags as false. `fullRefundOverride` sets quote item cancellation fees to `0` and refunds service fees. `enteredTicketOverride` bypasses entered-ticket eligibility only.

- [ ] **Step 4: Run admin tests**

Run the commands from Step 2.

Expected: pass.

## Task 5: Buyer UI Cancellation Quote

**Files:**
- Modify: `apps/web/hooks/use-reservations.ts`
- Modify: `apps/web/components/reservation/reservation-detail.tsx`
- Modify: `apps/web/components/reservation/cancel-confirm-modal.tsx`
- Modify: `apps/web/messages/ko.json`
- Test: `apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx`

- [ ] **Step 1: Add failing UI test**

Add a test that renders a cancellation quote:

```ts
expect(screen.getByText('결제 금액')).toBeInTheDocument();
expect(screen.getByText('100,000원')).toBeInTheDocument();
expect(screen.getByText('취소수수료')).toBeInTheDocument();
expect(screen.getByText('30,000원')).toBeInTheDocument();
expect(screen.getByText('최종 환불 예정 금액')).toBeInTheDocument();
expect(screen.getByText('70,000원')).toBeInTheDocument();
```

- [ ] **Step 2: Run UI test to verify RED**

Run:

```bash
pnpm --filter @grabit/web test -- components/reservation/__tests__/reservation-detail-qr.test.tsx
```

Expected: fail because the modal only shows one refund amount.

- [ ] **Step 3: Implement quote preview UI**

Fetch `GET /api/v1/reservations/:id/refund-preview` when opening the modal. Show original amount, cancellation fee total, service fee refund total, and final refundable amount. Continue to show one `예매 취소` action only.

- [ ] **Step 4: Run UI test**

Run the command from Step 2.

Expected: pass.

## Task 6: Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --filter @grabit/shared test -- schemas/booking.schema.test.ts
pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts src/modules/cancellation/payment-cancellation-finalizer.service.spec.ts src/modules/payment/payment-cancel-policy.spec.ts src/modules/jobs/refund-cancel-retry.worker.spec.ts src/modules/admin/admin-booking.service.spec.ts
pnpm --filter @grabit/web test -- components/reservation/__tests__/reservation-detail-qr.test.tsx components/admin/__tests__/admin-booking-dashboard.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run package typechecks**

Run:

```bash
pnpm --filter @grabit/shared typecheck
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
```

Expected: pass.

- [ ] **Step 3: Run diff hygiene checks**

Run:

```bash
git diff --check
rg -n "DATABASE_URL=|TOSS_SECRET|JWT_SECRET|password|authorization" docs/superpowers/plans/2026-07-01-full-reservation-cancellation-fees.md CONTEXT.md docs/adr/0002-use-nol-ticket-cancellation-fee-policy.md
```

Expected: `git diff --check` passes; secret scan has no raw secret values.

## Self-Review

- Spec coverage: covers buyer default, admin default, full refund override, entered-ticket override, same-day exception, D-2/D-1 fees, non-KRW allocation, quote storage, retry/webhook reuse, deadline migration, UI breakdown, and production missing-ticket risk.
- Placeholder scan: no unfinished implementation markers remain.
- Type consistency: `Cancellation Quote`, `Provider Partial Cancellation`, `PARTIAL_CANCELED`, `Administrative Full Refund Override`, and `Administrative Entered Ticket Cancellation Override` match `CONTEXT.md` and ADR 0002.
