---
status: active_runbook
last_updated: 2026-06-03
scope: Live-key foreign payment smoke and immediate full-cancel verification
---

# Live Foreign Payment Cancel UAT Runbook

## Purpose

이 runbook은 운영 live key로 해외카드, PayPal, Alipay를 각각 한 좌석씩
결제하고 즉시 전액 취소해서 provider 상태와 Grabit 내부 상태가 함께 닫히는지
검증하기 위한 절차다.

이 문서는 실행 승인서가 아니다. 아래 preflight가 모두 통과하고, 이 branch의
변경이 production에 배포된 뒤에만 Toss 상점관리자 변경, live 결제, DB 보정,
또는 환불/취소 같은 외부 write action을 실행한다.

## Official Basis

Sources checked on 2026-06-03:

- Toss MCP v2, document ID 1, `결제 취소하기`
- Toss MCP v2, document ID 21/28, `PayPal 연동하기`
- Toss MCP v2, document ID 22/36, `해외 간편결제창 연동하기` and
  `해외 간편결제 연동하기`
- [결제 취소하기](https://docs.tosspayments.com/guides/v2/cancel-payment)
- [해외결제 연동하기](https://docs.tosspayments.com/guides/v2/learn/foreign-payment)
- [PayPal 연동하기](https://docs.tosspayments.com/guides/v2/payment-widget/integration-paypal)
- [해외 간편결제 연동하기](https://docs.tosspayments.com/guides/v2/payment-widget/integration-foreignpay)
- [결제위젯 어드민 설정하기](https://docs.tosspayments.com/guides/v2/payment-widget/admin)
- [웹훅 연결하기](https://docs.tosspayments.com/guides/v2/webhook)

Implementation rules derived from those docs:

- 전액 취소는 결제 취소 API request body에 `cancelAmount`를 넣지 않는다.
- 부분 취소는 `cancelAmount`를 넣는다.
- 해외 간편결제 부분 취소는 `currency`가 필요하다.
- 중국 및 동남아 비동기 결제 취소는 `cancelRequestId`를 넣고
  `CANCEL_STATUS_CHANGED` webhook으로 최종 결과를 확인한다.
- PayPal은 live 취소 시 거래 수수료가 반환되지 않는다.
- Alipay 계열 비동기 결제는 `pendingUrl`, `PAYMENT_STATUS_CHANGED`, provider
  query로 최종 승인/실패를 확정한다. 결제 완료까지 최대 10분이 걸릴 수 있다.
- 해외카드와 PayPal을 함께 노출하는 widget은 MID, currency, `variantKey`
  구성이 맞아야 한다. KRW MID와 USD MID를 섞지 않는다.

## Operator Rules

1. Raw Toss keys, payment keys, authorization headers, cookies, card numbers,
   PayPal/Alipay account data, full e-mail addresses, phone numbers, and PII
   must never be pasted into docs, commits, screenshots, or evidence artifacts.
2. Live 결제는 payment method별 한 좌석만 실행한다.
3. 대상 공연 회차, 좌석, buyer account, admin account는 이 runbook용으로
   승인된 allowlist만 사용한다.
4. 기존 실사용자, 실제 예매, 실제 결제, 실제 티켓, 실제 문의/정산 데이터는
   cleanup 또는 보정 대상이 아니다.
5. DB write correction은 exact test reservation/order/payment IDs가 확정되고
   read-only inventory가 저장된 뒤에만 실행한다.
6. 가능한 모든 cleanup은 Toss dashboard 수동 취소나 raw DB update가 아니라
   Grabit app cancellation path로 실행한다.
7. provider와 내부 상태가 불일치하면 추가 결제 테스트를 중단한다.

## Preflight

### Deployment And Runtime

- [ ] Branch `ps/live-foreign-payment-cancel-safety`가 production에 배포됐다.
- [ ] API health is HTTP 200 at `https://api.heygrabit.com/api/v1/health`.
- [ ] Current Cloud Run revision and image digest are recorded.
- [ ] Runtime flags show the intended booking/payment mode.
- [ ] Production API logs are available for payment confirm, webhook, refund
      retry, and cancelled-seat release jobs.
- [ ] Sentry and Cloud Run log watches are open.

### Secret And Key Presence

Do not print raw values. Record only present/missing and environment.

- [ ] Default live Toss secret and client key are present.
- [ ] Overseas-card live secret/client configuration is present if overseas-card
      MID uses a separate key pair.
- [ ] Foreign-easy-pay live secret/client configuration is present for PayPal
      and Alipay.
- [ ] Widget/payment UI `variantKey` values are present in production env.
- [ ] No production deployment references test keys.

### Toss Admin Checklist

Use Chrome logged into Toss 상점관리자. Capture redacted screenshots only.

- [ ] Correct live merchant and MID are selected, not test merchant.
- [ ] 해외카드 is enabled on the intended KRW or USD MID according to contract.
- [ ] PayPal is enabled on the intended USD foreign-payment MID.
- [ ] Alipay or Alipay Plus is enabled on the intended foreign-easy-pay MID.
- [ ] TrueMoney and PayPay stay disabled in the `uspay` variant. Grabit has no
      provider-charge quote for them: the server rejects a `TRUEMONEY` checkout
      branch and refunds any captured TrueMoney DONE automatically.
- [ ] Payment UI includes the expected payment methods and `variantKey`.
- [ ] Agreement UI exists and is linked to the same payment UI.
- [ ] Webhook endpoint points to production API.
- [ ] `PAYMENT_STATUS_CHANGED` is enabled.
- [ ] `CANCEL_STATUS_CHANGED` is enabled.
- [ ] Webhook signing/verification setting matches the deployed API behavior.

### Test Inventory

- [ ] One approved showtime is selected.
- [ ] Three isolated seats are selected: one for overseas card, one for PayPal,
      one for Alipay.
- [ ] The amount is intentionally low and within approved loss tolerance.
- [ ] Booking policy and cancellation policy are known.
- [ ] Buyer account is a controlled test user.
- [ ] Admin account is a controlled operator account.
- [ ] Initial DB state for reservations, payments, ticket items, tickets, and
      seat inventories is recorded with masked IDs.

## Test Matrix

| Path | Expected provider facts | Cancel request | Finalization rule |
| --- | --- | --- | --- |
| Overseas card | `method=CARD`, provider remains `CARD`, metadata marks overseas-card scope | Full cancel omits `cancelAmount`; uses overseas-card secret scope if configured | Provider `CANCELED` finalizes reservation, payment, ticket items, tickets, and held-cancelled seat release |
| PayPal | `method=FOREIGN_EASY_PAY`, provider `PAYPAL`, USD provider amount | Full cancel omits `cancelAmount`; default/PayPal foreign-payment secret scope | Provider `CANCELED` finalizes immediately; record that live PayPal fee may not be returned |
| Alipay | `method=FOREIGN_EASY_PAY`, provider `ALIPAY` or `ALIPAY_PLUS`, async capable | Full cancel omits `cancelAmount`; includes deterministic `cancelRequestId`; uses foreign-easy-pay scope | If `IN_PROGRESS`, keep local pending and wait for `CANCEL_STATUS_CHANGED`; only `CANCELED` finalizes |

## Execution Workflow

Run one payment method at a time. Do not start the next method until the current
method is either fully closed or explicitly marked `STOPPED`.

1. Confirm the exact seat is available and not linked to any real user flow.
2. Open public checkout as the controlled buyer.
3. Select only the target payment method.
4. Complete live payment.
5. Confirm provider result in Toss dashboard with masked reference.
6. Confirm Grabit state:
   - reservation is confirmed or, for async Alipay, final confirmation is
     completed through webhook/provider query before canceling;
   - payment row has expected method/provider/currency metadata;
   - ticket item is active;
   - ticket and QR are issued and visible.
7. Trigger cancellation through Grabit cancellation UI or API.
8. Confirm the outgoing cancel request shape in logs without exposing secrets:
   - full cancel: no `cancelAmount`;
   - Alipay: has `cancelRequestId`;
   - partial currency is not used for these one-seat full-cancel tests.
9. Confirm provider cancel state:
   - overseas card/PayPal: provider `status=CANCELED` means proceed to
     internal finalization checks;
   - Alipay: provider `status=CANCELED` and the matching `cancelRequestId`
     cancel object with `cancelStatus=DONE` means proceed;
   - `IN_PROGRESS` means wait for webhook and query provider until final;
   - `ABORTED` or missing provider cancel means stop and escalate.
10. Confirm Grabit final state:
    - reservation status is cancelled;
    - payment status is canceled;
    - refund/cancel ledger is terminal or awaiting only provider async finality;
    - ticket item is cancelled with expected refund economics;
    - ticket is revoked;
    - seat inventory is `held_cancelled`, then release job is persisted or
      explicitly tracked for controlled reopening;
    - no unrelated reservation/payment/ticket rows changed.
11. Save redacted evidence row.

## Alipay Async Handling

Alipay must not be treated as done just because the cancel API returned.

- If the cancel response has `cancels.cancelStatus=IN_PROGRESS`, leave the
  ticket item/reservation in the pending path produced by the app.
- Wait for `CANCEL_STATUS_CHANGED`.
- Query Toss with the same secret scope and compare `paymentKey`, `orderId`,
  `status`, and latest cancel object.
- Only provider `status=CANCELED` and the matching `cancelRequestId` cancel
  object with `cancelStatus=DONE` closes the internal state.
- If no webhook arrives within 10 minutes, stop new live tests and escalate with
  provider query evidence.
- `CANCEL_STATUS_CHANGED` carries only `cancelRequestId`. The API resolves it
  through `cancel_<row id>` primary keys first, then the full value stored on
  the seat-level command (`cancel_<commandId>`), refund retries
  (`cancelRequest` and `previousAttempts[*]`), and async DONE compensation
  records. A resolved seat cancel finalizes only that Ticket Item; a replay for
  an already cancelled item is acknowledged as a duplicate.
- An out-of-order event whose state the provider already passed (for example
  `IN_PROGRESS`/`DONE` after `CANCELED`, or a cancel `IN_PROGRESS` after the
  same request is `DONE`) returns 200 with `IGNORED_STALE_PROVIDER_STATE`.
  Identity mismatches (paymentKey, orderId, amount, unknown cancel request)
  still return 400.

## Async DONE Compensation

An async DONE that cannot be issued is refunded in full instead of being left
at the PG: seat taken by another checkout after the checkout lock expired (a
late DONE for a `FAILED` order never takes a seat the same buyer re-locked for a
newer reservation), ticket limit, amount or currency mismatch with the stored
quote (a USD quote never accepts a same-number KRW charge), an unsupported
provider (TrueMoney), a payment method the order or the performance policy
does not allow (`payment_method_not_allowed`: the provider lookup's `method`
and `easyPay.provider` must match the frozen Checkout Payment Method and be in
the performance's allowed methods intersected with
`CHECKOUT_CONFIGURABLE_PAYMENT_METHODS`; virtual account and mobile phone never
pass), or a second paymentKey for an order whose payment is already accepted,
cancelled or compensated (including a buyer-cancelled reservation or an
earlier refunded late DONE).

- The method policy is decided only on the provider lookup of the paymentKey,
  never on callback or browser values. The pending return
  (`POST /payments/async-return`) serves only orders checked out with an
  asynchronously approved foreign wallet (Alipay+, TrueMoney); any other order
  gets 409 without a provider call, and the browser's `provider` parameter is
  ignored (the wallet comes from the provider lookup or the frozen checkout
  method).
- A deposited virtual account DONE is never cancelled automatically: its full
  refund needs the buyer's refund account. The row stays `DONE/cancel_pending`
  (unissuable) with an `attention` record (`attempts=0`), a
  `ASYNC_DONE_COMPENSATION_ATTENTION` diagnostic and an error log; refund it at
  the provider manually.

- The payment row stays `DONE` + `async_status=cancel_pending` until the PG
  reports the cancel complete, so confirm and DONE replays cannot issue it.
  `payments.provider_metadata.asyncDoneCompensation` records the cancel
  command, every `cancelRequestId`, attempts and state. A second paymentKey has
  no payment row of its own: the order's existing row keeps its status (for
  example `DONE` for a confirmed order) and the cancel is recorded in that row's
  `duplicatePaymentCompensations[]`.
- A cancel `ABORTED` webhook is recorded as `ASYNC_DONE_COMPENSATION_CANCEL_ABORTED`
  (ledger code and payment failure diagnostic).
- A `DONE/cancel_pending` row claimed by payment confirm
  (`confirmCompensationClaim: true`, no `asyncDoneCompensation` record) belongs
  to its `payment-confirm-reconcile` job: the sweep never adopts it, and its
  cancel `ABORTED` is left to that job. The reconcile job in turn never touches
  a row this sweep owns. A `CANCELED` webhook that completes either kind records
  the owner's compensated-cancel code.
- The recovery sweep (`AsyncDoneCompensationRecoveryWorker`, every minute where
  background processing runs and once per bounded worker window) queries the
  PG: completed cancels converge locally to `CANCELED/compensation_cancelled`
  and `FAILED`; `IN_PROGRESS` is re-checked after 10 minutes and becomes
  `attention` (error log, `ASYNC_DONE_COMPENSATION_ATTENTION`) once the provider
  has kept it `IN_PROGRESS` for 24 hours after the first cancel request; a DONE
  without a live cancel is re-cancelled with a new idempotency key and
  `cancelRequestId` suffix `-r<n>`. After 5 requests the record becomes
  `attention`, logs an error and writes `ASYNC_DONE_COMPENSATION_ATTENTION`.
  The sweep reads candidates in creation order page by page and skips rows not
  yet due, so up to 100 due orders are processed per run however many open
  compensations are waiting.
  A provider query that keeps failing (wrong secret scope or key, provider
  outage) is logged as a warning on each attempt, counted in `queryFailures`
  since `queryFailingSince`, and becomes `attention` after at least 3
  consecutive failures over one hour.
- `payments.amount` is the KRW ledger. A compensated charge reported in another
  currency without a quote (for example a TrueMoney USD amount) keeps the
  reservation's KRW total on the row; the provider amount and currency are in
  `asyncDoneCompensation.payment`.
- `attention` rows need manual provider reconciliation. Do not edit the row to
  issue tickets.

## Evidence Ledger

| Field | Overseas card | PayPal | Alipay |
| --- | --- | --- | --- |
| Execution timestamp | TBD | TBD | TBD |
| Operator | TBD | TBD | TBD |
| Showtime / seat reference | TBD | TBD | TBD |
| Buyer account reference | TBD | TBD | TBD |
| Toss merchant / MID class | TBD | TBD | TBD |
| Widget `variantKey` | TBD | TBD | TBD |
| Grabit order / reservation reference | TBD | TBD | TBD |
| Provider approval evidence | TBD | TBD | TBD |
| Internal confirm evidence | TBD | TBD | TBD |
| QR/ticket evidence | TBD | TBD | TBD |
| Cancel request shape | TBD | TBD | TBD |
| Provider cancel evidence | TBD | TBD | TBD |
| Internal final state evidence | TBD | TBD | TBD |
| Seat release/reopen evidence | TBD | TBD | TBD |
| Remaining risk / fee note | TBD | TBD | TBD |
| Decision | `BLOCKED` | `BLOCKED` | `BLOCKED` |

## Read-Only Query Shapes

Use exact allowlisted test order IDs. Mask values before saving evidence.

```sql
select
  r.id,
  r.status,
  r.toss_order_id,
  p.id as payment_id,
  p.status as payment_status,
  p.method,
  p.provider,
  p.currency,
  p.provider_currency,
  p.amount,
  p.provider_amount_minor
from reservations r
join payments p on p.reservation_id = r.id
where r.toss_order_id = '<allowlisted-test-order-id>';
```

```sql
select
  ti.id,
  ti.status,
  ti.seat_key,
  ti.price,
  ti.cancellation_fee,
  ti.refundable_amount,
  t.status as ticket_status
from ticket_items ti
left join tickets t on t.ticket_item_id = ti.id
where ti.reservation_id = '<allowlisted-test-reservation-id>'
order by ti.created_at;
```

```sql
select
  seat_key,
  status,
  reservation_id,
  reopen_job_id,
  updated_at
from seat_inventories
where showtime_id = '<allowlisted-test-showtime-id>'
  and seat_key in ('<seat-1>', '<seat-2>', '<seat-3>')
order by seat_key;
```

Open or attention async DONE compensations, and rejected DONE rows from before
automatic compensation (those still need a provider check and a manual refund
decision):

```sql
select
  p.toss_order_id,
  p.status,
  p.async_status,
  r.status as reservation_status,
  p.provider_metadata->'asyncDoneCompensation'->>'state' as compensation_state,
  p.provider_metadata->'asyncDoneCompensation'->>'attempts' as compensation_attempts,
  p.provider_metadata->'asyncDoneCompensation'->>'lastError' as compensation_last_error,
  jsonb_array_length(coalesce(p.provider_metadata->'duplicatePaymentCompensations', '[]'::jsonb)) as duplicate_charges
from payments p
join reservations r on r.id = p.reservation_id
where p.async_status in ('cancel_pending', 'payment_amount_mismatch', 'payment_provider_unsupported')
   or p.provider_metadata->>'asyncDoneCompensationOpen' = 'true'
   or p.provider_metadata->'asyncDoneCompensation'->>'state' = 'attention'
   or p.provider_metadata->'duplicatePaymentCompensations' is not null
order by p.created_at;
```

## DB Correction Policy

DB correction is a last resort.

Allowed:

- Read-only inventory and evidence queries.
- Updates limited to exact allowlisted test reservation/payment/ticket item/seat
  inventory IDs created by this runbook.
- Transactional correction that first records before/after evidence.

Not allowed:

- Updating or deleting real user records.
- Broad cleanup by showtime, performance, user, date range, status, or provider.
- Changing provider-facing payment facts to hide a Toss/local mismatch.
- Marking a provider-uncertain payment as cancelled internally.

Any proposed DB write must include:

- exact target IDs;
- reason the app cancellation path cannot correct it;
- before-state query output;
- SQL transaction plan;
- rollback or compensating action;
- reviewer approval.

## Stop Criteria

Stop immediately when any of these occurs:

- live key, MID, or `variantKey` appears to be test or wrong merchant;
- payment amount/currency differs from Grabit reservation facts;
- provider says paid but Grabit cannot confirm ticket/QR issuance;
- Grabit says cancelled but Toss provider state is not cancelled or pending;
- webhook verification fails;
- Alipay async result is not final within the expected window;
- seat inventory is reopened/sellable before cancellation safety is proven;
- any evidence suggests a real user row was touched;
- PayPal fee/loss risk exceeds the approved tolerance.

## Not Yet Executed

As of this document update, this branch has not performed Toss admin changes,
live payments, live cancels, production DB writes, or production deployment.
Those actions remain gated by the preflight above.
