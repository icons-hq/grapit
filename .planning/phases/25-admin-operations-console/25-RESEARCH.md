# Phase 25: Admin Operations Console - Research

**Researched:** 2026-05-13
**Domain:** Admin operations console, RBAC, masked audit logging, multilingual operations content
**Confidence:** MEDIUM

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
| ADMIN-01 | Operator can register and approve the fanmeet event with multilingual tabs, cast cards, multi-SVG upload, price tiers, sale settings, and review/approval RBAC. | Reuse the existing [`PerformanceForm`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/performance-form.tsx:146), add a separate admin publish lifecycle beside public `performance.status`, and extend the translation pipeline for locale tabs instead of creating a second event tool [VERIFIED: codebase grep]. |
| ADMIN-02 | Operator can manage Q&A, FAQ, notices, CS tickets, escalation rules, refund-dispute conversations, and 24-hour SLA indicators. | Build a new support/inbox domain under the existing admin shell because no Q&A/FAQ/CS schema currently exists, while reusing the dense table/detail pattern from translations and consent audit [VERIFIED: codebase grep]. |
| ADMIN-03 | Admin access requires MFA and IP allowlist, and sensitive actions write audit logs. | Preserve MFA as deferred accepted risk, add allowlist enforcement and denial/exception evidence, and centralize masked admin audit logging instead of relying on the current seat-only audit rows [VERIFIED: codebase grep][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| ADMIN-04 | Operator can manage banners, reservation CSV exports, seat disable/reactivate actions, cancelled-seat immediate opening, and seat-change history. | Extend the existing banner CRUD, booking dashboard, refund/manual-open flows, and booking gateway broadcast path; add missing export, seat history, and seat disable/reactivate contracts in shared/api/web layers [VERIFIED: codebase grep]. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Keep all user-facing documentation and workflow notes in Korean, while preserving technical identifiers in English [VERIFIED: codebase grep].
- Preserve the existing Grabit monolith-first stack and avoid introducing a separate admin app or parallel architecture just for Phase 25 [VERIFIED: codebase grep].
- Follow the repo-wide environment convention: the only `.env` file lives at the monorepo root, and `drizzle-kit` commands must set `DOTENV_CONFIG_PATH=../../.env` when run through `pnpm --filter @grabit/api` [VERIFIED: codebase grep].
- Cloud Run production configuration must come from environment variables or Secret Manager, not checked-in `.env` files [VERIFIED: codebase grep].
- Development verification should assume the seeded admin account `admin@grapit.test / TestAdmin2026!` and local ports `web:3000`, `api:8080` unless tests override them [VERIFIED: codebase grep].
- GSD workflow artifacts are first-class project state; planning/execution should remain within GSD workflow entry points rather than ad-hoc file edits [VERIFIED: codebase grep].

## Summary

The good news is that Phase 25 is not a greenfield admin build. The repo already has a reusable admin shell, booking dashboard, banner CRUD, translation review queue, consent audit table, dashboard metrics, and booking-operation audit primitives that can be extended rather than replaced [VERIFIED: codebase grep]. The biggest planning mistake would be treating the phase as “just more pages”; the real hidden work is cross-cutting contract alignment across locales, RBAC, publish state, and masked audit design [VERIFIED: codebase grep].

The most important structural finding is that the current data model is too coarse for Phase 25 in four places: `users.role` is still a single `user | admin` string, `booking_operation_audit_logs` only records `manual_open` and `admin_refund`, `banners` only stores one image URL plus `sortOrder/isActive`, and the performance model has only public sales statuses (`upcoming|selling|closing_soon|ended`) rather than an internal publish workflow [VERIFIED: codebase grep]. The phase also has a launch-locale contract drift: milestone/context/UI-SPEC require `ko/en/th/zh-CN/zh-TW`, while shared locale constants, translation targets, consent audit filters, user locale enum, and admin translation UI still use `ja` instead of `zh-TW` [VERIFIED: codebase grep].

The safest plan is to split Phase 25 into foundation-first waves: 1) locale/RBAC/audit/publish-state contract alignment, 2) event console + banner expansion, 3) unified operations inbox + support content domain, 4) reservation export + seat operations, and 5) security/audit surfaces + hardening. That structure matches the actual write seams in `packages/shared`, `apps/api/src/modules/admin|translation|consent`, and `apps/web/app/admin|components/admin`, and it avoids mixing schema-heavy support work with UI-only polish or Phase 26 cutover concerns [VERIFIED: codebase grep].

**Primary recommendation:** Plan Phase 25 as a five-wave phase with Wave 0 contract alignment for locales, RBAC, admin publish state, and masked audit before any inbox or seat-operation UI work.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin shell, navigation, tables, dialogs | Browser / Client | Frontend Server (SSR shell) | The existing admin experience is already a client-heavy App Router shell under `/admin`, and new work should extend those routes/components instead of adding a separate tool [VERIFIED: codebase grep]. |
| Authoritative RBAC and allowlist decisions | API / Backend | Browser / Client | Current client-side `user.role === 'admin'` redirects are only affordances; actual access control must be enforced in Nest guards/controllers and exposed to the UI as capabilities [VERIFIED: codebase grep][CITED: https://docs.nestjs.com/security/authorization]. |
| Event publish lifecycle, review metadata, and publish confirmation audit | API / Backend | Database / Storage | Publish state affects catalog visibility, cache invalidation, audit trails, and future cutover safety, so the source of truth must live with backend transactions and persisted state [VERIFIED: codebase grep]. |
| Unified operations inbox aggregation and SLA/escalation sorting | API / Backend | Browser / Client | The inbox must merge support/refund/translation/audit-backed data sets and compute urgency centrally before the UI renders operator queues [VERIFIED: codebase grep]. |
| Reservation CSV export and seat operation execution | API / Backend | Database / Storage | Export filters, seat disable/reactivate, and immediate open change authoritative reservation and seat inventory state and therefore belong in transactional backend flows [VERIFIED: codebase grep]. |
| Seat broadcast after manual or disabled/reactivated changes | API / Backend | Redis / WebSocket runtime | The repo already uses `BookingGateway.broadcastSeatUpdate(...)` after booking-seat mutations, so seat operations should reuse the same backend-to-socket path [VERIFIED: codebase grep]. |
| Masked audit storage and retrieval | API / Backend | Database / Storage | OWASP logging guidance and the existing consent audit implementation both point to application-generated events with controlled masking before persistence [VERIFIED: codebase grep][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Locale-tab authoring and translation review state | API / Backend | Browser / Client | Locale tabs are a UI affordance, but source text, review state, publication, and stale detection already live in the translation module and should remain server-owned [VERIFIED: codebase grep]. |

## Existing Reuse Seams

| Seam | Reuse For | Why It Matters |
|---|---|---|
| [`AdminLayout`](/Users/sangwopark19/icons/grapit/apps/web/app/admin/layout.tsx:16) + [`AdminSidebar`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/admin-sidebar.tsx:15) | New admin routes for inbox, seat operations, security, audit, and export | The shell, sticky header, mobile `Sheet`, and nav item pattern already exist; expanding them is cheaper than inventing a second shell [VERIFIED: codebase grep]. |
| [`PerformanceForm`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/performance-form.tsx:146) | Event form extension for locale tabs, transport info, publish review, and publish confirmation | Castings, showtimes, price tiers, multi-floor seat maps, uploads, and booking policy controls already exist and only need new sections/states [VERIFIED: codebase grep]. |
| [`AdminDashboardService`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/admin/admin-dashboard.service.ts:69) + [`/admin`](/Users/sangwopark19/icons/grapit/apps/web/app/admin/page.tsx:52) | KPI expansion and “needs attention” cards | The repo already has read-through dashboard caching, period filters, KPI cards, and top-list panels that can host new backlog counts [VERIFIED: codebase grep]. |
| [`AdminBookingDashboard`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/admin-booking-dashboard.tsx:26) + [`AdminBookingDetailModal`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/admin-booking-detail-modal.tsx:61) | Reservation-specific refund/immediate-open affordances | Reservation list/search/detail modal behavior is already in place; Phase 25 should add reason-gated immediate open here instead of inventing a different reservation surface [VERIFIED: codebase grep]. |
| [`AdminBookingService.manualOpen`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/admin/admin-booking.service.ts:289) + [`RefundService`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/refund/refund.service.ts:785) | Seat operation transactions, broadcast, and audit expansion | Manual open and admin refund already demonstrate seat identity normalization, DB transaction boundaries, and socket broadcast integration [VERIFIED: codebase grep]. |
| [`ConsentAuditTable`](/Users/sangwopark19/icons/grapit/apps/web/components/admin/consent-audit-table.tsx:86) + [`ConsentService.queryConsentAudit`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/consent/consent.service.ts:131) | Masked audit listing, filters, and detail preview | This is the clearest existing masked-audit pattern in the repo and should be generalized, not replaced [VERIFIED: codebase grep]. |
| [`TranslationController`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/translation/translation.controller.ts:40) + [`AdminTranslationsPage`](/Users/sangwopark19/icons/grapit/apps/web/app/admin/translations/page.tsx:41) | Locale review state, stale drafts, manual review/publish workflow | The translation subsystem already supports draft/review/published/stale and is the natural backbone for multilingual admin content [VERIFIED: codebase grep]. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | Workspace `^16.2.0`; current registry `16.2.6` published `2026-05-07` [VERIFIED: npm registry] | Admin routes, layout shell, client/server boundary | The current admin console already lives under `apps/web/app/admin`, so extending App Router avoids a duplicate admin frontend [VERIFIED: codebase grep]. |
| `@tanstack/react-query` | Workspace `^5.95.2`; current registry `5.100.10` published `2026-05-11` [VERIFIED: npm registry] | Admin query/mutation cache orchestration | Existing admin hooks already use query keys under `['admin', ...]`, and the official invalidation pattern matches the required publish/export/seat mutation refresh flow [VERIFIED: codebase grep][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations]. |
| NestJS | Workspace `@nestjs/core ^11.1.0`; current registry `11.1.19` published `2026-04-13` [VERIFIED: npm registry] | Admin controllers, guards, services, audit/allowlist entry points | Existing admin APIs already use `@Controller('admin')`, `@UseGuards(RolesGuard)`, and `ZodValidationPipe`, so Phase 25 should keep the same backend pattern [VERIFIED: codebase grep][CITED: https://docs.nestjs.com/security/authorization]. |
| Drizzle ORM | Workspace `^0.45.0`; current registry `0.45.2` published `2026-03-27` [VERIFIED: npm registry] | New admin/support/audit schema, migrations, transactions | Current admin mutations, booking operations, consent audit queries, and dashboard aggregation all use Drizzle and should stay transaction-first [VERIFIED: codebase grep]. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react-hook-form` + `@hookform/resolvers` | Workspace `react-hook-form ^7.72.0`; current registry `7.75.0` published `2026-05-02` [VERIFIED: npm registry] | Complex admin forms with cheap re-render behavior | Keep using it for event publish forms, support article forms, export reason dialogs, and seat operation reason capture; the official resolver docs already support strong typing with Zod [VERIFIED: codebase grep][CITED: https://github.com/react-hook-form/resolvers#typescript]. |
| Zod | Workspace `3.24.x/3.25.x`; current registry `4.4.3` published `2026-05-04` [VERIFIED: npm registry] | Shared request/response validation | Keep the repo on current Zod major for Phase 25 and do not bundle a Zod v4 upgrade into this admin phase; the resolver docs explicitly support Zod v3 and v4 [VERIFIED: codebase grep][CITED: https://github.com/react-hook-form/resolvers#typescript]. |
| Playwright | Workspace `@playwright/test ^1.59.1`; current registry `1.60.0` published `2026-05-11` [VERIFIED: npm registry] | Browser-level admin flow verification | Use it for seeded-admin login, publish confirmation, role denial, CSV export confirmation, and operations inbox smoke after implementation [VERIFIED: codebase grep]. |
| Existing translation module | Workspace internal [VERIFIED: codebase grep] | Review/publish/stale lifecycle for non-Korean admin content | Reuse it for event/support multilingual tabs instead of adding per-locale columns everywhere, but reconcile `ja` → `zh-TW` and the current `notice` auto-translation block first [VERIFIED: codebase grep]. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extend the current `/admin` shell | Build a separate admin SPA or sub-app | This would duplicate auth, routing, seeded-admin E2E login, and UI primitives for no Phase 25 benefit [VERIFIED: codebase grep]. |
| Add a separate admin publish state | Reuse the public `performance_status` enum for draft/review/published | Public search, home, status badges, admin lists, seed data, and dashboard metrics already depend on `upcoming|selling|closing_soon|ended`, so overloading that enum would leak internal workflow state into customer-facing behavior [VERIFIED: codebase grep]. |
| Add a generalized masked `admin_audit_logs` layer while preserving `booking_operation_audit_logs` for seat/refund history | Keep extending `booking_operation_audit_logs` for every sensitive action | The current booking-operation table is seatKey/reservationId-centric and cannot model publish/export/allowlist/security changes cleanly without null-heavy distortion [VERIFIED: codebase grep][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |

**Installation:**
```bash
# Baseline recommendation: no new package install is required.
# Reuse the existing workspace stack and add packages only if a concrete gap appears during planning.
```

**Version verification:** Current registry versions were verified with `npm view <package> version time --json` on 2026-05-13 [VERIFIED: npm registry].

## Architecture Patterns

### System Architecture Diagram

```text
Admin operator
  -> Next.js /admin routes and dialogs
    -> React Query hooks (admin query keys)
      -> NestJS /api/v1/admin/* + /api/v1/admin/translations + /api/v1/admin/consent-audit
        -> Guards / allowlist / capability checks
          -> Central masked admin audit writer
            -> Domain services
              -> Event publish + banner management
              -> Operations inbox + support content + SLA/escalation
              -> Reservation export + seat operations + refund/manual-open
              -> Translation review + consent audit reuse
                -> PostgreSQL tables (performances, banners, support content, admin_audit_logs, booking_operation_audit_logs, seat history)
                -> Redis / BookingGateway broadcast for seat-state changes
```

### Recommended Project Structure

```text
apps/web/app/admin/
├── page.tsx                     # dashboard + attention cards
├── operations/page.tsx          # unified inbox
├── performances/                # list/create/edit/publish flows
├── seat-operations/page.tsx     # seat-centric disable/reactivate/history
├── security/page.tsx            # allowlist, accepted-risk MFA, audit
└── bookings/page.tsx            # reservation list/detail/export actions

apps/web/components/admin/
├── operations-inbox.tsx
├── publish-confirm-dialog.tsx
├── seat-operations-panel.tsx
├── export-confirm-dialog.tsx
├── audit-log-table.tsx
└── security-status-card.tsx

apps/api/src/modules/admin/
├── admin-audit.service.ts
├── admin-capability.guard.ts
├── admin-operations.controller.ts
├── admin-operations.service.ts
├── admin-seat-operations.controller.ts
├── admin-seat-operations.service.ts
└── dto-or-zod-schemas shared from packages/shared

apps/api/src/database/schema/
├── admin-audit-logs.ts
├── admin-support-threads.ts
├── admin-support-messages.ts
├── admin-export-events.ts
├── admin-seat-operation-history.ts
└── admin-access-allowlist.ts

packages/shared/src/
├── schemas/admin-operations.schema.ts
├── schemas/admin-audit.schema.ts
└── types/admin-operations.types.ts
```

### Pattern 1: Separate Admin Publish Lifecycle From Public Catalog Status
**What:** Keep internal event workflow (`draft`, `review_ready`, `approved`, `published`, etc.) separate from the public `performance.status` enum (`upcoming|selling|closing_soon|ended`) [VERIFIED: codebase grep].  
**When to use:** Any new publish/review/approval state, checklist, or confirmation modal added in Phase 25.  
**Example:** Base the new state beside [`PerformanceStatus`](/Users/sangwopark19/icons/grapit/packages/shared/src/types/performance.types.ts:40) and [`performance_status`](/Users/sangwopark19/icons/grapit/apps/api/src/database/schema/performances.ts:11), not inside them [VERIFIED: codebase grep].

### Pattern 2: Central Masked Admin Audit Writer
**What:** Route all sensitive admin actions through one audit-writing service that records actor, capability, resource, masked before/after diff, reason, status, IP, and user agent while excluding raw secrets and raw exported PII [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].  
**When to use:** Publish, refund, seat disable/reactivate, immediate open, raw CSV export, allowlist change, CS escalation, and permission changes.  
**Example:** Use the masking approach from [`ConsentService.queryConsentAudit(...)`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/consent/consent.service.ts:131) as the read model, and keep the existing seat/refund append-only writes in [`booking_operation_audit_logs`](/Users/sangwopark19/icons/grapit/apps/api/src/database/schema/booking-operation-audit-logs.ts:17) as domain-level history [VERIFIED: codebase grep].

### Pattern 3: Thin Admin Pages, React Query Mutations, Explicit Invalidation
**What:** Keep page components thin, put fetch/mutate logic in hooks, and explicitly invalidate related query keys after each successful mutation [VERIFIED: codebase grep][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations].  
**When to use:** Event publish, banner reorder, export completion, support ticket status changes, and audit/security actions.  
**Example:**
```tsx
// Source: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
const queryClient = useQueryClient()

const mutation = useMutation({
  mutationFn: saveAdminChange,
  onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
    ])
  },
})
```

### Pattern 4: Reuse Translation Source/Draft Workflow For Locale Tabs
**What:** Keep Korean source text authoritative, use manual English input plus assisted Thai/Chinese drafts with explicit review state, and publish only reviewed content [VERIFIED: codebase grep].  
**When to use:** Event titles/descriptions/sales info, venue/transport content, FAQ/notice/Q&A answer bodies, and any operator-authored multilingual support copy.  
**Example:** The current translation controller/service already supports source creation, draft generation, review, stale invalidation, and publish under [`/api/v1/admin/translations/*`](/Users/sangwopark19/icons/grapit/apps/api/src/modules/translation/translation.controller.ts:40) [VERIFIED: codebase grep].

### Pattern 5: Use Zod-typed Forms End-To-End
**What:** Continue using `useForm(...zodResolver(schema))` with shared schemas so form shape, API payload, and DTO validation stay aligned [VERIFIED: codebase grep][CITED: https://github.com/react-hook-form/resolvers#typescript].  
**When to use:** Event publish forms, FAQ/notice forms, export filters, seat operation reason capture, and allowlist entry editing.  
**Example:**
```tsx
// Source: https://github.com/react-hook-form/resolvers#typescript
const form = useForm({
  resolver: zodResolver(schema),
})
```

### Anti-Patterns to Avoid
- **Client-only RBAC:** Hiding buttons in the browser without server enforcement leaves admin APIs open to privilege escalation [VERIFIED: codebase grep][CITED: https://docs.nestjs.com/security/authorization].
- **Overloading `performance.status`:** Reusing the public status enum for draft/review/publish states will ripple through public search, cards, badges, dashboard metrics, and seed data [VERIFIED: codebase grep].
- **Stuffing every action into `booking_operation_audit_logs`:** Publish/export/security actions do not naturally fit a `seatKey + reservationId` row model [VERIFIED: codebase grep].
- **Logging raw PII or export contents:** OWASP explicitly recommends masking or excluding tokens, passwords, payment data, and sensitive personal data from logs [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].
- **Treating `notice` as ready for assisted translation without a contract fix:** The admin translation form exposes `notice`, but the translation service currently blocks automatic translation for `notice` content types [VERIFIED: codebase grep].

## Schema/API/UI Change Areas

### Schema

| Area | Likely Change | Why |
|---|---|---|
| `users.role`, JWT payload, shared `UserProfile.role` | Expand beyond `user | admin` to Phase 25 admin capability semantics | The current user schema and frontend auth store only understand a single `admin` role string [VERIFIED: codebase grep]. |
| `performances` and/or companion admin-state table | Add an internal publish lifecycle and publish metadata, separate from public `performance.status` | Current public status is already used broadly and is not a safe place for draft/review/publish workflow [VERIFIED: codebase grep]. |
| `banners` | Add placement/device/window metadata | Current banner records only store `imageUrl`, `linkUrl`, `sortOrder`, and `isActive`, which is insufficient for hero/sub/detail + PC/mobile + exposure windows [VERIFIED: codebase grep]. |
| New support content domain | Add Q&A/FAQ/notice/CS/dispute tables with category, assignee, SLA, escalation, and message history | No schema for those entities exists today; only `legal_content` and translation tables are present [VERIFIED: codebase grep]. |
| Generalized audit domain | Add `admin_audit_logs` and possibly export/allowlist history tables while preserving `booking_operation_audit_logs` | Current booking-operation audit rows only capture action/seat/reservation/operator/time [VERIFIED: codebase grep]. |
| Seat operations | Add disable/reactivate/history storage | No seat-disable or seat-history schema exists today; only `seat_inventories` and cancelled-seat/manual-open flows exist [VERIFIED: codebase grep]. |
| Locale constants and translation targets | Replace or reconcile `ja` with `zh-TW` across shared constants, DB enums, translation targets, messages, and admin filters | The launch contract and the current codebase disagree here [VERIFIED: codebase grep]. |

### API

| Area | Likely Change | Why |
|---|---|---|
| Admin guard stack | Add capability-aware authorization and allowlist enforcement ahead of controllers | Current controllers all use coarse `@Roles('admin')` only [VERIFIED: codebase grep]. |
| Admin performance endpoints | Add publish-confirm, review summary, and publish-audit endpoints or mutation branches | Existing endpoints only create/update/delete/save seat map [VERIFIED: codebase grep]. |
| Admin booking endpoints | Add raw CSV export, manual-open reason capture, seat history, seat disable/reactivate, and possibly role-aware action visibility | Existing booking controller only lists/details/refund/manual-open [VERIFIED: codebase grep]. |
| New operations endpoints | Add inbox, FAQ, Q&A, notice, CS ticket, dispute, escalation, and SLA APIs | No such controller surface exists today [VERIFIED: codebase grep]. |
| Audit/security endpoints | Add masked audit query endpoints and allowlist status/config endpoints | Current reusable audit query endpoint exists only for consent audit [VERIFIED: codebase grep]. |

### UI

| Area | Likely Change | Why |
|---|---|---|
| Admin sidebar and route map | Group routes into dashboard, event/content, operations, and security/audit | Current sidebar only exposes dashboard, performances, banners, bookings, consent audit, and translations [VERIFIED: codebase grep]. |
| Performance form | Add locale tabs, venue/transport sections, publish checklist/review summary, confirmation modal, and publish state affordances | The current form is single-locale and save-only [VERIFIED: codebase grep]. |
| Operations inbox | New default operator landing experience | The context and UI-SPEC require one unified inbox, and no such page exists today [VERIFIED: codebase grep]. |
| Booking detail modal | Add immediate-open confirmation + reason capture, but keep seat-centric disable/reactivate/history in a separate panel | That split is mandated by D-12 and matches the current reservation-vs-seat seam [VERIFIED: codebase grep]. |
| Security/audit views | New accepted-risk MFA note, allowlist/access state, and masked audit exploration UI | No such admin security surface exists today [VERIFIED: codebase grep]. |

## Recommended Plan Waves

1. **Wave 0 — Contract Alignment**
   - Resolve `ja` vs `zh-TW`, define the admin RBAC/capability model, choose the IP allowlist storage/enforcement model, and choose the internal publish-state model before any large UI or schema fan-out.
   - This wave should also define the generalized admin audit payload and masking contract because event publish, export, security, and seat operations all depend on it.
2. **Wave 1 — Event Console And Banner Expansion**
   - Extend `PerformanceForm`, `AdminService`, shared schemas, and banner CRUD/model.
   - Deliver locale tabs, transport fields, publish confirmation, and banner placement/window metadata together because they share event/content authoring seams.
3. **Wave 2 — Unified Operations Inbox And Support Domain**
   - Add Q&A/FAQ/notice/CS/dispute schema, APIs, aggregation service, and dense inbox UI.
   - Keep this wave separate from export/seat operations so the support schema and SLA/escalation logic can stabilize first.
4. **Wave 3 — Reservation Export And Seat Operations**
   - Add seven-filter reservation CSV export, raw-export reason capture, seat disable/reactivate, seat history, and reservation-detail immediate open.
   - Reuse booking/refund/seat gateway seams already proven in Phase 24.
5. **Wave 4 — Security/Audit Surfaces And Hardening**
   - Add capability tests, allowlist enforcement, masked audit browsing, dashboard “needs attention” cards, and accepted-risk MFA surfacing.
   - End with browser/API verification, not with UI assembly only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mutation cache coherence | Ad-hoc local state sync after admin writes | `queryClient.invalidateQueries(...)` with existing admin query keys | The repo already uses React Query for admin hooks, and official invalidation patterns are purpose-built for this [VERIFIED: codebase grep][CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations]. |
| Form validation/type mapping | Separate browser-only validation objects and backend DTO drift | Shared Zod schemas plus `ZodValidationPipe` and `zodResolver` | Current performance/admin flows already use this stack and it keeps payload shape aligned end-to-end [VERIFIED: codebase grep][CITED: https://github.com/react-hook-form/resolvers#typescript]. |
| Multilingual review workflow | New per-locale shadow columns for every admin content type | Existing translation source/draft/review/publish pipeline | That subsystem already has stale detection, reviewed publish state, and automatic-translation labeling [VERIFIED: codebase grep]. |
| Seat identity/broadcast logic | New seat-key parsing and ad-hoc socket emitters | `normalizeReservationSeatIdentity(...)` + `BookingGateway.broadcastSeatUpdate(...)` | These paths already encode floor-aware seat identity and post-mutation broadcast behavior [VERIFIED: codebase grep]. |
| Audit masking rules | Copy-pasted masking in every controller | One audit service plus existing consent-audit masking read model | Current consent audit already masks email/phone/IP, and OWASP recommends a centralized logging handler with sanitization [VERIFIED: codebase grep][CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Admin app shell | Separate theme/layout/navigation system | Existing admin shell and local UI primitives | The existing shell already matches the approved Phase 25 UI contract and E2E helpers [VERIFIED: codebase grep]. |

**Key insight:** The repo already has the right primitives; Phase 25 is mostly about correcting cross-domain contracts and expanding a few narrow models, not about introducing new frontend or backend frameworks [VERIFIED: codebase grep].

## Common Pitfalls

### Pitfall 1: Overloading Public `performance.status`
**What goes wrong:** Draft/review/publish states get shoved into the public performance status enum and leak into customer-facing cards, search, dashboard counts, or filters [VERIFIED: codebase grep].  
**Why it happens:** The existing admin list already filters on public statuses, so it is tempting to extend the only visible status field [VERIFIED: codebase grep].  
**How to avoid:** Add a separate admin publish state and map it to the public sales status only when publish actually happens.  
**Warning signs:** Public `StatusBadge`, dashboard “active performances”, seed data, and search filters suddenly need to understand `draft` or `approved` [VERIFIED: codebase grep].

### Pitfall 2: Locale Drift Hidden Under “Translation”
**What goes wrong:** Planner builds five-locale admin tabs against `zh-TW`, but shared constants, DB enums, translation targets, and tests still expect `ja`, so types, filters, seeds, and overlays disagree [VERIFIED: codebase grep].  
**Why it happens:** Phase docs were updated to `zh-TW`, but the current codebase still carries a previous `ja` launch-locale contract [VERIFIED: codebase grep].  
**How to avoid:** Treat locale reconciliation as a Wave 0 contract task with shared-constant, DB-enum, message, test, and translation-target coverage.  
**Warning signs:** `isSupportedLocale('zh-TW') === false`, translation queue buttons still say `en/th/zh-CN/ja`, or admin locale filters omit `zh-TW` [VERIFIED: codebase grep].

### Pitfall 3: Audit Rows Leak the Thing They Were Meant To Protect
**What goes wrong:** Export logs store raw names/emails/phone numbers, publish diffs store secrets/tokens, or allowlist/security rows capture more PII than the logging tier should hold [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].  
**Why it happens:** The current booking-operation audit table is intentionally tiny, so expanding it without a masking service encourages direct payload dumps [VERIFIED: codebase grep].  
**How to avoid:** Log filter metadata, actor, resource, masked field diffs, and reason/status; never store raw CSV contents, tokens, passwords, OTPs, or payment data in audit previews or audit rows [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html].  
**Warning signs:** Audit schema proposals include `email`, `phone`, `csv_blob`, `accessToken`, `otp`, or arbitrary request bodies as first-class columns.

### Pitfall 4: Support Content Reuses The Wrong Existing Model
**What goes wrong:** `legal_content` gets overloaded for FAQ/Q&A/CS threads even though it only stores `type/slug/version/ko/en body/publishedAt` and has no category, assignee, SLA, escalation, or thread model [VERIFIED: codebase grep].  
**Why it happens:** `notice` already exists as a legal-content type, which can make it look like the support domain is “almost there” [VERIFIED: codebase grep].  
**How to avoid:** Use dedicated support-thread/message/article models for Q&A/FAQ/CS/disputes, and only reuse translation/audit patterns where they truly fit.  
**Warning signs:** Proposed schema tries to model refund disputes or SLA timestamps inside `legal_content`.

### Pitfall 5: Translation Contract Says “Notice” But Service Says “No”
**What goes wrong:** Admin notice authoring reaches the translation UI, but `generateDrafts()` returns `법적 고지는 자동 번역할 수 없습니다` because the service currently blocks `notice` content types alongside legal/refund/booking guides [VERIFIED: codebase grep].  
**Why it happens:** The admin translation form exposes `notice`, but `TranslationService.assertTranslatableContentType(...)` still treats `notice` as blocked [VERIFIED: codebase grep].  
**How to avoid:** Decide in Wave 0 whether operational notices become manually translated content or assisted-translation content, and update both UI and backend contract together.  
**Warning signs:** UI shows a notice translation CTA, but backend returns 400 on draft generation [VERIFIED: codebase grep].

### Pitfall 6: E2E Verification Starts Only Web And Forgets API
**What goes wrong:** Playwright admin tests fail with auth redirects or empty data because the web dev server starts automatically but the API on `:8080` is expected to be running separately [VERIFIED: codebase grep].  
**Why it happens:** `apps/web/playwright.config.ts` only manages the web server, while the login helper posts directly to `http://localhost:8080/api/v1/auth/login` [VERIFIED: codebase grep].  
**How to avoid:** Always start both `web` and `api` for browser verification, or use repo-standard dev orchestration before admin E2E.  
**Warning signs:** `loginAsTestUser` errors, `/admin` redirects to `/auth`, or dashboards load without data during browser tests [VERIFIED: codebase grep].

## Code Examples

Verified patterns from official sources:

### NestJS Role Metadata + Guard
```typescript
// Source: https://docs.nestjs.com/security/authorization
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### TanStack Query Mutation Invalidation
```tsx
// Source: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
const queryClient = useQueryClient()

const mutation = useMutation({
  mutationFn: saveAdminChange,
  onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'performances'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
    ])
  },
})
```

### `react-hook-form` + `zodResolver`
```tsx
// Source: https://github.com/react-hook-form/resolvers#typescript
const form = useForm<z.input<typeof schema>, any, z.output<typeof schema>>({
  resolver: zodResolver(schema),
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single client-visible `admin` role and `@Roles('admin')` gate [VERIFIED: codebase grep] | Capability-aware server enforcement with UI affordances derived from backend-allowed actions [ASSUMED] | Phase 25 planning baseline | Required for operator/reviewer/approver/finance separation without forcing a heavy approval workflow. |
| Public `performance.status` as the only lifecycle state [VERIFIED: codebase grep] | Separate internal publish lifecycle plus public sales status [ASSUMED] | Phase 25 planning baseline | Prevents draft/review/publish states from leaking into home/search/dashboard behavior. |
| `ja`-based launch locale contract in shared code [VERIFIED: codebase grep] | `zh-TW` launch-locale contract from milestone/context/UI-SPEC [VERIFIED: codebase grep] | Docs updated by 2026-05-13 | Locale reconciliation is a prerequisite for truthful multilingual Phase 25 planning. |
| Seat/refund-only booking-operation audit rows [VERIFIED: codebase grep] | General masked admin audit + preserved seat/refund append-only history [ASSUMED] | Phase 25 planning baseline | Publish/export/security logs need richer resource/reason/diff/IP/user-agent metadata than the current table can hold. |

**Deprecated/outdated:**
- Treating `ja` as the fifth launch locale is outdated relative to the current milestone/context/UI-SPEC contract [VERIFIED: codebase grep].
- Treating admin security as “MFA required in this phase” is outdated relative to D-08; MFA must remain an explicit deferred accepted risk in Phase 25 [VERIFIED: codebase grep].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A single-role enum plus capability map may be sufficient for Phase 25 if launch operations do not require one user to hold multiple concurrent admin roles [ASSUMED] | State of the Art / Open Questions | Planner may under-scope auth storage changes and later need a many-to-many grant table. |
| A2 | Synchronous HTTP CSV streaming is likely sufficient for Phase 25 launch-scale exports if export row counts remain moderate [ASSUMED] | Open Questions / Validation Architecture | Planner may under-scope export job infrastructure if operations need very large exports. |
| A3 | App-layer allowlist enforcement using the existing trusted IP helper is the best first implementation unless operations explicitly require self-serve allowlist editing [ASSUMED] | Open Questions / Security Domain | Planner may choose the wrong configuration surface and create avoidable operational friction. |

## Open Questions

1. **Do admins need multi-role membership or only one primary admin role at a time?**
   - What we know: the milestone names `operator/reviewer/approver/finance`, but the current schema and shared types only support one `role` string [VERIFIED: codebase grep].
   - What's unclear: whether one human operator needs multiple simultaneous role grants at launch.
   - Recommendation: if the answer is “mostly one role plus occasional super-admin”, keep the first phase on a single-role enum + capability matrix; otherwise choose a grant table immediately.

2. **Should operational notices use assisted translation or stay manual-only?**
   - What we know: D-05 allows assisted Thai/Chinese content, the admin translation UI exposes `notice`, but `TranslationService.assertTranslatableContentType(...)` currently blocks `notice` auto-drafts [VERIFIED: codebase grep].
   - What's unclear: whether notices are treated like operational content or like legal/manual-only content.
   - Recommendation: treat event/ops notices as operational content and update the service/UI contract together, while keeping legal/refund/booking-guide content blocked.

3. **Should the Phase 25 allowlist be environment-managed or database-managed?**
   - What we know: no allowlist schema or admin surface exists yet, but the app already trusts proxy IPs and has a shared request-IP helper [VERIFIED: codebase grep].
   - What's unclear: whether operators need to edit allowlist entries from the console during launch.
   - Recommendation: start with env/CIDR config plus audited denial/exception evidence unless there is a concrete self-service ops requirement.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | web/api build, tests, local verification | ✓ | `v24.13.0` [VERIFIED: local command] | Repo engine is `>=22.0.0`; no fallback needed. |
| pnpm | workspace scripts and filtered package commands | ✓ | `10.28.1` [VERIFIED: local command] | No fallback configured in repo scripts. |
| Docker | `apps/api` integration tests via `testcontainers` | ✓ | `29.1.3` [VERIFIED: local command] | If unavailable, skip `test:integration` and document the gap. |
| Playwright CLI | Admin E2E verification | ✓ | `1.59.1` workspace CLI [VERIFIED: local command] | Browser verification can still run through `pnpm --filter @grabit/web test:e2e` once dependencies are installed. |

**Missing dependencies with no fallback:**
- None [VERIFIED: local command].

**Missing dependencies with fallback:**
- None at the time of research [VERIFIED: local command].

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `Vitest 3.2.x` for unit/component/API tests + `Playwright 1.59.1` for browser E2E [VERIFIED: codebase grep][VERIFIED: local command] |
| Config file | `apps/web/vitest.config.ts`, `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/playwright.config.ts` [VERIFIED: codebase grep] |
| Quick run command | `pnpm --filter @grabit/web test -- components/admin/__tests__/consent-audit-table.test.tsx && pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts` |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @grabit/api test:integration && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-dashboard.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Multilingual event console, publish confirmation, publish audit, admin-led publish state | component + API unit + browser E2E | `pnpm --filter @grabit/web test -- components/admin/__tests__/performance-form-publish.test.tsx && pnpm --filter @grabit/api test -- src/modules/admin/admin-performance.controller.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-event-publish.spec.ts` | ❌ Wave 0 |
| ADMIN-02 | Unified operations inbox, SLA/escalation, Q&A/FAQ/notice/CS/dispute workflow | API unit/integration + browser E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin-operations.service.spec.ts && pnpm --filter @grabit/api test:integration -- test/admin-operations-console.integration.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-operations-inbox.spec.ts` | ❌ Wave 0 |
| ADMIN-03 | Role enforcement, allowlist decisions, masked audit evidence, deferred MFA surfacing | guard/unit + browser denial/E2E + audit query tests | `pnpm --filter @grabit/api test -- src/common/guards/roles.guard.spec.ts src/modules/admin/admin-audit.service.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts` | `roles.guard.spec.ts` ✅ / others ❌ Wave 0 |
| ADMIN-04 | Banner expansion, seven-filter CSV export, seat disable/reactivate/history, immediate open | API unit/integration + browser E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts src/modules/admin/admin-banner.service.spec.ts && pnpm --filter @grabit/api test:integration -- test/admin-seat-ops.integration.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-export-and-seat-ops.spec.ts` | `admin-booking.service.spec.ts` ✅ / others ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter @grabit/web test -- components/admin/... && pnpm --filter @grabit/api test -- src/modules/admin/...`
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test`
- **Phase gate:** `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @grabit/api test:integration && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-dashboard.spec.ts admin-event-publish.spec.ts admin-operations-inbox.spec.ts admin-rbac-and-security.spec.ts admin-export-and-seat-ops.spec.ts`

### Wave 0 Gaps

- [ ] `apps/web/components/admin/__tests__/performance-form-publish.test.tsx` — locale tabs, publish confirmation, reason gating, changed-field summary
- [ ] `apps/api/src/modules/admin/admin-audit.service.spec.ts` — masked diff, raw-export audit, deny/exception evidence
- [ ] `apps/api/src/modules/admin/admin-operations.service.spec.ts` — inbox aggregation, SLA coloring, escalation defaults
- [ ] `apps/api/test/admin-operations-console.integration.spec.ts` — support schema + export + audit with real DB/testcontainers
- [ ] `apps/web/e2e/admin-event-publish.spec.ts` — seeded-admin publish flow
- [ ] `apps/web/e2e/admin-operations-inbox.spec.ts` — SLA/escalation/inbox flow
- [ ] `apps/web/e2e/admin-rbac-and-security.spec.ts` — denied roles, allowlist messaging, deferred MFA surfacing
- [ ] `apps/web/e2e/admin-export-and-seat-ops.spec.ts` — raw CSV export confirmation, immediate open, seat disable/reactivate/history

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse the existing auth/session stack, surface MFA as deferred accepted risk in Phase 25, and do not falsely mark it complete [VERIFIED: codebase grep][CITED: https://owasp.org/www-project-application-security-verification-standard/]. |
| V3 Session Management | yes | Keep admin session enforcement on the server side and verify seeded-admin login through the existing refresh-token cookie flow used by Playwright [VERIFIED: codebase grep]. |
| V4 Access Control | yes | Add capability-aware admin guards on every sensitive endpoint; browser hiding alone is not sufficient [VERIFIED: codebase grep][CITED: https://docs.nestjs.com/security/authorization]. |
| V5 Input Validation | yes | Continue using shared Zod schemas and `ZodValidationPipe` across admin endpoints and forms [VERIFIED: codebase grep]. |
| V6 Cryptography | yes | Reuse existing JWT/OTP/ticket crypto primitives; do not introduce custom crypto for admin exports, audit, or allowlist features [VERIFIED: codebase grep]. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-only admin gating | Elevation of Privilege | Require server-side guards/capability checks on every admin route and mutation, then mirror permissions in the UI as affordances only [VERIFIED: codebase grep][CITED: https://docs.nestjs.com/security/authorization]. |
| Raw PII leakage through export or audit logs | Information Disclosure | Log export metadata and masked diffs only; never persist raw CSV payloads, tokens, passwords, OTPs, or payment data in admin audit records [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Audit log injection via unsanitized reasons or headers | Tampering | Centralize audit writes, sanitize CR/LF/delimiters, and treat request-derived data as untrusted before persistence [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html]. |
| Allowlist bypass through inconsistent IP extraction | Spoofing | Reuse `app.set('trust proxy', 1)` and `resolveTrustedRequestIp(req)` consistently for admin allowlist checks and denial evidence [VERIFIED: codebase grep]. |
| Seat-state corruption or stale broadcast after admin seat actions | Tampering | Reuse transaction-first seat inventory updates and `BookingGateway.broadcastSeatUpdate(...)` after every seat operation [VERIFIED: codebase grep]. |
| Unreviewed assisted translation reaching operators or end users | Repudiation | Keep draft/review/published states and explicit translation labels; do not bypass the review path for Thai/Chinese content [VERIFIED: codebase grep]. |

## Phase Boundaries And Scope-Creep Warnings

- Do **not** enable live booking cutover, Toss live keys, or `BOOKING_ENABLED=true` in Phase 25; those are explicitly Phase 26 gates [VERIFIED: codebase grep].
- Do **not** add canary controls, k6 load gates, DR tooling, on-call dashboards, or first-24-hour ticketing monitors beyond Phase 25’s internal admin backlog cards [VERIFIED: codebase grep].
- Do **not** implement QR field scanning, entry monitoring, offline scan sync, settlement export, or post-event retrospectives; those belong to Phase 27 [VERIFIED: codebase grep].
- Do **not** mark MFA as PASS in verification artifacts; Phase 25 must surface it as deferred accepted risk while shipping the rest of admin security/audit work [VERIFIED: codebase grep].

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase grep] `apps/web/app/admin/*`, `apps/web/components/admin/*`, `apps/web/hooks/use-admin.ts`, `apps/web/hooks/use-reservations.ts`, `apps/web/stores/use-auth-store.ts`, `apps/api/src/modules/admin/*`, `apps/api/src/modules/translation/*`, `apps/api/src/modules/consent/*`, `apps/api/src/modules/refund/refund.service.ts`, `apps/api/src/database/schema/*`, `packages/shared/src/*`, `.planning/*`, `docs/v2.0-fanmeet-milestone-spec.md`
- [VERIFIED: npm registry] `next`, `react`, `@tanstack/react-query`, `react-hook-form`, `zod`, `@nestjs/core`, `drizzle-orm`, `drizzle-kit`, `@playwright/test`
- [CITED: https://docs.nestjs.com/security/authorization] NestJS role metadata and guard patterns
- [CITED: https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations] React Query mutation invalidation pattern
- [CITED: https://github.com/react-hook-form/resolvers#typescript] `zodResolver` type inference and Zod v3/v4 compatibility
- [CITED: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html] High-risk event logging, event attributes, data to exclude, and centralized logging handler guidance
- [CITED: https://owasp.org/www-project-application-security-verification-standard/] ASVS v5 reference and version context

### Secondary (MEDIUM confidence)
- None.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Phase 25 should stay on the existing repo stack, and the relevant package versions plus official docs were verified this session.
- Architecture: MEDIUM - The main seams are clear from code, but RBAC storage and allowlist configuration still require planner choices.
- Pitfalls: HIGH - The biggest risks (`ja` vs `zh-TW`, public status overload, audit leakage, notice translation block, API/web E2E split) are directly visible in the current code and docs.

**Research date:** 2026-05-13
**Valid until:** 2026-06-12 for repo-structure findings; 2026-05-20 for npm-version freshness
