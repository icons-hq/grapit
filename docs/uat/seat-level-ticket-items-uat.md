# Seat-Level Ticket Items UAT

Date: 2026-05-28
Scope: multi-seat purchase, per-seat QR, per-ticket entry, per-ticket cancellation, service fee, and seat resale after cancellation.

## Preconditions

- During automated UAT, the local web dev server was running.
- During automated UAT, the local API surface returned authenticated buyer/scanner fixtures.
- No production payment, refund, database, or external API write is performed during this automated UAT.
- Real Toss partial cancellation and production migration must still be verified in a controlled production/sandbox release checklist.

## UAT Items

| ID | Area | Scenario | Expected Result | Verification |
| --- | --- | --- | --- | --- |
| UAT-01 | Payment amount | Buyer selects 4 seats. | Total amount includes ticket prices plus 2,000 KRW service fee per seat. | PASS - shared/web/API tests |
| UAT-02 | Ticket item creation | One paid reservation contains 4 seats. | 4 `ticket_items` are created, one per seat, each with seat identity and service fee. | PASS - API finalization tests |
| UAT-03 | Buyer QR list | Buyer opens booking complete or reservation detail. | Buyer sees one QR/status card per seat, and each card identifies its seat and floor. | PASS - Browser: 4 QR cards |
| UAT-04 | No transfer feature | Buyer views all ticket cards. | No "티켓 전달" UI or transfer action is shown. | PASS - Browser: 0 transfer labels |
| UAT-05 | Entered ticket visibility | One of several seat tickets has already entered. | Entered seat remains visible with its QR/status card and "입장 완료"; other active seats remain "입장 전". | PASS - Browser |
| UAT-06 | Per-ticket entry | Scanner opens one seat QR and taps entry. | Only that ticket item is processed; sibling ticket items remain eligible for later entry. | PASS - Browser + API tests |
| UAT-07 | Duplicate entry prevention | Scanner reopens the same QR after entry. | Scanner sees duplicate/already-entered state and cannot process again. | PASS - Browser |
| UAT-08 | Cancelled ticket visibility | Buyer opens reservation after one seat ticket was cancelled. | Cancelled seat remains identifiable, shows no QR, and uses cancelled-ticket copy. | PASS - Browser |
| UAT-09 | Individual cancellation UI | Buyer opens confirmed reservation before show date. | Active, not-entered ticket cards expose "이 티켓 취소"; entered/cancelled cards do not. | PASS - Browser |
| UAT-10 | Individual cancellation action | Buyer cancels one ticket item. | Request targets `PUT /reservations/:reservationId/ticket-items/:ticketItemId/cancel`; only that item changes state. | PASS - Browser mock + API tests |
| UAT-11 | Seat resale after cancel | One ticket item in a 4-seat reservation is cancelled after payment cancellation succeeds. | Exactly that seat inventory reopens for resale; sibling seats stay reserved. | PASS - API service tests |
| UAT-12 | Cancellation fee policy | Cancellation preview/processing runs per ticket. | Same-day KST rule, 7-day booking rule, show-date priority, NOL-style fee bands, and service-fee refundability are applied per ticket. | PASS - shared/API tests |
| UAT-13 | Legacy QR safety | Scanner receives a legacy reservation-level QR. | Scanner rejects payloads without `ticketItemId`/seat identity. | PASS - API QR tests |
| UAT-14 | Migration/backfill | Existing reservations are migrated. | `ticket_items` backfill preserves legacy QR rows, maps entered state when evidence exists, and does not reopen seats. | PASS - migration check/spec |
| UAT-15 | Admin reservation detail | Admin opens a multi-seat reservation after one ticket item entered and another ticket item was cancelled. | Admin detail shows one row per `ticket_items` record with item status, admission state, refund amount, and reopen state. | PASS - API/web admin tests |
| UAT-16 | Admin raw booking export | Admin exports raw reservation CSV after partial ticket cancellation. | CSV rows are ticket-item-level and include Ticket Item ID, Ticket Item Status, Admission State, refund amount, and reopen state. | PASS - API admin export tests |
| UAT-17 | Settlement export | Finance/admin exports settlement datasets for a partially cancelled reservation. | Settlement CSV is one row per ticket item, and entry/refund/no-show reconciliation uses `ticket_items` status/admission/refund fields. | PASS - API settlement tests |

## Automated Evidence

Browser environment:

- Web: `http://localhost:3000`
- UAT mock API: `http://127.0.0.1:8080`
- Browser: Codex in-app Browser, default desktop viewport plus 390x844 mobile viewport.

Browser checks:

- Reservation detail: URL/title matched, page was not blank, no framework overlay, no console warnings/errors.
- Reservation detail counts before cancellation: 4 QR cards, 3 active QR images, 0 "티켓 전달", 2 ticket cancel buttons, 1 entered-ticket notice, 1 cancelled-ticket notice.
- Booking complete: 4 QR cards, 3 active QR images, 0 "티켓 전달", cancelled seat copy shown.
- Individual cancel interaction: opened ticket-level cancel dialog, selected reason, submitted ticket cancel, dialog closed, toast appeared, cancel buttons changed 2 -> 1, cancelled-ticket notices changed 1 -> 2, active QR images changed 3 -> 2.
- Scanner interaction: seat QR `token-seat-4` verified as processable, "입장 처리" produced processed state, reload produced duplicate/already-entered state with no processing button.
- Mobile reservation detail after entry/cancel: 4 QR cards, 2 active QR images, 0 ticket cancel buttons, no console warnings/errors.

Screenshots:

- `/tmp/grapit-uat-reservation-detail.png`
- `/tmp/grapit-uat-booking-complete.png`
- `/tmp/grapit-uat-ticket-cancel.png`
- `/tmp/grapit-uat-scanner-processed.png`
- `/tmp/grapit-uat-scanner-duplicate.png`
- `/tmp/grapit-uat-reservation-mobile.png`

CLI checks:

- `pnpm --filter @grabit/shared test`: PASS, 14 files / 81 tests.
- `pnpm --filter @grabit/shared typecheck`: PASS.
- `pnpm --filter @grabit/api exec vitest run database/schema/ticket-items.schema.spec.ts modules/reservation/reservation.service.spec.ts modules/reservation/reservation-finalization.service.spec.ts modules/payment/payment.service.spec.ts modules/payment/toss-payments.client.spec.ts modules/ticket/qr-ticket.service.spec.ts modules/field-operations/field-check-in.service.spec.ts`: PASS, 7 files / 132 tests. Expected negative-path Nest logs were emitted.
- `pnpm --filter @grabit/web exec vitest run components/booking/__tests__/booking-complete-qr.test.tsx components/booking/__tests__/seat-selection-panel.test.tsx components/reservation/__tests__/reservation-detail-qr.test.tsx components/reservation/__tests__/refund-timeline.test.tsx`: PASS, 4 files / 16 tests.
- `pnpm --filter @grabit/api exec vitest run modules/admin/settlement-export.service.spec.ts modules/admin/admin-booking.service.spec.ts`: PASS, 2 files / 18 tests.
- `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/seat-operations-panel.test.tsx`: PASS, 1 file / 3 tests.
- `pnpm --filter @grabit/api typecheck`: PASS.
- `pnpm --filter @grabit/web typecheck`: PASS.
- `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit check`: PASS.
- `git diff --check`: PASS.

## Manual Release Gates

- Run production migration through the approved CI/CD path, not from a local shell.
- Use Toss sandbox or approved payment fixture to verify one real partial cancellation per ticket item.
- Verify real phone-camera QR scan against a phone-reachable origin or production preview URL.
- Confirm production Cloud Run deploy, health, and live smoke after PR merge.
