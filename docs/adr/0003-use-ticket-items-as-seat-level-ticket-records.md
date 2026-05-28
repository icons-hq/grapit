# Use ticket_items as seat-level ticket records

Grabit will introduce a `ticket_items` table as the source of truth for seat-level ticket lifecycle instead of stretching `reservation_seats`. `reservation_seats` is a seat snapshot for the original Reservation, while `ticket_items` owns Ticket Item Status, Admission State, QR Credential linkage, Ticket Item Cancellation, refund effects, and controlled reopen state. This change is delivered as one integrated rollout across booking, payment, refund, QR, scanner, admin, settlement, and export surfaces rather than split into a later phase.

**Consequences**

- Existing `reservation_seats` rows must be backfilled into `ticket_items`.
- Legacy backfill preserves financial truth: rows whose existing reservation/payment amount did not include the new Ticket Service Fee use `service_fee=0`; new bookings still create Ticket Items with the 2,000 KRW fee.
- New booking finalization creates one Ticket Item per selected seat.
- Existing confirmed Reservations are migrated by creating one Ticket Item per existing `reservation_seats` row.
- Existing Reservation-level QR Credentials are transition-only compatibility artifacts; after backfill, each Ticket Item receives a seat-level QR Credential and buyer/scanner surfaces use seat-level QR only.
- Legacy Reservation-level QR Credentials must not process Venue Entry after the seat-level migration; scanner surfaces should reject them with guidance to open the seat-level QR Credentials from reservation detail.
- The migration assumes launch-prep or early-operation data can be cleaned up or backfilled; Grabit will not maintain a long-lived dual-mode scanner for both Reservation-level and Ticket Item-level QR Credentials.
- Seat-level QR, duplicate scan, partial cancellation, settlement export, and admin ticket item views read from `ticket_items`.
- `reservation_seats` should be removed after migration or kept only as a compatibility view during transition.

**Rollout Order**

1. Add `ticket_items` schema, backfill, and shared/API contracts.
2. Move QR issuance and verification to seat-level Ticket Items.
3. Switch scanner consume, duplicate detection, and offline sync to Ticket Item truth.
4. Update buyer booking complete and reservation detail to show seat-level QR lists.
5. Add Ticket Item Cancellation, cancellation fee calculation, and controlled reopen.
6. Update admin reservation detail, settlement, and exports to item-level rows.

Production booking stays closed during this integrated rollout. Booking enablement is reconsidered only after schema migration, QR issuance, scanner consume, duplicate detection, offline sync, buyer QR surfaces, Ticket Item Cancellation, controlled reopen, admin detail, settlement, and export smoke checks all pass together.

**Acceptance Gates**

1. Booking four seats creates four Ticket Items and four seat-level QR Credentials.
2. Buyer booking complete and reservation detail show four QR Credentials grouped by Seat Identity.
3. After the A-1 QR Credential is consumed, the A-2 QR Credential remains processable, and re-scanning A-1 returns Duplicate Scan.
4. Cancelling the A-3 Ticket Item changes only A-3 to controlled reopen (`held_cancelled` then `available`) while A-1, A-2, and A-4 remain valid according to their own Ticket Item Status and Admission State.
5. NOL Ticket-style cancellation fees and the 2,000 KRW Ticket Service Fee refund rule pass same-day, booking-date, show-date, cap, and percentage-flooring cases.
6. Admin reservation detail and settlement exports reconcile against Ticket Item rows.
