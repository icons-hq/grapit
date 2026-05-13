# Phase 25: Admin Operations Console - Context

**Gathered:** 2026-05-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 25 completes the admin operations console for the v2.0 fanmeet launch. It covers event registration and publish controls, multilingual operational content, Q&A/FAQ/notice/CS handling, admin security posture, sensitive-action audit, seat operations, and reservation CSV export.

This phase does not enable live booking cutover, Toss live-key cutover, k6/DR/on-call gates, field QR scanning, event-day monitor, settlement export, or post-event retrospective. `BOOKING_ENABLED=true` remains Phase 26 scope.

</domain>

<decisions>
## Implementation Decisions

### Event Approval Workflow

- **D-01:** Event publish stays fast and admin-led. Do not build separated operator/reviewer/approver/finance approval roles as a required workflow in Phase 25.
- **D-02:** Detailed event lifecycle states and publish checklist fields are delegated to the planner. The planner should choose the smallest model that satisfies roadmap success criteria without adding heavy approval bureaucracy.
- **D-03:** Event publish must show a confirmation modal before committing. On confirm, write an audit entry with actor, action, resource, status, changed fields, before/after values where safe, timestamp, and optional reason.

### CS, Q&A, FAQ, And Notice Operations

- **D-04:** Build a unified operations inbox for operational work instead of forcing operators to hunt across separate screens. The inbox should bring together unanswered Q&A, CS tickets, refund disputes, urgent notices, SLA state, and escalation priority.
- **D-05:** Multilingual support content uses manual Korean and English as the operator-controlled sources. Thai and Chinese launch-locale content may use assisted translation, but must carry review state and a translation-use indication.
- **D-06:** CS tickets need a 24-hour SLA view with countdown, overdue red highlight, and category/escalation visibility.
- **D-07:** Escalation should be automatic for high-risk categories: payment errors, unprocessed refunds, suspected abuse/fraud, and signup failures. Operators can still adjust status manually, but these categories should start high priority or escalated.

### Admin Security And Audit

- **D-08:** Admin MFA is intentionally deferred beyond Phase 25. This conflicts with the `ADMIN-03` requirement text, so downstream agents must not mark the MFA portion as PASS. Record it as an accepted risk / deferred security item until implemented in a later phase.
- **D-09:** IP allowlist behavior is delegated to the planner. The implementation should balance launch operations practicality with `ADMIN-03`, and must preserve audit evidence for allowlist exceptions or access denials.
- **D-10:** Audit all sensitive admin actions, including event publish/update, refund/admin refund, CS escalation, seat operation, reservation export, permission/security changes, and other high-risk operations introduced by this phase.
- **D-11:** Audit details use a masked diff model: actor, action, resource, before/after changed fields, IP, user agent, reason, and status are stored, but PII, tokens, secrets, raw OTPs, and credentials must be masked or excluded.

### Seat Operations And Reservation Export

- **D-12:** Seat operations are split by workflow. Reservation-specific actions such as cancelled-seat immediate open belong in the reservation detail modal. Seat disable/reactivate/history belongs in a dedicated seat operations panel.
- **D-13:** Seat disable/reactivate requires reason, confirmation modal, and audit log. These actions are money- and capacity-impacting operations and should not be silent toggles.
- **D-14:** Reservation CSV export must support the full seven filters from the milestone spec: event, tier, zone/floor, reservation status, domestic/overseas, payment method, and date range.
- **D-15:** Raw PII CSV export is allowed for admins. Because this increases privacy risk, every raw export must write audit evidence with actor, filters, export type, timestamp, and reason/status. Planner should avoid logging exported raw PII values themselves.

### the agent's Discretion

- Event lifecycle states are planner discretion as long as admin-led publish remains fast and publish confirmation/audit are enforced.
- Publish checklist fields are planner discretion, guided by roadmap success criteria and current schema.
- IP allowlist model is planner discretion, but MFA remains explicitly deferred and audit evidence remains mandatory.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope And Requirements

- `.planning/ROADMAP.md` - Phase 25 goal, requirements, merged source phases, and success criteria.
- `.planning/REQUIREMENTS.md` - `ADMIN-01`, `ADMIN-02`, `ADMIN-03`, and `ADMIN-04` requirement mapping.
- `.planning/PROJECT.md` - v2.0 fanmeet launch constraints, production cutover policy, and accepted-risk handling.
- `.planning/STATE.md` - Current state after Phase 24 and visible deferred/human-needed evidence conventions.
- `docs/v2.0-fanmeet-milestone-spec.md` - Source SP-5 details for event registration, Q&A/FAQ/notice/CS, dashboard expansion, seat operations, reservation export, admin security, and audit log.

### Prior Phase Decisions

- `.planning/phases/23-launch-foundation/23-CONTEXT.md` - Launch foundation decisions for content review, translation/legal lock, consent/audit foundations, and `BOOKING_ENABLED=false`.
- `.planning/phases/24-traffic-booking-payment-core/24-CONTEXT.md` - Manual cancelled-seat open as Phase 25 admin UI scope, refund/QR/seat operation foundations, and booking cutover caveats.

### Existing Admin Code

- `apps/web/app/admin/layout.tsx` - Current admin route guard checks `user.role === 'admin'` and renders the admin shell.
- `apps/web/components/admin/admin-sidebar.tsx` - Existing admin navigation structure to extend with operations inbox, seat operations, audit/export, or CS routes.
- `apps/web/app/admin/page.tsx` - Existing dashboard/KPI pattern and card/table visual structure.
- `apps/web/components/admin/performance-form.tsx` - Current event form, castings, multi-floor seat map editor, booking policy, and upload integration.
- `apps/web/components/admin/admin-booking-dashboard.tsx` - Existing booking list/search/filter and reservation detail modal integration.
- `apps/web/components/admin/admin-booking-detail-modal.tsx` - Current reservation detail/refund modal; likely integration point for reservation-specific immediate open.
- `apps/web/components/admin/consent-audit-table.tsx` - Existing masked audit query/filter table pattern.

### Existing API And Schema Code

- `apps/api/src/modules/admin/admin.module.ts` - Current admin module wiring.
- `apps/api/src/modules/admin/admin-performance.controller.ts` - Existing admin performance CRUD and seat-map save endpoints.
- `apps/api/src/modules/admin/admin-booking.controller.ts` - Existing booking detail, admin refund, and manual-open endpoints.
- `apps/api/src/modules/admin/admin-booking.service.ts` - Existing admin refund delegation, manual-open implementation, seat identity normalization, and booking operation audit insertion.
- `apps/api/src/common/guards/roles.guard.ts` - Current role guard only supports string roles from request user context.
- `apps/api/src/database/schema/users.ts` - Current `role` is a string defaulting to `user`; only `user | admin` is represented in shared types.
- `apps/api/src/database/schema/booking-operation-audit-logs.ts` - Existing manual-open/admin-refund audit table and action enum.
- `packages/shared/src/schemas/performance.schema.ts` - Current performance, seat map, booking policy, and admin form validation schemas.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `AdminSidebar`, `AdminLayout`, and dashboard table/card components can host new operations routes without creating a separate admin app.
- `PerformanceForm` already contains cast card, price tier, showtime, multi-floor SVG, and booking policy controls that Phase 25 can extend with publish confirmation and audit-aware state.
- `AdminBookingDashboard` and `AdminBookingDetailModal` already provide the reservation detail surface for admin refund; reservation-specific immediate open can follow this modal pattern.
- `ConsentAuditTable` provides a reusable pattern for masked evidence filtering and operator-readable audit rows.

### Established Patterns

- Current admin authorization is coarse-grained `@Roles('admin')` plus client-side `user.role === 'admin'`. Phase 25 decisions intentionally keep publish admin-led, but sensitive-action audit should be stronger than the current role model.
- Phase 23 established manual review for content and auditability for compliance-sensitive records. Phase 25 should reuse that pattern for operational content and CS evidence.
- Phase 24 already created booking-operation audit primitives for `manual_open` and `admin_refund`; Phase 25 should expand that audit taxonomy instead of inventing an unrelated log model.
- Existing admin UI favors dense tables, filters, modals, and KPI cards rather than marketing-style pages. New operations surfaces should follow that utilitarian pattern.

### Integration Points

- Add operations inbox routes/components under `apps/web/app/admin` and sidebar entries in `AdminSidebar`.
- Extend admin API controllers/services under `apps/api/src/modules/admin` for CS/Q&A/FAQ/notice, export, audit query, and seat operations.
- Extend schemas in `packages/shared/src` for operational content, CS tickets, audit records, export filters, and seat operation requests.
- Preserve Phase 26 boundary: Phase 25 can prepare operational console behavior, but must not perform live payment cutover or enable public booking.

</code_context>

<specifics>
## Specific Ideas

- Publish flow should feel quick: a single admin can publish, but a confirmation modal and audit record are mandatory.
- Operations inbox should prioritize work by SLA and escalation rather than by content type alone.
- MFA should be left visible as a deferred/accepted-risk item, not silently omitted.
- Raw PII export is allowed for admins, but audit of raw export activity is mandatory.

</specifics>

<deferred>
## Deferred Ideas

- Admin MFA is intentionally deferred beyond Phase 25 and must remain visible as an accepted risk / deferred security item until implemented.

</deferred>

---

*Phase: 25-Admin Operations Console*
*Context gathered: 2026-05-13*
