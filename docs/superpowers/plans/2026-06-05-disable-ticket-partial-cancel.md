# Disable Ticket Partial Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable customer-facing ticket-item partial cancellation and route all customer cancellations through full-reservation refund cancellation.

**Architecture:** Customer UI exposes one cancellation path: cancel the whole reservation. The frontend calls the refund full-cancel endpoint, while the ticket-item cancel endpoint remains present but returns a clear rejection for stale clients. Existing partial or pending cancellation rows are handled through a separate read-only operations reconciliation flow, not by automatic migration in this change.

**Tech Stack:** Next.js App Router, React 19, TanStack Query, NestJS 11, Drizzle ORM, Vitest, Toss Payments cancellation client.

---

## Confirmed Product Decisions

- Customer ticket-item partial cancellation is no longer supported.
- Customer cancellation means full reservation cancellation only.
- Frontend should call `POST /api/v1/reservations/:id/refund` for customer full cancellation.
- `PUT /api/v1/reservations/:id/ticket-items/:ticketItemId/cancel` should remain available but return a clear 400 rejection.
- Existing partially cancelled or `cancellation_pending` reservations are out of scope for automatic migration and must be reconciled operationally.

## Current Code Facts

- `apps/web/hooks/use-reservations.ts` currently sends full cancellation to `PUT /api/v1/reservations/:id/cancel`.
- `apps/web/hooks/use-reservations.ts` currently sends ticket-item cancellation to `PUT /api/v1/reservations/:id/ticket-items/:ticketItemId/cancel`.
- `apps/web/components/reservation/reservation-detail.tsx` hides the full cancellation button when persisted ticket items exist.
- `apps/web/components/reservation/reservation-detail.tsx` renders a ticket-item cancellation dialog and button path.
- `apps/api/src/modules/reservation/reservation.service.ts` currently rejects legacy full cancellation for reservations with ticket items.
- `apps/api/src/modules/refund/refund.service.ts` already builds a full payment cancel request with idempotency and retry behavior.
- `apps/api/src/modules/cancellation/payment-cancellation-finalizer.service.ts` already finalizes full cancellation across reservation, payment, ticket items, tickets, and seats.

## Files

- Modify: `apps/web/hooks/use-reservations.ts`
  - Switch customer full cancellation hook to `POST /api/v1/reservations/:id/refund`.
  - Remove or stop exporting the customer ticket-item cancellation hook if no other current caller remains.
- Modify: `apps/web/app/mypage/reservations/[id]/page.tsx`
  - Remove `useCancelTicketItem` usage.
  - Pass only full-cancel handlers into `ReservationDetailView`.
- Modify: `apps/web/components/reservation/reservation-detail.tsx`
  - Show full cancellation for seat-level reservations.
  - Remove customer ticket-item cancellation dialog state, copy, and handlers.
  - Keep QR ticket status display for active/cancelled ticket state visibility.
- Modify: `apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx`
  - Add coverage that seat-level reservations show the full reservation cancel button.
  - Add coverage that per-ticket cancellation controls are not rendered.
- Modify: `apps/api/src/modules/reservation/reservation.controller.ts`
  - Keep the ticket-item cancellation route but return a clear unsupported operation response.
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
  - Remove customer ticket-item cancellation execution from the public route path, or leave the method unused for admin/internal follow-up only after checking imports.
- Modify: `apps/api/src/modules/reservation/reservation.service.spec.ts`
  - Replace customer ticket-item cancellation behavior tests with an unsupported operation test at the controller/service boundary.
  - Keep lower-level partial cancellation tests only if the method remains intentionally internal.
- Modify: `apps/api/src/modules/refund/refund.service.spec.ts`
  - Add a seat-level reservation context test for full cancellation finalizer invocation.
- Optional create: `docs/runbooks/ticket-cancellation-reconciliation.md`
  - Add a read-only operator checklist for existing partial or pending ticket-item cancellations.

---

### Task 1: Backend Guard For Ticket-Item Cancellation

**Files:**
- Modify: `apps/api/src/modules/reservation/reservation.controller.ts`
- Test: `apps/api/src/modules/reservation/reservation.service.spec.ts` or a controller spec if one exists in the branch

- [ ] **Step 1: Write the failing backend test**

Add a test that verifies the customer ticket-item cancel path returns the agreed message without calling Toss.

Expected behavior:

```ts
await expect(
  service.cancelTicketItem(reservationId, ticketItemId, userId, '일정 변경'),
).rejects.toThrow('티켓 단위 취소는 지원하지 않습니다. 예매 전체를 취소해주세요.');

expect(mockTossClient.cancelPayment).not.toHaveBeenCalled();
```

If using a controller-level test, assert:

```ts
await expect(
  controller.cancelTicketItem(reservationId, ticketItemId, { reason: '일정 변경' }, { user: { id: userId } }),
).rejects.toThrow('티켓 단위 취소는 지원하지 않습니다. 예매 전체를 취소해주세요.');
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/reservation/reservation.service.spec.ts
```

Expected: FAIL because `cancelTicketItem` still executes the old partial cancellation flow.

- [ ] **Step 3: Implement the minimal guard**

Change the public ticket-item cancellation path to throw:

```ts
throw new BadRequestException(
  '티켓 단위 취소는 지원하지 않습니다. 예매 전체를 취소해주세요.',
);
```

Preferred location:

- If no admin/internal caller needs `ReservationService.cancelTicketItem`, put the guard at the start of `ReservationService.cancelTicketItem`.
- If an internal/admin caller must retain partial cancellation later, put the guard in `ReservationController.cancelTicketItem` and do not expose the service method through customer routes.

- [ ] **Step 4: Run the backend focused test**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/reservation/reservation.service.spec.ts
```

Expected: PASS for the new unsupported-operation test. Existing old partial-cancel tests will need deletion or relocation if the service method is now publicly disabled.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reservation/reservation.controller.ts apps/api/src/modules/reservation/reservation.service.ts apps/api/src/modules/reservation/reservation.service.spec.ts
git commit -m "fix(reservation): disable customer ticket partial cancellation"
```

---

### Task 2: Route Customer Full Cancellation To Refund Endpoint

**Files:**
- Modify: `apps/web/hooks/use-reservations.ts`
- Modify: `apps/web/app/mypage/reservations/[id]/page.tsx`
- Test: existing web hook/page tests if present; otherwise cover through component tests in Task 3

- [ ] **Step 1: Change the full cancellation hook endpoint**

Change `useCancelReservation` from:

```ts
apiClient.put(`/api/v1/reservations/${id}/cancel`, { reason })
```

to:

```ts
apiClient.post(`/api/v1/reservations/${id}/refund`, { reason })
```

Keep the mutation name as `useCancelReservation` unless the implementation branch also updates all call sites to a clearer name. The UI concept is still "예매 취소"; the API concept is refund request.

- [ ] **Step 2: Remove ticket-item cancellation usage from the reservation detail page**

In `apps/web/app/mypage/reservations/[id]/page.tsx`:

Remove this import:

```ts
useCancelTicketItem,
```

Remove this mutation:

```ts
const cancelTicketItemMutation = useCancelTicketItem();
```

Remove this handler:

```ts
async function handleCancelTicketItem(ticketItemId: string, reason: string) {
  await cancelTicketItemMutation.mutateAsync({
    reservationId: id,
    ticketItemId,
    reason,
  });
  toast.success('티켓이 취소되었습니다');
  refetch();
}
```

Remove these props from `ReservationDetailView`:

```tsx
onCancelTicketItem={handleCancelTicketItem}
isCancellingTicketItem={cancelTicketItemMutation.isPending}
```

- [ ] **Step 3: Keep customer success and error copy aligned**

Keep success copy:

```ts
toast.success('예매가 취소되었습니다');
```

Keep failure copy unless the API returns a useful business state:

```ts
toast.error('취소 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
```

Do not show "티켓이 취소되었습니다" anywhere in the customer reservation detail page after this task.

- [ ] **Step 4: Run frontend typecheck**

Run:

```bash
pnpm --filter @grabit/web typecheck
```

Expected: PASS after component props are cleaned up in Task 3. If Task 3 has not been completed yet, expected failure references `onCancelTicketItem` or `isCancellingTicketItem`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/hooks/use-reservations.ts 'apps/web/app/mypage/reservations/[id]/page.tsx'
git commit -m "fix(web): route reservation cancellation through refund endpoint"
```

---

### Task 3: Remove Customer Ticket-Item Cancellation UI

**Files:**
- Modify: `apps/web/components/reservation/reservation-detail.tsx`
- Test: `apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx`

- [ ] **Step 1: Write failing UI assertions**

Add or update a seat-level confirmed reservation test so it asserts:

```ts
expect(screen.getByRole('button', { name: '예매 취소' })).toBeInTheDocument();
expect(screen.queryByRole('button', { name: '티켓 취소' })).not.toBeInTheDocument();
expect(screen.queryByText('티켓을 취소하시겠습니까?')).not.toBeInTheDocument();
```

Also assert QR status text still exists:

```ts
expect(
  screen.getByText('좌석별 티켓 상태를 확인할 수 있습니다. 취소된 티켓의 QR은 표시되지 않습니다.'),
).toBeInTheDocument();
```

- [ ] **Step 2: Run the failing UI test**

Run:

```bash
pnpm --filter @grabit/web test -- components/reservation/__tests__/reservation-detail-qr.test.tsx
```

Expected: FAIL because the full cancel button is currently hidden for persisted ticket items or ticket-item cancel controls still render.

- [ ] **Step 3: Change full cancel visibility**

Change:

```ts
const showCancelButton = reservation.status === 'CONFIRMED' && !hasSeatLevelTicketItems;
```

to:

```ts
const showCancelButton = reservation.status === 'CONFIRMED';
```

- [ ] **Step 4: Remove ticket-item cancel props and state**

Remove from `ReservationDetailProps`:

```ts
onCancelTicketItem?: (ticketItemId: string, reason: string) => void | Promise<void>;
isCancellingTicketItem?: boolean;
```

Remove from component parameters:

```ts
onCancelTicketItem,
isCancellingTicketItem = false,
```

Remove state and functions:

```ts
const [ticketCancelTarget, setTicketCancelTarget] = useState<BuyerQrCard | null>(null);
const [ticketCancelReason, setTicketCancelReason] = useState('');

function closeTicketCancelDialog() {
  setTicketCancelTarget(null);
  setTicketCancelReason('');
}

async function handleConfirmTicketCancel() {
  if (!ticketCancelTarget || !ticketCancelReason || !onCancelTicketItem) {
    return;
  }

  try {
    await onCancelTicketItem(ticketCancelTarget.id, ticketCancelReason);
    closeTicketCancelDialog();
  } catch {
    // The page-level mutation handler owns user-facing error copy.
  }
}
```

Remove:

```ts
const canCancelTicketItems =
  reservation.status === 'CONFIRMED' &&
  hasSeatLevelTicketItems &&
  isBeforeShowDateInSeoul(reservation.showDateTime) &&
  Boolean(onCancelTicketItem);
```

- [ ] **Step 5: Remove the ticket-item cancel dialog block**

Delete the `<Dialog open={Boolean(ticketCancelTarget)} ...>` block that renders:

```tsx
<DialogTitle className="text-xl font-semibold">
  티켓을 취소하시겠습니까?
</DialogTitle>
```

Keep the existing `<CancelConfirmModal ... />` block.

- [ ] **Step 6: Remove ticket-item cancel buttons from QR cards**

Find the QR card rendering block that uses `canCancelTicketItems` or `setTicketCancelTarget(card)`.

Delete the customer action button that opens ticket cancellation. Keep card status badges, QR rendering, and cancelled ticket status explanation.

- [ ] **Step 7: Update full-cancel modal copy if needed**

If `CancelConfirmModal` copy implies partial cancellation is possible, update it to whole-reservation language only:

```tsx
예매 전체가 취소됩니다. 일부 좌석만 취소할 수 없습니다.
```

Do not introduce a second modal.

- [ ] **Step 8: Run focused UI test**

Run:

```bash
pnpm --filter @grabit/web test -- components/reservation/__tests__/reservation-detail-qr.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Run frontend typecheck**

Run:

```bash
pnpm --filter @grabit/web typecheck
```

Expected: PASS with no references to removed props.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/reservation/reservation-detail.tsx apps/web/components/reservation/__tests__/reservation-detail-qr.test.tsx
git commit -m "fix(web): show only full reservation cancellation"
```

---

### Task 4: Add Refund Full-Cancel Coverage For Seat-Level Reservations

**Files:**
- Modify: `apps/api/src/modules/refund/refund.service.spec.ts`

- [ ] **Step 1: Add a seat-level context helper in the refund spec**

Add a helper next to `createContext()`:

```ts
function createSeatLevelContext() {
  return {
    ...createContext(),
    seats: [{ seatId: '1F:A-10' }, { seatId: '1F:A-11' }],
    payment: {
      ...createContext().payment,
      amount: 264000,
    },
  };
}
```

- [ ] **Step 2: Write the full-cancel finalizer test**

Add a test:

```ts
it('finalizes a full refund cancellation for seat-level reservations', async () => {
  const tossPaymentsClient = {
    cancelPayment: vi.fn().mockResolvedValue({
      status: 'CANCELED',
      cancels: [{
        cancelAmount: 264000,
        cancelReason: '일정 변경',
        cancelStatus: 'DONE',
        cancelRequestId: 'cancel_refund-1',
      }],
    }),
  };
  const finalizer = {
    finalizeFullPaymentCancellation: vi.fn(),
  };
  const pgBoss = {
    isAvailable: true,
    send: vi.fn(),
  };
  const service = new RefundService(
    {} as never,
    tossPaymentsClient as never,
    finalizer as never,
    pgBoss as never,
  );
  const context = createSeatLevelContext();
  const requestedRefund = createRefund();
  const completedRefund = createRefund({
    status: 'completed',
    completedAt: new Date('2026-05-08T03:05:00.000Z'),
  });

  vi.spyOn(service as never, 'loadReservationContext').mockResolvedValue(context as never);
  vi.spyOn(service as never, 'findExistingRefund').mockResolvedValue(null);
  vi.spyOn(service as never, 'insertRequestedRefund').mockResolvedValue(requestedRefund as never);
  vi.spyOn(service as never, 'loadRefundById').mockResolvedValue(completedRefund as never);

  const result = await service.requestRefund('reservation-1', 'user-1', '일정 변경');

  expect(tossPaymentsClient.cancelPayment).toHaveBeenCalledWith(
    'pay-key-1',
    '일정 변경',
    expect.objectContaining({
      idempotencyKey: 'refund-cancel:refund-1',
    }),
  );
  expect(finalizer.finalizeFullPaymentCancellation).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'refund_request',
      refundId: 'refund-1',
      context: expect.objectContaining({
        seats: [{ seatId: '1F:A-10' }, { seatId: '1F:A-11' }],
      }),
      reason: '일정 변경',
    }),
  );
  expect(result.refundableAmount).toBe(264000);
});
```

- [ ] **Step 3: Run the focused refund test**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts
```

Expected: PASS. If the `cancelRequestId` generated for the test differs because the request id seed changes, keep the assertion focused on `idempotencyKey` and the finalizer context.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/refund/refund.service.spec.ts
git commit -m "test(refund): cover seat-level full cancellation"
```

---

### Task 5: Add Operations Reconciliation Runbook

**Files:**
- Create: `docs/runbooks/ticket-cancellation-reconciliation.md`

- [ ] **Step 1: Create the runbook**

Create `docs/runbooks/ticket-cancellation-reconciliation.md` with this content:

```markdown
# Ticket Cancellation Reconciliation Runbook

Use this only for reservations that entered ticket-item partial cancellation before customer partial cancellation was disabled.

## Scope

- `ticket_items.status = 'cancellation_pending'`
- reservations with some `ticket_items.status = 'cancelled'` and reservation `status = 'CONFIRMED'`
- Toss cancellation completed but Grabit state did not finalize
- Grabit ticket item marked pending but Toss cancellation failed or was never accepted

## Read-Only Triage

1. Search by reservation number in admin.
2. Record reservation id, payment id, payment key presence, reservation status, payment status, and ticket item statuses.
3. Check Toss payment cancellation history by payment key in Toss dashboard.
4. Compare Toss final payment status with Grabit payment status.
5. Do not issue a second cancellation until Toss cancellation history is understood.

## Resolution Rules

- If Toss has no successful cancellation and Grabit is pending, restore the ticket item to active only after confirming the customer should keep the ticket.
- If Toss has a successful partial cancellation and Grabit is pending, finalize only the matching ticket item.
- If Toss has full payment cancellation, finalize full reservation cancellation.
- If Toss rejected the cancellation amount, do not retry partial cancellation. Ask the customer to use full reservation cancellation or process manually with finance approval.

## Safety

- Never bulk update all pending rows.
- Never trust reservation number as Toss order id.
- Never expose payment key, secret key, cookies, or authorization headers in support replies.
- Capture before and after state for each reservation.
```

- [ ] **Step 2: Run doc checks**

Run:

```bash
git diff --check -- docs/runbooks/ticket-cancellation-reconciliation.md
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/ticket-cancellation-reconciliation.md
git commit -m "docs: add ticket cancellation reconciliation runbook"
```

---

### Task 6: Full Verification

**Files:**
- No edits expected

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
pnpm --filter @grabit/api test -- src/modules/reservation/reservation.service.spec.ts src/modules/refund/refund.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend focused tests**

Run:

```bash
pnpm --filter @grabit/web test -- components/reservation/__tests__/reservation-detail-qr.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @grabit/api typecheck
pnpm --filter @grabit/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint if typechecks pass**

Run:

```bash
pnpm --filter @grabit/api lint
pnpm --filter @grabit/web lint
```

Expected: PASS or only pre-existing unrelated lint failures. Any failure in files touched by this plan must be fixed before shipping.

- [ ] **Step 5: Manual local smoke**

Run the app locally:

```bash
pnpm dev
```

Open a confirmed seat-level reservation detail page and verify:

- QR ticket section still renders.
- No per-ticket cancellation button is visible.
- `예매 취소` button is visible before the cancellation deadline.
- Cancellation modal says whole reservation cancellation.
- Network request goes to `POST /api/v1/reservations/:id/refund`.

- [ ] **Step 6: Production deploy verification after merge**

After merge and deploy, verify live read paths:

```bash
curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags
```

Then use a safe test reservation or admin-approved test case to verify the customer UI exposes only full cancellation.

---

## Rollout Notes

- This change reduces Toss partial cancellation failure exposure for all customer-facing payment methods.
- It does not automatically fix already inconsistent reservations.
- Customer support copy should say: "현재 티켓 단위 취소는 지원하지 않습니다. 예매 전체 취소 후 필요한 좌석으로 다시 예매해주세요."
- Admin/internal partial cancellation should remain out of customer UI unless a separate policy and reconciliation design is approved.

## Open Risks

- Existing `cancellation_pending` rows need manual reconciliation before support can promise a final state.
- If `POST /refund` response can be `processing_at_pg`, frontend copy may need a "취소 확인 중" success state instead of only "예매가 취소되었습니다".
- If any frontend or admin page still imports `useCancelTicketItem`, typecheck will catch it.
- If old partial cancellation tests are removed too broadly, internal payment-cancel policy coverage must remain in `apps/api/src/modules/payment/payment-cancel-policy.spec.ts`.
