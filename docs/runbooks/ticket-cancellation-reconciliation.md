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
4. Compare the cancellation scope, completed cancellation sum, provider balance and remaining Ticket Items with Grabit state. Provider and local status names need not match.
5. Do not issue a second cancellation until Toss cancellation history is understood.

## Resolution Rules

- If any Ticket Item remains `cancellation_pending`, do not start Full Reservation Cancellation for that reservation until the pending item is manually reconciled.
- If Toss has no successful cancellation and Grabit is pending, restore the ticket item to active only after confirming the customer should keep the ticket.
- If Toss has a successful partial cancellation and Grabit is pending, finalize only the matching ticket item. If active Ticket Items remain, preserve parent `reservation=CONFIRMED` and `payment=DONE`; `PARTIAL_CANCELED` at the provider does not by itself justify changing the local parent payment.
- A Full Reservation Cancellation retaining cancellation/service fees is different: the Reservation and all Ticket Items are cancelled, while local payment may be `PARTIAL_CANCELED` with the retained provider balance. Validate against the stored Cancellation Quote.
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

## Historical state repair and correction (2026-09-18)

Girl Rules의 저장된 승인/취소 결제 1,190건을 PG 원거래와 읽기 전용으로 대조했다. 원거래 금액 차이는 없었다. 상태명 차이 55건 중 47건은 PG `PARTIAL_CANCELED`·잔액 0과 내부 `CANCELED`의 정상적인 표현 차이였다. 남은 8건 중 4건도 활성 티켓이 남은 부분 티켓 취소로, 내부 `DONE` 유지가 정상이다. 실제 전액취소 미수렴은 4결제·4예매였다.

최초 실행은 활성 티켓이 남은 4건까지 `PARTIAL_CANCELED`로 변경하는 오류가 있었다. 티켓·QR·재고 등 원본 행의 hash는 보존됐지만, 부모 payment의 상태를 사용하는 QR·명단·매출 조회에서 활성 7티켓·2,254,000원이 제외됐다. 단순 status 문자열 대조와 행 보존만으로는 조회 계약을 검증하지 못한 사례다.

12:22 KST, 최초 실행의 정확한 4개 reference만 allowlist로 고정했다. 새 PG GET으로 identity·통화·완료 취소액·잔액을 재검증하고, 검토 hash `a4f28766b487aa0dbd25b4691e641278c17d3e422558284a782f7bc2ede71412`가 일치할 때 4행의 `payments.status`만 `DONE`으로 복원했다. 예약 전체, 대상 결제의 나머지 필드, 비대상 결제, 티켓·QR·재고·특전·수령·환불 hash가 모두 보존됐다. 전액취소 4결제·4예매와 기본 특전 13개 복구는 유지했다.

복원 후 읽기 전용 집계는 `CONFIRMED`/`DONE` 활성 711티켓·199,462,000원이다. 부분 취소 finalizer부터 남은 QR 조회·구매자 명단·관리자 및 정산 매출까지 실제 PostgreSQL 통합 회귀로 검증한다. 원본 실행 증거는 지우거나 덮어쓰지 않고 정정 증거를 별도 보관한다. 추가 결제·취소·환불 API 호출은 없다.

이 이력은 다른 데이터에 적용할 포괄 SQL이 아니다. 이후 복구에는 해당 원거래·취소 범위·보호 권리·변경 행 수와 수정 후 실제 조회 흐름을 개별 검토한다.

[정정 실행 증거](https://console.cloud.google.com/storage/browser/grapit-ops-evidence-491806/2026-09-18-partial-cancellation-correction?project=grapit-491806): 최초 실행 증거는 보존하며 이 정정 이력이 최종 상태 해석의 기준이다.
