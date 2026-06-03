---
status: draft_evidence_artifact
last_updated: 2026-06-03
scope: Admin Pre-Open Booking Smoke on the real Girl Rules Performance
source_runbook: docs/runbooks/ticketing-open-evidence-gates-2026-06-03.md
decision_record: docs/adr/0005-use-admin-pre-open-booking-smoke-on-real-performance.md
---

# Ticketing Open Admin Pre-Open Smoke Evidence - 2026-06-03

This artifact records the execution result for Admin Pre-Open Booking Smoke on
the real Girl Rules Performance. It is not a public-open approval by itself.

## Scope

- Target Performance: Girl Rules, masked internal reference TBD.
- Performance posture before public sale: published and `오픈예정`.
- Authorized admin account: masked internal reference TBD.
- Ordinary Buyers must remain blocked until the Performance Sale Status changes
  to `오픈`.
- Evidence rows must link redacted screenshots, logs, provider artifacts, and
  admin artifacts. Screenshots alone are not a full evidence chain.
- Raw provider keys, payment keys, QR tokens, cookies, bearer tokens, OTP values,
  full phone numbers, full e-mail addresses, and full seat/order identifiers must
  not be pasted here.

## Runtime Snapshot

| Field | Value |
| --- | --- |
| Web revision / image | TBD |
| API revision / image | TBD |
| `bookingEnabled` runtime flag | TBD |
| Performance Publication | TBD |
| Performance Sale Status | TBD |
| Support route smoke | TBD |
| Operator / reviewer | TBD |
| Approved window | TBD |

## Production Payment Matrix

Primary source: buyer-visible production checkout UI and provider widget.
Cross-checks: API `allowedPaymentMethods` and provider admin settings.

| Payment path | Buyer-visible checkout/widget evidence | API allowed-method cross-check | Provider admin cross-check | Included in smoke? | Notes |
| --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD |

## Ordinary Buyer Block Evidence

Use a non-admin Buyer session. Prefer seat lock or another earliest-safe booking
mutation that cannot create a payment request.

| Timing | UI/CTA evidence | Blocked mutation evidence | Result | Notes |
| --- | --- | --- | --- | --- |
| Before first admin payment path | TBD | TBD | TBD | TBD |
| After final cleanup | TBD | TBD | TBD | TBD |

## Payment Path Evidence Rows

Fill one row per payment method or provider path. Run paths sequentially. Do not
start the next path until Smoke Booking Cleanup for the prior path is complete.

| Payment path | Provider path | Evidence row artifact | Checkout/widget evidence | Admin account | Test seat | Order/reservation ref | Provider approval | API confirm/finalization | Reservation/payment/ticket state | QR visibility | Cleanup action | Cleanup result | Reviewer decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | This row | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Stop / Failure Log

If any payment path fails, cleanup cannot restore sellable inventory, or ordinary
Buyer block evidence fails, stop the matrix and keep public sale blocked.

| Timestamp | Payment path | Failure | Immediate action | Owner decision | Follow-up |
| --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD |

## Final Reviewer Decision

| Field | Value |
| --- | --- |
| Status | TBD |
| Reviewer | TBD |
| Decision timestamp | TBD |
| Accepted payment paths | TBD |
| Waived payment paths, if any | TBD |
| Cleanup complete for all paths | TBD |
| Ordinary Buyer block verified before/after | TBD |
| Admin pre-open smoke gate accepted? | TBD |
| Final public open dependency | Overall gate ledger must still be `EVIDENCE_ACCEPTED` or explicitly `WAIVED`. |
| Notes | TBD |
