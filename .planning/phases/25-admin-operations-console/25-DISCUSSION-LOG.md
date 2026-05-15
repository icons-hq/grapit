# Phase 25: Admin Operations Console - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 25-Admin Operations Console
**Areas discussed:** Event approval workflow, CS/Q&A/FAQ/notice operations, Admin security and audit policy, Seat operations and reservation exports

---

## Event Approval Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Separated gate | Operator drafts, reviewer/approver/finance permissions are action-level, and self-approval is blocked. | |
| Single approver | Operator writes, one approver approves publish. | |
| Audit-only admin | Existing admin can publish directly and the system keeps audit evidence. | yes |

**User's choice:** Audit-only admin.
**Notes:** User preferred a faster admin-led publish flow over separated approval roles.

| Option | Description | Selected |
|--------|-------------|----------|
| Full workflow | `draft -> review_requested -> changes_requested -> finance_review -> approved -> scheduled/published -> archived`. | |
| Simple workflow | `draft -> review -> published`. | |
| You decide | Planner chooses the minimum safe lifecycle. | yes |

**User's choice:** You decide.
**Notes:** Lifecycle detail is delegated to the planner.

| Option | Description | Selected |
|--------|-------------|----------|
| Risk fields | Locale content, price tiers, sale windows, payment methods, seat maps, and booking policy must be approved before publish. | |
| Content only | Only multilingual content and public display block publish. | |
| You decide | Planner chooses blocking fields from Phase 25 success criteria. | yes |

**User's choice:** You decide.
**Notes:** Publish checklist detail is delegated to the planner.

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm modal + audit | Show a publish summary modal, then write actor/action/before-after/status/changed fields/reason optional audit. | yes |
| Reason required | Require reason for publish and important updates. | |
| Silent audit only | No confirmation; system records audit automatically. | |

**User's choice:** Confirm modal + audit.
**Notes:** Publish remains fast but must be confirmable and traceable.

---

## CS/Q&A/FAQ/Notice Operations

| Option | Description | Selected |
|--------|-------------|----------|
| Unified operations inbox | Unanswered Q&A, CS tickets, refund disputes, and urgent notices appear in one SLA/priority-driven operations inbox. | yes |
| Separate modules | Q&A, FAQ, notices, and CS remain separate admin menus. | |
| You decide | Planner chooses based on current admin sidebar and implementation scope. | |

**User's choice:** Unified operations inbox.
**Notes:** Operations should be organized by work priority rather than by content type alone.

| Option | Description | Selected |
|--------|-------------|----------|
| ko/en manual + assisted th/zh | Operators manage Korean and English manually; Thai/Chinese use assisted translation with review state and translation-use indication. | yes |
| All locales manual | All five locales require manual entry/review. | |
| Korean source only | Korean is operated and fallback/translation is planner discretion. | |

**User's choice:** ko/en manual + assisted th/zh.
**Notes:** Aligns with Phase 23 translation/legal lock direction while keeping operations practical.

| Option | Description | Selected |
|--------|-------------|----------|
| 24h SLA dashboard | Show 24-hour countdown, overdue red highlight, and category escalation visibility. | yes |
| Simple status labels | Show only open/pending/resolved. | |
| You decide | Planner chooses minimum implementation. | |

**User's choice:** 24h SLA dashboard.
**Notes:** SLA must be visible enough for launch operations.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-priority rules | Payment error, unprocessed refund, suspected abuse, and signup failure start high priority/escalated. | yes |
| Manual escalation | Operator manually escalates tickets. | |
| You decide | Planner decides by category risk. | |

**User's choice:** Auto-priority rules.
**Notes:** High-risk operational categories should not rely only on manual triage.

---

## Admin Security And Audit Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Admin login required | Admin accounts require MFA setup and verification before `/admin` access. | |
| Sensitive actions only | Step-up MFA only for publish/refund/seat operation/export. | |
| You decide | Planner chooses based on implementation burden and security needs. | |
| No MFA as accepted risk | Do not implement MFA in Phase 25; document accepted risk. | yes |
| Lightweight step-up only | No admin login MFA, but require password/email OTP style re-check for high-risk actions. | |
| Keep requirement | Keep MFA requirement and planner designs minimum implementation. | |

**User's choice:** Do not implement MFA; document it for later.
**Notes:** User explicitly asked to leave MFA for later and record it in docs. This conflicts with `ADMIN-03`, so it must remain visible as accepted risk / deferred security item.

| Option | Description | Selected |
|--------|-------------|----------|
| Soft allowlist + override audit | Outside allowlist requires warning/step-up/override reason and audit. | |
| Hard block | Outside allowlist blocks all admin access. | |
| You decide | Planner chooses based on Cloud Run and operations reality. | yes |

**User's choice:** You decide.
**Notes:** IP allowlist implementation is delegated to planner.

| Option | Description | Selected |
|--------|-------------|----------|
| All sensitive actions | Event publish/update, refund, CS escalation, seat operation, export, permission/security changes all get immutable audit. | yes |
| Security + money only | Audit only refund/export/permission/login failures and similar finance/security events. | |
| You decide | Planner chooses audit taxonomy. | |

**User's choice:** All sensitive actions.
**Notes:** Audit coverage should be broad for operations.

| Option | Description | Selected |
|--------|-------------|----------|
| Masked diff | Store actor/action/resource/before-after changed fields/IP/userAgent/reason/status, masking PII/token/secret. | yes |
| Metadata only | Store actor/action/resource/time/status only. | |
| You decide | Planner balances storage and privacy risk. | |

**User's choice:** Masked diff.
**Notes:** Audit should support incident review without exposing sensitive values.

---

## Seat Operations And Reservation Exports

| Option | Description | Selected |
|--------|-------------|----------|
| Per-reservation + seat ops panel | Immediate open lives in reservation detail; disable/reactivate/history lives in a separate seat operations panel. | yes |
| Seat map admin console | Operators directly manipulate seats on the seat map. | |
| You decide | Planner chooses based on existing booking/admin UI. | |

**User's choice:** Per-reservation + seat ops panel.
**Notes:** Reservation-specific work and seat inventory work should be separated.

| Option | Description | Selected |
|--------|-------------|----------|
| Reason + confirm + audit | Seat disable/reactivate requires reason, confirmation modal, and masked audit record. | yes |
| Confirm only | Confirmation modal only; reason optional. | |
| You decide | Planner chooses by action risk. | |

**User's choice:** Reason + confirm + audit.
**Notes:** Seat state changes are revenue/capacity-impacting and need traceability.

| Option | Description | Selected |
|--------|-------------|----------|
| Full seven filters | event, tier, zone/floor, reservation status, domestic/overseas, payment method, date range. | yes |
| Core filters | event, status, payment method, date range. | |
| You decide | Planner chooses from spec and data model. | |

**User's choice:** Full seven filters.
**Notes:** Export should support event, field, CS, and settlement operations.

| Option | Description | Selected |
|--------|-------------|----------|
| Masked by default | Basic CSV masks email/phone; raw PII export needs separate action/audit/reason. | |
| Raw export for admins | Admins can export raw email/phone and audit records the export. | yes |
| You decide | Planner balances operations and privacy risk. | |

**User's choice:** Raw export for admins.
**Notes:** Raw PII export is permitted for admins, but audit must be mandatory and should not log raw exported values.

---

## the agent's Discretion

- Event lifecycle state model.
- Publish checklist blocking fields.
- IP allowlist enforcement model.

## Deferred Ideas

- Admin MFA is intentionally deferred beyond Phase 25 and must remain visible as an accepted risk / deferred security item until implemented.
