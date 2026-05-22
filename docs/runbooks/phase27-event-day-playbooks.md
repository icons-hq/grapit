---
phase: 27-event-operations-settlement
status: active_runbook
last_updated: 2026-05-22
scope: OPS-03 event-day incident playbooks for field operations, refunds, cancellations, and exchange handling
---

# Phase 27 Event-Day Operations Playbook

## Purpose

This runbook defines the event-day operating contract for `OPS-03`. It covers
operator actions for forced refund, weather, facility, cast issue, on-site
refund, and exchange scenarios before live evidence is collected.

The runbook is an operating artifact, not an admin product surface. Operators
must record evidence in redacted artifacts and carry post-event findings into
`.planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md`.

## Capability Boundaries

| Capability scope | Allowed actions | Explicitly denied |
| --- | --- | --- |
| `scanner` | Verify QR tickets, submit manual entry, submit offline sync attempts, and write scan evidence for assigned event/showtime. | Refunds, exchanges, reservation management, user management, settlement export, raw audit export, security settings. |
| `finance` | Review settlement/export evidence and payment/refund totals when the route requires finance access. | Scanner check-in actions unless separately granted, security management. |
| `full-admin` | Operate refund, reservation, event, staff, contact, monitor, and settlement surfaces with audit reason. | Direct mutation without audit reason or evidence path. |

## Redaction Rules

Never paste raw QR tokens, raw JWT/JTI values, Toss payment keys, provider
payment keys, cookies, bearer tokens, OTP values, full emails, full phone
numbers, unmasked IPs, raw customer rows, or provider credentials into this
runbook, screenshots, commits, logs copied to docs, or retrospective evidence.

Evidence must use masked reservation IDs, masked order IDs, redacted provider
case IDs, artifact paths, timestamps, owner, and result classification.

## Evidence Fields

Every scenario entry must include these operator-supplied fields:

| Field | Required value |
| --- | --- |
| Incident ID | Operator-generated event-day incident ID. |
| Owner | Responsible operator or role. |
| Event/showtime scope | Redacted event/showtime identifier and seat/zone scope if relevant. |
| Console action | Route or admin surface used, with audit reason. |
| External contacts | Owner, contact role, date/time, status, and redacted provider/case reference. |
| Evidence path | Local artifact path such as `.planning/phases/27-event-operations-settlement/evidence/<incident-id>.json`. |
| Customer communication | Channel, timestamp, and masked audience segment. |
| Final state | `open`, `monitoring`, `closed`, or `carried-forward`. |

## Scenario: forced refund

| Item | Operating contract |
| --- | --- |
| Severity | High when payment reversal affects confirmed buyers; Critical if entry or settlement truth diverges. |
| Affected scope | Specific reservation, payment, seat group, showtime, or event-wide refund batch. |
| Console action | Full-admin uses `/admin/bookings` reservation detail refund action or refund dispute surface; finance reviews `/admin/settlement` totals when available. Scanner-only staff have no refund action. |
| External contacts | Operator-supplied fields: payment provider owner/date/status, customer support owner/date/status, event owner/date/status. |
| Evidence fields | Masked reservation/order ID, refund request reason, provider state class, local reservation/payment/ticket state, audit log ID, evidence path. |
| Close-entry trigger | Close or pause entry for the affected seat/reservation scope if refund state cannot be reconciled before the buyer reaches the scanner. |
| Escalation trigger | Escalate to full-admin and finance if provider refund succeeds while local ticket remains active, or if local refund succeeds while provider truth is unknown. |
| Redaction | Do not record raw payment keys, provider credentials, full buyer contact data, cookies, OTPs, unmasked IPs, or QR tokens. |

## Scenario: weather

| Item | Operating contract |
| --- | --- |
| Severity | Medium for advisory delays; High for showtime delay; Critical for cancellation or venue evacuation. |
| Affected scope | Event-wide or affected arrival window, entry gate, transport route, or showtime. |
| Console action | Full-admin updates notice/FAQ through `/admin/operations` or event content surfaces; field monitor is checked through `/admin/field-monitor` once implemented. Scanner-only staff continue check-in only while entry remains open. |
| External contacts | Operator-supplied fields: venue operations owner/date/status, production owner/date/status, public communications owner/date/status. |
| Evidence fields | Weather source summary, decision timestamp, public notice path, entry count snapshot, offline pending count, close-entry decision, evidence path. |
| Close-entry trigger | Close or pause entry when weather makes queueing, gate access, or venue movement unsafe. |
| Escalation trigger | Escalate to full-admin when entry rate drops abnormally, offline backlog grows, or public notice timing risks unsafe crowd movement. |
| Redaction | Do not paste provider credentials, full customer contacts, raw QR URLs, raw scanner logs, or unmasked IPs. |

## Scenario: facility

| Item | Operating contract |
| --- | --- |
| Severity | Medium for localized seat/gate issue; High for floor/zone closure; Critical for venue-wide safety issue. |
| Affected scope | Gate, floor, zone, seat block, accessibility path, restroom/concession route, or whole venue. |
| Console action | Full-admin uses `/admin/performances` event/venue notice controls and `/admin/bookings` seat/reservation lookup; scanner-only staff may only record scan outcome and entry notes for assigned scope. |
| External contacts | Operator-supplied fields: venue facility owner/date/status, security owner/date/status, accessibility support owner/date/status. |
| Evidence fields | Facility issue class, affected seat/zone scope, decision log path, entry monitor snapshot, manual seat operation audit ID, evidence path. |
| Close-entry trigger | Close entry for affected gate/zone when facility state makes admission unsafe or reservation truth cannot be honored. |
| Escalation trigger | Escalate to full-admin if seat disable/reactivate, manual open, exchange, or refund decisions become necessary. |
| Redaction | Do not record raw customer rows, full names, full phones, full emails, raw QR tokens, cookies, or security credentials. |

## Scenario: cast issue

| Item | Operating contract |
| --- | --- |
| Severity | Medium for schedule notice; High for material cast change; Critical if cancellation/refund policy is triggered. |
| Affected scope | Event, showtime, cast card, notice audience, refund-eligible reservation group. |
| Console action | Full-admin updates cast/event notice through `/admin/performances` and `/admin/operations`; refunds use `/admin/bookings` only when policy requires. Finance reviews `/admin/settlement` after refunds settle. |
| External contacts | Operator-supplied fields: production owner/date/status, artist/cast liaison owner/date/status, customer support owner/date/status. |
| Evidence fields | Cast decision timestamp, public notice path, refund/exchange policy reference, affected reservation segment, audit log ID, evidence path. |
| Close-entry trigger | Close or pause entry if the cast issue changes admission validity, refund policy, or showtime truth before operators can communicate the decision. |
| Escalation trigger | Escalate to full-admin and finance when refund/exchange volume affects settlement totals or public communication has not been acknowledged. |
| Redaction | Do not paste private cast contact data, full buyer contacts, payment keys, raw QR tokens, JWTs, cookies, OTPs, or unmasked IPs. |

## Scenario: on-site refund

| Item | Operating contract |
| --- | --- |
| Severity | Medium for single-buyer issue; High for repeated gate dispute; Critical if on-site refund conflicts with scanner/ticket truth. |
| Affected scope | Individual reservation, seat group, gate dispute queue, or support desk batch. |
| Console action | Full-admin handles reservation/refund review in `/admin/bookings`; scanner-only staff record scan rejection/duplicate status but cannot approve refund or view settlement export. |
| External contacts | Operator-supplied fields: on-site support owner/date/status, payment provider owner/date/status, venue desk owner/date/status. |
| Evidence fields | Masked reservation/order ID, scanner result class, refund reason, support desk note path, provider state class, audit log ID, evidence path. |
| Close-entry trigger | Pause entry for the affected ticket when scanner result, refund state, and support claim conflict. |
| Escalation trigger | Escalate to full-admin if duplicate scan, refunded ticket scan, or tampered QR appears; escalate to finance when provider and local refund truth diverge. |
| Redaction | Do not record full buyer identity, full phone/email, raw payment key, raw QR token, raw JTI, cookie, OTP, or unmasked IP. |

## Scenario: exchange

| Item | Operating contract |
| --- | --- |
| Severity | Medium for same-grade manual resolution; High when seat inventory or showtime truth changes; Critical if exchange creates oversell risk. |
| Affected scope | Reservation, seat group, grade, floor, showtime, or exchange-eligible policy group. |
| Console action | Full-admin uses `/admin/bookings` reservation operations and seat operation surfaces; finance reviews settlement impact through `/admin/settlement` when available. Scanner-only staff cannot alter seats or payment/refund state. |
| External contacts | Operator-supplied fields: venue seating owner/date/status, customer support owner/date/status, finance owner/date/status if money movement occurs. |
| Evidence fields | Original and target masked seat scope, policy reason, inventory state snapshot, reservation operation audit ID, customer communication path, evidence path. |
| Close-entry trigger | Close or pause entry for the affected ticket if exchange state is unresolved or could cause duplicate admission. |
| Escalation trigger | Escalate to full-admin if exchange touches sold/held/cancelled seats; escalate to finance if price/refund settlement changes. |
| Redaction | Do not paste raw customer rows, raw QR/JWT/JTI values, payment keys, cookies, OTPs, full emails, full phones, or unmasked IPs. |

## Close-Out

For every scenario, the operator must add a redacted evidence path and final
classification to `27-RETROSPECTIVE.md`. Narrative-only closure is insufficient
for event-day launch evidence.
