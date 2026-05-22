---
phase: 27-event-operations-settlement
status: completed_with_deferred_followup
created: 2026-05-22
evidence_policy: direct_evidence_required
---

# Phase 27 Human UAT

Automated verification and Computer Use rehearsal have completed for this execute session. Per maintainer instruction on 2026-05-22, the remaining physical/external launch evidence is recorded as deferred follow-up instead of blocking Phase 27 execute closure. Do not paste raw QR tokens, JWT/JTI values, cookies, payment keys, OTP values, full emails, full phone numbers, unmasked IPs, raw customer rows, or provider credentials.

## Real phone-camera QR open

| Field | Value |
| --- | --- |
| Status | deferred_followup |
| Requirement | QR-02 |
| Required evidence | Scan a buyer QR from payment complete or My Page on a real phone, confirm it opens the HTTPS Grabit check-in URL, routes to login if needed, and returns to the intended ticket page. |
| Record | Device, browser, account class, event/showtime, timestamp, result, evidence path. |
| Current evidence | Computer Use verified the browser check-in URL surface and mobile scanner layout with redacted local mocks in `.planning/debug/phase27-computer-use-human-uat.md`; physical phone-camera QR scan is deferred to later launch/manual testing. |

## Scanner-only permission rehearsal

| Field | Value |
| --- | --- |
| Status | computer_use_verified |
| Requirement | QR-02, FIELD-01 |
| Required evidence | With a scanner-only account, verify check-in works and unrelated admin surfaces are denied. |
| Must deny | Full admin sidebar, refund, reservation management, user management, content, security, settlement, and raw export routes. |
| Record | Scanner account class, event/showtime, tested routes, timestamp, result, evidence path. |
| Current evidence | `.planning/debug/phase27-computer-use-human-uat.md` records scanner-only mobile check-in, duplicate replay denial, and settlement export denial using redacted local sessions. |

## Venue-like offline stale/recovered connectivity

| Field | Value |
| --- | --- |
| Status | computer_use_verified |
| Requirement | QR-02, FIELD-01 |
| Required evidence | While authenticated as scanner staff, create a pending scan during stale connectivity, restore connectivity, sync it, and capture synced and rejected conflict states. |
| Record | Device/browser, device-local attempt ID, scanner account class, event/showtime, pending/synced/rejected result, timestamp, evidence path. |
| Current evidence | `.planning/debug/phase27-computer-use-human-uat.md` records pending, recovered synced, and rejected conflict states in Google Chrome for Testing using redacted local sessions. |

## External operational contacts

| Scenario | Status | Required owner/date/status evidence |
| --- | --- | --- |
| forced refund | deferred_followup | Payment provider owner, customer support owner, event owner, redacted case reference or explicit blocker. |
| weather | deferred_followup | Venue operations owner, production owner, public communications owner, redacted evidence path or explicit blocker. |
| facility | deferred_followup | Venue facility owner, security owner, accessibility support owner, redacted evidence path or explicit blocker. |
| cast issue | deferred_followup | Production owner, cast liaison owner, customer support owner, redacted evidence path or explicit blocker. |
| on-site refund | deferred_followup | On-site support owner, payment provider owner, venue desk owner, redacted evidence path or explicit blocker. |
| exchange | deferred_followup | Venue seating owner, customer support owner, finance owner if money movement occurs, redacted evidence path or explicit blocker. |

## Settlement operator review

| Field | Value |
| --- | --- |
| Status | computer_use_verified |
| Requirement | POST-01 |
| Required evidence | Export entry status, no-show reservations, reservation/payment/refund summary, and settlement/accounting input CSVs; verify dashboard totals match source data. |
| Record | Reviewer, timestamp, filters, dataset evidence paths, source reconciliation result, export reason. |
| Current evidence | `.planning/debug/phase27-computer-use-human-uat.md` records finance summary totals, export warning/filters/reason, completed CSV download, and scanner-only settlement denial using redacted local sessions. Real production/finance dataset sign-off is deferred to later launch/manual testing. |

## Approval Log

| Reviewer | Timestamp | Decision | Evidence path | Notes |
| --- | --- | --- | --- | --- |
| Codex Computer Use | 2026-05-22 | partial_auto_verified | `.planning/debug/phase27-computer-use-human-uat.md` | Scanner-only check-in/denial, offline pending/sync/rejected, and settlement UI/export rehearsal verified with redacted local mocks. Physical phone-camera scan and external operational contacts remain `human_needed`. |
| Maintainer | 2026-05-22 | execute_complete_defer_remaining | `.planning/phases/27-event-operations-settlement/27-16-SUMMARY.md` | Physical phone-camera scan, external operational contacts, and production/venue dataset sign-off are deferred to later launch/manual evidence instead of blocking this execute session. |

## Resume Signal

Later launch/manual testing should append redacted evidence notes for the deferred rows above, or mark any deferred row `BLOCKED` with owner/date/reason.
