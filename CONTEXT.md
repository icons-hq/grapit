# Grabit Context

Grabit is a live-entertainment ticketing and event-operations platform. This glossary defines the domain language used across buyer booking, venue entry, field operations, and settlement conversations.

## Language

**Buyer**:
A person who discovers a performance, books seats, pays, and owns the resulting reservation and QR credential.
_Avoid_: Customer, fan, user when referring to the booking actor.

**Buyer Account**:
The Grabit account that represents a Buyer inside the service and can own Reservations, QR Credentials, consents, and login links.
_Avoid_: Real-world person, social provider account, email address.

**Verified Buyer Identity**:
The buyer identity evidence Grabit uses when deciding whether a new login link belongs to an existing Buyer Account. Future social-login linking can use a newly verified phone number plus birth date when exactly one active Buyer Account matches; historical cleanup uses stricter evidence.
_Avoid_: Phone-only match, provider email match, automatic global merge.

**Social Login Link**:
The connection between one external social provider account and one Buyer Account. It proves a login route for the Buyer Account, not a replacement for the account's profile details; the provider email is only supporting evidence.
_Avoid_: Buyer Account, Reservation Owner, provider email.

**Identity Conflict**:
A state where identity evidence matches more than one active Buyer Account, so Grabit must not automatically link or merge accounts. It does not have to block the buyer's current login flow.
_Avoid_: Safe match, automatic merge candidate, login failure.

**Historical Account Merge**:
An operator-controlled repair that moves existing ownership records from a duplicate Buyer Account into the intended Buyer Account after explicit review and approval. It must preserve recovery evidence for the ownership records it changes.
_Avoid_: Future social-login linking, automatic signup, global deduplication.

**Safe Merge Group**:
A group of duplicate Buyer Accounts whose verified identity evidence matches and whose target Buyer Account is unambiguous enough for an operator-approved batch merge.
_Avoid_: Every duplicate group, identity conflict, best-effort merge.

**Manual Merge Allowlist**:
An operator-approved list of duplicate Buyer Accounts that may be merged even when they are not eligible for automatic safe-group merging.
_Avoid_: Automatic merge rule, broad production filter, informal approval.

**Merge Target Buyer Account**:
The Buyer Account that remains active after a Historical Account Merge and receives the merged ownership records and Social Login Links.
_Avoid_: New account, source account, arbitrary oldest account.

**Merge Recovery Record**:
The durable evidence of a Historical Account Merge, including which Buyer Accounts were merged and enough before-and-after ownership detail to support investigation or rollback.
_Avoid_: Informal backup note, application log, dry-run report.

**Reservation**:
A buyer's confirmed claim to attend a specific showtime with one or more selected seats.
_Avoid_: Order, purchase, ticket when referring to the booking record.

**Ticket Item**:
A seat-level entitlement within a Reservation. A Reservation can contain one or more Ticket Items, and each Ticket Item has its own QR Credential and admission progress.
_Avoid_: Reservation, seat label, QR credential.

**Ticket Benefit**:
A show-specific privilege or goods item that can be made available to Ticket Items.
_Avoid_: Reservation benefit, buyer benefit, ticket-level metadata.

**Ticket Benefit Identity**:
The stable system-generated identity used to track a Ticket Benefit across configuration changes, run records, exports, and rollback.
_Avoid_: Display name, operator-entered label.

**Ticket Benefit Display Copy**:
The localized name and short description used to show a Ticket Benefit to Buyers, Field Scanner Staff, and operators.
_Avoid_: Internal benefit code, CSV-only label.

**Benefit Configuration**:
The saved operator-defined benefit setup for one showtime, including Included Ticket Benefits, Limited Ticket Benefits, Ticket Benefit Display Copy, eligibility, quantities, selection priority, and mutual exclusion rules. Saving it makes it active immediately; Included Ticket Benefits apply immediately from the active Benefit Configuration until Benefit Result Lock, while Limited Ticket Benefits require a Benefit Run to create Benefit Assignments.
_Avoid_: Hardcoded benefit table, image-only benefit guide, ticket tier metadata.

**Benefit Configuration Change Record**:
The durable record of an operator change to Benefit Configuration, including what changed, who changed it, when it changed, and whether it affected Buyer-visible Included Ticket Benefits.
_Avoid_: Unsaved draft, informal admin note.

**Benefit Entitlement**:
A Ticket Item's usable right to one Ticket Benefit. Field Scanner Staff can verify and mark a Benefit Entitlement as used so the same Ticket Item cannot use that benefit again.
_Avoid_: Admission State, QR Credential, Benefit Assignment.

**Benefit Redemption**:
The online, QR-based field operation of marking one Benefit Entitlement as used for a Ticket Item. It is processed one Benefit Entitlement at a time, separate from Venue Entry, and does not change Admission State.
_Avoid_: Venue Entry, manual lookup, admission processing.

**Benefit Redemption Record**:
The durable record of a Benefit Redemption attempt, including the Benefit Entitlement, Ticket Item, scanner, timing, device attempt, redacted QR reference, and result.
_Avoid_: Raw QR token, informal staff note.

**Duplicate Benefit Redemption**:
A Benefit Redemption attempt for a Benefit Entitlement that has already been used.
_Avoid_: Duplicate Scan, Venue Entry duplicate.

**Benefit Result Lock**:
The point after any Benefit Redemption for a showtime when Benefit Configuration can no longer be changed and active Benefit Entitlements can no longer be changed by Included Ticket Benefit configuration edits, a new Live Benefit Run, or Benefit Rollback.
_Avoid_: Sale close, admission close, publish lock.

**Included Ticket Benefit**:
A Ticket Benefit that every eligible Ticket Item receives as a Benefit Entitlement through the active Benefit Configuration without individual random selection, including Ticket Items sold after a Live Benefit Run.
_Avoid_: Benefit Assignment, random benefit, winner benefit.

**Limited Ticket Benefit**:
A Ticket Benefit with a limited quantity that is assigned to selected Ticket Items. A Ticket Item can have at most one Limited Ticket Benefit in the active benefit result.
_Avoid_: Included Ticket Benefit, all-benefit, guaranteed benefit.

**Benefit Eligibility**:
The active Ticket Items in configured ticket tiers for a showtime that can receive a Ticket Benefit.
_Avoid_: Admission State, floor section, buyer segment, payment method.

**Benefit Quantity**:
The maximum number of Ticket Item-level Benefit Assignments a Limited Ticket Benefit can produce for eligible Ticket Items in a Benefit Run.
_Avoid_: Seat count, winner ratio, remaining inventory.

**Benefit Quantity Shortfall**:
The difference between a Limited Ticket Benefit's Benefit Quantity and the number of Benefit Entitlements actually produced when eligible Ticket Items are insufficient.
_Avoid_: Failed run, inventory error.

**Benefit Selection Priority**:
The operator-defined order for assigning Limited Ticket Benefits when the same Ticket Item is eligible for multiple limited benefits.
_Avoid_: Display order, benefit importance label.

**Benefit Assignment**:
A Benefit Entitlement that grants one Limited Ticket Benefit to a selected Ticket Item.
_Avoid_: Winner, draw result, seat status.

**Benefit Run**:
An operator-triggered process that evaluates eligible Ticket Items against a Benefit Configuration and produces Limited Ticket Benefit results for one showtime.
_Avoid_: Background lottery, automatic campaign.

**Live Benefit Run**:
A Benefit Run whose results replace the showtime's current Benefit Assignments, become attached to Ticket Items, and are visible to Buyers without a separate publish step.
_Avoid_: Test run, preview run.

**Live Benefit Run Confirmation**:
The operator confirmation step before a Live Benefit Run replaces the active Benefit Assignments for a showtime.
_Avoid_: Test run preview, passive save.

**Test Benefit Run**:
A Benefit Run that uses the same eligibility and selection rules as a Live Benefit Run but does not attach Benefit Assignments to Ticket Items. It can use the active Benefit Configuration or an unsaved configuration snapshot.
_Avoid_: Mock data, unrecorded preview.

**Benefit Run Record**:
The durable record of a Benefit Run's configuration snapshot, inputs, generated results, operator, timing, and whether the run was live or test. For a Test Benefit Run, the configuration snapshot can be unsaved.
_Avoid_: Temporary preview, audit note only.

**Benefit Run Evidence**:
The preserved information needed to explain and verify how a Benefit Run produced its results, including the Benefit Configuration as it existed when the run executed.
_Avoid_: Informal note, screenshot proof.

**Benefit Entitlement Export**:
A CSV export where each row represents one live or test Benefit Entitlement result and its Ticket Item, Buyer, run mode, attachment state, and redemption state.
_Avoid_: Buyer summary, reservation summary, benefit-only count.

**Benefit Configuration Export**:
A CSV export of Benefit Configuration and Benefit Configuration Change Records for operator review.
_Avoid_: Benefit Entitlement Export, run result export.

**Benefit Rollback**:
An operator action that restores Benefit Entitlements from a previous Live Benefit Run Record for the same showtime, excluding Ticket Items that are no longer active.
_Avoid_: Test run restore, re-run, manual edit.

**Benefit Rollback Confirmation**:
The operator confirmation step before Benefit Rollback replaces the active Benefit Assignments for a showtime with a previous live result.
_Avoid_: Test run review, passive restore.

**Mutually Exclusive Ticket Benefits**:
Ticket Benefits that cannot both be assigned as Benefit Assignments to the same Buyer across that Buyer's Ticket Items in the active result for a showtime. Once a Buyer receives one of the mutually exclusive benefits, that Buyer's other Ticket Items are excluded from the conflicting benefit.
_Avoid_: Duplicate benefit, same-seat exclusion.

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

**Operator-Assisted Ticket Item Cancellation**:
A Ticket Item Cancellation completed through operations or finance handling rather than the current buyer-facing cancellation flow.
_Avoid_: Customer partial cancellation, hidden buyer feature.

**Full Reservation Cancellation**:
The cancellation of all remaining valid Ticket Items in a Reservation as one buyer-facing cancellation event.
_Avoid_: Ticket Item Cancellation, partial cancellation.

**Cancellation Event Count**:
An admin metric that counts Full Reservation Cancellation as one event and Operator-Assisted Ticket Item Cancellation as one event per cancelled Ticket Item.
_Avoid_: Reservation status count, active ticket delta.

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

**Payment Failure Diagnostic**:
An admin-facing explanation of why a Reservation did not complete payment, assembled from provider evidence, webhook evidence, and Grabit's own payment lifecycle state.
_Avoid_: Raw Toss error dump, customer-facing failure copy, payment status.

**Payment Failure Bucket**:
A normalized admin analytics bucket that groups a failed or expired Reservation by operator actionability, such as local deadline expiry, provider expiry, provider abort, buyer pre-confirm cancellation, compensated cancel, or unreconciled provider expiry.
_Avoid_: Payment status, raw diagnostic code, customer-facing message.

**Unreconciled Provider Expiry**:
A Payment Failure Bucket for a Reservation that failed locally before a provider `EXPIRED` webhook could be fully reconciled into a normal payment row, most often because the provider webhook arrived late or required provider-state normalization.
_Avoid_: Local-only timeout, successful payment, refund-needed state.

**Payment Failure Contact Export**:
A contact export for buyers affected by payment failure, payment expiration, or cancellation, including safe diagnostic fields needed for operator follow-up.
_Avoid_: Raw payment export, webhook payload export, settlement dataset.

**Last Affected Reason**:
The latest safe operator-facing reason for why a Buyer appears in a Payment Failure Contact Export, while keeping payment failure diagnostics and cancellation reasons as separate evidence fields.
_Avoid_: Combined raw error, single source of truth for all failures, marketing copy.

**Current Marketing Consent**:
The Buyer's effective marketing contact permission at the time an operator export or follow-up decision is made.
_Avoid_: Reservation-time consent, historical consent audit row.

**Payment Method Attribution**:
An admin-facing payment method label with its evidence source, used when normal payment method storage is incomplete or missing.
_Avoid_: Hidden payment method, raw provider payload, unverifiable label.

**Daily Revenue Movement**:
The KST-day movement of booking revenue, separating newly completed Reservation revenue from negative cancellation revenue caused by completed refunds or provider cancellations.
_Avoid_: Active ticket total, lifetime sales, settlement payout.

**Daily Operations Summary**:
An admin dashboard summary of today's booking count, cancellation event count, gross booking revenue, negative cancellation revenue, and net revenue.
_Avoid_: Revenue trend chart, settlement report, lifetime performance summary.

**Negative Cancellation Revenue**:
The negative revenue movement caused by completed refunds or provider cancellations, based on the confirmed refunded amount rather than the cancelled Ticket Item's original sale amount.
_Avoid_: Cancelled ticket list price, cancellation fee, total cancelled reservation amount.

**Effective Average Ticket Amount**:
The average amount per currently valid sold Ticket Item, based on active Ticket Item revenue rather than the seat tier's list price.
_Avoid_: Seat tier price, face value, cancelled-seat average.

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
A staff member authorized to verify QR credentials, process venue entry, and redeem Benefit Entitlements at the event site.
_Avoid_: Admin, operator, buyer.

**Scanner Capability**:
A limited authority granted to Field Scanner Staff for field QR operations, including Venue Entry and Benefit Redemption. It is separate from finance, security, event-management, and broad admin authority.
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

Dev: "Where should showtime-specific benefit rules come from?"

Domain expert: "Use Benefit Configuration so operators can define Included Ticket Benefits, Limited Ticket Benefits, Ticket Benefit Display Copy, eligibility, quantities, priority, and mutual exclusion without hardcoding a benefit table."

Dev: "If an operator edits Benefit Configuration, should Buyer-visible benefits change immediately?"

Domain expert: "Included Ticket Benefits follow the active Benefit Configuration immediately until Benefit Result Lock. Limited Ticket Benefits only change through a Live Benefit Run or Benefit Rollback."

Dev: "Should Benefit Configuration edits be reviewable later?"

Domain expert: "Yes. Keep Benefit Configuration Change Records and provide Benefit Configuration Export so operators can review who changed the setup and what changed."

Dev: "Does Benefit Configuration need a separate publish step after saving?"

Domain expert: "No. Saving Benefit Configuration makes it active immediately, and the change is captured as a Benefit Configuration Change Record."

Dev: "Can operators test an unsaved Benefit Configuration?"

Domain expert: "Yes. A Test Benefit Run can use an unsaved configuration snapshot without changing active Benefit Configuration or Buyer-visible Included Ticket Benefits."

Dev: "Can a Test Benefit Run be promoted into active Benefit Configuration?"

Domain expert: "No. Test Benefit Runs are review records only; operators save Benefit Configuration through the configuration flow."

Dev: "Should Ticket Benefit names be hardcoded in one language?"

Domain expert: "No. Use Ticket Benefit Display Copy so benefit names and short descriptions can be localized for Buyers, Field Scanner Staff, and operators."

Dev: "Can operators change the internal identity of a Ticket Benefit?"

Domain expert: "No. Ticket Benefit Identity is system-generated and stable; operators edit Ticket Benefit Display Copy."

Dev: "If a Buyer books two seats, how many entries are eligible for random Ticket Benefits?"

Domain expert: "Two. Ticket Benefits are assigned to Ticket Items, so each booked seat-level entitlement is evaluated separately."

Dev: "Should a benefit that every VIP Ticket Item receives be stored as an individual Benefit Assignment?"

Domain expert: "No. Treat it as an Included Ticket Benefit. It still becomes a Benefit Entitlement for each eligible Ticket Item, but it is not a random Benefit Assignment."

Dev: "Can one Ticket Item have every Included Ticket Benefit and also one Limited Ticket Benefit?"

Domain expert: "Yes. Included Ticket Benefits all become Benefit Entitlements for eligible Ticket Items; the one-benefit limit applies only to Limited Ticket Benefits."

Dev: "Can a Limited Ticket Benefit apply to multiple ticket tiers with one shared quantity?"

Domain expert: "Yes. Benefit Eligibility defines the target ticket tiers, and Benefit Quantity defines the maximum assignments across those eligible Ticket Items."

Dev: "Can Benefit Eligibility target a seat floor or section?"

Domain expert: "No. Benefit Eligibility is ticket-tier based for now."

Dev: "Does Venue Entry remove a Ticket Item from Benefit Eligibility?"

Domain expert: "No. Benefit Eligibility is based on active Ticket Items in configured ticket tiers, not Admission State."

Dev: "Does Benefit Quantity count Buyers or Ticket Items?"

Domain expert: "Benefit Quantity counts Ticket Item-level Benefit Assignments, not distinct Buyers."

Dev: "If there are fewer eligible Ticket Items than the Benefit Quantity, should the run fail?"

Domain expert: "No. Assign all eligible Ticket Items and record the remaining count as a Benefit Quantity Shortfall."

Dev: "If one Ticket Item is eligible for multiple Limited Ticket Benefits, how is the one-benefit limit enforced?"

Domain expert: "Apply Benefit Selection Priority. Once a Ticket Item receives one Limited Ticket Benefit, it is removed from later limited-benefit selection in that active result."

Dev: "Can Field Scanner Staff check and mark an Included Ticket Benefit as used?"

Domain expert: "Yes. Included Ticket Benefits are Benefit Entitlements, so they must be visible and usable only once per Ticket Item."

Dev: "Does Venue Entry automatically mark Ticket Benefits as used?"

Domain expert: "No. Benefit Redemption is separate from Venue Entry, and Field Scanner Staff must mark each Benefit Entitlement as used explicitly."

Dev: "If a Ticket Item has several Benefit Entitlements, should staff redeem them all at once?"

Domain expert: "No. Benefit Redemption is handled one Benefit Entitlement at a time so each benefit has its own usage state."

Dev: "What evidence should Benefit Redemption keep?"

Domain expert: "Keep a Benefit Redemption Record for each attempt, but never store or export the raw QR token."

Dev: "If staff try to redeem the same Benefit Entitlement twice, is that a Duplicate Scan?"

Domain expert: "No. It is a Duplicate Benefit Redemption, and staff should see the previous redemption context."

Dev: "Does Benefit Redemption require a separate staff authority from Scanner Capability?"

Domain expert: "No. Field Scanner Staff use the same Scanner Capability for Venue Entry and Benefit Redemption."

Dev: "Can Field Scanner Staff redeem a benefit by searching a buyer name instead of scanning QR?"

Domain expert: "No. Benefit Redemption is QR-based; manual lookup redemption is a separate exception workflow."

Dev: "Can Benefit Redemption be queued offline like Offline Pending Scan?"

Domain expert: "No. Benefit Redemption requires online confirmation to prevent duplicate benefit use."

Dev: "Should a redeemed Benefit Entitlement disappear from the Buyer's ticket detail?"

Domain expert: "No. Keep it visible with its redemption state so Buyers and Field Scanner Staff can understand what happened."

Dev: "Should Buyers see their Benefit Entitlements before staff scan?"

Domain expert: "Yes. Buyer ticket detail shows Benefit Entitlements and redemption state; Field Scanner Staff see the same entitlement state with redemption actions."

Dev: "Should Benefit Assignments or Benefit Redemptions send outbound Buyer notifications?"

Domain expert: "No. Buyers can see Benefit Entitlements in ticket detail, but outbound notifications are a separate product decision."

Dev: "What is the row unit for a benefit CSV export?"

Domain expert: "Use Benefit Entitlement Export: one row per Benefit Entitlement, including included and limited benefits."

Dev: "Should Test Benefit Run exports use a different CSV structure from Live Benefit Run exports?"

Domain expert: "No. Use the same Benefit Entitlement Export row structure and distinguish test results by run mode and attachment state."

Dev: "Can operators replace or roll back benefit results after any benefit has been redeemed for that showtime?"

Domain expert: "No. Once Benefit Redemption starts for a showtime, Benefit Result Lock prevents Included Ticket Benefit configuration changes, new Live Benefit Runs, and Benefit Rollback from changing active Benefit Entitlements."

Dev: "Can operators save Benefit Configuration changes after Benefit Result Lock?"

Domain expert: "No. After Benefit Result Lock, operators can review and export benefit records, but cannot save Benefit Configuration changes for that showtime, including Ticket Benefit Display Copy edits."

Dev: "If a Ticket Item is sold after a Live Benefit Run, does it automatically receive a Limited Ticket Benefit?"

Domain expert: "No. It automatically receives eligible Included Ticket Benefits from the active Benefit Configuration, but Limited Ticket Benefits require a later Live Benefit Run before Benefit Result Lock."

Dev: "If a Ticket Item is cancelled, should its Benefit Entitlements disappear from history?"

Domain expert: "No. They stop being usable, but remain visible in operator records and exports as inactive Benefit Entitlements."

Dev: "If a cancelled Ticket Item had a Limited Ticket Benefit, should that benefit be automatically reassigned?"

Domain expert: "No. Keep the cancelled assignment inactive in records; operators can run a new Live Benefit Run before Benefit Result Lock if they want a new active result."

Dev: "Should operators be able to preview a random benefit result without changing buyer Ticket Items?"

Domain expert: "Yes. Use a Test Benefit Run, which records the same kind of result as a Live Benefit Run but does not create Benefit Assignments."

Dev: "Should a Benefit Run be explainable after it completes?"

Domain expert: "Yes. Keep Benefit Run Evidence so operators can verify the inputs and random selection used for that run. Live runs use a system-generated random seed, while test runs may use an operator-provided seed for repeatable preview."

Dev: "After a Live Benefit Run completes, should Buyers wait for a separate benefit publish step?"

Domain expert: "No. Live Benefit Run results become Benefit Assignments attached to Ticket Items and are Buyer-visible immediately."

Dev: "Should a Live Benefit Run require confirmation before it replaces current limited benefit results?"

Domain expert: "Yes. Use Live Benefit Run Confirmation because the new result immediately replaces Buyer-visible Benefit Assignments."

Dev: "Should random Ticket Benefits be run across a whole multi-show Performance?"

Domain expert: "No. Run them per showtime so each audience group is evaluated against its own Ticket Items."

Dev: "If more Ticket Items are sold after a Live Benefit Run and the operator runs benefits again, should earlier assignments be preserved?"

Domain expert: "No. A new Live Benefit Run replaces the active Benefit Assignments for that showtime while preserving the earlier run as a Benefit Run Record."

Dev: "Can an operator restore a previous live benefit result?"

Domain expert: "Yes. Use Benefit Rollback to restore Benefit Entitlements from a previous Live Benefit Run Record for the same showtime, but do not restore entitlements to Ticket Items that are no longer active."

Dev: "Should Benefit Rollback require confirmation?"

Domain expert: "Yes. Use Benefit Rollback Confirmation because rollback replaces the current Buyer-visible Benefit Assignments."

Dev: "Can a Test Benefit Run be used as a rollback source?"

Domain expert: "No. Test Benefit Run Records can be reviewed and exported, but only Live Benefit Run Records can be restored through Benefit Rollback."

Dev: "If one of a Buyer's Ticket Items receives a mutually exclusive Ticket Benefit, can another Ticket Item owned by the same Buyer receive the excluded benefit?"

Domain expert: "No. Mutual exclusion is scoped to the Buyer across that Buyer's Ticket Items in the active result for that showtime, regardless of which Ticket Item received the first mutually exclusive benefit."

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
