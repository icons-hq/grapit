# Use NOL Ticket cancellation fee policy for ticket items

Grabit applies a NOL Ticket-style cancellation policy per Ticket Item. Each Ticket Item has a 2,000 KRW Ticket Service Fee, and Ticket Item Cancellation computes cancellation fees per ticket. Same-day booking cancellation before 24:00 KST is the first-priority special case; otherwise show-date rules take priority over booking-date rules.

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
- The Ticket Service Fee is not an order-level fee.
- Same-day booking cancellation before 24:00 KST is the only case currently defined to refund the Ticket Service Fee.
- Buyer cancellation is not allowed on the show date; the Cancellation Window ends no later than 23:59 KST on the day before the show date.
- When a booking-date rule and a show-date rule both match, the show-date rule applies.
- Cancellation fee percentages and caps apply only to Ticket Item price, not to the Ticket Service Fee.
- Percentage cancellation fees are floored to integer KRW.
- Reservation payment surfaces preserve the Original Payment Amount and show per-Ticket Item cancellation and refund effects in Cancellation History.
- Settlement exports use Ticket Item as the atomic row unit, while event-level summaries may group Ticket Items by Reservation or showtime.
