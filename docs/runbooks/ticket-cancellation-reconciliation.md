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

- If any Ticket Item remains `cancellation_pending`, do not start Full Reservation Cancellation for that reservation until the pending item is manually reconciled.
- If Toss has no successful cancellation and Grabit is pending, restore the ticket item to active only after confirming the customer should keep the ticket.
- If Toss has a successful partial cancellation and Grabit is pending, finalize only the matching ticket item.
- If Toss has full payment cancellation, finalize full reservation cancellation.
- If Toss rejected the cancellation amount, do not retry partial cancellation. Ask the customer to use full reservation cancellation or process manually with finance approval.

## Safety

- Never bulk update all pending rows.
- Never trust reservation number as Toss order id.
- Never expose payment key, secret key, cookies, or authorization headers in support replies.
- Capture before and after state for each reservation.

## Seat ownership and refund timing (2026-09 relaunch)

- Finalize only the reviewed reservation/payment. A historical reservation's seat list does not prove ownership of shared `seat_inventories` rows.
- Every reopen must preserve other `active` / `cancellation_pending` Ticket Items on the same showtime and seat key, including manual recovery SQL. Use the [relaunch ownership and preflight procedure](show-relaunch-reliability.md#수동-취소재고-복구-보호).
- Cancellation confirmation means the PG accepted/completed the cancellation. It does not prove a bank deposit or card-statement adjustment. Historical locally generated `expected_deposit_at` values are not issuer promises; the API now omits them.
- A late cancellation event racing with issuance must retry through the full cancellation finalizer; updating payment status alone is insufficient to revoke tickets, QR credentials and benefits.
