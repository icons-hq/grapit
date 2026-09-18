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

## Completed historical state repair (2026-09-18)

Girl Rules의 저장된 승인/취소 결제 1,190건을 PG 원거래와 읽기 전용으로 대조했다. 원거래 금액 차이는 없었다. 상태명 차이 중 47건은 PG `PARTIAL_CANCELED`·잔액 0과 내부 `CANCELED`의 정상적인 표현 차이였다.

6월 4일 취소된 8건은 티켓/QR 회수가 완료됐으나 payment가 `DONE`으로 남아 있었다. 사용자 승인 및 Cloud SQL 백업 이후, 대상 8개 reference의 allowlist와 검토 hash를 고정하고 PG identity·통화·금액·완료 취소 합계·잔액을 다시 대조했다. 부분취소 4건은 payment만 `PARTIAL_CANCELED`로, 전액취소 4건은 payment/예약을 취소 상태로 맞췄다. 전액취소 날짜는 PG의 실제 마지막 취소 시각을 사용했다.

기존 ticket/QR/inventory/benefit/redemption/refund의 회차별 전후 hash가 같았고, 새 PG 조회에서 8건의 상태·금액 불일치 0을 확인했다. 추가 취소나 환불 API는 호출하지 않았다. 이 이력은 다른 데이터에 적용할 포괄 SQL이 아니다. 이후 복구에도 해당 원거래·보호 권리·수정 행 수를 개별 검토한다.
