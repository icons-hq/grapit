---
phase: 25
slug: admin-operations-console
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-13
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for Admin Operations Console execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.x for web/API unit and component tests; Playwright 1.59.1 for browser E2E; API integration through the existing `apps/api/vitest.integration.config.ts` setup |
| **Config file** | `apps/web/vitest.config.ts`, `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @grabit/api test -- src/common/guards/roles.guard.spec.ts src/modules/admin/admin-booking.service.spec.ts src/modules/admin/admin.service.spec.ts src/modules/translation/translation.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/consent-audit-table.test.tsx components/admin/__tests__/translation-review.test.tsx components/admin/__tests__/floor-seat-map-editor.test.tsx` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @grabit/api test:integration && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-dashboard.spec.ts admin-event-publish.spec.ts admin-operations-inbox.spec.ts admin-rbac-and-security.spec.ts admin-export-and-seat-ops.spec.ts` |
| **Estimated runtime** | ~900 seconds for full phase gate, depending on local API/testcontainers startup |

---

## Sampling Rate

- **After every task commit:** Run the most specific unit/component test named in the task plus `pnpm --filter @grabit/api test -- src/modules/admin` when API admin code changed.
- **After every plan wave:** Run `pnpm lint && pnpm typecheck && pnpm test`.
- **Before `$gsd-verify-work`:** Run the full suite command above, or record the exact missing local dependency if API integration or Playwright cannot run.
- **Max feedback latency:** 15 minutes for full phase gate; 2 minutes for task-level unit/component checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-00-01 | 00 | 0 | ADMIN-01, ADMIN-03 | T-25-01 / T-25-04 / T-25-10 | Locale, RBAC/capability, publish-state, allowlist, masked audit, and deferred-MFA contracts are defined before fan-out; MFA remains accepted risk, not pass. | unit + typecheck | `pnpm typecheck && pnpm --filter @grabit/shared test -- src/constants/locales.test.ts && pnpm --filter @grabit/api test -- src/common/guards/roles.guard.spec.ts src/common/guards/admin-capabilities.guard.spec.ts src/modules/admin/admin-audit.service.spec.ts` | partial | pending |
| 25-01-01 | 01 | 1 | ADMIN-01 | T-25-02 / T-25-06 | Event publish requires confirmation and writes masked audit evidence without overloading public `performance.status`. | component + API unit + E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/translation/translation.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/event-publish-confirmation.test.tsx && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-event-publish.spec.ts` | partial | pending |
| 25-02-01 | 02 | 2 | ADMIN-02 | T-25-05 / T-25-07 | Operations inbox sorts unanswered Q&A, CS, refund disputes, notices, SLA state, high-risk escalations, and signup-failure lookup without leaking raw PII. | API unit + component + E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin-operations.service.spec.ts && pnpm --filter @grabit/web test -- components/admin/__tests__/operations-inbox.test.tsx && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-operations-inbox.spec.ts` | missing | pending |
| 25-03-01 | 03 | 3 | ADMIN-04 | T-25-03 / T-25-08 | Reservation CSV export supports seven filters and raw export audit logs store actor/filter/reason metadata, not exported raw PII values. | API unit + integration + E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts && pnpm --filter @grabit/api test:integration -- test/admin-seat-ops.integration.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-export-and-seat-ops.spec.ts` | partial | pending |
| 25-03-02 | 03 | 3 | ADMIN-04 | T-25-09 | Seat disable/reactivate and immediate cancelled-seat open require reason, confirmation, audit log, and seat broadcast after transactional state change. | API unit + E2E | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-export-and-seat-ops.spec.ts` | partial | pending |
| 25-04-01 | 04 | 4 | ADMIN-03 | T-25-01 / T-25-04 / T-25-10 | Server-side admin capability checks, allowlist denial/exception evidence, deferred MFA warning, and masked audit browse surfaces are enforced. | guard + API unit + E2E | `pnpm --filter @grabit/api test -- src/common/guards/roles.guard.spec.ts src/modules/admin/admin-audit.service.spec.ts && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts` | partial | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/constants/locales.test.ts` — launch locale contract explicitly covers the chosen `zh-TW` / `ja` reconciliation before new multilingual admin work.
- [ ] `apps/api/src/common/guards/admin-capabilities.guard.spec.ts` — backend capability enforcement for operator/reviewer/approver/finance actions.
- [ ] `apps/web/components/admin/__tests__/event-publish-confirmation.test.tsx` — locale tabs, publish confirmation, reason gating, changed-field summary.
- [ ] `apps/api/src/modules/admin/admin-audit.service.spec.ts` — masked diff, raw-export audit, allowlist denial/exception evidence.
- [ ] `apps/api/src/modules/admin/admin-operations.service.spec.ts` — inbox aggregation, SLA countdown/overdue classification, escalation defaults.
- [ ] `apps/api/test/admin-operations-console.integration.spec.ts` — support schema, export, and audit with real DB/testcontainers.
- [ ] `apps/web/e2e/admin-event-publish.spec.ts` — seeded-admin publish flow.
- [ ] `apps/web/e2e/admin-operations-inbox.spec.ts` — SLA/escalation/inbox flow.
- [ ] `apps/web/e2e/admin-rbac-and-security.spec.ts` — denied roles, allowlist messaging, deferred MFA surfacing.
- [ ] `apps/web/e2e/admin-export-and-seat-ops.spec.ts` — raw CSV export confirmation, immediate open, seat disable/reactivate/history.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production IP allowlist policy selection | ADMIN-03 | Final allowed CIDR/source policy may depend on deployment/operator network setup outside local tests. | Confirm chosen env or DB allowlist source, verify denial audit evidence in staging/prod-like environment, and record exception handling in `25-HUMAN-UAT.md` if production network state is unavailable. |
| MFA accepted-risk visibility | ADMIN-03 | MFA is explicitly deferred by D-08 and cannot be truthfully marked complete in automated verification. | Verify admin security UI and final `25-VERIFICATION.md` state show MFA as deferred/accepted risk, not PASS. |

---

## Threat References

| Ref | Threat | Required Mitigation |
|-----|--------|---------------------|
| T-25-01 | Client-only admin gating permits privilege escalation. | Server-side capability/role guard on every sensitive admin endpoint; UI affordances mirror server capability only. |
| T-25-02 | Internal publish lifecycle leaks into public catalog status. | Keep admin publish state separate from public `performance.status`; publish mutation controls public visibility deliberately. |
| T-25-03 | Raw PII leaks through CSV export or audit records. | Export audit stores actor, filters, export type, reason, status, and timestamp only; exported raw PII values are not logged. |
| T-25-04 | Allowlist bypass or false denial through inconsistent IP extraction. | Reuse the trusted request IP helper consistently and record denial/exception evidence. |
| T-25-05 | Support content model overload hides SLA/escalation state. | Use dedicated support/operations schema rather than `legal_content` for CS/Q&A/FAQ/disputes. |
| T-25-06 | Publish/update audit diff stores secrets or unsafe before/after values. | Use a centralized masked diff writer and field allow/deny lists. |
| T-25-07 | High-risk support categories fail to escalate. | Payment errors, unprocessed refunds, suspected abuse/fraud, and signup failures default to high priority/escalated. |
| T-25-08 | Reservation export filters are incomplete and operators export wrong population. | Require all seven filters: event, tier, zone/floor, reservation status, domestic/overseas, payment method, and date range. |
| T-25-09 | Seat operations corrupt inventory or leave stale client seat state. | Use transaction-first seat mutation plus existing seat broadcast path after success. |
| T-25-10 | MFA deferment is hidden and verification falsely passes `ADMIN-03`. | Surface MFA as accepted risk/deferred security item in UI, verification, and UAT artifacts. |

---

## Validation Sign-Off

- [x] All planned behavior groups have automated verification targets or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks should proceed without automated verify.
- [x] Wave 0 covers all missing test references.
- [x] No watch-mode flags in validation commands.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution
