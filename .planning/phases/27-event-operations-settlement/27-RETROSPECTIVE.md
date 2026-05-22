---
phase: 27-event-operations-settlement
status: pending_manual_event_evidence
source_requirements:
  - OPS-03
  - POST-02
evidence_policy: direct_evidence_required
---

# Phase 27 Retrospective

This artifact records Phase 27 retrospective evidence for the 2026-07-04 event-day operations loop. Automated product evidence is linked below. Physical phone-camera, scanner-only rehearsal, venue-like offline, external contact, and settlement operator evidence remains `human_needed` until the maintainer supplies redacted evidence paths.

Admin retrospective management UI is out of scope per D-32/D-34. This markdown artifact is the Phase 27 retrospective surface unless a later phase introduces a repeated-event operations product need.

## Operator Rules

- Evidence must be redacted before it is committed.
- Do not store raw QR tokens, raw JWT/JTI values, authorization headers, cookies, Toss or provider payment keys, OTP values, full emails, full phone numbers, unmasked IPs, raw customer rows, or provider credentials.
- Direct evidence paths are required before any event-day result can receive an affirmative classification.
- Accepted risk and narrative-only notes are not successful launch evidence.

## Incidents

| Incident ID | Scenario | Owner | Evidence path | Result | Carry-forward |
| --- | --- | --- | --- | --- | --- |
| Pending manual evidence | forced refund / weather / facility / cast issue / on-site refund / exchange | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | human_needed | pending operator review |

Required evidence:
- Incident timeline with redacted event/showtime scope.
- Console action route or admin surface used.
- External contact owner/date/status.
- Close-entry and escalation decisions.

## Non-incidents

| Watch area | Owner | Evidence path | Result | Notes |
| --- | --- | --- | --- | --- |
| Field check-in normal flow | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | human_needed | Record if no incident occurred. |
| Duplicate/tamper/refunded-ticket rejection | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | human_needed | Record scanner rejection evidence. |
| Weather/facility/cast monitoring | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | human_needed | Record non-incident watch evidence. |

Required evidence:
- Watch timestamp, scope, source, and redacted summary.
- Evidence path proving the watch occurred.

## Improvements

| Improvement | Source | Owner | Evidence path | Next action |
| --- | --- | --- | --- | --- |
| Pending operator retrospective | Event-day operations review | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Fill after event-day evidence review. |

Required evidence:
- The event-day observation that triggered the improvement.
- Impact on QR scanning, field monitor, settlement, customer support, or runbook quality.

## Next-event carry-forward

| Carry-forward item | Reason | Owner | Evidence path | Target phase |
| --- | --- | --- | --- | --- |
| Pending manual evidence classification | Physical event-day checks are not yet supplied. | Maintainer | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Decide after manual checkpoint. |

Required evidence:
- Why the item was not handled in Phase 27.
- Whether it is product work, operations work, security hardening, or external-provider coordination.

## Field scan evidence

| Evidence row | Owner | Evidence path | Required proof | Result |
| --- | --- | --- | --- | --- |
| Automated buyer QR and scanner path | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | QR image, scanner route, manual consume, duplicate rejection, and no raw token UI assertions. | automated_green |
| Phone-camera QR open | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Buyer QR opens HTTPS check-in URL and returns after login if needed. | human_needed |
| Scanner-only admission | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Scanner can verify and manually process entry without full admin surfaces. | human_needed |
| Duplicate scan rejection | Codex automated verification plus operator rehearsal | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md`; `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Automated duplicate rejection is covered in the verification artifact; physical scanner evidence still pending. | human_needed |
| Tampered/refunded/expired rejection | Codex automated verification plus operator rehearsal | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md`; `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Automated invalid-state rejection is covered in the verification artifact; physical scanner evidence still pending. | human_needed |

Required evidence:
- Duplicate scan evidence paths before field-scan completion is claimed.
- Redacted scanner account, device/browser, event/showtime, timestamp, and result.

## Offline sync evidence

| Evidence row | Owner | Evidence path | Required proof | Result |
| --- | --- | --- | --- | --- |
| Automated offline pending and sync path | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Offline pending store, sync endpoint, synced/rejected browser flows. | automated_green |
| Pending offline attempt | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Local attempt remains pending while network is unavailable. | human_needed |
| Recovered sync | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Server re-verifies pending attempt after connectivity returns. | human_needed |
| Rejected conflict | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Duplicate/tampered/refunded/expired conflict is rejected at sync. | human_needed |

Required evidence:
- Pending, synced, and rejected evidence paths.
- Device-local attempt ID and scanner account context in redacted form.
- No narrative-only successful result.

## Settlement evidence

| Evidence row | Owner | Evidence path | Required proof | Result |
| --- | --- | --- | --- | --- |
| Automated settlement API and UI | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Settlement summary/export API, dashboard, all D-29 datasets, scanner-only denial, safe CSV assertions. | automated_green |
| Entry status export | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Entry status dataset exists and is redacted. | human_needed |
| No-show reservation list | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | No-show list reconciles with field scan totals. | human_needed |
| Reservation/payment/refund summary | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Summary reconciles with source reservation/payment/refund state. | human_needed |
| Accounting input data | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Export comes from safe CSV generation. | human_needed |

Required evidence:
- Export evidence from the settlement/export implementation.
- CSV safety proof for formula escaping and scanner-only denial.
- Reviewer/timestamp for operator acceptance.

## v2.0 completion evidence

| Evidence row | Owner | Evidence path | Required proof | Result |
| --- | --- | --- | --- | --- |
| QR-02 automated implementation | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Buyer QR, scanner verify/consume, duplicate rejection, and offline sync assertions are recorded. | automated_green |
| QR-02 physical closure | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Phone-camera and scanner-only evidence are present. | human_needed |
| FIELD-01 automated implementation | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Field monitor API/UI and offline counts assertions are recorded. | automated_green |
| FIELD-01 event-day closure | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Event-day field monitor and offline rehearsal evidence are present. | human_needed |
| OPS-03 playbook readiness | Codex automated verification | `docs/runbooks/phase27-event-day-playbooks.md`; `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Six scenario playbooks exist with external contact fields. | automated_green |
| OPS-03 operator closure | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | External contact rows are filled, approved not-applicable, or blocked with owner/date. | human_needed |
| POST-01 automated implementation | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-VERIFICATION.md` | Settlement/export API and UI assertions are recorded. | automated_green |
| POST-01 operator closure | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Settlement reviewer/timestamp and exported dataset evidence are present. | human_needed |
| POST-02 retrospective readiness | Codex automated verification | `.planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md`; `scripts/phase27/validate-retrospective.mjs` | Retrospective structure exists and validator passes. | automated_green |
| POST-02 final closure | Operator-supplied | `.planning/phases/27-event-operations-settlement/27-HUMAN-UAT.md` | Retrospective is filled with evidence-backed findings after manual checkpoint. | human_needed |

Required evidence:
- Requirement-by-requirement evidence path.
- Explicit carry-forward for any unresolved event-day issue.
- No successful completion claim without direct evidence path.
