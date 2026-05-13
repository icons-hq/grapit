# Phase 25: Admin Operations Console - Research

**Researched:** 2026-05-13
**Domain:** Admin operations console, RBAC/capabilities, masked audit logging, event publishing, support operations, seat operations
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Event publish stays fast and admin-led. Do not build separated operator/reviewer/approver/finance approval roles as a required workflow in Phase 25.
- **D-02:** Detailed event lifecycle states and publish checklist fields are delegated to the planner. The planner should choose the smallest model that satisfies roadmap success criteria without adding heavy approval bureaucracy.
- **D-03:** Event publish must show a confirmation modal before committing. On confirm, write an audit entry with actor, action, resource, status, changed fields, before/after values where safe, timestamp, and optional reason.
- **D-04:** Build a unified operations inbox for operational work instead of forcing operators to hunt across separate screens. The inbox should bring together unanswered Q&A, CS tickets, refund disputes, urgent notices, SLA state, and escalation priority.
- **D-05:** Multilingual support content uses manual Korean and English as the operator-controlled sources. Thai and Chinese launch-locale content may use assisted translation, but must carry review state and a translation-use indication.
- **D-06:** CS tickets need a 24-hour SLA view with countdown, overdue red highlight, and category/escalation visibility.
- **D-07:** Escalation should be automatic for high-risk categories: payment errors, unprocessed refunds, suspected abuse/fraud, and signup failures. Operators can still adjust status manually, but these categories should start high priority or escalated.
- **D-08:** Admin MFA is intentionally deferred beyond Phase 25. This conflicts with the `ADMIN-03` requirement text, so downstream agents must not mark the MFA portion as PASS. Record it as an accepted risk / deferred security item until implemented in a later phase.
- **D-09:** IP allowlist behavior is delegated to the planner. The implementation should balance launch operations practicality with `ADMIN-03`, and must preserve audit evidence for allowlist exceptions or access denials.
- **D-10:** Audit all sensitive admin actions, including event publish/update, refund/admin refund, CS escalation, seat operation, reservation export, permission/security changes, and other high-risk operations introduced by this phase.
- **D-11:** Audit details use a masked diff model: actor, action, resource, before/after changed fields, IP, user agent, reason, and status are stored, but PII, tokens, secrets, raw OTPs, and credentials must be masked or excluded.
- **D-12:** Seat operations are split by workflow. Reservation-specific actions such as cancelled-seat immediate open belong in the reservation detail modal. Seat disable/reactivate/history belongs in a dedicated seat operations panel.
- **D-13:** Seat disable/reactivate requires reason, confirmation modal, and audit log. These actions are money- and capacity-impacting operations and should not be silent toggles.
- **D-14:** Reservation CSV export must support the full seven filters from the milestone spec: event, tier, zone/floor, reservation status, domestic/overseas, payment method, and date range.
- **D-15:** Raw PII CSV export is allowed for admins. Because this increases privacy risk, every raw export must write audit evidence with actor, filters, export type, timestamp, and reason/status. Planner should avoid logging exported raw PII values themselves.

### the agent's Discretion

- Event lifecycle states are planner discretion as long as admin-led publish remains fast and publish confirmation/audit are enforced.
- Publish checklist fields are planner discretion, guided by roadmap success criteria and current schema.
- IP allowlist model is planner discretion, but MFA remains explicitly deferred and audit evidence remains mandatory.

### Deferred Ideas (OUT OF SCOPE)

- Admin MFA is intentionally deferred beyond Phase 25 and must remain visible as an accepted risk / deferred security item until implemented.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| ADMIN-01 | Event registration console with multilingual tabs, cast cards, venue/transport, multi-SVG, price tiers, sale settings, review/approval, and publish states. | Extend the existing `PerformanceForm`, shared performance schemas, admin performance controller/service, translation pipeline, and add a small internal publish lifecycle beside public sales status [VERIFIED: apps/web/components/admin/performance-form.tsx][VERIFIED: packages/shared/src/schemas/performance.schema.ts][VERIFIED: apps/api/src/modules/admin/admin.service.ts][VERIFIED: apps/api/src/database/schema/performances.ts]. |
| ADMIN-02 | Q&A 12 categories, FAQ, notices, CS 10 categories, escalation rules, SLA, signup failure lookup, and refund dispute retention. | Build a new support/operations domain because no runtime support/FAQ/notice/Q&A schema or module exists under API/shared/admin UI; reuse admin table/detail patterns from consent audit and translation queue [VERIFIED: find command over admin API schema UI shared paths][VERIFIED: apps/web/components/admin/consent-audit-table.tsx][VERIFIED: apps/web/app/admin/translations/page.tsx]. |
| ADMIN-03 | Admin MFA, IP allowlist, and sensitive action audit logs. | Preserve MFA as an accepted-risk/deferred item per D-08, implement backend-enforced IP allowlist, and centralize masked admin audit logging; current RBAC is only `user/admin`, and current booking audit logs are too narrow [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][VERIFIED: apps/api/src/common/guards/roles.guard.ts][VERIFIED: apps/api/src/database/schema/users.ts][VERIFIED: apps/api/src/database/schema/booking-operation-audit-logs.ts][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| ADMIN-04 | Banners, reservation CSV filters, seat disable/reactivate, immediate cancelled-seat opening, and seat history. | Extend existing banner CRUD, booking dashboard/detail modal, manual-open transaction, seat inventory schema, and WebSocket broadcast path; add missing CSV/export, seat disabled state/history, and reason/audit contracts [VERIFIED: apps/api/src/database/schema/banners.ts][VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts][VERIFIED: apps/web/components/admin/admin-booking-detail-modal.tsx][VERIFIED: apps/api/src/database/schema/seat-inventories.ts][VERIFIED: apps/api/src/modules/booking/booking.gateway.ts]. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- User-facing summaries and workflow notes must be Korean; technical identifiers remain English [VERIFIED: AGENTS.md].
- Follow the existing monolith-first Grabit architecture; do not introduce a separate admin service/app for Phase 25 [VERIFIED: AGENTS.md].
- Keep the documented stack from project architecture/stack guidance; use existing Next.js/NestJS/Drizzle/Zod/TanStack Query patterns [VERIFIED: AGENTS.md][VERIFIED: package.json][VERIFIED: apps/api/package.json][VERIFIED: apps/web/package.json].
- The root `.env` convention applies locally, and `drizzle-kit` through `pnpm --filter @grabit/api` needs `DOTENV_CONFIG_PATH=../../.env` [VERIFIED: AGENTS.md].
- Cloud Run production config must come from environment variables or Secret Manager, not checked-in `.env` files [VERIFIED: AGENTS.md].
- Local admin verification may use `admin@grapit.test / TestAdmin2026!`, web port `3000`, and API port `8080` unless the test harness overrides them [VERIFIED: AGENTS.md].
- GSD artifacts are project state; do not bypass the workflow by creating `PLAN.md` directly from research [VERIFIED: AGENTS.md].

## Summary

Phase 25 is not a greenfield admin app. The codebase already has an admin shell, sidebar, dashboard, performance form, banner CRUD, booking dashboard, booking detail modal, translation queue, consent audit table, and booking-operation audit primitives [VERIFIED: apps/web/app/admin/layout.tsx][VERIFIED: apps/web/components/admin/admin-sidebar.tsx][VERIFIED: apps/web/components/admin/performance-form.tsx][VERIFIED: apps/web/components/admin/banner-manager.tsx][VERIFIED: apps/web/components/admin/admin-booking-dashboard.tsx][VERIFIED: apps/web/components/admin/consent-audit-table.tsx][VERIFIED: apps/api/src/modules/admin/admin.module.ts]. Planning should therefore prioritize contract alignment and safe extension over page-by-page UI work.

The key hidden risks are cross-cutting: the current admin access model is a single `role` string with only `user | admin`; public `performances.status` is a sales/display state, not an internal publish lifecycle; `booking_operation_audit_logs` only supports `manual_open` and `admin_refund`; `banners` lacks placement/device/schedule fields; and runtime support/Q&A/FAQ/notice modules are absent [VERIFIED: apps/api/src/database/schema/users.ts][VERIFIED: packages/shared/src/types/user.types.ts][VERIFIED: apps/api/src/database/schema/performances.ts][VERIFIED: apps/api/src/database/schema/booking-operation-audit-logs.ts][VERIFIED: apps/api/src/database/schema/banners.ts][VERIFIED: find command over admin API schema UI shared paths].

There is also a launch-locale conflict that the plan must address before multilingual admin content work: Phase 25 UI/CONTEXT require `ko/en/th/zh-CN/zh-TW`, but current shared constants, DB enum, admin translation UI, consent audit filters, and translation target locales use `ja` instead of `zh-TW` [VERIFIED: .planning/phases/25-admin-operations-console/25-UI-SPEC.md][VERIFIED: packages/shared/src/constants/locales.ts][VERIFIED: apps/api/src/database/schema/users.ts][VERIFIED: apps/api/src/modules/translation/translation.service.ts][VERIFIED: apps/web/hooks/use-admin.ts][VERIFIED: apps/web/app/admin/translations/page.tsx].

**Primary recommendation:** Plan Phase 25 as contract-first work: locale alignment, capability/RBAC model, internal publish lifecycle, and centralized masked audit should land before support inbox, CSV exports, and seat-operations UI.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin shell/navigation and dense operations UI | Browser / Client | Frontend Server | Existing admin routes are under `apps/web/app/admin`, rendered through client components and shared local UI primitives [VERIFIED: apps/web/app/admin/layout.tsx][VERIFIED: apps/web/components/admin/admin-sidebar.tsx]. |
| Authoritative RBAC/capabilities and IP allowlist | API / Backend | Browser / Client | Client redirects are only affordances; Nest guards/controllers must enforce access decisions [VERIFIED: apps/web/app/admin/layout.tsx][VERIFIED: apps/api/src/common/guards/roles.guard.ts][CITED: https://docs.nestjs.com/security/authorization]. |
| Event registration and internal publish lifecycle | API / Backend | Database / Storage | Publish state affects catalog visibility, audit, cache invalidation, and translations; it should be persisted and changed through backend transactions [VERIFIED: apps/api/src/modules/admin/admin.service.ts][VERIFIED: apps/api/src/database/schema/performances.ts]. |
| Multilingual content review state | API / Backend | Browser / Client | Current translation sources/drafts/review/publish model is server-owned; UI should expose tabs/status, not invent a second translation store [VERIFIED: apps/api/src/modules/translation/translation.service.ts][VERIFIED: apps/web/app/admin/translations/page.tsx]. |
| Unified operations inbox, SLA, escalation | API / Backend | Browser / Client | The inbox aggregates Q&A, CS, refund disputes, notices, and signup failures; urgency and SLA state should be computed centrally for consistent filtering [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md][VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md]. |
| Reservation CSV export | API / Backend | Database / Storage | Export filters and raw PII access are sensitive backend decisions requiring audit evidence before data leaves the system [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][CITED: https://owasp.org/www-community/attacks/CSV_Injection]. |
| Seat immediate open, disable/reactivate, history | API / Backend | WebSocket runtime | Seat inventory is authoritative in the DB; existing manual-open code updates DB transactionally and broadcasts through `BookingGateway` [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts][VERIFIED: apps/api/src/modules/booking/booking.gateway.ts]. |
| Masked audit writing and querying | API / Backend | Database / Storage | Existing consent audit masks email/phone/IP before returning rows; Phase 25 needs a generalized masked admin audit writer/query surface [VERIFIED: apps/api/src/modules/consent/consent.service.ts][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |

## Repository Findings

| Area | Current Evidence | Planning Impact |
|------|------------------|-----------------|
| Admin module shape | `AdminModule` currently wires performance, banner, booking, upload, dashboard, diagnostics controllers/services [VERIFIED: apps/api/src/modules/admin/admin.module.ts]. | New operations/audit/security/seat exports should be added as cohesive admin submodules or controllers under the existing module, not a separate app. |
| Admin route shell | Sidebar only exposes dashboard, performances, banners, bookings, consent audit, translations [VERIFIED: apps/web/components/admin/admin-sidebar.tsx]. | Add operations inbox, seat operations, audit/security surfaces deliberately; avoid hiding Phase 25 work behind existing booking page only. |
| Client admin guard | Admin layout redirects if `user.role !== 'admin'` and renders `null` while redirecting [VERIFIED: apps/web/app/admin/layout.tsx]. | Keep backend guard authoritative; add capability-aware UI/empty/access-denied states rather than blank screens for future roles. |
| RBAC | `RolesGuard` checks `requiredRoles.includes(user.role)` against a single `role` string [VERIFIED: apps/api/src/common/guards/roles.guard.ts][VERIFIED: apps/api/src/database/schema/users.ts]. | Implement role bundles/capabilities as an additive model while keeping `admin` superuser compatibility. |
| Event form | Current form already covers title, genre, venue, dates, poster, description, price tiers, showtimes, cast cards, multi-floor seat maps, and booking policy [VERIFIED: apps/web/components/admin/performance-form.tsx][VERIFIED: packages/shared/src/schemas/performance.schema.ts]. | Extend existing form with locale tabs, transport, publish checklist, and confirmation instead of rebuilding it. |
| Event status | `performance_status` is `upcoming|selling|closing_soon|ended` [VERIFIED: apps/api/src/database/schema/performances.ts]. | Do not overload this as admin lifecycle; add internal lifecycle fields/table for draft/review/approved/published-like states chosen by planner. |
| Banners | Schema stores one `imageUrl`, `linkUrl`, `sortOrder`, `isActive` [VERIFIED: apps/api/src/database/schema/banners.ts]. | Phase 25 banner requirements need placement/device/date/status fields and probably upload variants. |
| Booking operations | `manualOpen()` validates cancelled reservation, checks event policy, inserts audit rows, updates `held_cancelled` seats to `available`, and broadcasts updates [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts]. | Reuse transaction/broadcast pattern, but add reason/confirmation/UI and richer audit metadata. |
| Seat inventory | Seat status enum has `available`, `locked`, `held_cancelled`, `sold`; no `disabled` state or history table exists [VERIFIED: apps/api/src/database/schema/seat-inventories.ts]. | Seat disable/reactivate requires schema/API/shared type changes and a history/audit read model. |
| CSV export | Existing admin booking API only supports `status`, `search`, and `page` [VERIFIED: apps/api/src/modules/admin/admin-booking.controller.ts][VERIFIED: apps/web/hooks/use-reservations.ts]. | Seven-filter export is new backend + UI work, not an extension of current list query alone. |
| Support operations | Runtime search found no support/FAQ/notice/Q&A/CS modules or schemas, aside from docs and diagnostics naming [VERIFIED: find command over admin API schema UI shared paths]. | ADMIN-02 is a real domain build: shared schemas, Drizzle tables, services, controllers, hooks, pages, tests. |
| Locale contract | Current runtime launch locale set is `ko,en,th,zh-CN,ja`, while Phase 25 UI-SPEC says inherited `ja` should be treated as drift [VERIFIED: packages/shared/src/constants/locales.ts][VERIFIED: packages/shared/src/constants/locales.test.ts][VERIFIED: .planning/phases/25-admin-operations-console/25-UI-SPEC.md]. | Put locale reconciliation in Wave 0; otherwise all multilingual support tests will encode the wrong launch contract. |
| Translation/legal boundary | Translation service blocks `legal`, `notice`, `refund`, and `booking_guide` content types from machine draft generation [VERIFIED: apps/api/src/modules/translation/translation.service.ts]. | Notices/support content may need manual-only or explicitly reviewed assisted translation rules; planner must not assume automatic drafts for notices. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | Workspace `^16.2.0`; registry `16.2.6` published 2026-05-07 | Admin App Router UI | Existing web app is Next.js 16, so Phase 25 should extend current routes/components [VERIFIED: apps/web/package.json][VERIFIED: npm view next version time]. |
| React | Workspace `^19.1.0` | Admin client components | Existing admin UI is React client components; no separate framework is needed [VERIFIED: apps/web/package.json]. |
| @tanstack/react-query | Workspace `^5.95.2`; registry `5.100.10` published 2026-05-11 | Admin server-state queries/mutations | Existing admin hooks use `useQuery`, `useMutation`, and invalidation; official docs recommend invalidating related queries after mutations [VERIFIED: apps/web/hooks/use-admin.ts][VERIFIED: apps/web/hooks/use-reservations.ts][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations]. |
| react-hook-form + @hookform/resolvers | Workspace `react-hook-form ^7.72.0`, `@hookform/resolvers ^5.2.2`; registry `7.75.0` and `5.2.2` | Event/support/admin forms | Existing `PerformanceForm` uses `useForm` with `zodResolver`; keep the pattern [VERIFIED: apps/web/components/admin/performance-form.tsx][CITED: https://github.com/react-hook-form/resolvers#typescript]. |
| NestJS | Workspace `@nestjs/core ^11.1.0`; registry `11.1.19` published 2026-04-13 | Admin API/controllers/guards | Current API is NestJS with guards, decorators, modules, services [VERIFIED: apps/api/package.json][VERIFIED: apps/api/src/modules/admin/admin.module.ts][CITED: https://docs.nestjs.com/security/authorization]. |
| Drizzle ORM / drizzle-kit | Workspace `drizzle-orm ^0.45.0`, `drizzle-kit ^0.31.0`; registry `0.45.2` and `0.31.10` | Schema/migrations/transactions | Existing schema and admin mutations use Drizzle; transactions are the right primitive for audit + state mutation [VERIFIED: apps/api/package.json][VERIFIED: apps/api/src/modules/admin/admin.service.ts][VERIFIED: npm view drizzle-orm version time][CITED: https://orm.drizzle.team/docs/transactions]. |
| Zod | Workspace API `^3.25.76`, shared `^3.24.0`; registry latest `4.4.3` | Shared request/response schemas | Existing shared contracts are Zod v3; do not bundle a Zod v4 migration into Phase 25 unless explicitly planned [VERIFIED: apps/api/package.json][VERIFIED: packages/shared/package.json][VERIFIED: npm view zod version time]. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | Workspace `^1.7.0` | Admin navigation/action icons | Continue UI-SPEC requirement to use local primitives and lucide icons [VERIFIED: apps/web/package.json][VERIFIED: .planning/phases/25-admin-operations-console/25-UI-SPEC.md]. |
| sonner | Workspace `^2.0.7` | Admin mutation feedback | Existing admin booking/banner flows use toast feedback [VERIFIED: apps/web/components/admin/admin-booking-dashboard.tsx][VERIFIED: apps/web/components/admin/banner-manager.tsx]. |
| Vitest | Workspace `^3.2.x`; registry latest `4.1.6` published 2026-05-11 | Unit/component tests | Existing config and scripts use Vitest 3; avoid framework upgrade during Phase 25 [VERIFIED: apps/api/vitest.config.ts][VERIFIED: apps/web/vitest.config.ts][VERIFIED: npm view vitest version time]. |
| Playwright | Workspace `@playwright/test ^1.59.1`; registry latest `1.60.0` published 2026-05-11 | Admin E2E smoke | Existing web config uses Playwright against `localhost:3000` with API started separately [VERIFIED: apps/web/playwright.config.ts][VERIFIED: npm view @playwright/test version time]. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing admin shell | Separate admin app | Adds auth/session/deploy complexity and contradicts monolith-first constraint [VERIFIED: AGENTS.md]. |
| Nest guard/decorator capability checks | Client-only route hiding | Client-only checks fail authoritative RBAC and audit requirements [VERIFIED: apps/web/app/admin/layout.tsx][CITED: https://docs.nestjs.com/security/authorization]. |
| Central audit writer | Ad hoc per-controller audit inserts | Ad hoc inserts will miss masking, reason/status consistency, and sensitive action coverage [VERIFIED: apps/api/src/database/schema/booking-operation-audit-logs.ts][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Existing Zod v3 shared contracts | Upgrade to Zod v4 now | Registry says v4 exists, but workspace is v3 and the phase already has schema migration risk [VERIFIED: packages/shared/package.json][VERIFIED: npm view zod version time]. |

**Installation:**

```bash
# No new runtime package is required by the research baseline.
# Use existing workspace packages and add code/tests only.
pnpm install --frozen-lockfile
```

**Version verification:** Current package facts were rechecked with `npm view <package> version time` on 2026-05-13 [VERIFIED: npm registry].

## Architecture Patterns

### System Architecture Diagram

```mermaid
flowchart TD
  AdminUser[Admin/operator browser] --> AdminShell[/admin App Router shell]
  AdminShell --> Hooks[React Query admin hooks]
  Hooks --> Api[API /api/v1/admin/*]
  Api --> AuthGuard[JWT + Roles/Capabilities + IP allowlist guard]
  AuthGuard --> Decision{Authorized?}
  Decision -- no --> DenyAudit[Audit denial/exception]
  Decision -- yes --> DomainService[Admin domain service]
  DomainService --> Validation[Zod DTO validation]
  Validation --> Tx[Drizzle transaction]
  Tx --> State[(PostgreSQL state)]
  Tx --> Audit[(Masked admin audit log)]
  DomainService --> Cache[Catalog/admin query invalidation]
  DomainService --> Broadcast[BookingGateway seat-update]
  Hooks --> UIState[Tables, dialogs, forms, SLA badges]
```

### Recommended Project Structure

```text
packages/shared/src/
├── constants/locales.ts             # launch locale source of truth
├── schemas/admin-operations.schema.ts # support/audit/export/seat operation DTOs
├── schemas/performance.schema.ts    # event publish/form additions
└── types/admin-operations.types.ts  # typed read models and capabilities

apps/api/src/database/schema/
├── admin-audit-logs.ts              # generalized masked audit
├── admin-access-allowlist.ts        # IP allowlist/exception records
├── support-*.ts                     # Q&A/FAQ/notice/CS/refund dispute tables
├── seat-operation-history.ts        # disable/reactivate/manual-open history
└── existing tables                  # additive changes only

apps/api/src/modules/admin/
├── admin-audit.service.ts           # one writer for sensitive actions
├── admin-security.controller.ts     # allowlist/audit/security surfaces
├── admin-operations.controller.ts   # unified inbox/read models
├── admin-seat-operations.service.ts # disable/reactivate/history/export logic
└── existing controllers/services    # performance/banner/booking extensions

apps/web/app/admin/
├── operations/page.tsx
├── seat-operations/page.tsx
├── audit/page.tsx
└── security/page.tsx

apps/web/components/admin/
├── operations-inbox.tsx
├── admin-audit-table.tsx
├── seat-operations-panel.tsx
├── reservation-export-panel.tsx
└── event-publish-confirmation-dialog.tsx
```

### Pattern 1: Backend-Enforced Capabilities

**What:** Keep `admin` as superuser compatibility, but add capability metadata for operator/reviewer/approver/finance-like access without creating D-01's heavy approval workflow.

**When to use:** Any admin endpoint that changes money, capacity, security, support status, or publication state.

**Example:**

```typescript
// Source: NestJS authorization docs + local RolesGuard pattern
export const ADMIN_CAPABILITIES_KEY = 'admin_capabilities';
export const AdminCapabilities = (...capabilities: AdminCapability[]) =>
  SetMetadata(ADMIN_CAPABILITIES_KEY, capabilities);

@Post('bookings/export')
@AdminCapabilities('reservations.export_raw')
async exportReservations(@CurrentUser('id') actorId: string, @Body() dto: ExportDto) {
  return this.adminSeatOperationsService.exportReservations(actorId, dto);
}
```

[CITED: https://docs.nestjs.com/security/authorization][VERIFIED: apps/api/src/common/guards/roles.guard.ts]

### Pattern 2: Transactional State Change + Audit

**What:** Mutate the business entity and write masked audit evidence in the same Drizzle transaction whenever possible.

**When to use:** Publish, seat disable/reactivate, manual open, raw CSV export request, refund/admin refund, support escalation, allowlist/security changes.

**Example:**

```typescript
await this.db.transaction(async (tx) => {
  const before = await this.loadSeat(tx, input.showtimeId, input.seatKey);
  await this.disableSeat(tx, input);
  await this.adminAudit.write(tx, {
    actorId,
    action: 'seat.disable',
    resourceType: 'seat_inventory',
    resourceId: before.id,
    status: 'success',
    reason: input.reason,
    diff: maskDiff({ before, after: { status: 'disabled' } }),
    ipAddress: requestIp,
    userAgent,
  });
});
```

[CITED: https://orm.drizzle.team/docs/transactions][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]

### Pattern 3: React Query Mutation Invalidation

**What:** Keep admin list/detail views coherent by invalidating the affected query families after each mutation.

**When to use:** Publish, banner reorder, support ticket update, translation review, seat operation, export status changes.

**Example:**

```typescript
const queryClient = useQueryClient();
return useMutation({
  mutationFn: (input: SeatDisableInput) =>
    apiClient.post('/api/v1/admin/seat-operations/disable', input),
  onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'seat-operations'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
    ]);
  },
});
```

[CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations][VERIFIED: apps/web/hooks/use-admin.ts]

### Anti-Patterns to Avoid

- **Client-only RBAC:** Hiding buttons in `/admin` does not satisfy ADMIN-03; enforce in Nest guards and keep UI capability-aware [VERIFIED: apps/web/app/admin/layout.tsx][VERIFIED: apps/api/src/common/guards/roles.guard.ts].
- **Overloading public `performance.status`:** `upcoming|selling|closing_soon|ended` is user-facing sales state, not publish approval lifecycle [VERIFIED: apps/api/src/database/schema/performances.ts].
- **Ad hoc audit tables per feature:** Use one masked audit writer/read model plus feature-specific history where needed, otherwise exports/support/security changes will drift [VERIFIED: apps/api/src/database/schema/booking-operation-audit-logs.ts][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].
- **CSV as raw string concatenation:** CSV formula injection and raw PII audit risks require escaping/sanitization and audited export metadata [CITED: https://owasp.org/www-community/attacks/CSV_Injection].
- **Treating MFA as done:** D-08 explicitly defers MFA; validation must record accepted risk, not PASS [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Authorization metadata and guard resolution | Custom request conditionals in every controller | Nest decorators + guard with `Reflector` | Official Nest pattern supports class/method metadata and keeps access checks centralized [CITED: https://docs.nestjs.com/security/authorization]. |
| Form state and schema validation | Local `useState` validation per field | react-hook-form + Zod resolver | Existing form stack already uses this and keeps frontend/backend schema parity [VERIFIED: apps/web/components/admin/performance-form.tsx][CITED: https://github.com/react-hook-form/resolvers#typescript]. |
| Async admin cache coherence | Manual state patching across tables/details | TanStack Query invalidation | Existing admin hooks already invalidate query families; official docs support mutation invalidation [VERIFIED: apps/web/hooks/use-admin.ts][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations]. |
| DB state + audit consistency | Separate best-effort audit writes after mutation | Drizzle transactions | Seat/manual-open already uses transaction for audit + seat state; keep that standard [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts][CITED: https://orm.drizzle.team/docs/transactions]. |
| Sensitive log masking | Feature-specific manual string replacement | Central `AdminAuditService` masking policy | OWASP logging guidance warns against logging secrets, tokens, and sensitive personal data [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Seat status fan-out | New WebSocket channel | Existing `BookingGateway.broadcastSeatUpdate` | Existing booking clients already listen to booking namespace seat updates [VERIFIED: apps/api/src/modules/booking/booking.gateway.ts]. |
| Translation review state | Separate locale columns on every support/event table | Existing translation source/draft/review model where allowed | Translation service already owns target locales, review, publish, stale state [VERIFIED: apps/api/src/modules/translation/translation.service.ts]. |

**Key insight:** Phase 25 is less about choosing new libraries and more about centralizing contracts. The planner should create shared schemas and backend invariants first so admin UI pages cannot drift from security, audit, and locale rules [VERIFIED: repository inspection].

## Common Pitfalls

### Pitfall 1: Marking MFA As Implemented

**What goes wrong:** ADMIN-03 text says MFA, but CONTEXT D-08 defers MFA.

**Why it happens:** Requirement wording and locked user decision conflict.

**How to avoid:** Add an accepted-risk/deferred MFA artifact and validation row; do not build or test a fake MFA pass in Phase 25 [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].

**Warning signs:** Verification report says ADMIN-03 PASS without a caveat for MFA.

### Pitfall 2: Role Explosion Into Approval Bureaucracy

**What goes wrong:** Planner builds mandatory operator/reviewer/approver/finance handoffs despite D-01.

**Why it happens:** Requirement says review/approval RBAC, but user chose fast admin-led publish.

**How to avoid:** Model capabilities and optional review metadata; do not require a multi-step approval workflow to publish [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].

**Warning signs:** Event cannot publish unless separate users approve in sequence.

### Pitfall 3: Locale Drift (`ja` vs `zh-TW`)

**What goes wrong:** New multilingual admin pages keep `ja` while Phase 25 UI-SPEC says `zh-TW`.

**Why it happens:** Current runtime constants and tests were previously migrated to `ja`.

**How to avoid:** Put locale decision reconciliation in the first implementation wave, update constants/schema/tests together, and do not add new Phase 25 locale surfaces until resolved [VERIFIED: packages/shared/src/constants/locales.ts][VERIFIED: apps/api/src/database/schema/users.ts][VERIFIED: .planning/phases/25-admin-operations-console/25-UI-SPEC.md].

**Warning signs:** New copy says `en/th/zh-CN/ja 초안 생성`.

### Pitfall 4: Audit Rows Without Masking or Status

**What goes wrong:** Sensitive actions write partial audit rows, or logs contain raw PII/export contents.

**Why it happens:** Existing booking audit table is narrow and lacks diff/reason/IP/user-agent/status fields.

**How to avoid:** Add centralized masked audit schema/service before feature-specific sensitive mutations [VERIFIED: apps/api/src/database/schema/booking-operation-audit-logs.ts][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].

**Warning signs:** Controller directly inserts audit rows with raw request body.

### Pitfall 5: CSV Export Leaks or Formula Injection

**What goes wrong:** Raw PII CSV exports are logged, stored unintentionally, or include formula payloads.

**Why it happens:** CSV looks like simple text generation.

**How to avoid:** Audit metadata only, require reason, escape CSV cells, and neutralize formula-leading characters before writing rows [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][CITED: https://owasp.org/www-community/attacks/CSV_Injection].

**Warning signs:** Export implementation joins arrays with commas and logs row data.

### Pitfall 6: Seat Disable Without Inventory Schema

**What goes wrong:** UI exposes disabled seats but backend status enum cannot persist them.

**Why it happens:** Current status enum has no `disabled`.

**How to avoid:** Add status/history schema and update shared `SeatState`, booking reads, and WebSocket mapping before UI controls [VERIFIED: apps/api/src/database/schema/seat-inventories.ts][VERIFIED: packages/shared/src/types/booking.types.ts].

**Warning signs:** Disabled seats are represented only by a client-side map.

### Pitfall 7: Support Inbox Treated As UI-Only

**What goes wrong:** An inbox page is built but no durable Q&A/FAQ/notice/CS/refund dispute model exists.

**Why it happens:** Admin shell makes it easy to add tables.

**How to avoid:** Define support schemas, state machine, SLA/escalation fields, and aggregation API before component work [VERIFIED: find command over admin API schema UI shared paths].

**Warning signs:** Operations inbox rows are hardcoded or derived only from frontend fixtures.

## Code Examples

### CSV Cell Sanitization

```typescript
// Source: OWASP CSV Injection guidance
export function safeCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replaceAll('"', '""')}"`;
}
```

[CITED: https://owasp.org/www-community/attacks/CSV_Injection]

### Masked Audit Diff Shape

```typescript
type AdminAuditEvent = {
  actorId: string;
  action: AdminAuditAction;
  resourceType: string;
  resourceId: string;
  status: 'success' | 'denied' | 'failed';
  reason?: string;
  changedFields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};
```

[VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]

### Existing Manual-Open Pattern To Extend

```typescript
await this.db.transaction(async (tx) => {
  await tx.insert(bookingOperationAuditLogs).values(auditRows);
  await tx.update(seatInventories).set({ status: 'available' }).where(...);
});

this.bookingGateway.broadcastSeatUpdate(showtimeId, seatId, 'available');
```

[VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts][VERIFIED: apps/api/src/modules/booking/booking.gateway.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Role string only (`user/admin`) | Capability metadata + backend guard, with `admin` as superuser compatibility | Current Nest docs support metadata/guard authorization; Phase 25 needs finer permissions | Avoids D-01 workflow bloat while satisfying RBAC enforcement [VERIFIED: apps/api/src/common/guards/roles.guard.ts][CITED: https://docs.nestjs.com/security/authorization]. |
| Ad hoc feature audit rows | Central masked audit event model | Phase 25 security/audit scope | Enables consistent masking, reason/status, and export/security evidence [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Manual query refresh | Mutation invalidation by query family | Existing admin hooks and TanStack guidance | Keeps admin lists/detail pages coherent after mutations [VERIFIED: apps/web/hooks/use-admin.ts][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations]. |
| CSV string concatenation | Explicit escaping and formula neutralization | OWASP CSV injection guidance | Prevents spreadsheet execution attacks on admin exports [CITED: https://owasp.org/www-community/attacks/CSV_Injection]. |

**Deprecated/outdated:**

- Treating `@tosspayments/sdk` as the current SDK is out of scope for Phase 25 and not needed here; existing Phase 24 payment code should remain untouched unless reservation/export reads require fields [VERIFIED: apps/web/package.json].
- Upgrading Zod/Vitest/Playwright to registry latest is not required for Phase 25; workspace versions are already configured and tests rely on them [VERIFIED: apps/api/package.json][VERIFIED: apps/web/package.json][VERIFIED: packages/shared/package.json].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

All claims in this research are verified from repository files, npm registry output, or cited primary documentation. No `[ASSUMED]` claims are intentionally used.

## Open Questions

1. **Locale source of truth**
   - What we know: Phase 25 UI-SPEC requires `zh-TW` and calls inherited `ja` drift, while current runtime/tests use `ja` [VERIFIED: .planning/phases/25-admin-operations-console/25-UI-SPEC.md][VERIFIED: packages/shared/src/constants/locales.ts].
   - What's unclear: Whether Phase 25 should migrate the whole app back to `zh-TW`, support both temporarily, or amend UI-SPEC.
   - Recommendation: Treat this as a Wave 0 decision; no new multilingual support/event work should encode `ja` until resolved.

2. **Capability names and seeded admin users**
   - What we know: DB/user types only support `user/admin`; planner needs operator/reviewer/approver/finance semantics without D-01 bureaucracy [VERIFIED: apps/api/src/database/schema/users.ts][VERIFIED: packages/shared/src/types/user.types.ts][VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].
   - What's unclear: Whether one seeded superadmin is enough for verification or test fixtures need multiple operator profiles.
   - Recommendation: Add capability bundles and keep `admin` as all-capabilities for existing seed.

3. **Notice translation policy**
   - What we know: UI/CONTEXT wants multilingual notices/support content, but translation service blocks `notice` from machine-generated drafts [VERIFIED: apps/api/src/modules/translation/translation.service.ts][VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].
   - What's unclear: Whether non-legal notices may use assisted translation after review.
   - Recommendation: Default notices to manual `ko/en` plus reviewed `th/zh-*` content unless planner records an explicit allowlist.

4. **IP allowlist source and break-glass model**
   - What we know: D-09 delegates allowlist behavior but requires audit evidence [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].
   - What's unclear: Env-configured allowlist vs DB-managed allowlist, and local/dev bypass rules.
   - Recommendation: Use env bootstrap + DB-managed changes with audit; allow local dev bypass only outside production.

5. **Raw CSV retention**
   - What we know: Raw PII CSV export is allowed, but raw PII must not be logged [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md].
   - What's unclear: Whether generated CSV files may be retained in object storage.
   - Recommendation: Stream/download without storing raw file unless a later decision defines retention and access rules.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | All JS/TS verification | ⚠️ available, not pinned version | Local shell `v24.13.0`; project `.nvmrc` is `22` | Run `nvm use` or CI Node 22 before final verification [VERIFIED: node --version][VERIFIED: .nvmrc]. |
| pnpm | Workspace scripts | ✓ | `10.28.1` | none needed [VERIFIED: pnpm --version]. |
| npm | Registry verification / ctx7 fallback | ✓ | `11.6.2` | none needed [VERIFIED: npm --version]. |
| Docker | DB/Redis integration fallback | ✓ | `29.1.3` | Use unit tests/mocks if no service needed [VERIFIED: docker --version]. |
| psql | Direct local DB inspection/migration smoke | ✗ | — | Use Drizzle migrations through app tooling or Dockerized Postgres; planner should not require bare `psql` unless installed [VERIFIED: psql --version]. |
| redis-cli | Direct Redis inspection | ✗ | — | Existing tests use mocks/testcontainers where applicable; do not require manual Redis CLI for Phase 25 planning [VERIFIED: redis-cli --version]. |
| Playwright CLI | Admin E2E smoke | ✓ | `1.59.1` | Web component/Vitest coverage when full E2E is too heavy [VERIFIED: pnpm --filter @grabit/web exec playwright --version]. |

**Missing dependencies with no fallback:** None for planning and unit/component validation.

**Missing dependencies with fallback:**

- `psql` and `redis-cli` are not available in the current shell; use app-level tests, Docker/testcontainers, or CI for service-dependent checks.
- Node version is newer than `.nvmrc`; planners should include `nvm use` or CI Node 22 before declaring final verification green.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x for API/shared/web unit/component tests; Playwright 1.59.1 for web E2E [VERIFIED: apps/api/package.json][VERIFIED: apps/web/package.json][VERIFIED: packages/shared/package.json]. |
| Config file | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` [VERIFIED: apps/api/vitest.config.ts][VERIFIED: apps/web/vitest.config.ts][VERIFIED: apps/web/playwright.config.ts]. |
| Quick run command | `pnpm --filter @grabit/api test -- src/common/guards/roles.guard.spec.ts src/modules/admin/admin-booking.service.spec.ts src/modules/admin/admin.service.spec.ts src/modules/translation/translation.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/consent-audit-table.test.tsx components/admin/__tests__/translation-review.test.tsx components/admin/__tests__/floor-seat-map-editor.test.tsx` |
| Full suite command | `pnpm test && pnpm --filter @grabit/web test:e2e` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ADMIN-01 | Event form supports locale tabs, cast cards, venue/transport, multi-SVG, pricing, sale settings, publish confirmation/audit. | unit + integration + component | `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/translation/translation.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/event-publish-confirmation.test.tsx` | ❌ Wave 0 for new publish tests; partial existing form/admin tests exist [VERIFIED: apps/api/src/modules/admin/admin.service.spec.ts][VERIFIED: apps/web/components/admin/__tests__/floor-seat-map-editor.test.tsx]. |
| ADMIN-02 | Operations inbox covers Q&A/FAQ/notices/CS/escalation/SLA/refund disputes/signup failure lookup. | unit + component + E2E smoke | `pnpm --filter @grabit/api test -- src/modules/admin/admin-operations.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/operations-inbox.test.tsx` | ❌ Wave 0. |
| ADMIN-03 | Backend RBAC/capabilities, IP allowlist, masked audit; MFA documented as accepted risk. | unit + integration + artifact check | `pnpm --filter @grabit/api test -- src/common/guards/admin-capabilities.guard.spec.ts src/modules/admin/admin-audit.service.spec.ts src/modules/admin/admin-security.controller.spec.ts` | ❌ Wave 0, except current `roles.guard.spec.ts` exists [VERIFIED: apps/api/src/common/guards/roles.guard.spec.ts]. |
| ADMIN-04 | Banners expanded, seven-filter CSV export audited, cancelled-seat immediate open, disable/reactivate/history. | unit + component + E2E smoke | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts src/modules/admin/admin-seat-operations.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/seat-operations-panel.test.tsx components/admin/__tests__/reservation-export-panel.test.tsx` | ❌ Wave 0 for new export/seat panel tests; manual-open service spec exists [VERIFIED: apps/api/src/modules/admin/admin-booking.service.spec.ts]. |

### Sampling Rate

- **Per task commit:** Run the narrow Vitest command for the touched API/shared/web files.
- **Per wave merge:** Run `pnpm --filter @grabit/api test`, `pnpm --filter @grabit/web test`, and targeted Playwright admin smoke.
- **Phase gate:** Full `pnpm test`, `pnpm --filter @grabit/api typecheck`, `pnpm --filter @grabit/web typecheck`, and accepted-risk verification for MFA before `$gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/shared/src/constants/locales.test.ts` and related runtime tests need explicit expected locale decision (`zh-TW` vs `ja`) before new multilingual admin work.
- [ ] `apps/api/src/common/guards/admin-capabilities.guard.spec.ts` should define capability semantics and admin superuser compatibility.
- [ ] `apps/api/src/modules/admin/admin-audit.service.spec.ts` should lock masking, diff, status, reason, IP/user-agent, and no raw PII.
- [ ] `apps/api/src/modules/admin/admin-operations.service.spec.ts` should define inbox aggregation, 24h SLA, and escalation rules.
- [ ] `apps/api/src/modules/admin/admin-seat-operations.service.spec.ts` should cover disable/reactivate/history and broadcast behavior.
- [ ] `apps/web/components/admin/__tests__/operations-inbox.test.tsx`, `event-publish-confirmation.test.tsx`, `seat-operations-panel.test.tsx`, and `reservation-export-panel.test.tsx` should cover expected admin workflows.
- [ ] `apps/web/e2e/admin-operations-console.spec.ts` should cover a minimal logged-in admin journey after APIs exist.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | Partial | Existing JWT/session auth remains; MFA is explicitly deferred as accepted risk and must not be marked PASS [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][CITED: https://owasp.org/www-project-application-security-verification-standard/]. |
| V3 Session Management | Yes | Preserve existing cookie/JWT session controls; do not move admin auth into client-only state [VERIFIED: apps/api/src/modules/auth/auth.service.ts][CITED: https://owasp.org/www-project-application-security-verification-standard/]. |
| V4 Access Control | Yes | Backend capability guard + IP allowlist enforcement; UI hiding is secondary [VERIFIED: apps/api/src/common/guards/roles.guard.ts][CITED: https://docs.nestjs.com/security/authorization]. |
| V5 Input Validation | Yes | Zod DTOs through shared schemas and `ZodValidationPipe`; CSV export filters must be validated [VERIFIED: apps/api/src/modules/admin/admin-performance.controller.ts][VERIFIED: packages/shared/src/schemas/performance.schema.ts]. |
| V6 Cryptography | Indirect | Do not log tokens/secrets/raw OTPs; no custom crypto is needed for Phase 25 audit/export work [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |

### Known Threat Patterns for Phase 25

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Privilege escalation through UI-only admin checks | Elevation of Privilege | Backend guard/capability checks on every sensitive endpoint [VERIFIED: apps/api/src/common/guards/roles.guard.ts][CITED: https://docs.nestjs.com/security/authorization]. |
| Raw PII in audit/export logs | Information Disclosure | Masked audit writer; log export metadata, not row values [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| CSV formula injection | Tampering | Prefix dangerous cell values and quote/escape all CSV cells [CITED: https://owasp.org/www-community/attacks/CSV_Injection]. |
| Unauthorized seat/capacity manipulation | Tampering / Repudiation | Reason + confirmation + transaction + audit + history + broadcast [VERIFIED: apps/api/src/modules/admin/admin-booking.service.ts][VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md]. |
| Missing support SLA escalation | Repudiation / Availability | Persist SLA due time, escalation reason, actor changes, and audit events [VERIFIED: docs/v2.0-fanmeet-milestone-spec.md][VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md]. |
| IP allowlist lockout or bypass | Denial of Service / Spoofing | Environment/bootstrap allowlist, DB-managed exceptions, denial audit, production-only enforcement rules [VERIFIED: .planning/phases/25-admin-operations-console/25-CONTEXT.md]. |

## Sources

### Primary (HIGH confidence)

- Repository files under `apps/api`, `apps/web`, `packages/shared`, `.planning`, and `docs` inspected with `rg`, `find`, and `nl` on 2026-05-13.
- npm registry version checks with `npm view <package> version time` for Next.js, NestJS, TanStack Query, Drizzle, drizzle-kit, react-hook-form, @hookform/resolvers, zod, Vitest, and Playwright [VERIFIED: npm registry].
- NestJS authorization docs via Context7 fallback and official docs - guards/metadata authorization [CITED: https://docs.nestjs.com/security/authorization].
- TanStack Query docs via Context7 fallback and official docs - invalidations from mutations [CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations].
- Drizzle transactions docs - transaction/rollback pattern [CITED: https://orm.drizzle.team/docs/transactions].
- OWASP Logging Cheat Sheet - sensitive data exclusion/masking in logs [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].
- OWASP CSV Injection page - spreadsheet formula injection risk [CITED: https://owasp.org/www-community/attacks/CSV_Injection].
- OWASP ASVS project page - security verification category framing [CITED: https://owasp.org/www-project-application-security-verification-standard/].

### Secondary (MEDIUM confidence)

- React Hook Form resolvers README - Zod resolver TypeScript usage [CITED: https://github.com/react-hook-form/resolvers#typescript].

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - workspace packages, npm registry, and official docs were rechecked.
- Architecture: MEDIUM-HIGH - repository seams are clear, but Phase 25 has unresolved locale and allowlist policy decisions.
- Pitfalls: HIGH - pitfalls are grounded in direct code gaps, locked CONTEXT decisions, and primary security guidance.
- Validation: MEDIUM - test infrastructure is strong, but most Phase 25-specific tests need Wave 0 creation.

**Research date:** 2026-05-13
**Valid until:** 2026-05-20 for registry/version facts; architectural findings should be rechecked if Phase 25 code changes land before planning.
