# Use admin pre-open booking smoke on the real performance

Grabit uses Admin Pre-Open Booking Smoke on the real Girl Rules Performance before public sales open, rather than a separate test Performance, because the launch risk is in the production booking, payment, QR, inventory, and cleanup chain that Buyers will actually use. The Performance remains a Published Upcoming Performance, ordinary Buyers stay blocked by the Sitewide Booking Gate and Performance Sale Status, and only an authorized admin account can use Admin Booking Bypass for the smoke.

**Consequences**

- Admin Pre-Open Booking Smoke covers the full Production Payment Matrix visible to Buyers at launch, one method/provider path at a time.
- The Production Payment Matrix is determined from the production checkout UI and provider widget that Buyers actually see; API allowed methods and provider admin settings are cross-check evidence, not the primary source.
- Each payment path uses its own order, operator-selected low-risk seat, redacted evidence bundle, and immediate Smoke Booking Cleanup before the next path starts.
- Evidence is recorded as a Markdown row per payment path, with links to redacted screenshots, logs, provider artifacts, and admin artifacts. Screenshots alone are not accepted as the full evidence chain.
- Smoke Booking Cleanup is complete only after cancellation/refund evidence and verified sellable inventory restoration; if normal cleanup does not restore the seat, the admin controlled reopen path is used with a recorded reason and audit evidence.
- Ordinary Buyer block evidence is captured before the first admin payment path and after final cleanup, using buyer-facing UI state plus an earliest-safe blocked booking mutation such as seat lock.
- A failure in any payment path or cleanup step keeps public sale blocked until the cause is fixed or explicitly waived.
