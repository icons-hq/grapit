# Grabit Context

Grabit is a live-entertainment ticketing and event-operations platform. This glossary defines the domain language used across buyer booking, venue entry, field operations, and settlement conversations.

## Language

**Buyer**:
A person who discovers a performance, books seats, pays, and owns the resulting reservation and QR credential.
_Avoid_: Customer, fan, user when referring to the booking actor.

**Reservation**:
A buyer's confirmed claim to attend a specific showtime with one or more selected seats.
_Avoid_: Order, purchase, ticket when referring to the booking record.

**Ticket Item**:
A seat-level entitlement within a Reservation. A Reservation can contain one or more Ticket Items, and each Ticket Item has its own QR Credential and admission progress.
_Avoid_: Reservation, seat label, QR credential.

**Ticket Item Status**:
The validity state of a Ticket Item, such as active, cancelled, or expired. It is separate from whether venue entry has been processed.
_Avoid_: Admission State, QR Credential status.

**Seat Identity**:
The human-readable seat identity attached to a Ticket Item, such as floor, section, row, and number. It is the primary identity shown to Field Scanner Staff for a seat-level QR Credential.
_Avoid_: Reservation number, QR token, generic seat list.

**QR Credential**:
A buyer-visible credential tied to one Ticket Item that can be scanned to verify entitlement. It remains distinct from whether venue entry has already been processed.
_Avoid_: One-time QR, disposable ticket, entry status.

**QR Credential Status**:
The lifecycle state of the QR Credential itself, such as active, revoked, expired, or rotated. Buyer and scanner eligibility is primarily determined from Ticket Item Status plus Admission State.
_Avoid_: Ticket Item Status, Admission State.

**QR Rotation**:
The replacement of a Ticket Item's active QR Credential with a new one, making the previous QR Credential invalid for scanning.
_Avoid_: Ticket transfer, duplicate scan.

**Reservation Owner**:
The buyer account that created and paid for a Reservation. The Reservation Owner can view all QR Credentials for the Reservation's Ticket Items.
_Avoid_: Ticket holder, transferred attendee.

**Ticket Transfer**:
A product capability that lets a buyer assign or send a Ticket Item to another attendee outside the buyer's own reservation detail.
_Avoid_: QR display, screenshot, seat-level QR list.

**Venue Entry**:
The operational act of admitting one or more Ticket Items at the venue for a showtime.
_Avoid_: QR validation, ticket display.

**Admission State**:
The state that describes whether venue entry has been processed for a Ticket Item.
_Avoid_: QR status, credential validity.

**Duplicate Scan**:
A repeated scan of a Ticket Item whose Venue Entry has already been processed.
_Avoid_: Same-reservation scan, same-buyer scan.

**Ticket Item Cancellation**:
The cancellation of exactly one Ticket Item within a Reservation while the remaining Ticket Items can stay valid for venue entry.
_Avoid_: Reservation cancellation, full refund.

**Partially Cancelled Reservation**:
A Reservation that remains confirmed while one or more of its Ticket Items have been cancelled.
_Avoid_: Cancelled Reservation, failed reservation.

**Cancelled Reservation**:
A Reservation with no remaining valid Ticket Items after cancellation.
_Avoid_: Partially Cancelled Reservation, failed reservation.

**Original Payment Amount**:
The total amount captured in the original payment transaction for a Reservation. It remains unchanged after Ticket Item Cancellation; refund and fee effects are shown in cancellation history.
_Avoid_: Remaining ticket amount, active ticket total.

**Cancellation History**:
The per-Ticket Item record of cancellation amount, cancellation fee, refunded Ticket Service Fee, and refund result for a Reservation.
_Avoid_: Adjusted payment amount, overwritten total.

**Cancelled Ticket Item Reopen**:
The controlled release of a cancelled Ticket Item's Seat Identity back into sellable inventory while other Ticket Items in the Reservation remain sold.
_Avoid_: Immediate resale, full reservation reopen, all-seat release.

**Ticket Service Fee**:
A fixed 2,000 KRW booking fee charged for each booked Ticket Item. Its refundability follows the Cancellation Fee Schedule.
_Avoid_: Order fee, payment fee, platform total fee.

**Reservation Payable Amount**:
The KRW amount a Buyer owes for a Reservation before provider-specific charging. It is derived from Ticket Item prices plus Ticket Service Fees.
_Avoid_: PayPal amount, provider amount, display estimate.

**Provider Charge Amount**:
The amount submitted to and validated against the payment provider for a Reservation payment, expressed in that provider's required currency. It can match the Reservation Payable Amount for domestic payments, but can be a distinct foreign-currency amount for PayPal.
_Avoid_: Reservation total, KRW ticket total, client estimate.

**Provider Charge Quote**:
A snapshot of the Provider Charge Amount that the Buyer is asked to pay for a Reservation. It preserves the provider currency and amount used for payment authorization and validation.
_Avoid_: Live exchange rate, UI estimate, mutable display price.

**Production Payment Matrix**:
The set of payment methods and provider paths that Buyers can actually see and use in the production checkout for a Performance. It is defined by the buyer-visible checkout UI and provider widget, while API allowed methods and provider admin settings are cross-checks rather than the primary source.
_Avoid_: Code-supported payment list, test-only method list, provider wishlist.

**Launch Evidence Approval**:
The owner or reviewer decision that required public-open checks have accepted evidence or an explicit Evidence Waiver before real buyers are allowed to book.
_Avoid_: Code fix, deploy success, runtime health.

**Evidence Waiver**:
An owner-approved decision to proceed despite missing or incomplete launch evidence, with the operational risk accepted rather than treated as proven.
_Avoid_: PASS, verified evidence, silent exception.

**Sitewide Booking Gate**:
A platform-wide launch control that keeps buyer booking closed across performances until Launch Evidence Approval is in place. It is separate from whether a specific Performance is publicly visible or sale-open.
_Avoid_: Performance Sale Status, Performance Publication, public catalog visibility.

**Performance Publication**:
The operator decision that makes a Performance visible on public buyer surfaces. It does not by itself make seats bookable.
_Avoid_: Performance Sale Status, Sitewide Booking Gate, ticketing open.

**Performance Sale Status**:
The operator-owned sale state of a Performance, such as upcoming, open, closing soon, or ended. A Performance must be published, pass the Sitewide Booking Gate, and be in an open sale state before real buyers can book it.
_Avoid_: Performance Publication, Launch Evidence Approval, public open approval.

**Published Upcoming Performance**:
A Performance that is visible to Buyers before sales begin because it has Performance Publication but its Performance Sale Status is still upcoming. Buyers can discover and read it, but they cannot book it until the Sitewide Booking Gate is open and the Performance Sale Status changes to open.
_Avoid_: Hidden draft, public open, ticketing open.

**Admin Pre-Open Booking Smoke**:
A controlled booking and payment run by an authorized admin against a Published Upcoming Performance before Buyer sales open. It proves the real booking path across the Production Payment Matrix while ordinary Buyers remain blocked.
_Avoid_: Public open, buyer sale, sandbox-only test, single-method-only smoke.

**Admin Booking Bypass**:
A limited operator permission for Admin Pre-Open Booking Smoke that lets an authorized admin book while Buyers are still blocked by the Sitewide Booking Gate or Performance Sale Status. It is not buyer access and is not evidence that public sales are open.
_Avoid_: Public booking access, launch approval, general buyer bypass.

**Smoke Booking Cleanup**:
The immediate cancellation, refund, and verified inventory restoration step after an Admin Pre-Open Booking Smoke. If normal cancellation does not return the Seat Identity to sellable inventory, the cleanup uses a controlled reopen path so real Performance inventory, settlement, and entry data stay clean.
_Avoid_: Optional cleanup, manual note, leaving a paid test reservation.

**Cancellation Fee Schedule**:
A NOL Ticket-style per-Ticket Item fee schedule that determines cancellation fees by cancellation timing. Same-day booking cancellation before 24:00 KST is the first-priority exception; otherwise show-date rules take priority over booking-date rules, and fee percentages apply to Ticket Item price only.
_Avoid_: Flat refund penalty, Reservation-level cancellation fee.

**Cancellation Window**:
The period before the show date when a buyer can cancel a Reservation or Ticket Item under the event's policy. It does not include the show date, and scanned QR Credentials are outside buyer cancellation eligibility.
_Avoid_: Entry window, refund processing period.

**Field Scanner Staff**:
A staff member authorized to verify QR credentials and process venue entry at the event site.
_Avoid_: Admin, operator, buyer.

**Scanner Capability**:
A limited authority granted to Field Scanner Staff for venue-entry work only. It is separate from finance, security, event-management, and broad admin authority.
_Avoid_: Admin access, full operator access.

**Field Check-In**:
The staff-facing workflow where a QR credential is verified, ticket context is reviewed, and venue entry is manually confirmed.
_Avoid_: Automatic entry, QR open.

**Offline Pending Scan**:
A scan attempt captured locally after staff review when the field device cannot complete server processing, awaiting later server-authoritative sync.
_Avoid_: Successful entry, local admission proof.

**Field Monitor**:
An operations view focused on entry progress, rejection patterns, duplicate attempts, and offline backlog during an event.
_Avoid_: Raw scan log, settlement report.

**Admin Ticket Item View**:
An operator-facing view of Ticket Items inside a Reservation, including seat identity, validity, admission, QR credential, cancellation, refund, and reopen state.
_Avoid_: Reservation-only booking detail.

**Settlement Dataset**:
A finance-facing export or summary used after booking and entry operations to reconcile Ticket Items, payments, refunds, entry state, and no-shows for an event, with optional showtime or date-range drilldown. Summary views can group by Reservation, but export rows use Ticket Item as the atomic unit.
_Avoid_: Dashboard, analytics, showtime-only report.

## Example Dialogue

Dev: "Should scanning the QR Credential automatically complete Venue Entry?"

Domain expert: "No. Field Scanner Staff must review the reservation context and confirm Field Check-In manually. Opening the QR Credential only verifies entitlement."

Dev: "If a Ticket Item has already entered, should its QR disappear from Reservation detail?"

Domain expert: "No. Keep the QR Credential visible and show Admission State separately for that Ticket Item."

Dev: "If a Reservation has three seats and one attendee arrives first, should the whole Reservation be entered?"

Domain expert: "No. Each Ticket Item has its own QR Credential. Process Venue Entry only for the scanned Ticket Item."

Dev: "If another Ticket Item in the same Reservation already entered, is this scan a duplicate?"

Domain expert: "No. Duplicate Scan is determined per Ticket Item, not per Reservation."

Dev: "What should Field Scanner Staff see first after scanning a seat-level QR Credential?"

Domain expert: "Show the Seat Identity first, because the scan applies to that Ticket Item only. Keep the Reservation number as secondary context."

Dev: "How should buyer screens show multiple QR Credentials?"

Domain expert: "Use Ticket Item cards with Seat Identity first, and show each Ticket Item's QR Credential in its card."

Dev: "If one attendee cannot come, must the buyer cancel the whole Reservation?"

Domain expert: "No. Use Ticket Item Cancellation so the buyer can cancel that Ticket Item while the remaining Ticket Items stay valid."

Dev: "Does showing each QR Credential mean Grabit supports Ticket Transfer?"

Domain expert: "No. The buyer can see all QR Credentials in their reservation detail, but Ticket Transfer is a separate product capability."

Dev: "If a Reservation has four Ticket Items, who receives the QR Credentials?"

Domain expert: "Send and show all four QR Credentials to the Reservation Owner."

Dev: "Can Offline Pending Scans count as final admitted attendees?"

Domain expert: "No. They only become final after server-authoritative sync."

Dev: "If launch evidence is approved and the sitewide booking gate is open, can buyers book a published Performance that is still upcoming?"

Domain expert: "No. Performance Publication only exposes the Performance. Buyer booking starts only when its Performance Sale Status is open."

Dev: "Should a Performance be hidden before the sale moment?"

Domain expert: "No. Use a Published Upcoming Performance when Buyers should see the page before ticketing opens."

Dev: "Can an admin run a real payment test on a Published Upcoming Performance before Buyers can book?"

Domain expert: "Yes, but only as an Admin Pre-Open Booking Smoke through Admin Booking Bypass. Buyers must still be blocked until the sale status changes to open."

Dev: "Should Admin Pre-Open Booking Smoke test only domestic card payment?"

Domain expert: "No. It should cover the Production Payment Matrix so pre-open evidence matches what Buyers will see at launch."

Dev: "Can the paid admin smoke booking remain in the real Performance?"

Domain expert: "No. Complete Smoke Booking Cleanup immediately. The cleanup is done only when the seat is verified as sellable again, even if that requires controlled reopen."

Dev: "Does changing a Performance Sale Status to open approve the whole public launch?"

Domain expert: "No. It is the final performance-level switch after Launch Evidence Approval and the Sitewide Booking Gate."

Dev: "If the owner approves launch without running every drill, should those gates be marked as passed?"

Domain expert: "No. Mark them as Evidence Waivers so future operators can see the difference between proven evidence and accepted risk."
