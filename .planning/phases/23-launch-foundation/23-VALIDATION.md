---
phase: 23
slug: launch-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Quick run command** | `pnpm --filter @grabit/shared typecheck && pnpm --filter @grabit/api test -- auth.service.spec.ts booking.service.spec.ts reservation.service.spec.ts && pnpm --filter @grabit/web test -- phone-verification.test.tsx footer.test.tsx` |
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
| 23-W0-FLAG | TBD | 0 | FLAG-01, FLAG-02 | T-23-01 | `BOOKING_ENABLED=false` blocks API mutation paths and Korean root URLs remain stable | unit/smoke | `pnpm --filter @grabit/api test -- booking.service.spec.ts reservation.service.spec.ts && pnpm --filter @grabit/web test -- i18n-routing.test.ts` | partial / W0 | pending |
| 23-W0-I18N | TBD | 0 | I18N-01, I18N-02 | T-23-02 | Locale routing is suggest-never-redirect and PhoneInput/auth/OTP/email copy is localized | unit/e2e | `pnpm --filter @grabit/web test -- i18n-routing.test.ts phone-input-i18n.test.tsx sitemap.test.ts` | W0 | pending |
| 23-W0-TRANS | TBD | 0 | TRANS-01, TRANS-02 | T-23-03 | Legal content cannot enter auto-translation jobs; reviewed machine translations keep labels | unit | `pnpm --filter @grabit/api test -- translation.service.spec.ts && pnpm --filter @grabit/web test -- translation-review.test.tsx legal-content.test.ts` | partial / W0 | pending |
| 23-W0-AUTH | TBD | 0 | AUTH-01, AUTH-02 | T-23-04 | LINE remains absent, email verification tokens expire/latest-token-win, refresh family cap stays three active devices | unit | `pnpm --filter @grabit/api test -- auth.service.spec.ts auth.controller.spec.ts && pnpm --filter @grabit/web test -- auth-email-verification.test.tsx` | partial / W0 | pending |
| 23-W0-COMP | TBD | 0 | COMP-01, COMP-02 | T-23-05 | Consent audit rows are immutable and queryable while PII is masked by default | unit | `pnpm --filter @grabit/api test -- consent.service.spec.ts consent-audit.controller.spec.ts && pnpm --filter @grabit/web test -- signup-consent.test.tsx consent-audit-table.test.tsx` | W0 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/constants/locales.test.ts` — supported locales, Korean root, and foreign route prefixes.
- [ ] `packages/shared/src/flags.test.ts` — boolean parsing for `BOOKING_ENABLED` with false-by-default behavior.
- [ ] `apps/web/i18n/routing.test.ts` — `ko` remains prefixless and `en`, `th`, `zh-CN`, `zh-TW` are prefixed.
- [ ] `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx` — launch locale labels fit the existing PhoneInput contract.
- [ ] `apps/web/app/__tests__/sitemap.test.ts` — localized sitemap and hreflang alternates include five launch locales.
- [ ] `apps/api/src/modules/feature-flags/feature-flags.service.spec.ts` — API runtime flag parsing and default values.
- [ ] `apps/api/src/modules/translation/translation.service.spec.ts` — draft/review/publish, stale detection, and legal exclusion.
- [ ] `apps/api/src/modules/consent/consent.service.spec.ts` — itemized immutable consent capture and under-14/cross-border gates.
- [ ] `apps/api/src/modules/consent/consent-audit.controller.spec.ts` — operator query by item, version, language, timestamp, IP, and user.
- [ ] `apps/web/components/admin/__tests__/translation-review.test.tsx` — translation review queue state and automatic-translation label.
- [ ] `apps/web/components/admin/__tests__/consent-audit-table.test.tsx` — dense filters, masked PII, and evidence display.
- [ ] `apps/web/components/auth/__tests__/auth-email-verification.test.tsx` — sent/resend/expired/verified/error states.
- [ ] `apps/web/components/auth/__tests__/signup-consent.test.tsx` — required/optional consent rows, legal dialogs, and refusal copy.

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s for quick checks
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 scaffold exists

**Approval:** pending
