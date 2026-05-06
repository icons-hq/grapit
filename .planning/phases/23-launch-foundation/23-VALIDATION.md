---
phase: 23
slug: launch-foundation
status: planned_pending_execution
nyquist_compliant: planned_pending_execution
wave_0_complete: false
nyquist_note: "Revised plans include Wave 0/automated verification strategy, but tests have not executed yet."
created: 2026-05-06
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^3.2.0` for API/web unit tests; Playwright `^1.59.1` for web E2E |
| **Config file** | `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api test -- auth.service.spec.ts booking.service.spec.ts reservation.service.spec.ts && pnpm --filter @grabit/web test -- phone-verification.test.tsx phone-verification-i18n.test.tsx footer.test.tsx gnb-locale.test.tsx` |
| **Full suite command** | `pnpm test` plus targeted `pnpm --filter @grabit/web test:e2e` when web flows change |
| **Estimated runtime** | Quick targeted suites should stay under 180 seconds; full suite runtime depends on Playwright browser startup |

---

## Sampling Rate

- **After every task commit:** Run the targeted tests for the touched capability and `pnpm --filter @grabit/shared typecheck` if shared exports changed.
- **After every plan wave:** Run `pnpm --filter @grabit/api typecheck && pnpm --filter @grabit/web typecheck` plus API/web unit suites for changed apps.
- **Before `$gsd-verify-work`:** Run `pnpm test`, targeted Playwright locale/auth/booking-disabled E2E, and migration review.
- **Max feedback latency:** 180 seconds for quick checks; longer full-suite/E2E runs are wave gates, not per-task gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-W0-FLAG | 23-03, 23-08 | 0 | FLAG-01, FLAG-02 | T-23-01 | `BOOKING_ENABLED=false` blocks API mutation paths and Korean root URLs remain stable | unit/smoke | `pnpm --filter @grabit/api test -- booking.service.spec.ts reservation.service.spec.ts && pnpm --filter @grabit/web test -- i18n-routing.test.ts` | partial / W0 | pending |
| 23-W0-I18N | 23-04, 23-09, 23-14, 23-15, 23-16 | 0 | I18N-01, I18N-02 | T-23-02 | Locale routing is suggest-never-redirect, shell locale UI is visible, PhoneInput/auth/OTP/email copy is localized, and public event time/currency surfaces use KST/KRW anchors | unit/e2e | `pnpm --filter @grabit/web test -- i18n-routing.test.ts phone-input-i18n.test.tsx phone-verification-i18n.test.tsx sitemap.test.ts format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx gnb-locale.test.tsx layout-shell-locale.test.tsx` | W0 | pending |
| 23-W0-FORMAT | 23-14 | 0 | I18N-02 | T-23-02 | KST/KRW anchors and estimated local currency formatting are explicit and wired into public performance detail | unit/component/page | `pnpm --filter @grabit/web test -- format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx` | W0 | pending |
| 23-W0-TRANS | 23-05, 23-11, 23-13, 23-17 | 0 | TRANS-01, TRANS-02 | T-23-03 | Legal content cannot enter auto-translation jobs; reviewed machine translations keep labels on admin and public event surfaces; legal canonical files are locked to `ko/en` | unit | `pnpm --filter @grabit/api test -- translation.service.spec.ts && pnpm --filter @grabit/web test -- translation-review.test.tsx automatic-translation-label.test.tsx performance-detail-translation-label.test.tsx legal-content.test.ts` | partial / W0 | pending |
| 23-W0-AUTH | 23-06, 23-09, 23-10 | 0 | AUTH-01, AUTH-02 | T-23-04 | LINE remains absent, email verification tokens expire/latest-token-win, refresh family cap stays three active devices | unit | `pnpm --filter @grabit/api test -- auth.service.spec.ts auth.controller.spec.ts && pnpm --filter @grabit/web test -- auth-email-verification.test.tsx` | partial / W0 | pending |
| 23-W0-COMP | 23-07, 23-10, 23-12, 23-13, 23-17 | 0 | COMP-01, COMP-02 | T-23-05 | Consent audit rows are immutable/queryable, signup submit payload carries item/version/language rows, legal canonical files cover English fallback, and PII is masked by default | unit | `pnpm --filter @grabit/shared test -- auth.schema.test.ts && pnpm --filter @grabit/api test -- consent.service.spec.ts consent-audit.controller.spec.ts && pnpm --filter @grabit/web test -- signup-consent.test.tsx signup-submit-consent.test.tsx consent-audit-table.test.tsx legal-content.test.ts` | W0 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/constants/locales.test.ts` — supported locales, Korean root, and foreign route prefixes.
- [ ] `packages/shared/src/flags.test.ts` — boolean parsing for `BOOKING_ENABLED` with false-by-default behavior.
- [ ] `apps/web/i18n/routing.test.ts` — `ko` remains prefixless and `en`, `th`, `zh-CN`, `zh-TW` are prefixed.
- [ ] `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx` — launch locale labels fit the existing PhoneInput contract.
- [ ] `apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx` — auth/SMS OTP flow passes active locale into `PhoneInput`.
- [ ] `apps/web/components/layout/__tests__/gnb-locale.test.tsx` — desktop GNB renders `LocaleSwitcher` visibly with active locale state.
- [ ] `apps/web/components/layout/__tests__/layout-shell-locale.test.tsx` — public layout shell renders `LocaleSuggestion` and does not auto-navigate.
- [ ] `apps/web/components/i18n/locale-switcher.tsx` / `locale-suggestion.tsx` grep gates — explicit language choice, `aria-current`, session dismissal copy, visible shell wiring, and no automatic redirect.
- [ ] `apps/web/lib/i18n/format.test.ts` — KST anchor, KRW source amount, estimated conversion, and exchange-rate disclaimer for five launch locales.
- [ ] `apps/web/components/i18n/__tests__/format-components.test.tsx` — visible time/currency components render KST/KRW anchors and disclaimer text without relying on color alone.
- [ ] `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx` — current public performance detail renders KST anchor, KRW source amount, estimated conversion, and disclaimer.
- [ ] `apps/web/app/__tests__/sitemap.test.ts` — localized sitemap and hreflang alternates include five launch locales.
- [ ] `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` — API runtime flag parsing and default values.
- [ ] `apps/api/src/modules/translation/translation.service.spec.ts` — draft/review/publish, stale detection, and legal exclusion.
- [ ] `apps/api/src/modules/consent/consent.service.spec.ts` — itemized immutable consent capture and under-14/cross-border gates.
- [ ] `apps/api/src/modules/consent/consent-audit.controller.spec.ts` — operator query by item, version, language, timestamp, IP, and user.
- [ ] `apps/web/components/admin/__tests__/translation-review.test.tsx` — translation review queue state and automatic-translation label.
- [ ] `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx` — current public performance detail renders `AutomaticTranslationLabel` for AI-assisted translated content metadata.
- [ ] `apps/web/components/admin/__tests__/consent-audit-table.test.tsx` — dense filters, masked PII, and evidence display.
- [ ] `apps/web/components/auth/__tests__/auth-email-verification.test.tsx` — sent/resend/expired/verified/error states.
- [ ] `apps/web/components/auth/__tests__/signup-consent.test.tsx` — required/optional consent rows, legal dialogs, and refusal copy.
- [ ] `apps/web/components/auth/__tests__/signup-submit-consent.test.tsx` — signup submit payload includes consent item/version/language rows aligned with `ConsentService`.
- [ ] `packages/shared/src/schemas/auth.schema.test.ts` — register and social completion DTOs accept itemized consent rows and reject missing required consent rows.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legal English canonical copy sufficiency | TRANS-02, COMP-01 | Repo can enforce schema lock and fallback behavior, but final legal wording needs human sign-off | Review `ko`/`en` legal copy surfaces, confirm Thai/Chinese locales use English legal canonical fallback, and record evidence without raw PII |
| Canary rollback decision | FLAG-01 | Rollback is an operational launch gate, not a unit-test-only behavior | Run canary smoke for auth/session, booking-disabled API behavior, Korean root URL preservation, and locale routing; rollback immediately on failure per D-02 |
| External email/SMS delivery evidence | AUTH-01, I18N-02 | Real provider delivery requires configured Resend/Infobip credentials and test recipients | Capture redacted send/receive evidence for email verification resend and five launch-country SMS OTP paths |

---

## Security Threat References

| Ref | Threat | Mitigation |
|-----|--------|------------|
| T-23-01 | Direct API booking while UI is disabled | Backend flag gate on lock, reservation prepare, and payment confirm/request creation with unit/E2E coverage |
| T-23-02 | Locale auto-redirect breaks Korean SEO URLs or user sessions | URL-first locale resolution and suggest-never-redirect tests for `/`, `/en`, `/th`, `/zh-CN`, `/zh-TW` |
| T-23-03 | Legal copy is machine translated or published without manual canonical source | Schema-level legal content type and service guard that blocks legal content from translation jobs |
| T-23-04 | Email verification link replay or refresh token reuse | Latest-token-wins opaque token hashes, 30-minute expiry, consumed state, and existing family-wide reuse revoke |
| T-23-05 | Consent evidence tampering or PII leakage | Immutable append-only audit rows plus masked operator/admin query output |

---

## Validation Sign-Off

Planning note: `nyquist_compliant` is `planned_pending_execution`, not `true`, because Wave 0/test scaffolds are now explicitly assigned to plans but have not been executed yet. `wave_0_complete` remains `false` until execution creates and runs the listed tests.

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s for quick checks
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 scaffold exists and executes green

**Approval:** pending
