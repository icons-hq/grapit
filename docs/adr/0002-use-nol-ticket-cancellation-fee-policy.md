# Use NOL Ticket cancellation fee policy for ticket items

Grabit applies a NOL Ticket-style cancellation policy per Ticket Item. Each Ticket Item has a 2,000 KRW Ticket Service Fee, and cancellation fees are computed per ticket even when the Buyer cancels the whole Reservation. Same-day booking cancellation before 24:00 KST is the first-priority special case; otherwise show-date rules take priority over booking-date rules.

**Policy**

| Cancellation timing | Cancellation fee |
| --- | --- |
| Booking day before 24:00 KST, within the cancellation window | No cancellation fee, and the Ticket Service Fee is refunded |
| Within 7 days after booking | None |
| 8 days after booking through 10 days before show date | `min(4,000 KRW, Ticket Item price * 10%)` |
| 9 to 7 days before show date | 10% of the ticket price |
| 6 to 3 days before show date | 20% of the ticket price |
| 2 to 1 days before show date | 30% of the ticket price |

**Consequences**

- Cancellation and refund calculations must operate per Ticket Item.
- Buyer-facing cancellation remains Full Reservation Cancellation; Ticket Item Cancellation is not exposed as a buyer self-service flow.
- If a confirmed Reservation reaches Full Reservation Cancellation without Ticket Items, Grabit should automatically create the missing Ticket Items from the existing reservation seat and payment records before calculating the refund.
- Historical cancelled or failed Reservations are not backfilled by the buyer cancellation flow.
- Buyer cancellation confirmation must show a Cancellation Quote with the original payment amount, cancellation fees, Ticket Service Fee refundability, and final refundable amount.
- Per-Ticket Item quote amounts are stored on the Ticket Item cancellation fields, while Reservation-level quote summary is stored with the Refund request metadata so retries and webhook reconciliation have a stable anchor.
- Cancellation preview is advisory. Cancellation confirmation recalculates the authoritative request-time quote and stores that quote before provider cancellation.
- Cancellation Quote values are fixed at request time. Provider retries, asynchronous completion, and webhook reconciliation must reuse the stored quote instead of recalculating against a later date.
- When Full Reservation Cancellation leaves any policy-retained captured balance, the Reservation and target Ticket Items become cancelled while the payment record preserves Provider Partial Cancellation semantics instead of being treated as a full payment cancellation.
- Local payment status must represent `PARTIAL_CANCELED` when the provider leaves any captured balance after Full Reservation Cancellation. Full-refund cancellations keep the normal `CANCELED` payment status.
- Admin cancellation defaults to the same per-Ticket Item fee policy as buyer cancellation.
- The same-day booking cancellation exception applies to default admin cancellation as well as buyer cancellation.
- Admins can use a separate Administrative Full Refund Override for cases such as company fault or show cancellation; this must be explicit rather than the default admin refund behavior.
- Administrative Full Refund Override changes refund economics only; cancelled seats still follow the normal delayed reopen policy.
- Buyer cancellation and default admin cancellation do not apply to Ticket Items whose Venue Entry has already been processed.
- Admins can use a separate Administrative Entered Ticket Cancellation Override for controlled test cleanup or exceptional operations cases; this must be explicit and never buyer-facing.
- Administrative Entered Ticket Cancellation Override bypasses entered-ticket eligibility only. It does not imply Administrative Full Refund Override, and both overrides must be selected explicitly when both are needed.
- The Ticket Service Fee is not an order-level fee.
- Same-day booking cancellation before 24:00 KST is the only case currently defined to refund the Ticket Service Fee.
- Buyer cancellation is not allowed on the show date; the Cancellation Window ends no later than 23:59 KST on the day before the show date.
- Reservation `cancel_deadline` remains the stored API/UI contract, but new and corrected confirmed Reservations must store the Cancellation Window end instead of a rolling `showtime - 24h` deadline.
- A migration should correct existing `CONFIRMED` and still-in-payment `PENDING_PAYMENT` Reservation cancellation deadlines to the Cancellation Window end; historical `CANCELLED` and `FAILED` Reservations are not corrected by this policy migration.
- When a booking-date rule and a show-date rule both match, the show-date rule applies.
- Cancellation fee percentages and caps apply only to Ticket Item price, not to the Ticket Service Fee.
- Percentage cancellation fees are floored to integer KRW.
- Cancellation fees retained after refund are Cancellation Fee Revenue and must remain explainable per Ticket Item for settlement and support.
- For non-KRW provider charges, Full Reservation Cancellation uses the existing provider-currency partial cancellation allocation pattern. Cancellation Quotes remain KRW-facing, while provider cancel amounts are computed internally from the original provider charge snapshot.
- This policy is an end-to-end cancellation contract across API calculation, stored quote, provider cancellation, buyer UI, admin UI, shared schemas, settlement support, and tests; partial implementation is not acceptable.
- Reservation payment surfaces preserve the Original Payment Amount and show per-Ticket Item cancellation and refund effects in Cancellation History.
- Settlement exports use Ticket Item as the atomic row unit, while event-level summaries may group Ticket Items by Reservation or showtime.
