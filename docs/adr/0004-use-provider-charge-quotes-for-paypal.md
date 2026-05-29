# Use provider charge quotes for PayPal

Grabit keeps the Reservation Payable Amount as the KRW ticketing truth and introduces a backend-owned Provider Charge Quote for PayPal instead of treating the current KRW total as a USD amount. Domestic payments can keep matching the Reservation Payable Amount, while PayPal uses a USD Provider Charge Amount that is quoted during reservation preparation, stored as a snapshot, and validated during Toss confirmation. This preserves existing refund, settlement, and admin assumptions around KRW reservation totals while making the PayPal provider contract explicit.

**Consequences**

- `reservations.total_amount` and existing KRW-facing settlement/refund logic remain the Reservation Payable Amount.
- PayPal checkout is enabled only when backend quote configuration is valid and an explicit server flag permits it.
- If PayPal checkout is enabled but quote configuration is invalid, the API should fail startup rather than silently degrade at runtime.
- Provider Charge Amounts are stored and compared internally as minor-unit integers, then converted to provider-required decimals only at the Toss SDK/API boundary.
- PayPal uses Toss foreign easy pay semantics with `provider=PAYPAL`, but follows the synchronous `successUrl` and confirm API flow rather than the asynchronous `pendingUrl` webhook flow used by some other foreign wallets.
- PayPal risk payloads describe the Ticket Items being sold and use backend user account snapshots for available transaction context; Grabit does not invent shipping details for ticket entitlements.
