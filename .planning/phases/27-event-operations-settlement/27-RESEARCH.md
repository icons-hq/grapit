# Phase 27: Event Operations + Settlement - Research

**Researched:** 2026-05-22  
**Domain:** QR check-in, field operations, offline sync, settlement export, post-event evidence  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

Source: `.planning/phases/27-event-operations-settlement/27-CONTEXT.md` copied verbatim for locked decisions, planner discretion, and deferred scope. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

### Locked Decisions

## Implementation Decisions

### Buyer QR Ticket Surface

- **D-01:** Payment complete and My Page reservation detail must show an actual scannable QR code image, not only `QR active` state or masked ticket metadata.
- **D-02:** The buyer QR card shows only minimal metadata next to the QR: reservation number, performance title, showtime, seat(s), and ticket status. Raw QR token and raw JTI must not be rendered as visible text.
- **D-03:** The QR payload should be an HTTPS Grabit URL that a normal phone camera app can open. The URL routes to the protected ticket check-in/management page for that ticket.
- **D-04:** Invalid ticket states are not hidden from the buyer QR surface. The buyer may still see/present the QR, but scanner-side verification is the source of truth for `USED`, `REVOKED`, `EXPIRED`, cancelled, refunded, duplicate, or tampered cases.
- **D-05:** The QR URL may contain an opaque ticket token or equivalent one-time/verifiable identifier needed to find the ticket, but the buyer UI must not print raw token/JTI values outside the QR image or URL itself.

### Scanner-Only Access Model

- **D-06:** Grapit will not use separate QR scanner hardware. Field staff scan buyer QR tickets with normal mobile phones.
- **D-07:** Phone camera QR scan opens the Grabit ticket check-in page. If the visitor is not logged in, route them to login first and then return to the intended ticket page.
- **D-08:** A normal member account must receive access denied on the QR check-in page. Seeing or possessing the QR URL must not allow a regular user to check in a ticket.
- **D-09:** Field staff use a lower-privilege scanner-only admin account, not a full admin account. Implement this through the existing admin capability model by adding a scanner-only bundle/capability set such as `adminCapabilityBundle='scanner'` or equivalent explicit capabilities.
- **D-10:** Scanner-only accounts may access only the event/showtime-scoped scan page/API, submit scan/check-in attempts, submit offline sync payloads, and write scan audit evidence. They must not access refund, reservation management, user management, content, security, settlement, or raw export capabilities.
- **D-11:** Full admin accounts may manage scanner-only staff permissions, but scanner-only accounts must not see the full admin sidebar or unrelated admin routes.

### Ticket Check-In Flow

- **D-12:** Opening a QR URL never automatically marks a ticket as used. The page first displays ticket identity, status, reservation/showtime/seat context, and the server verification result.
- **D-13:** Final entry processing is manual: scanner staff must press an `입장 처리` action after confirming the displayed ticket status.
- **D-14:** The server must be the final authority for normal, duplicate, tampered, refunded/cancelled, expired, wrong-showtime, and already-used outcomes.
- **D-15:** Duplicate scans must return an explicit duplicate/already-used result with the prior scan/check-in timestamp and staff/device context where safe. Do not silently treat duplicates as success.
- **D-16:** Tampered or unverifiable QR URLs/tokens must not reveal sensitive lookup details. Show an operator-readable rejection state and write audit/log evidence with redacted token/JTI values.
- **D-17:** Refunded/cancelled tickets must be rejected at scan time even if the buyer QR surface still renders a QR image.

### Offline Fallback Sync

- **D-18:** The scanner page is online-first. It should verify and process entry with the server whenever connectivity is available.
- **D-19:** If the scanner page is already available to an authenticated scanner-only session and a network failure prevents processing, store a local pending scan attempt for later sync.
- **D-20:** Local pending scan data must include scanner account context, event/showtime scope, QR URL/token reference, attempt timestamp, device-local attempt id, and pending/synced/rejected state. Avoid storing raw PII.
- **D-21:** When connectivity recovers, pending attempts sync to the server. The server resolves all conflicts and final states, including duplicate, tampered, refunded, expired, and already-used tickets.
- **D-22:** Offline sync results must be visible to field staff and the field monitor as pending, synced, or rejected. Offline local acceptance is not final admission evidence until server sync succeeds.

### Field Monitor

- **D-23:** The event-day field monitor is KPI-first. Its first screen answers whether entry is proceeding normally.
- **D-24:** Required KPIs are entered count, not-entered count, entry rate, duplicate scans, rejected scans, offline pending count, offline synced count, and latest abnormal alerts.
- **D-25:** Scan logs are secondary drill-down/filter data. The default monitor should not be a raw log table.
- **D-26:** Abnormal alerts must cover at least duplicate scan spikes, rejected/tampered scans, refunded/cancelled scan attempts, offline pending backlog, and sync failures.

### Settlement And Export

- **D-27:** Phase 27 includes an admin settlement/operations dashboard plus CSV export, not CSV-only output.
- **D-28:** Dashboard summary should show event-level sales/payment/refund/entry/no-show summary suitable for post-event operator review.
- **D-29:** CSV exports must include entry status, no-show reservation list, reservation/payment/refund summary, and settlement/accounting input data.
- **D-30:** External accounting system integration, tax/PG settlement mapping, and formal accounting workflow documents are out of scope for Phase 27.
- **D-31:** Settlement/export access is not part of scanner-only capability. It remains full admin or finance-capability scope.

### Retrospective

- **D-32:** Post-event retrospective is a GSD artifact, not an admin product feature in Phase 27.
- **D-33:** Create `27-RETROSPECTIVE.md` covering incidents, non-incidents, improvements, next-event carry-forward items, field scan/offline/settlement evidence, and v2.0 completion evidence.
- **D-34:** Admin retrospective input/management UI is deferred unless a later phase proves repeated event operations need it.

### the agent's Discretion

- Planner may choose the QR rendering library, QR URL route shape, QR token encoding detail, and whether the buyer QR is rendered as canvas, SVG, or image as long as the result is scannable and raw token/JTI is not printed as text.
- Planner may choose exact scanner capability names and route guards, but scanner-only accounts must be lower privilege than full admin and regular users must be denied.
- Planner may choose IndexedDB/localStorage/service-worker details for pending offline attempts, but must preserve D-18 through D-22 and avoid raw PII storage.
- Planner may choose the dashboard layout, chart/table mix, polling/refresh strategy, and export file naming as long as D-23 through D-31 are met.

### Deferred Ideas (OUT OF SCOPE)

## Deferred Ideas

- Dedicated QR scanner hardware is not part of Phase 27.
- A native mobile scanner app is not part of Phase 27.
- Full external accounting/tax/PG settlement integration and formal mapping documents are deferred beyond Phase 27.
- Admin retrospective input/management UI is deferred; Phase 27 uses `27-RETROSPECTIVE.md`.
</user_constraints>

## Project Constraints (from AGENTS.md)

- 모든 응답과 planning artifact 설명은 Korean 중심으로 작성하고, technical terms와 code identifiers는 English로 유지한다. [VERIFIED: AGENTS.md]
- GSD workflow, GSD skill, GSD command 사용 시 독립 작업이 안전하게 병렬화될 수 있으면 Codex native subagents를 선호한다. [VERIFIED: AGENTS.md]
- Phase 27 research 자체는 단일 `RESEARCH.md` artifact 생성 작업이라 병렬 write scope가 없으며, planner/executor가 이후 wave fan-out을 판단해야 한다. [VERIFIED: AGENTS.md]
- 프로젝트는 라이브 엔터테인먼트 티켓 예매 플랫폼 Grabit이며, 사용자가 공연을 발견하고 좌석을 선택해 안정적으로 예매를 완료하는 흐름이 core value다. [VERIFIED: AGENTS.md]
- 1인 개발 제약 때문에 모놀리스 우선, 복잡도 최소화, 기존 Next.js/NestJS/Drizzle/PostgreSQL/admin capability 패턴 재사용이 우선이다. [VERIFIED: AGENTS.md]
- 결제는 Toss Payments SDK, 인프라는 GCP Seoul region, 좌석맵은 SVG 기반이다. [VERIFIED: AGENTS.md]
- `.env`는 monorepo root에 있고, production Cloud Run은 `.env`가 아니라 Secret Manager 또는 Cloud Run 환경변수를 사용한다. [VERIFIED: AGENTS.md]
- drizzle-kit migration은 production에서 직접 실행하지 않고 CI/CD에서 `DATABASE_URL`을 주입해 실행한다. [VERIFIED: AGENTS.md]
- Project-local skill directories `.codex/skills` and `.agents/skills` are absent, so no additional project skill conventions apply to this research. [VERIFIED: test -d .codex/skills; VERIFIED: test -d .agents/skills]
- `.planning/graphs/graph.json` is absent, so no graph-derived semantic context was available for Phase 27 research. [VERIFIED: test -f .planning/graphs/graph.json]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QR-02 | Field staff can scan QR tickets with JWT/HMAC verification, duplicate-scan detection, tamper detection, and offline fallback sync. | Existing `QrTicketService` verifies JWT/HMAC and rejects invalid states; Phase 27 must add buyer QR image, scanner-only route/API, atomic consume, scan event log, and offline sync queue. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts] |
| FIELD-01 | Operator can monitor event-day entry counts, no-shows, entry rate, duplicate scans, and abnormal access alerts in real time. | Add scan event persistence and KPI aggregation endpoint/UI; use UI-SPEC 10-second refresh as the default "real-time enough" monitor pattern unless later requirements demand WebSocket. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md; ASSUMED] |
| OPS-03 | Operator can follow event-day playbooks for forced refund, weather/facility/cast cancellation, on-site refund, and exchange scenarios. | Plan should create an event-day playbook artifact and link console actions/contact fields; external contact values are not in repo and must be collected or left as placeholders with owner/date. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; ASSUMED] |
| POST-01 | Operator can export entry status, no-show reservations, settlement data, and accounting inputs after the event. | Reuse admin audit/export conventions and `safeCsvRows`; add settlement dashboard and CSV export endpoints protected by finance/full-admin capability, not scanner capability. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: apps/api/src/modules/admin/csv-export.util.ts; VERIFIED: packages/shared/src/schemas/admin-operations.schema.ts] |
| POST-02 | Maintainer can commit a retrospective covering launch incidents, improvements, and next-event carry-forward actions by 2026-07-10. | Retrospective is a GSD artifact named `27-RETROSPECTIVE.md`, not an admin UI feature; planner needs a docs task and verification marker for required sections. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 27 should be planned as one end-to-end operational path: buyer sees a real scannable QR image, phone camera opens an HTTPS Grabit check-in URL, scanner-only staff authenticate and verify the ticket, staff manually press `입장 처리`, server atomically records the entry or rejection, field monitor aggregates scan/entry health, settlement exports close the post-event accounting inputs, and `27-RETROSPECTIVE.md` records v2.0 completion evidence. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: .planning/REQUIREMENTS.md]

The current codebase already has the hardest QR foundation: signed QR token issuance, JWT/HMAC verification, status checks, redacted scanner contract, reservation detail QR ticket data, admin capability fields, admin audit service, and safe CSV utility. [VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts; VERIFIED: packages/shared/src/schemas/booking.schema.ts; VERIFIED: apps/api/src/database/schema/users.ts; VERIFIED: apps/api/src/modules/admin/admin-audit.service.ts; VERIFIED: apps/api/src/modules/admin/csv-export.util.ts] Phase 27 should not replace those systems; it should extend them with a scannable QR rendering layer, scanner-only capability bundle, scan event persistence, consume/sync APIs, monitor aggregates, settlement exports, and retrospective artifact. [VERIFIED: codebase grep; ASSUMED]

**Primary recommendation:** Use existing NestJS/Drizzle/PostgreSQL as the final source of truth, add `qrcode.react` for buyer QR rendering, use `idb` for local pending scan attempts, keep scanner-only routes outside the full admin shell, and make all entry/settlement actions auditable. [VERIFIED: package.json; VERIFIED: npm view qrcode.react; VERIFIED: npm view idb; ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Buyer scannable QR image | Browser / Client | API / Backend | Existing reservation detail API already exposes `qrTicket.token`; client should render the HTTPS URL as QR while preserving no raw-token text. [VERIFIED: packages/shared/src/schemas/booking.schema.ts; VERIFIED: apps/web/components/reservation/reservation-detail.tsx] |
| QR URL auth return and access denied | Browser / Client | API / Backend | The phone camera opens a web route; the route handles login return and access-denied UX, while API guards enforce authority. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Ticket verification and `입장 처리` | API / Backend | Database / Storage | Server must decide normal/duplicate/tampered/refunded/expired/wrong-showtime/already-used outcomes and update ticket state atomically. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts] |
| Offline pending attempts | Browser / Client | API / Backend | Local queue exists only when network failure blocks online processing; server later resolves conflicts and final states. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; CITED: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation] |
| Field monitor KPIs and alerts | API / Backend | Browser / Client | Backend should aggregate scan/ticket/payment state; browser renders KPI-first monitor and polls/refreshes. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md] |
| Event-day playbooks | Documentation / GSD Artifact | Admin UI / Backend | Required scenarios are operational runbooks with console action references and external contacts, not a new workflow engine. [VERIFIED: .planning/REQUIREMENTS.md; ASSUMED] |
| Settlement dashboard and CSV exports | API / Backend | Database / Storage, Browser / Client | Backend owns audited aggregation/export; UI displays summary and triggers downloads. Scanner-only capability must not access this. [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts; VERIFIED: apps/api/src/modules/admin/csv-export.util.ts] |
| Retrospective evidence | Documentation / GSD Artifact | — | `27-RETROSPECTIVE.md` is explicitly the deliverable; no admin UI in Phase 27. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | repo `^16.2.0`; npm latest `16.2.6` | Buyer QR, scanner route, monitor, settlement UI | Existing web app framework; avoid framework churn during launch evidence work. [VERIFIED: apps/web/package.json; VERIFIED: npm view next] |
| React | repo `^19.1.0` web | UI rendering | Already paired with Next.js 16 in this repo. [VERIFIED: apps/web/package.json] |
| shadcn/ui + Radix + lucide | existing project setup | Scanner/monitor/settlement controls | UI-SPEC locks shadcn `new-york`, neutral base, lucide, and existing primitives. [VERIFIED: components.json; VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md] |
| TanStack Query | repo `^5.95.2`; npm latest `5.100.11` | Scanner verify/consume mutations, monitor polling, settlement queries | Existing server-state library in web app; use `refetchInterval` for 10-second field monitor refresh. [VERIFIED: apps/web/package.json; VERIFIED: npm view @tanstack/react-query; ASSUMED] |
| NestJS | repo `^11.1.0`; npm latest `11.1.23` | Check-in, offline sync, monitor, settlement APIs | Existing API framework and guard/provider pattern. [VERIFIED: apps/api/package.json; VERIFIED: npm view @nestjs/core] |
| Drizzle ORM | repo `^0.45.0`; npm latest `0.45.2` | Ticket scan event tables, transactional consume, settlement queries | Existing database ORM; official transaction API supports transactional update/rollback. [VERIFIED: apps/api/package.json; VERIFIED: npm view drizzle-orm; CITED: https://orm.drizzle.team/docs/transactions] |
| PostgreSQL | existing primary DB | Final source of truth for ticket status, scan events, exports | Ticket/reservation/payment data already lives in PostgreSQL through Drizzle schemas. [VERIFIED: apps/api/src/database/schema/tickets.ts; VERIFIED: apps/api/src/database/schema/reservations.ts] |
| `@nestjs/jwt` | repo `^11.0.2` | QR JWT/HMAC verification | Existing `QrTicketService` signs/verifies QR ticket payloads with HS256 allowlist. [VERIFIED: apps/api/package.json; VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `qrcode.react` | `4.2.0`, modified 2024-12-11 | Buyer-visible QR SVG/canvas rendering | Add to `apps/web` for payment complete and My Page QR image; use `QRCodeSVG` unless canvas download is needed. [VERIFIED: npm view qrcode.react; CITED: https://github.com/zpao/qrcode.react] |
| `idb` | `8.0.3`, modified 2025-05-07 | IndexedDB wrapper for pending offline attempts | Add to `apps/web` for scanner page local queue; object store by `deviceAttemptId` with `syncState` index. [VERIFIED: npm view idb; CITED: https://github.com/jakearchibald/idb] |
| `@zxing/browser` | `0.2.0`, modified 2026-04-27 | Optional in-browser camera QR scanner | Use only if planner adds an in-app continuous scanner UI; default requirement is phone camera opening HTTPS QR URL. [VERIFIED: npm view @zxing/browser; CITED: https://github.com/zxing-js/browser; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Existing `safeCsvRows` | local utility | Settlement CSV escaping and formula-injection defense | Reuse for every Phase 27 CSV export instead of manual string joins. [VERIFIED: apps/api/src/modules/admin/csv-export.util.ts] |
| Existing `AdminAuditService` | local service | Scan/entry/export audit evidence | Extend action taxonomy for scan consume, offline sync, settlement export. [VERIFIED: apps/api/src/modules/admin/admin-audit.service.ts; VERIFIED: packages/shared/src/schemas/admin-operations.schema.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `qrcode.react` | server-side `qrcode` package | Server-side generation helps email/PDF images, but Phase 27 buyer surfaces are React pages; client QR avoids new server image endpoint. [VERIFIED: npm view qrcode; ASSUMED] |
| `idb` | raw IndexedDB API | Raw IndexedDB is browser-native but verbose and error-prone; `idb` keeps transaction/object-store code small. [CITED: https://github.com/jakearchibald/idb] |
| phone camera opens URL | `@zxing/browser` camera scanner | `@zxing/browser` is useful for a staff scanner page, but locked decisions say normal phone camera opens the URL; do not make camera-scanner library a blocker. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: npm view @zxing/browser] |
| 10-second polling monitor | Socket.IO/WebSocket monitor | WebSocket is already in stack but adds operational complexity; UI-SPEC says auto-refresh every 10s plus manual refresh, so polling is the simpler launch path. [VERIFIED: apps/web/package.json; VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md; ASSUMED] |

**Installation:**

```bash
pnpm --filter @grabit/web add qrcode.react idb

# Optional only if adding an in-browser continuous scanner:
pnpm --filter @grabit/web add @zxing/browser
```

**Version verification:**

| Package | Verified Version | Publish/Modified Evidence |
|---------|------------------|---------------------------|
| `qrcode.react` | `4.2.0` | `npm view qrcode.react version time.modified --json` returned `2024-12-11T17:22:40.710Z`. [VERIFIED: npm view qrcode.react] |
| `idb` | `8.0.3` | `npm view idb version time.modified --json` returned `2025-05-07T08:12:54.691Z`. [VERIFIED: npm view idb] |
| `@zxing/browser` | `0.2.0` | `npm view @zxing/browser version time.modified --json` returned `2026-04-27T10:56:03.302Z`. [VERIFIED: npm view @zxing/browser] |
| `next` | `16.2.6` latest; repo `^16.2.0` | `npm view next` and `apps/web/package.json`. [VERIFIED: npm view next; VERIFIED: apps/web/package.json] |
| `@nestjs/core` | `11.1.23` latest; repo `^11.1.0` | `npm view @nestjs/core` and `apps/api/package.json`. [VERIFIED: npm view @nestjs/core; VERIFIED: apps/api/package.json] |
| `drizzle-orm` | `0.45.2` latest; repo `^0.45.0` | `npm view drizzle-orm` and `apps/api/package.json`. [VERIFIED: npm view drizzle-orm; VERIFIED: apps/api/package.json] |
| `@tanstack/react-query` | `5.100.11` latest; repo `^5.95.2` | `npm view @tanstack/react-query` and `apps/web/package.json`. [VERIFIED: npm view @tanstack/react-query; VERIFIED: apps/web/package.json] |

## Architecture Patterns

### System Architecture Diagram

```text
Buyer Payment Complete / My Page
  -> Reservation detail API returns qrTicket.token
  -> Browser builds HTTPS check-in URL
  -> qrcode.react renders scannable QR image
  -> Phone camera opens /field/check-in?... URL
    -> Login required? yes -> login -> return to check-in URL
    -> User capability check
      -> normal member -> access denied + no state change
      -> scanner/full admin -> verify ticket with API
        -> server verifies JWT/HMAC + DB ticket/payment/reservation/showtime state
          -> valid for showtime -> staff presses "입장 처리"
            -> transactional consume -> ticket used + scan event
          -> duplicate/refunded/expired/tampered/wrong-showtime -> rejection + scan event
        -> network failure after page/session available
          -> idb pending attempt
          -> reconnect -> sync endpoint
          -> server conflict resolution -> pending/synced/rejected status

Scan events + ticket/reservation/payment state
  -> Field monitor KPI aggregation API -> KPI-first monitor UI
  -> Settlement aggregation/export API -> dashboard + CSV files
  -> 27-RETROSPECTIVE.md -> incident/non-incident/improvement/evidence record
```

### Recommended Project Structure

```text
apps/api/src/modules/field-operations/
├── field-operations.module.ts        # Scanner/check-in/monitor providers
├── field-check-in.controller.ts       # verify, consume, offline sync endpoints
├── field-check-in.service.ts          # QR verification + atomic consume orchestration
├── offline-sync.service.ts            # pending attempt conflict resolution
├── field-monitor.controller.ts        # KPI/alert endpoint
├── field-monitor.service.ts           # event/showtime aggregation
└── settlement-export.service.ts       # post-event summary and CSV generation

apps/api/src/database/schema/
└── ticket-scan-events.ts              # scan event/audit evidence table

apps/web/app/field/check-in/
└── page.tsx                           # scanner-only minimal shell, no full admin sidebar

apps/web/components/field/
├── qr-ticket-image.tsx                # reusable buyer QR renderer
├── scanner-check-in.tsx               # verify/result/consume/offline queue UI
├── offline-sync-status.tsx            # pending/synced/rejected display
└── field-monitor.tsx                  # KPI-first operations view

apps/web/app/admin/settlement/
└── page.tsx                           # finance/full-admin dashboard + exports

packages/shared/src/schemas/
└── field-operations.schema.ts         # zod contracts for verify/consume/sync/export
```

The exact file names can follow existing module naming conventions, but the planner should keep scanner-only check-in UI out of `apps/web/app/admin/layout.tsx` unless the layout is capability-filtered. [VERIFIED: apps/web/app/admin/layout.tsx; ASSUMED]

### Pattern 1: Buyer QR Image Uses URL, Not Raw Text

**What:** Build an HTTPS Grabit check-in URL from `qrTicket.token` and render it as QR, while keeping raw token/JTI out of visible DOM text. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: packages/shared/src/schemas/booking.schema.ts]

**When to use:** Payment complete and My Page reservation detail. [VERIFIED: apps/web/components/booking/booking-complete.tsx; VERIFIED: apps/web/components/reservation/reservation-detail.tsx]

**Example:**

```tsx
// Source: qrcode.react README / Context7 docs
import { QRCodeSVG } from 'qrcode.react';

export function QrTicketImage({ value }: { value: string }) {
  return (
    <QRCodeSVG
      value={value}
      size={220}
      level="M"
      marginSize={4}
      title="티켓 검표 QR"
    />
  );
}
```

`qrcode.react` exposes `QRCodeSVG`, `QRCodeCanvas`, `value`, `size`, `level`, `title`, and `marginSize`; QR quiet-zone margin should be explicit for camera readability. [CITED: https://github.com/zpao/qrcode.react]

### Pattern 2: Verify and Consume Are Separate Server Actions

**What:** `verify` returns server result/context without changing ticket state; `consume` performs the manual `입장 처리` update. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**When to use:** Every scanner route. Opening the QR URL must never mark a ticket used. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**Example:**

```ts
// Source: Drizzle transactions docs + existing QrTicketService pattern
const result = await db.transaction(async (tx) => {
  const verified = await qrTicketService.verifyTicketForScannerContract(token);

  const [updated] = await tx
    .update(tickets)
    .set({ status: 'used', usedAt: now, updatedAt: now })
    .where(and(eq(tickets.id, verified.ticketId), eq(tickets.status, 'active'), isNull(tickets.usedAt)))
    .returning({ id: tickets.id, usedAt: tickets.usedAt });

  if (!updated) {
    await tx.insert(ticketScanEvents).values(buildDuplicateEvent(verified, now));
    return { outcome: 'duplicate' as const };
  }

  await tx.insert(ticketScanEvents).values(buildEntryEvent(verified, now));
  return { outcome: 'entered' as const, usedAt: updated.usedAt };
});
```

Drizzle supports transactional work through `db.transaction`, and existing ticket verification already joins ticket/reservation/payment state before returning scanner context. [CITED: https://orm.drizzle.team/docs/transactions; VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts]

### Pattern 3: Scanner-Only Capability Extends Existing RBAC

**What:** Add scanner capability/bundle to `ADMIN_CAPABILITIES`, `ADMIN_CAPABILITY_BUNDLES`, and resolver logic; protect APIs with `AdminCapabilitiesGuard`. [VERIFIED: packages/shared/src/schemas/admin-operations.schema.ts; VERIFIED: packages/shared/src/types/admin-operations.types.ts; VERIFIED: apps/api/src/common/guards/admin-capabilities.guard.ts]

**When to use:** Check-in verify/consume/offline sync and scan audit write endpoints. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**Example capability shape:**

```ts
// Source: existing admin-operations.schema.ts capability/bundle pattern
export const FIELD_SCAN_CAPABILITIES = [
  'field.scan.verify',
  'field.scan.consume',
  'field.scan.sync',
] as const;

export const SCANNER_BUNDLE = {
  scanner: FIELD_SCAN_CAPABILITIES,
};
```

Scanner-only users should not receive settlement/export, refund, reservation management, user management, content, security, or raw export capabilities. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

### Pattern 4: Offline Queue Is Pending Evidence, Not Final Entry

**What:** Persist pending attempts in IndexedDB with device-local id and no raw PII; sync later to server for final conflict resolution. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**When to use:** Only when the scanner page is already available to an authenticated scanner session and network failure prevents online processing. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**Example:**

```ts
// Source: idb README / Context7 docs
import { openDB } from 'idb';

const db = await openDB('grabit-field-scans', 1, {
  upgrade(database) {
    const store = database.createObjectStore('pendingScanAttempts', {
      keyPath: 'deviceAttemptId',
    });
    store.createIndex('showtimeId', 'showtimeId');
    store.createIndex('syncState', 'syncState');
  },
});

await db.add('pendingScanAttempts', {
  deviceAttemptId: crypto.randomUUID(),
  showtimeId,
  qrReference,
  scannerAccountId,
  attemptedAt: new Date().toISOString(),
  syncState: 'pending',
});
```

`idb` wraps IndexedDB with promise-based `openDB`, object stores, indexes, and transaction completion helpers. [CITED: https://github.com/jakearchibald/idb]

### Pattern 5: KPI-First Monitor Polling

**What:** API returns a compact summary object first, plus secondary log/filter payload. UI polls every 10 seconds and has manual refresh. [VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md]

**When to use:** Field monitor first screen. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]

**Example response shape:**

```ts
type FieldMonitorSummary = {
  eventId: string;
  showtimeId: string;
  enteredCount: number;
  notEnteredCount: number;
  entryRate: number;
  duplicateScanCount: number;
  rejectedScanCount: number;
  offlinePendingCount: number;
  offlineSyncedCount: number;
  alerts: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; message: string }>;
  lastUpdatedAt: string;
};
```

### Anti-Patterns to Avoid

- **Metadata-only QR:** Existing Phase 26 screens show QR status/masked JTI, but Phase 27 requires a real QR image that a camera can scan. [VERIFIED: apps/web/e2e/phase26-qr-visibility.spec.ts; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]
- **Consume-on-open:** Opening the URL must verify only; final entry requires staff pressing `입장 처리`. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]
- **Full-admin scanner shortcut:** Giving field staff full `admin` role or exposing the admin sidebar violates scanner-only constraints. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: apps/web/components/admin/admin-sidebar.tsx]
- **Client-trusted offline success:** Offline local state is pending evidence only; server must resolve final state. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]
- **Raw token/JTI in UI/logs:** The QR URL may contain the token, but visible text, audit metadata, monitor rows, and errors must stay redacted. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts]
- **BarcodeDetector-only scanner:** MDN marks Barcode Detection API as limited availability; do not depend on it as the only QR scanning strategy. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR image rendering | Manual SVG path/string QR generator | `qrcode.react` | QR encoding, error correction, quiet zone, SVG/canvas output are solved already. [CITED: https://github.com/zpao/qrcode.react] |
| IndexedDB queue | Ad-hoc `localStorage` JSON array for pending scans | `idb` | IndexedDB handles larger structured data and indexes; `idb` keeps transactions reliable. [CITED: https://github.com/jakearchibald/idb] |
| CSV escaping | Manual string concatenation | Existing `safeCsvRows` | Existing utility escapes quotes and neutralizes formula prefixes. [VERIFIED: apps/api/src/modules/admin/csv-export.util.ts] |
| Scanner authorization | Browser-only route checks or `role === 'admin'` only | `AdminCapabilitiesGuard` + shared capability resolver | API authorization must enforce scanner-only lower privilege. [VERIFIED: apps/api/src/common/guards/admin-capabilities.guard.ts; VERIFIED: packages/shared/src/types/admin-operations.types.ts] |
| QR token validation | `jwt.decode` or parsing URL params as truth | Existing `QrTicketService.verifyTicketToken` / scanner contract | Existing service verifies signed token and DB state, including used/revoked/expired/payment status. [VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts] |
| Entry state transition | Separate read-then-write without transaction | PostgreSQL conditional update inside Drizzle transaction | Duplicate/race cases need one authoritative DB transition and scan event evidence. [CITED: https://orm.drizzle.team/docs/transactions; ASSUMED] |
| Optional camera scanning | Raw `getUserMedia` frame loop | `@zxing/browser` if needed | Camera permissions and decoding loops are edge-case heavy; MDN notes `getUserMedia` requires secure contexts/user permission. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia; VERIFIED: npm view @zxing/browser] |

**Key insight:** Phase 27 is operational correctness work, not UI-only work. Custom shortcuts around QR encoding, local persistence, authorization, CSV generation, or atomic DB transitions will create false launch evidence because the event-day failure modes are race conditions, privilege leaks, offline conflicts, and export/audit gaps. [ASSUMED]

## Common Pitfalls

### Pitfall 1: QR Looks Present But Is Not Scannable

**What goes wrong:** Payment complete/My Page show `QR active`, masked JTI, or CTA text, but no camera-readable QR image. [VERIFIED: apps/web/components/booking/booking-complete.tsx; VERIFIED: apps/web/components/reservation/reservation-detail.tsx]  
**Why it happens:** Phase 26 verified metadata visibility, not QR image/deep-link behavior. [VERIFIED: apps/web/e2e/phase26-qr-visibility.spec.ts]  
**How to avoid:** Add unit/E2E checks for an SVG/canvas QR element with the HTTPS check-in URL as encoded value and no visible raw token text. [ASSUMED]  
**Warning signs:** Tests only assert "QR active", "masked JTI", or D-1 email copy. [VERIFIED: apps/web/e2e/booking-complete-qr.spec.ts]

### Pitfall 2: Verification Accidentally Consumes Tickets

**What goes wrong:** Staff or any logged-in user opening the QR URL marks the ticket used before human confirmation. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
**Why it happens:** The route combines lookup and state transition. [ASSUMED]  
**How to avoid:** Separate `verify` and `consume` endpoints, and make `consume` require scanner capability plus explicit user action. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; ASSUMED]  
**Warning signs:** API handler updates `tickets.usedAt` during GET/initial page load. [ASSUMED]

### Pitfall 3: Scanner-Only Account Becomes Full Admin

**What goes wrong:** Staff can reach refunds, user management, content, settlement, security, or raw export screens. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
**Why it happens:** Existing admin layout gates on coarse `role === 'admin'` and static sidebar links. [VERIFIED: apps/web/app/admin/layout.tsx; VERIFIED: apps/web/components/admin/admin-sidebar.tsx]  
**How to avoid:** Add scanner capabilities but keep scanner route in a minimal shell or capability-filter the admin layout/sidebar. [ASSUMED]  
**Warning signs:** Scanner test user can load `/admin` dashboard or see full admin sidebar. [ASSUMED]

### Pitfall 4: Duplicate Race Creates Two Valid Entries

**What goes wrong:** Two scanners scan the same QR close together and both get success. [ASSUMED]  
**Why it happens:** Service checks `usedAt` then updates later without a conditional update/transaction. [ASSUMED]  
**How to avoid:** Use one PostgreSQL transaction with conditional `status='active' AND usedAt IS NULL` update and insert a scan event for both success and duplicate outcomes. [CITED: https://orm.drizzle.team/docs/transactions; ASSUMED]  
**Warning signs:** Duplicate tests do not simulate second consume after first success, or scan events only exist for success. [ASSUMED]

### Pitfall 5: Offline Pending Is Presented As Final Admission

**What goes wrong:** Staff thinks a locally saved pending attempt is accepted entry, but server later rejects it as duplicate/refunded/tampered. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
**Why it happens:** UI uses green/success copy for local storage instead of pending state. [ASSUMED]  
**How to avoid:** Use explicit `pending`, `synced`, `rejected` states and make "not final until server sync" visible. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
**Warning signs:** Offline mode has no conflict-result list after reconnect. [ASSUMED]

### Pitfall 6: Settlement Export Leaks Or Mutates Data Unsafely

**What goes wrong:** CSV exports expose raw PII too broadly, allow formula injection, or skip audit reason/evidence. [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts; VERIFIED: apps/api/src/modules/admin/csv-export.util.ts]  
**Why it happens:** New settlement export bypasses existing admin export pattern. [ASSUMED]  
**How to avoid:** Require finance/full-admin capability, reason, audit log, `no-store`, attachment filename, and `safeCsvRows`. [VERIFIED: apps/api/src/modules/admin/admin-booking.controller.ts; VERIFIED: apps/api/src/modules/admin/csv-export.util.ts]  
**Warning signs:** Export endpoint returns `text/csv` built by array `.join(',')`. [ASSUMED]

## Code Examples

Verified patterns from official/local sources:

### QR Image Rendering

```tsx
// Source: qrcode.react README / Context7 docs
import { QRCodeSVG } from 'qrcode.react';

<QRCodeSVG
  value={checkInUrl}
  size={220}
  level="M"
  marginSize={4}
  title="티켓 검표 QR"
/>;
```

`QRCodeSVG` is the recommended first pass for responsive buyer pages because it is DOM-inspectable and does not require canvas export. [CITED: https://github.com/zpao/qrcode.react; ASSUMED]

### IndexedDB Pending Queue

```ts
// Source: idb README / Context7 docs
const tx = db.transaction('pendingScanAttempts', 'readwrite');
await tx.store.put({
  deviceAttemptId,
  showtimeId,
  qrReference,
  attemptedAt,
  scannerAccountId,
  syncState: 'pending',
});
await tx.done;
```

`idb` exposes transaction completion through `tx.done`, which should be awaited before UI reports a pending scan as stored. [CITED: https://github.com/jakearchibald/idb]

### Admin Capability Guard Pattern

```ts
// Source: existing AdminCapabilitiesGuard usage pattern
@UseGuards(JwtAuthGuard, RolesGuard, AdminCapabilitiesGuard)
@Roles('admin')
@AdminCapabilities('field.scan.consume')
@Post('field/check-in/consume')
consumeTicket(@Body() dto: FieldConsumeDto) {
  return this.fieldCheckInService.consume(dto);
}
```

The exact guard stack should match local controller conventions, but capability checks must be on the API boundary, not only in React route gating. [VERIFIED: apps/api/src/common/guards/admin-capabilities.guard.ts; ASSUMED]

### Safe CSV Export

```ts
// Source: existing csv-export.util.ts
const csv = safeCsvRows([
  ['reservationId', 'entryStatus', 'paidAmount', 'refundAmount'],
  ...rows.map((row) => [row.reservationId, row.entryStatus, row.paidAmount, row.refundAmount]),
]);
```

`safeCsvRows` should be the only CSV writer used for settlement exports. [VERIFIED: apps/api/src/modules/admin/csv-export.util.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| QR status metadata and masked JTI visible to buyer | Real scannable QR image encoding HTTPS check-in URL | Phase 27 decisions, 2026-05-22 | Tests must move beyond metadata visibility. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Any admin-like account can use operations UI | Scanner-only lower-privilege capability bundle | Phase 27 decisions, 2026-05-22 | Planner must extend capability schema/resolver and route shell. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| QR lookup could be mistaken for admission | Verify page plus manual `입장 처리` consume | Phase 27 decisions, 2026-05-22 | API design must split read and state transition. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Offline local result treated as operational truth | Local pending, then server sync conflict resolution | Phase 27 decisions, 2026-05-22 | UI/monitor must show pending/synced/rejected. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Raw log table as operations screen | KPI-first field monitor with alerts, logs secondary | Phase 27 UI-SPEC, 2026-05-22 | Planner should put aggregate endpoint/UI before detailed log table. [VERIFIED: .planning/phases/27-event-operations-settlement/27-UI-SPEC.md] |
| CSV-only post-event output | Settlement dashboard plus audited CSV exports | Phase 27 decisions, 2026-05-22 | Dashboard summary is part of scope, not a nice-to-have. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |

**Deprecated/outdated:**

- Metadata-only QR evidence is insufficient for Phase 27 because success criteria require normal phone-camera QR path and scanner behavior. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]
- Barcode Detection API alone is not a safe browser QR scanning baseline because MDN marks it limited availability. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API]
- `localStorage` as the primary offline queue is not recommended for pending scan attempts because Phase 27 requires structured state, indexing by sync state/showtime, and future conflict resolution metadata. [ASSUMED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Field monitor 10-second polling is sufficient for Phase 27 "real time" because UI-SPEC explicitly requests auto-refresh every 10s plus manual refresh. | Standard Stack, Architecture Patterns | If the user expects sub-second live updates, planner must add Socket.IO/WebSocket work. |
| A2 | `ticket_scan_events` or equivalent new table is the right place for scan attempts, duplicate/rejected evidence, offline sync results, and monitor aggregation. | Architecture Patterns | If an existing audit table must be the only source, planner needs a different schema plan. |
| A3 | Scanner check-in route can live outside `/admin` to avoid exposing the full admin sidebar. | Architecture Patterns | If product requires `/admin` URL, planner must capability-filter admin layout/sidebar first. |
| A4 | Settlement/accounting input CSV columns can be derived from existing reservation/payment/refund/entry data because external accounting/tax/PG mapping is out of scope. | Phase Requirements, Standard Stack | RESOLVED by Plans 27-09 and 27-15: export internal accounting-input datasets now; external accounting/tax/PG mapping remains out of scope by D-30. |
| A5 | `@zxing/browser` is optional because locked decisions prefer normal phone camera opening an HTTPS URL, not a staff camera scanner web app. | Standard Stack | If staff must scan from inside a browser scanner page, add `@zxing/browser` and camera-permission tests. |
| A6 | Event-day playbook external contacts are not currently defined in repo artifacts. | Phase Requirements, Open Questions | RESOLVED by Plans 27-04 and 27-16: create required contact fields/placeholders first, then require owner-filled or owner-approved not-applicable evidence before launch rehearsal. |

## Open Questions (RESOLVED)

1. **RESOLVED - Which event/showtime IDs are the launch scope for monitor, scanner, and settlement?**  
   What we know: Phase 27 is for 2026-07-04 event-day operations. [VERIFIED: .planning/ROADMAP.md]  
   What's unclear: Whether there is one showtime or multiple showtime scopes requiring separate monitor filters. [ASSUMED]  
   Resolution source: Plans 27-06, 27-08, and 27-09 require event/showtime-scoped APIs; Plans 27-14 and 27-15 require event/showtime filters in the monitor and settlement UI; Plan 27-16 requires manual UAT evidence to record the exact event/showtime used. No hardcoded final business ID is invented in research.

2. **RESOLVED - What external contacts belong in the event-day playbooks?**  
   What we know: Playbooks must cover forced refund, weather, facility, cast issue, on-site refund, and exchange scenarios with external contacts. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
   What's unclear: Actual venue, organizer, PG, artist agency, emergency, and operations contact values are not in the researched files. [ASSUMED]  
   Resolution source: Plan 27-04 creates `docs/runbooks/phase27-event-day-playbooks.md` with required external-contact fields and Plan 27-16 blocks final evidence until the fields are filled, owner-approved not-applicable, or marked blocker with owner/date.

3. **RESOLVED - What thresholds define duplicate spike, offline backlog, and sync failure alerts?**  
   What we know: Alert categories are required. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
   What's unclear: Numeric threshold/window values are not specified. [ASSUMED]  
   Resolution source: Plan 27-08 implements API alert aggregation with conservative configurable defaults for duplicate spikes, rejected/tampered scans, refunded/cancelled attempts, offline backlog, and sync failures; Plan 27-14 renders those alerts and verifies the UI contract. Final operational tuning remains configurable rather than a locked business value.

4. **RESOLVED - What exact settlement/accounting CSV columns does the operator need?**  
   What we know: Entry status, no-show list, reservation/payment/refund summary, and settlement/accounting input data are required. [VERIFIED: .planning/REQUIREMENTS.md]  
   What's unclear: External accounting/PG mapping is out of scope, so final external column mapping is not defined. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md]  
   Resolution source: Plan 27-09 defines backend datasets `entry_status`, `no_show_reservations`, `reservation_payment_refund_summary`, and `settlement_accounting_input`; Plan 27-15 exposes matching CSV actions. These are internal accounting inputs, not formal external accounting/tax/PG mapped outputs per D-30.

5. **RESOLVED - What human evidence will prove real phone-camera scanning and venue offline rehearsal?**  
   What we know: Automation can test QR DOM, protected route, API consume, browser offline sync, and CSV export. [ASSUMED]  
   What's unclear: Real phone camera, venue connectivity, and staff account rehearsal require human/device evidence. [ASSUMED]  
   Resolution source: Plan 27-16 creates `27-HUMAN-UAT.md` and a blocking human verification checkpoint for real phone-camera QR open, scanner-only permission rehearsal, venue-like stale/recovered offline sync, external operational contacts, and settlement operator review.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Next/Nest/pnpm scripts | yes | local `v24.13.0`; project engine `>=22.0.0` | Use project CI/runtime Node if local version mismatch matters. [VERIFIED: node --version; VERIFIED: package.json] |
| pnpm | workspace install/test | yes | `10.28.1` | None needed. [VERIFIED: pnpm --version; VERIFIED: package.json] |
| npm | package version audit | yes | `11.6.2` | Use pnpm for project commands. [VERIFIED: npm --version] |
| Playwright | web E2E scanner/offline tests | yes | CLI reported `1.58.0`; package requests `^1.59.1` | Run through `pnpm --filter @grabit/web test:e2e` after install resolves lockfile. [VERIFIED: pnpm exec playwright --version; VERIFIED: apps/web/package.json] |
| Docker Desktop | API integration tests with testcontainers | yes | Docker Desktop/server `29.1.3` | If Docker unavailable in CI, run unit tests and mark integration blocked. [VERIFIED: docker info; VERIFIED: apps/api/package.json] |
| Google Cloud SDK | optional deploy/live evidence | yes | `564.0.0` | GitHub Actions/Cloud Console if local gcloud not used. [VERIFIED: gcloud --version] |
| `psql` CLI | manual DB inspection | no | — | Use app scripts/testcontainers or install PostgreSQL client if needed. [VERIFIED: command -v psql] |
| `pg_isready` | local Postgres probe | no | — | Use Docker/testcontainers or app health checks. [VERIFIED: command -v pg_isready] |
| `redis-cli` | Redis probe | no | — | Phase 27 default plan does not require Redis for QR consume; use existing app abstractions if needed. [VERIFIED: command -v redis-cli; ASSUMED] |

**Missing dependencies with no fallback:**

- None for research/planning. [VERIFIED: environment audit]

**Missing dependencies with fallback:**

- `psql`, `pg_isready`, and `redis-cli` are not installed locally; use app/testcontainers/health endpoints instead. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | API: Vitest node; Web unit: Vitest/jsdom; E2E: Playwright Chromium. [VERIFIED: apps/api/vitest.config.ts; VERIFIED: apps/web/vitest.config.ts; VERIFIED: apps/web/playwright.config.ts] |
| Config file | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`. [VERIFIED: codebase] |
| Quick run command | `pnpm --filter @grabit/api test -- src/modules/ticket/qr-ticket.service.spec.ts`; add Phase 27 targeted specs as they are created. [VERIFIED: apps/api/package.json; ASSUMED] |
| Full suite command | `pnpm test` plus `pnpm --filter @grabit/web test:e2e` for browser flows. [VERIFIED: package.json; VERIFIED: apps/web/package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| QR-02 | QR image renders HTTPS check-in URL, raw token/JTI not visible, normal/duplicate/tampered/refunded/expired/wrong-showtime/already-used outcomes, offline sync pending/synced/rejected | API unit/integration + Web unit + Playwright | `pnpm --filter @grabit/api test -- src/modules/field-operations/field-check-in.service.spec.ts`; `pnpm --filter @grabit/web test:e2e -- e2e/phase27-qr-check-in.spec.ts` | no, Wave 0. [VERIFIED: rg --files; ASSUMED] |
| FIELD-01 | Field monitor KPIs and abnormal alerts update from scan events and ticket state | API unit + Web component + Playwright smoke | `pnpm --filter @grabit/api test -- src/modules/field-operations/field-monitor.service.spec.ts`; `pnpm --filter @grabit/web test -- components/field/__tests__/field-monitor.test.tsx` | no, Wave 0. [VERIFIED: rg --files; ASSUMED] |
| OPS-03 | Playbooks cover forced refund, weather/facility/cast cancellation, on-site refund, exchange with console actions and contacts | Artifact validation + manual review | `test -f docs/runbooks/phase27-event-day-playbooks.md && rg "forced refund|weather|facility|cast|on-site refund|exchange" docs/runbooks/phase27-event-day-playbooks.md` | no, Wave 0. [ASSUMED] |
| POST-01 | Dashboard summary and CSV exports for entry status, no-show, reservation/payment/refund summary, settlement/accounting input | API unit + Web component + export smoke | `pnpm --filter @grabit/api test -- src/modules/admin/settlement-export.service.spec.ts`; `pnpm --filter @grabit/web test -- components/admin/__tests__/settlement-dashboard.test.tsx` | no, Wave 0. [VERIFIED: rg --files; ASSUMED] |
| POST-02 | `27-RETROSPECTIVE.md` includes incidents, non-incidents, improvements, carry-forward items, field scan/offline/settlement evidence, v2.0 completion evidence | Artifact validation | `test -f .planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md && rg "Incidents|Non-incidents|Improvements|Carry-forward|v2.0" .planning/phases/27-event-operations-settlement/27-RETROSPECTIVE.md` | no, execution artifact. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; ASSUMED] |

### Sampling Rate

- **Per task commit:** Run targeted Vitest file for touched tier and `pnpm --filter @grabit/web test -- <component test>` for UI changes. [ASSUMED]
- **Per wave merge:** Run relevant API module tests, web unit tests, and one Playwright happy-path scanner flow. [ASSUMED]
- **Phase gate:** `pnpm test`, targeted Phase 27 Playwright suite, export artifact checks, and human UAT evidence for real phone-camera/offline rehearsal before `$gsd-verify-work`. [ASSUMED]

### Wave 0 Gaps

- [ ] `packages/shared/src/schemas/field-operations.schema.ts` and matching tests for verify/consume/sync/monitor/export contracts. [ASSUMED]
- [ ] `apps/api/src/modules/field-operations/field-check-in.service.spec.ts` for normal, duplicate, tampered, refunded/cancelled, expired, wrong-showtime, already-used outcomes. [ASSUMED]
- [ ] `apps/api/src/modules/field-operations/offline-sync.service.spec.ts` for stale/recovered connectivity conflict resolution. [ASSUMED]
- [ ] `apps/api/src/modules/field-operations/field-monitor.service.spec.ts` for KPI/alert aggregation. [ASSUMED]
- [ ] `apps/api/src/modules/admin/settlement-export.service.spec.ts` for CSV datasets, audit, and formula escaping. [ASSUMED]
- [ ] `apps/web/components/field/__tests__/qr-ticket-image.test.tsx` for real QR element and no visible raw token/JTI. [ASSUMED]
- [ ] `apps/web/components/field/__tests__/scanner-check-in.test.tsx` for verify/consume/offline state UI. [ASSUMED]
- [ ] `apps/web/components/field/__tests__/field-monitor.test.tsx` for KPI-first layout and alerts. [ASSUMED]
- [ ] `apps/web/components/admin/__tests__/settlement-dashboard.test.tsx` for dashboard tabs and export actions. [ASSUMED]
- [ ] `apps/web/e2e/phase27-qr-check-in.spec.ts` for buyer QR -> protected route -> scanner-only entry -> duplicate rejection. [ASSUMED]
- [ ] `apps/web/e2e/phase27-offline-sync.spec.ts` for pending queue, reconnect sync, rejected conflict. [ASSUMED]
- [ ] `docs/runbooks/phase27-event-day-playbooks.md` artifact or equivalent location for OPS-03. [ASSUMED]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Require authenticated scanner-only/full-admin session for check-in page/API; logged-out QR opens login then returns. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| V3 Session Management | yes | Do not store raw PII in offline queue; avoid raw QR/JTI visible text; rely on existing session auth. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; ASSUMED] |
| V4 Access Control | yes | Extend existing `AdminCapabilitiesGuard` with scanner-only capabilities; deny normal members and deny scanner-only access to admin/settlement/refund/raw export. [VERIFIED: apps/api/src/common/guards/admin-capabilities.guard.ts; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| V5 Input Validation | yes | Add zod schemas for QR verify/consume/offline sync/monitor/export request payloads. [VERIFIED: apps/web/package.json; VERIFIED: apps/api/package.json; ASSUMED] |
| V6 Cryptography | yes | Use existing signed QR JWT/HMAC verification with algorithm allowlist; never decode-only. [VERIFIED: apps/api/src/modules/ticket/qr-ticket.service.ts; CITED: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html] |
| V7 Error Handling and Logging | yes | Redact tampered token/JTI details in UI/audit; use admin audit service for sensitive operations. [VERIFIED: apps/api/src/modules/admin/admin-audit.service.ts; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| V9 API Protection | yes | Make consume/sync idempotent by ticket state and device attempt id; rate-limit/check capability on endpoints. [ASSUMED] |

### Known Threat Patterns for Phase 27 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| QR token replay / duplicate entry | Tampering, Repudiation | Server-side conditional consume, explicit duplicate outcome, scan event with prior timestamp/staff/device context where safe. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; ASSUMED] |
| Normal user opens QR URL and attempts entry | Elevation of Privilege | Auth return plus scanner-only capability guard; normal member gets access denied. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Tampered QR enumeration | Information Disclosure | Generic rejection UI, no sensitive lookup details, redacted audit token/JTI. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| Offline queue tampering | Tampering | Server re-verifies every synced attempt and marks final pending/synced/rejected state. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |
| CSV formula injection | Tampering | Use `safeCsvRows`, not manual CSV generation. [VERIFIED: apps/api/src/modules/admin/csv-export.util.ts] |
| PII/raw token leakage in monitor/export/audit | Information Disclosure | Show KPI-first monitor, redact scan logs, restrict settlement exports to finance/full-admin, audit every raw export. [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md; VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/27-event-operations-settlement/27-CONTEXT.md` - locked user decisions, discretion, deferred scope. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - QR-02, FIELD-01, OPS-03, POST-01, POST-02 requirement text. [VERIFIED: local file]
- `.planning/STATE.md` - milestone state and Phase 26 caveat; noted as potentially lagging because status and current position conflict. [VERIFIED: local file]
- `AGENTS.md` - Korean response rule, GSD workflow/subagent guidance, project constraints, stack/convention excerpts. [VERIFIED: local file]
- `.planning/graphs/graph.json` absence and project skill directory absence - no graph/skill context was injected. [VERIFIED: shell probes]
- `.planning/phases/27-event-operations-settlement/27-UI-SPEC.md` - QR/scanner/monitor/settlement UI contract. [VERIFIED: local file]
- `apps/api/src/modules/ticket/qr-ticket.service.ts` - existing QR issuance, JWT verification, scanner contract. [VERIFIED: codebase]
- `apps/api/src/database/schema/tickets.ts` - existing ticket fields/status. [VERIFIED: codebase]
- `packages/shared/src/schemas/admin-operations.schema.ts` and `packages/shared/src/types/admin-operations.types.ts` - existing capability/bundle model. [VERIFIED: codebase]
- `apps/api/src/modules/admin/admin-audit.service.ts`, `apps/api/src/modules/admin/admin-booking.service.ts`, `apps/api/src/modules/admin/csv-export.util.ts` - existing audit/export patterns. [VERIFIED: codebase]
- `apps/web/components/booking/booking-complete.tsx` and `apps/web/components/reservation/reservation-detail.tsx` - current buyer QR metadata surfaces. [VERIFIED: codebase]
- `package.json`, `apps/web/package.json`, `apps/api/package.json` - runtime, scripts, dependency versions. [VERIFIED: codebase]
- `npm view qrcode.react`, `npm view idb`, `npm view @zxing/browser`, `npm view next`, `npm view @nestjs/core`, `npm view drizzle-orm`, `npm view @tanstack/react-query` - package version currency. [VERIFIED: npm registry]
- Context7 `/zpao/qrcode.react` - QR component props and rendering API. [VERIFIED: Context7 CLI]
- Context7 `/jakearchibald/idb` - IndexedDB wrapper API. [VERIFIED: Context7 CLI]
- Context7 `/zxing-js/browser` - optional browser QR scanner API. [VERIFIED: Context7 CLI]
- Drizzle transactions docs - transactional pattern. [CITED: https://orm.drizzle.team/docs/transactions]
- MDN `getUserMedia` docs - camera API secure-context/user-permission requirements. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia]
- MDN Barcode Detection API docs - limited availability caveat. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API]
- MDN PWA offline/background operation docs - offline queue/sync design context. [CITED: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation]
- OWASP JWT cheat sheet - JWT verification/security principles. [CITED: https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html]

### Secondary (MEDIUM confidence)

- Prior Phase 24/25/26 CONTEXT and VERIFICATION files for deferrals and existing QR/admin/export caveats. [VERIFIED: local files]
- Memory-derived prior QR field-scan architecture notes were used only as search guidance and were rechecked against current code where cited. [VERIFIED: memory + codebase]

### Tertiary (LOW confidence)

- None used as authoritative source. Low-confidence items are isolated in the Assumptions Log. [VERIFIED: research process]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - existing repo dependencies were checked and new packages were verified with `npm view` plus Context7 docs. [VERIFIED: package.json; VERIFIED: npm registry; VERIFIED: Context7 CLI]
- Architecture: HIGH - locked decisions and existing code clearly define QR, scanner-only RBAC, server truth, offline sync, monitor, and settlement boundaries. [VERIFIED: .planning/phases/27-event-operations-settlement/27-CONTEXT.md; VERIFIED: codebase]
- Pitfalls: HIGH for QR/RBAC/export/token leakage because current code and locked decisions expose the exact failure modes; MEDIUM for duplicate race/offline thresholds because implementation schema is still proposed. [VERIFIED: codebase; ASSUMED]
- Validation: MEDIUM - test frameworks are verified, but Phase 27-specific test files do not exist and must be created in Wave 0. [VERIFIED: codebase; ASSUMED]
- Security: HIGH for capability/JWT/redaction requirements; MEDIUM for final rate-limit/idempotency details because endpoint design is not yet implemented. [VERIFIED: codebase; ASSUMED]

**Research date:** 2026-05-22  
**Valid until:** 2026-06-21 for architecture decisions; re-run npm/doc checks within 7 days of implementation for fast-moving package versions. [ASSUMED]
