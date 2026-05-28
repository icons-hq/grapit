# Use seat-level QR credentials for ticket items

Grabit issues QR Credentials per Ticket Item, not per Reservation, because a buyer can pay for multiple seats while attendees may enter separately. We rejected a single Reservation-level QR with staff-selected seats at scan time because it makes QR sharing and partial entry harder to reason about at the venue, and it hides the real admission unit from the credential itself.

**Consequences**

- A Reservation can contain multiple Ticket Items.
- Each Ticket Item has its own QR Credential and Admission State.
- Ticket Item Status tracks validity such as active, cancelled, or expired; Admission State tracks not-entered versus entered.
- QR Credential Status remains separate for credential lifecycle concerns such as revocation, expiration, and rotation.
- A Ticket Item can have only one active QR Credential at a time; issuing a replacement QR Credential revokes or rotates the previous one, and buyer surfaces show only the latest active QR Credential.
- Each QR Credential must expose the Ticket Item's Seat Identity to buyer and scanner surfaces.
- QR Credential payloads identify the Ticket Item with `ticketItemId`, `reservationId`, `paymentId`, `showtimeId`, `seatIdentity`, `jti`, and `secretVersion`; scanner verification treats `ticketItemId + jti` and database state as authoritative.
- Buyer-facing booking complete and reservation detail surfaces show the QR Credentials for all Ticket Items in the Reservation.
- Buyer-facing QR lists are organized as Ticket Item cards with Seat Identity as the primary title and Reservation number as secondary context.
- Admin reservation detail surfaces show Ticket Item rows with Seat Identity, Ticket Item Status, Admission State, QR Credential Status, cancellation/refund summary, and reopen state.
- QR email reminders are sent to the Reservation Owner and include or link to all Ticket Item QR Credentials for the Reservation.
- Buyer-facing surfaces keep showing a Ticket Item's QR Credential after entry and display Admission State separately.
- Ticket Transfer is not part of this decision; assigning a Ticket Item to another attendee is a separate product capability.
- Venue Entry processes the scanned Ticket Item, not the whole Reservation.
- Duplicate Scan detection is per Ticket Item, not per Reservation.
- Partial cancellation keeps the Reservation confirmed and changes only the affected Ticket Item state.
- When the last valid Ticket Item in a Reservation is cancelled, the Reservation becomes cancelled.
- Cancelled Ticket Item Reopen releases only that Ticket Item's Seat Identity back into sellable inventory after a controlled hold period, not immediately at cancellation time.
