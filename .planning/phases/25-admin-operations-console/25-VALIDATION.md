---
phase: 25
slug: admin-operations-console
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-13
revised: 2026-05-13
---

# Phase 25 — Validation Strategy

> Per-task validation contract for the revised Admin Operations Console plan set.

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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 25-01-01 | 01 | 0 | ADMIN-01, ADMIN-02 | T-25-14 | Shared locale, visible-copy bundles, auth launch copy, and `StatusBadge` use exactly `ko/en/th/zh-CN/zh-TW`. | unit/component/grep | `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts && pnpm --filter @grabit/web test -- components/auth/__tests__/auth-email-verification.test.tsx && ! rg -n -e "'ja'" -e '"ja"' -e /ja -e 日本語 -e チケット予約 packages/shared/src/constants/locales.ts packages/shared/src/constants/locales.test.ts packages/shared/src/i18n/launch-copy-keys.ts packages/shared/src/i18n/launch-copy-keys.test.ts apps/web/lib/i18n/visible-copy.ts apps/web/components/auth/auth-launch-copy.ts apps/web/components/auth/__tests__/auth-email-verification.test.tsx apps/web/components/performance/status-badge.tsx apps/web/messages --glob 'zh-TW.json' --glob 'ja.json'` | pending |
| 25-02-01 | 02 | 0 | ADMIN-01, ADMIN-02, ADMIN-03 | T-25-15 | API schema/auth/email/SMS/seed locale contract accepts `zh-TW` and removes active `ja`. | unit/grep | `pnpm --filter @grabit/api test -- src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/sms/sms-copy.spec.ts && ! rg -n -e "'ja'" -e '"ja"' -e /ja -e 日本語 -e チケット予約 apps/api/src/database/schema/users.ts apps/api/src/modules/auth/auth.controller.ts apps/api/src/modules/auth/email/templates/email-verification.copy.ts apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts apps/api/src/modules/auth/email/email.service.spec.ts apps/api/src/modules/sms/sms-copy.ts apps/api/src/modules/sms/sms-copy.spec.ts apps/api/src/database/seed.mjs` | pending |
| 25-03-01 | 03 | 0 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-01, T-25-10 | Capability bundles and accepted-risk MFA status are backend contracts; `admin` remains all-capabilities fixture. | typecheck | `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api typecheck` | pending |
| 25-03-02 | 03 | 0 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-01, T-25-10 | Server-side `AdminCapabilitiesGuard` fails closed and allows only declared capabilities or admin superuser. | unit/typecheck | `pnpm --filter @grabit/api test -- src/common/guards/admin-capabilities.guard.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-16-01 | 16 | 0 | ADMIN-01, ADMIN-02 | T-25-14 | Public routing/format/runtime/i18n components and Toss payment widget use `zh-TW`, not `ja`. | unit/component/grep | `pnpm --filter @grabit/web test -- i18n/routing.test.ts lib/i18n/format.test.ts hooks/__tests__/booking-disabled-runtime.test.tsx components/i18n/__tests__/automatic-translation-label.test.tsx && ! rg -n -e "'ja'" -e '"ja"' -e /ja -e 日本語 -e チケット予約 apps/web/i18n/routing.ts apps/web/i18n/routing.test.ts apps/web/lib/i18n/format.ts apps/web/lib/i18n/format.test.ts apps/web/lib/runtime-flags.ts apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx apps/web/components/i18n/locale-suggestion.tsx apps/web/components/i18n/automatic-translation-label.tsx apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx apps/web/components/booking/toss-payment-widget.tsx` | pending |
| 25-17-01 | 17 | 0 | ADMIN-01, ADMIN-02 | T-25-14 | Phone input runtime, phone/auth tests, sitemap, and i18n smoke expectations use `zh-TW`. | unit/E2E spec prep/grep | `pnpm --filter @grabit/web test -- components/ui/__tests__/phone-input-i18n.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx app/__tests__/sitemap.test.ts && ! rg -n -e "'ja'" -e '"ja"' -e /ja -e 日本語 -e チケット予約 apps/web/components/ui/phone-input.tsx apps/web/components/ui/__tests__/phone-input-i18n.test.tsx apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx apps/web/app/sitemap.ts apps/web/app/__tests__/sitemap.test.ts apps/web/e2e/i18n-smoke.spec.ts` | pending |
| 25-18-01 | 18 | 0 | ADMIN-01, ADMIN-02, ADMIN-03 | T-25-15 | User, consent, translation, and DeepL contracts use `zh-TW`; provider target is not `JA`. | unit | `pnpm --filter @grabit/api test -- src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts` | pending |
| 25-19-01 | 19 | 0 | ADMIN-01, ADMIN-02, ADMIN-03 | T-25-15 | Admin translation and consent UI expose `zh-TW` and no Japanese option. | component | `pnpm --filter @grabit/web test -- components/admin/__tests__/translation-review.test.tsx components/admin/__tests__/consent-audit-table.test.tsx` | pending |
| 25-20-01 | 20 | 0 | ADMIN-01, ADMIN-02, ADMIN-03 | T-25-15 | Legal-sensitive page, fallback-label, and content-test surfaces use `zh-TW` with English canonical fallback; no unreviewed native legal copy. | component/grep | `pnpm --filter @grabit/web test -- app/legal/__tests__/legal-fallback.test.tsx content/legal/__tests__/legal-content.test.ts && ! rg -n -e "'ja'" -e '"ja"' -e /ja -e 日本語 -e チケット予約 apps/web/app/legal/terms/page.tsx apps/web/app/legal/privacy/page.tsx apps/web/app/legal/marketing/page.tsx apps/web/app/legal/__tests__/legal-fallback.test.tsx apps/web/components/legal/legal-fallback-label.tsx apps/web/content/legal/__tests__/legal-content.test.ts` | pending |
| 25-04-01 | 04 | 1 | ADMIN-01, ADMIN-04 | T-25-02, T-25-06 | Event lifecycle is separate from public sales status; venue/transport/banner schema is durable before migration. | unit/typecheck | `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-content.schema.spec.ts && pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/shared typecheck` | pending |
| 25-21-01 | 21 | 2 | ADMIN-02 | T-25-05, T-25-07 | Support/FAQ/notice schema persists SLA, escalation, locale, review, and translation-use state. | unit/typecheck | `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-content.schema.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-05-01 | 05 | 3 | ADMIN-03, ADMIN-04 | T-25-03, T-25-04, T-25-09 | General audit and allowlist schema stores masked evidence and exception metadata before feature writes. | unit/typecheck | `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-operations.schema.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-05-02 | 05 | 3 | ADMIN-03, ADMIN-04 | T-25-03, T-25-04, T-25-09 | Disabled seat state and seat operation history are durable with reason/audit linkage. | unit/typecheck | `pnpm --filter @grabit/api test -- src/database/schema/phase25-admin-operations.schema.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-06-01 | 06 | 4 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-11, T-25-12 | Drizzle migration is generated, destructive-grep reviewed, and applied or truthfully blocked before feature plans. | migration gate | `DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit generate --name=phase25_admin_operations_console && DOTENV_CONFIG_PATH=../../.env pnpm --filter @grabit/api exec drizzle-kit migrate` | pending |
| 25-07-01 | 07 | 5 | ADMIN-03, ADMIN-04 | T-25-03, T-25-04, T-25-10 | Masked audit writer/query centralizes safe diffs, reason/status, actor, IP, and request evidence. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-audit.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-07-02 | 07 | 5 | ADMIN-03, ADMIN-04 | T-25-03, T-25-04, T-25-10 | Allowlist and CSV helpers validate access decisions and neutralize formula-leading export cells. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-security.service.spec.ts src/modules/admin/csv-export.util.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-08-01 | 08 | 6 | ADMIN-01, ADMIN-03 | T-25-01, T-25-02, T-25-06 | Event update/publish backend requires capability and writes `event.update`/`event.publish` audit. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-08-02 | 08 | 6 | ADMIN-01, ADMIN-03 | T-25-01, T-25-02, T-25-06 | Publish UI shows venue/transport summary and confirmation before audited publish. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/event-publish-confirmation.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-09-01 | 09 | 6 | ADMIN-02, ADMIN-03 | T-25-05, T-25-07, T-25-03 | Operations inbox API aggregates SLA/escalation work and writes support escalation evidence. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-operations.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-09-02 | 09 | 6 | ADMIN-02, ADMIN-03 | T-25-05, T-25-07, T-25-03 | Operations inbox UI exposes SLA countdown, overdue state, escalation, and unified queue filters. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/operations-inbox.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-10-01 | 10 | 6 | ADMIN-01, ADMIN-02 | T-25-05, T-25-06 | FAQ/notice API enforces review/publish state and translation-use indication. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-support-content.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-10-02 | 10 | 6 | ADMIN-01, ADMIN-02 | T-25-05, T-25-06 | FAQ/notice UI supports authoring, review, publish, and assisted-translation indication. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/support-content-manager.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-11-01 | 11 | 6 | ADMIN-03, ADMIN-04 | T-25-03, T-25-08, T-25-06 | CSV export backend requires seven filters, reason, CSV safety, and metadata-only audit; refund audit remains masked. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-11-02 | 11 | 6 | ADMIN-03, ADMIN-04 | T-25-03, T-25-08, T-25-06 | Reservation export UI exposes all seven filters and reason capture before raw export. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/reservation-export-panel.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-12-01 | 12 | 7 | ADMIN-03, ADMIN-04 | T-25-09, T-25-01 | Seat operation APIs require reason, transaction, audit/history, and post-success broadcast. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-booking.service.spec.ts src/modules/admin/admin-seat-operations.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-13-01 | 13 | 7 | ADMIN-03, ADMIN-04 | T-25-06, T-25-01 | Banner management API enforces capability and writes audited placement/device/schedule changes. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-13-02 | 13 | 7 | ADMIN-03, ADMIN-04 | T-25-06, T-25-01 | Banner UI exposes placement/device/schedule controls without bypassing audited API behavior. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/banner-manager.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-22-01 | 22 | 8 | ADMIN-03, ADMIN-04 | T-25-09, T-25-01 | Seat operations UI confirms disable/reactivate/immediate-open and shows history state. | component/typecheck | `pnpm --filter @grabit/web test -- components/admin/__tests__/seat-operations-panel.test.tsx && pnpm --filter @grabit/web typecheck` | pending |
| 25-14-01 | 14 | 9 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-01, T-25-03, T-25-04, T-25-10 | Audit/security controllers require capability and expose masked audit/security state only. | unit/typecheck | `pnpm --filter @grabit/api test -- src/modules/admin/admin-audit.service.spec.ts src/modules/admin/admin-security.service.spec.ts && pnpm --filter @grabit/api typecheck` | pending |
| 25-14-02 | 14 | 9 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-01, T-25-03, T-25-04, T-25-10 | Audit/security UI shows masked diffs, allowlist state, and MFA accepted-risk instead of PASS. | typecheck/grep | `pnpm --filter @grabit/web typecheck && rg -n -e "MFA는 아직 적용되지 않았습니다" -e audit.read -e security.manage apps/web/app/admin/security/page.tsx apps/web/components/admin/admin-security-summary.tsx apps/web/components/admin/admin-audit-table.tsx apps/web/hooks/use-admin-security.ts` | pending |
| 25-23-01 | 23 | 10 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-01, T-25-10 | AdminModule/sidebar/registering routes enables route-level E2E for admin RBAC/security surfaces. | E2E/typecheck | `pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-rbac-and-security.spec.ts` | pending |
| 25-15-01 | 15 | 11 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-10, T-25-12, T-25-13 | Final verification distinguishes PASS/BLOCKER/ACCEPTED_RISK_DEFERRED and preserves Phase 26 boundaries. | full suite | `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @grabit/api test:integration && CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- admin-dashboard.spec.ts admin-event-publish.spec.ts admin-operations-inbox.spec.ts admin-rbac-and-security.spec.ts admin-export-and-seat-ops.spec.ts` | pending |
| 25-15-02 | 15 | 11 | ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04 | T-25-10, T-25-12, T-25-13 | Human UAT records allowlist checks and MFA accepted-risk without claiming MFA implementation. | grep | `rg -n -e accepted_risk -e MFA -e /admin/security -e /admin/audit -e BOOKING_ENABLED=true -e "Phase 26" -e "Phase 27" .planning/phases/25-admin-operations-console/25-HUMAN-UAT.md` | pending |

*Status: pending / green / red / flaky*

---

## Plan-Linked Test Targets

- [ ] `25-01`, `25-16`, `25-17`: shared/public-web locale tests lock `zh-TW` for constants, message loading, status badges, routing, runtime copy, Toss payment widget copy, phone input, sitemap, and smoke expectations.
- [ ] `25-02`, `25-18`, `25-19`, `25-20`: API/schema/seed/admin/consent/translation/legal locale tests remove active `ja` and lock `zh-TW`, including legal fallback labels and legal content tests.
- [ ] `25-03`: `apps/api/src/common/guards/admin-capabilities.guard.spec.ts` locks backend capability semantics and admin superuser compatibility.
- [ ] `25-04` and `25-21`: schema tests lock event/venue/transport/banner plus support/FAQ/notice database contracts before migration.
- [ ] `25-05`: schema tests lock audit/allowlist/seat-operation database contracts before migration.
- [ ] `25-06`: Drizzle generate/review/apply is the blocking gate before runtime feature verification.
- [ ] `25-07`: audit/security/CSV primitive tests run before sensitive feature plans.
- [ ] `25-08` through `25-14`, `25-22`, and `25-23`: feature plans create and run their API/component tests; route-level E2E runs only after AdminModule/sidebar wiring.
- [ ] `25-15`: full admin E2E suite runs after all routes/controllers/services are registered.

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
| T-25-11 | Migration SQL applies destructive or unintended schema changes. | Review generated SQL with destructive-statement grep before applying. |
| T-25-12 | Schema or validation gate evidence is misreported as complete. | Record exact migration/validation command results or explicit blockers. |
| T-25-13 | Verification or UAT artifacts leak raw CSV PII or secrets. | Keep verification artifacts to metadata/status evidence and avoid raw exported rows. |
| T-25-14 | Launch locale drift leaves active Japanese route/copy surfaces after the zh-TW decision. | Split locale reconciliation into ownership-scoped shared/public-web and API/admin plans with active `ja` grep gates. |
| T-25-15 | Admin/API translation and consent target locales diverge from the launch set. | Lock API/schema/admin/consent translation targets to `zh-TW` and remove active `ja` options before downstream admin work. |

---

## Validation Sign-Off

- [x] All planned behavior groups have automated verification targets or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks should proceed without automated verify.
- [x] Wave 0 covers all missing active locale runtime/test references.
- [x] No watch-mode flags in validation commands.
- [x] Feedback latency target documented.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution
