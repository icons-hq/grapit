# Phase 27: Event Operations + Settlement - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22T00:37:48Z
**Phase:** 27-Event Operations + Settlement
**Areas discussed:** Buyer QR ticket surface, invalid QR display policy, scanner-only access, scanner UX, manual check-in, offline fallback sync, field monitor, settlement/export, retrospective

---

## Buyer QR Ticket Surface

| Option | Description | Selected |
|--------|-------------|----------|
| QR image + minimal metadata | Payment complete/My Page detail show a large QR code, reservation number, performance, showtime, seat, and status. Raw token/JTI stays hidden. | ✓ |
| QR image + scanner metadata | Adds ticket ID fragment, issued time, email schedule, and status detail. Easier for operations but more cluttered. | |
| QR image + mobile ticket utilities | Adds enlarged view, brightness guidance, image save/print affordances. More useful on event day but larger scope. | |

**User's choice:** 1
**Notes:** The initial user request explicitly said current screens show QR active state and ticket ID metadata but no QR image, and that a real scannable buyer QR is required before scanner/offline/settlement E2E verification.

---

## Invalid QR Display Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Status-specific locked screen | Hide QR for `USED`, `REVOKED`, `EXPIRED`, cancelled, or refunded states and show state card only. | |
| Dim QR + warning | Keep QR visible but visually disabled with warning. | |
| Always show QR, scanner rejects | Buyer screen stays simple; scanner performs final rejection for invalid states. | ✓ |

**User's choice:** 3
**Notes:** Context captures that scanner-side validation is source of truth. Raw token/JTI still must not be rendered as text.

---

## Scanner-Only Access

| Option | Description | Selected |
|--------|-------------|----------|
| Admin role + scanner capability only | Reuse existing admin capability structure with scanner-only bundle/capability. | ✓ |
| New `scanner` role | Add `user | admin | scanner` role. Conceptually clear but broader schema/auth churn. | |
| Event staff access code | Use event access code/PIN instead of accounts. Faster but weaker audit/revocation. | |

**User's choice:** 1
**Notes:** User clarified field staff will use a lower-grade QR scan-only account, not a full admin account. Current code has `user | admin` style role plus admin capability fields, so this should extend capability structure.

---

## Scanner UX

| Option | Description | Selected |
|--------|-------------|----------|
| Single mobile scanner screen | Dedicated scanner-only mobile page with camera scan/result/offline queue. | |
| Event selection + scanner screen | Staff picks event/showtime then scans. More flexible but extra on-site step. | |
| Full admin scanner tab | Add scanner tab to existing admin shell. Simpler but risks exposing unrelated admin UI. | |
| Phone camera QR URL deep link | Buyer QR opens a Grabit HTTPS ticket check-in page through the phone's normal camera app. Login and capability gates apply. | ✓ |

**User's choice:** Free-text replacement
**Notes:** User clarified the desired UX: no in-app scanner camera is required as the primary interaction. A normal phone camera opens the QR URL. If unauthenticated, login is required; if logged in as a normal member, access is denied.

---

## Manual Check-In

| Option | Description | Selected |
|--------|-------------|----------|
| Detail confirmation then manual entry | QR URL opens ticket status/detail first, then staff presses `입장 처리`. | ✓ |
| Auto entry on page open | Opening the URL immediately marks ticket used. Fast but risky. | |
| Mixed auto/manual | Normal tickets auto-process, abnormal states require manual confirmation. Fast but complex. | |

**User's choice:** 1
**Notes:** Opening a QR URL is not an entry action. Staff must confirm the displayed ticket and press `입장 처리`.

---

## Offline Fallback Sync

| Option | Description | Selected |
|--------|-------------|----------|
| Online-first + local pending queue | Online verification is primary; failed network requests become local pending scan attempts and sync after recovery. | ✓ |
| Full offline allowlist preload | Preload valid ticket hash list to device for offline normal/duplicate judgment. More resilient but higher security/device risk. | |
| Offline records hold-only | Offline state records manual-review list only, without processing entry. Safest but slower. | |

**User's choice:** 1
**Notes:** Server remains final authority after sync for duplicate, tampered, refunded, expired, and already-used outcomes.

---

## Field Monitor

| Option | Description | Selected |
|--------|-------------|----------|
| Entry KPI monitor | entered, not-entered, entry rate, duplicate scans, rejected scans, offline pending/synced, latest abnormal alerts. | ✓ |
| Scan log monitor | Recent scan log table with filters as primary view. Better audit, weaker operational overview. | |
| Seat/zone monitor | Entry status by floor/zone/seat map. Operationally rich but larger scope. | |

**User's choice:** 1
**Notes:** First screen should answer whether event entry is progressing normally. Logs are secondary drill-down.

---

## Settlement And Export

| Option | Description | Selected |
|--------|-------------|----------|
| CSV export + accounting inputs | Entry/no-show/reservation/payment/refund/settlement CSVs only. | |
| Operations dashboard + CSV | Admin dashboard for event revenue/refund/entry/no-show summary plus CSV export. | ✓ |
| Accounting integration prep | Strong external accounting mapping and formal docs. Heavier and depends on external details. | |

**User's choice:** 2
**Notes:** User requested explanation first, then selected admin dashboard plus CSV. External accounting/tax/PG mapping remains out of scope.

---

## Retrospective

| Option | Description | Selected |
|--------|-------------|----------|
| GSD artifact | Write `27-RETROSPECTIVE.md` with incidents, non-incidents, improvements, carry-forward, and completion evidence. | ✓ |
| Admin UI + artifact | Build admin retrospective input/read UI and also write markdown evidence. | |
| Admin export only | Use admin export without markdown evidence. Weakens GSD traceability. | |

**User's choice:** 1
**Notes:** User asked for detailed explanation, then selected GSD artifact. Admin retrospective UI is deferred.

---

## the agent's Discretion

- Exact QR rendering library and QR route shape.
- Exact scanner capability names, route guard implementation, and admin permission UI details.
- Exact local pending queue storage/sync implementation, provided server remains final authority and raw PII is avoided.
- Exact settlement dashboard layout and CSV file/column naming.

## Deferred Ideas

- Dedicated QR scanner hardware.
- Native mobile scanner app.
- External accounting/tax/PG settlement integration and formal mapping documents.
- Admin retrospective input/management UI.
