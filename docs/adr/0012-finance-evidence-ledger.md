# ADR 0012: Use one evidence-based finance ledger with explicit date and currency contracts

Status: accepted under the user's autonomous full-revamp authorization, 2026-09-22.

## Context

The old finance UI displayed zero before querying, exposed filters the API ignored, counted pending requests in refund totals, and omitted cancelled payments from provider reconciliation. A manual foreign-payout input then compared unlike bases without evidence. A payment's original amount, remaining Ticket Items, provider currency and provider payout are distinct facts.

## Decision

`FinanceLedgerService` owns the finance read boundary. The local reader takes a repeatable-read, read-only PostgreSQL snapshot. It selects approved payments by an explicit KST approval or cancellation date basis, keeps original orders/payments, and evaluates known cancellation timestamps at `asOf`. Full-refund quotes and `previousAttempts` survive rights restoration and are used for historical amounts. Unknown evidence is `null`, never invented zero.

Provider settlement reads are explicit. They include all approved payments of the selected event/showtime, including full cancellation and payment-without-ticket cases, then use the independently selected sold/payout date range. They preserve signed transaction amounts and KRW/USD minor units. Scope, date, currency or transport errors yield failed/partial status; an empty successful response is separate. Current PG observation time is not a historical snapshot or proof of bank deposit. The Toss settlement timeout is 65 seconds, respecting its documented minimum 60 seconds.

Exports share the reader: one payment, one ticket or one provider transaction per data row, with a leading scope record. No buyer name/contact, QR token or payment key is included. Finance capability, reason and audit are mandatory. An incomplete provider query cannot be exported as a complete provider dataset.

## Compatibility and rollout

The `/admin/settlement` browser route stays. The old `/admin/settlement/summary`, `/reconciliation` and `/export` contracts cannot express missing evidence, cutoff, currency or query state. They explicitly return HTTP 410 with the new endpoint instead of silently changing totals or maintaining a contradictory finance implementation. This is a deliberate exception to the general API compatibility plan, chosen within the delegated revamp scope. All repository UI callers migrate together. API and Web must deploy/roll back together and finance operators refresh the page; 410 is detectable and does not alter records.

No schema migration or rewrite of original orders, payments, tickets, cancellation receipts, entry or benefit rights is needed. Archived CSVs retain their original meaning and must not be relabelled as new ledger exports.

## Limitations

This is an evidence reader, not a new accounting close system. Data missing from historical records cannot be manufactured. Provider evidence, independent bank statements, foreign merchant settlement access and real closing approval remain external gates. [Runbook](../runbooks/finance-ledger-reconciliation.md) specifies reconciliation and discrepancy records. The [Toss API reference](https://docs.tosspayments.com/reference#정산-조회) defines settlement date bases and transaction rows.

과거 좌석 취소 준비가 내부 실패로 보상 복구되어 command/견적이 지워진 경우, 기준 시각 이후 수정된 티켓의 과거 상태를 active나 0원으로 복원하지 않는다. 관련 금액은 미확인으로 유지한다. 취소일을 확정할 수 없는 거래는 취소일 조회에서 대조 후보로 포함하며 경고한다. 이 보수적인 판정은 입장 등 다른 변경으로 수정 시각이 갱신된 과거 티켓에도 적용될 수 있다. 현재 시각 조회 또는 보존된 원본 증거로 재대조한다.
