---
phase: 27-event-operations-settlement
status: human_needed
created: 2026-05-22
evidence_policy: direct_evidence_required
---

# Phase 27 Human UAT

Automated verification has completed, but physical event-day workflows require direct human evidence. Fill each row with redacted evidence before marking the phase complete. Do not paste raw QR tokens, JWT/JTI values, cookies, payment keys, OTP values, full emails, full phone numbers, unmasked IPs, raw customer rows, or provider credentials.

## Real phone-camera QR open

| Field | Value |
| --- | --- |
| Status | human_needed |
| Requirement | QR-02 |
| Required evidence | Scan a buyer QR from payment complete or My Page on a real phone, confirm it opens the HTTPS Grabit check-in URL, routes to login if needed, and returns to the intended ticket page. |
| Record | Device, browser, account class, event/showtime, timestamp, result, evidence path. |
| Current evidence | Pending maintainer/operator evidence. |

## Scanner-only permission rehearsal

| Field | Value |
| --- | --- |
| Status | human_needed |
| Requirement | QR-02, FIELD-01 |
| Required evidence | With a scanner-only account, verify check-in works and unrelated admin surfaces are denied. |
| Must deny | Full admin sidebar, refund, reservation management, user management, content, security, settlement, and raw export routes. |
| Record | Scanner account class, event/showtime, tested routes, timestamp, result, evidence path. |
| Current evidence | Pending maintainer/operator evidence. |

## Venue-like offline stale/recovered connectivity

| Field | Value |
| --- | --- |
| Status | human_needed |
| Requirement | QR-02, FIELD-01 |
| Required evidence | While authenticated as scanner staff, create a pending scan during stale connectivity, restore connectivity, sync it, and capture synced and rejected conflict states. |
| Record | Device/browser, device-local attempt ID, scanner account class, event/showtime, pending/synced/rejected result, timestamp, evidence path. |
| Current evidence | Pending maintainer/operator evidence. |

## External operational contacts

| Scenario | Status | Required owner/date/status evidence |
| --- | --- | --- |
| forced refund | human_needed | Payment provider owner, customer support owner, event owner, redacted case reference or explicit blocker. |
| weather | human_needed | Venue operations owner, production owner, public communications owner, redacted evidence path or explicit blocker. |
| facility | human_needed | Venue facility owner, security owner, accessibility support owner, redacted evidence path or explicit blocker. |
| cast issue | human_needed | Production owner, cast liaison owner, customer support owner, redacted evidence path or explicit blocker. |
| on-site refund | human_needed | On-site support owner, payment provider owner, venue desk owner, redacted evidence path or explicit blocker. |
| exchange | human_needed | Venue seating owner, customer support owner, finance owner if money movement occurs, redacted evidence path or explicit blocker. |

## Settlement operator review

| Field | Value |
| --- | --- |
| Status | human_needed |
| Requirement | POST-01 |
| Required evidence | Export entry status, no-show reservations, reservation/payment/refund summary, and settlement/accounting input CSVs; verify dashboard totals match source data. |
| Record | Reviewer, timestamp, filters, dataset evidence paths, source reconciliation result, export reason. |
| Current evidence | Pending finance/operator review. |

## Approval Log

| Reviewer | Timestamp | Decision | Evidence path | Notes |
| --- | --- | --- | --- | --- |
| Pending | Pending | human_needed | Pending | Awaiting manual evidence. |

## Resume Signal

Reply with `approved` plus evidence notes after the rows above are filled, or describe failures so the related rows remain `BLOCKED` or `human_needed`.
