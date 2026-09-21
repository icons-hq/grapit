# Preserve prepared checkout across provider returns

A Prepared Checkout belongs to one Reservation and one Buyer Account. Its order ID, canonical seats, payment deadline, Checkout Payment Method and Provider Charge Quote survive full document navigation. The return page recovers this state from the authenticated API, including when no Payment exists yet. A fail URL is not evidence that a payment failed or can be cancelled.

We rejected generating another order after every SDK error: an ambiguous response or document remount can leave multiple unpaid orders and may obscure a late approval. We also rejected restoring only the order ID: the foreign payment tab then falls back to a domestic method, and a retry can cross provider accounts or currencies.

**Consequences**

- Reservation preparation stores `checkout_payment_method`. A Buyer can review a different method before Provider Handoff; the same order is updated with a new quote when needed.
- Provider Handoff means the server has validated the method and seat locks and has authorized opening that provider's checkout. `checkout_started_at` records this boundary, not proof of provider approval or of a browser actually opening.
- A conditional database update freezes the method after successful seat-lock validation. Concurrent method changes and handoff cannot both succeed with different method snapshots. Foreign minor-unit amounts remain server-owned.
- Before Provider Handoff, same-method retries reuse the order and quote. After handoff, the browser checks the result and does not open another provider request while that result is unknown. Handoff to another method requires resolving or ending the previous checkout; an untrusted return query cannot reset the method binding.
- A pending checkout with an unknown provider result cannot be abandoned or expired by a local timeout, including when no Payment callback exists. Provider `IN_PROGRESS`, `DONE`, and `PARTIAL_CANCELED` block pre-payment abandonment even after the local deadline. Confirmed orders direct the Buyer to their tickets.
- Changes use an additive, nullable migration. Existing members, original payment amounts, Ticket Items, QR Credentials and audit history remain unchanged. A legacy pending order with no method snapshot cannot enter a new provider checkout. Drain/resolve these orders before cutover; do not guess a provider or currency from the UI language.
- The browser saves the order ID in its address before sending the prepare request, so a committed order survives response loss. Protected checkout login also retains this address and locale.
- Browser recovery before handoff keeps the locale, presents the original method/quote, and restores the domestic or foreign widget. The installed SDK exposes no API to select an individual wallet; the Buyer explicitly selects the saved wallet inside that widget before retrying.
- The UI distinguishes checking, ready, confirmed, ended and lookup failure. Unknown state does not become a fresh payment or automatic cancellation. A server quote is visible before requesting foreign payment.

**Validation**

Use real PostgreSQL for pending-order recovery, owner isolation, stored quote/method, pre-handoff changes, concurrent handoff, immutable post-handoff method and failed seat-lock validation. Test unknown handoffs after deadline expiry against the abandonment API, prepare API and expiration worker. Use full-page remount tests with an empty booking store, an HTTP webhook acknowledgement test and actual browser/sandbox readback. A local test does not certify production cutover or the remaining external/device gates.

**Provider lookup limits**

The [widget-key API scope](https://docs.tosspayments.com/reference/using-api/api-keys) documents payment-key lookup and transaction lookup, but does not list order-ID lookup. `NOT_FOUND_MERCHANT` is not evidence of a missing payment. The [transaction API](https://docs.tosspayments.com/reference#거래-조회) can supply a payment key when a matching transaction exists; an empty/error result is not proof that an asynchronous payment is unpaid. Unresolved handoffs stay in status review with My tickets and support actions.
