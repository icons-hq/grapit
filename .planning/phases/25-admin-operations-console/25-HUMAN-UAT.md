---
phase: 25-admin-operations-console
plan: "15"
status: human_uat_required_for_security_evidence
completed: 2026-05-14
accepted_risk: [D-08-admin-mfa]
---

# Phase 25 Human UAT

Use this checklist after automated verification. Do not convert these manual checks into PASS evidence unless the route was actually opened in a production-like environment and the evidence was reviewed. Do not paste raw CSV rows, secrets, tokens, raw OTP values, or full customer PII into this file.

## Setup

1. Log in as `admin@grapit.test`.
2. Keep live `BOOKING_ENABLED=true`, Toss live keys, canary, k6, DR, field QR, settlement, and event-day monitor out of this phase. Those remain Phase 26 or Phase 27 scope.
3. Record only metadata evidence: route, timestamp, masked actor/requester, action, reason, and observed status.

## `/admin/security`

Expected:

- The page shows the amber MFA accepted-risk copy: `MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.`
- Current request allowlist state is visible.
- Allowlist records are visible without exposing secrets.
- Denial or exception evidence is visible with masked IP/request metadata.

Result fields:

- `accepted_risk`: D-08 admin MFA remains deferred.
- `allowlist_policy_source`: pending human input.
- `denial_or_exception_evidence`: pending human input.

## `/admin/audit`

Expected:

- Audit rows show actor, action, reason/status, masked IP, and timestamp.
- Sensitive diffs are masked.
- No raw PII, raw CSV payload, secrets, tokens, or raw OTP values are visible.

Result fields:

- `masked_ip_visible`: pending human input.
- `sensitive_payload_masked`: pending human input.

## `/admin/operations`

Expected:

- SLA state, overdue state, escalation label, queue, assignee, and requester metadata are visible.
- Requester email/name/phone remain masked.
- Refund-dispute or high-risk support items are visibly escalated.

Result fields:

- `sla_and_escalation_visible`: pending human input.
- `requester_metadata_masked`: pending human input.

## `/admin/bookings`

Expected:

- CSV export requires all relevant filters and a reason before raw export confirmation.
- Cancelled-seat immediate opening requires a reason.
- Reservation detail does not leak unnecessary raw payment or customer data into audit evidence.

Result fields:

- `csv_reason_gate_visible`: pending human input.
- `manual_open_reason_gate_visible`: pending human input.

## `/admin/seat-operations`

Expected:

- Seat disable/reactivate requires showtime ID, seat key, and reason.
- Seat operation history shows previous status, next status, action, reason, actor metadata, and timestamp.
- Any broadcast behavior should be checked in Phase 26/27 production rehearsal, not treated as live-event proof here.

Result fields:

- `disable_reactivate_reason_gate_visible`: pending human input.
- `seat_history_visible`: pending human input.

## Phase Boundary Confirmation

- `BOOKING_ENABLED=true`: Phase 26.
- Toss live keys and live payment cutover: Phase 26.
- Canary, k6, DR, and first-24-hour monitor: Phase 26.
- Field QR scan, event-day entry operations, settlement export, and post-event retrospective: Phase 27.

Manual UAT status remains `human_needed` until a human records the production-like evidence above.
