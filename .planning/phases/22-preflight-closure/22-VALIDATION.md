---
phase: 22
slug: preflight-closure
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-04
---

# Phase 22 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest for API/web unit and integration tests; Playwright for web E2E where public browser evidence is needed. |
| **Config file** | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts src/modules/auth/email/email.service.spec.ts` and `pnpm --filter @grabit/web test -- app/auth/reset-password/__tests__/reset-password.test.tsx content/legal/__tests__/legal-content.test.ts app/legal/__tests__/metadata.test.ts components/layout/__tests__/footer.test.tsx` |
| **Full suite command** | `pnpm test && pnpm build`; add `pnpm --filter @grabit/api test:integration` when Docker/testcontainers are available. |
| **Estimated runtime** | Focused tests: under 90 seconds; full suite/build: environment-dependent. |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the touched surface and update the matching evidence row.
- **After every plan wave:** Run `pnpm test`; run `pnpm --filter @grabit/api test:integration` for Valkey/SMS/booking cluster changes when Docker/testcontainers are available.
- **Before `$gsd-verify-work`:** `pnpm test && pnpm build` must pass, or each failure must be classified as `ACCEPTED_RISK` or `BLOCKER` in `22-VERIFICATION.md`.
- **Max feedback latency:** Keep automated feedback under 10 minutes for code/doc tasks; manual operator gates must record timestamp, owner, status, and evidence path.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| W0-SMS-UAT | TBD | 0/1 | PREF-01 | T-22-01 | No raw OTP, full phone number, reset token, cookies, or bearer headers committed. | unit + integration + manual UAT | `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts`; `pnpm --filter @grabit/api test:integration -- sms-cluster-crossslot` | automated: yes; manual evidence: W0 | pending |
| W0-EMAIL-UAT | TBD | 0/1 | PREF-01 | T-22-02 | Reset links, reset tokens, email addresses, cookies, and provider secrets are redacted. | unit + component + manual UAT | `pnpm --filter @grabit/api test -- src/modules/auth/email/email.service.spec.ts`; `pnpm --filter @grabit/web test -- app/auth/reset-password/__tests__/reset-password.test.tsx` | automated: yes; manual evidence: W0 | pending |
| W0-LEGAL-UAT | TBD | 0/1 | PREF-01 | T-22-03 | Legal sign-off records factual approval only and does not imply external counsel review. | static/component + manual sign-off | `pnpm --filter @grabit/web test -- content/legal/__tests__/legal-content.test.ts app/legal/__tests__/metadata.test.ts components/layout/__tests__/footer.test.tsx` | automated: yes; manual evidence: W0 | pending |
| W0-BASELINE | TBD | 0/1 | PREF-02 | T-22-04 | Historical v1.1 artifacts are referenced, not rewritten as newly executed proof. | docs verification | `git show bd8220e:.planning/ROADMAP.md >/dev/null` plus ledger/baseline grep checks | baseline artifact: W0 | pending |
| W0-HARDENING | TBD | 0/1 | PREF-03 | T-22-05 | Fragile points close as concrete fix, accepted risk with owner/date, or launch blocker. | integration + smoke + docs verification | `pnpm --filter @grabit/api test:integration -- booking-cluster-lua`; `node scripts/smoke-valkey-production.mjs --checks=health,lua,socketio,logs` with `GRABIT_SMOKE_ARTIFACT` set | register artifact: W0 | pending |

*Status values: pending, green, red, flaky.*

---

## Wave 0 Requirements

- [ ] `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md` - captures SMS, email, and legal operator evidence for PREF-01.
- [ ] `.planning/phases/22-preflight-closure/22-EVIDENCE-LEDGER.md` - gate matrix with `PASS`, `ACCEPTED_RISK`, and `BLOCKER` rows.
- [ ] `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md` - classifies v1.1 validation gaps for PREF-02 as `COMPLETE`, `ACCEPTED_CAVEAT`, or `BLOCKER`.
- [ ] `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` - closes Valkey/R2/SMS/email/legal fragile points for PREF-03.
- [ ] `.planning/phases/22-preflight-closure/22-VERIFICATION.md` - final Phase 22 verification and Phase 23 launch-readiness blocker statement.
- [ ] Production Valkey smoke evidence uses `GRABIT_SMOKE_ARTIFACT=.planning/phases/22-preflight-closure/artifacts/valkey-smoke.json` or an equivalent Phase 22 evidence path.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device signup OTP happy path and SMS failure-copy evidence | PREF-01 | Requires provider/device delivery and UI screenshots that local tests cannot prove. | Run `send-code -> SMS received -> verify-code success -> signup step3 verified`; separately capture wrong-code, expired/resend, and system-error copy. Mask phone numbers and OTPs. |
| Email reset-to-login through Gmail | PREF-01 | Requires Resend/provider acceptance plus real inbox receipt and login with the new password. | Capture Resend email id, Gmail receipt screenshot, reset confirm result, and successful login; redact email address, reset link, token, and cookies. |
| Legal public URL, mailbox receipt, and factual sign-off | PREF-01 | Requires public deployment state, support/privacy mailbox receipt, and operator approval. | Check legal URLs, Footer links, signup/booking dialogs, robots/canonical, support/privacy inbox receipt, and factual sign-off fields. |
| v1.1 validation baseline classification | PREF-02 | Requires judgment over historical evidence and caveats. | For each referenced v1.1 gap, classify as `COMPLETE`, `ACCEPTED_CAVEAT`, or `BLOCKER`, with source artifact path and reason. |
| Operational hardening risk classification | PREF-03 | Some provider/dashboard states require live access outside the repo. | For each Valkey/R2/SMS/email/legal fragile point, record concrete fix, accepted risk with owner/date, or launch blocker. |

---

## Validation Sign-Off

- [ ] All plans include focused automated verification where code surfaces are touched.
- [ ] Manual-only gates record owner, timestamp, status, evidence path, and redaction statement.
- [ ] No evidence artifact contains raw OTPs, reset tokens, reset links, cookies, bearer headers, full phone numbers, full email addresses, or provider secrets.
- [ ] `22-EVIDENCE-LEDGER.md`, `22-HUMAN-UAT.md`, `22-VALIDATION-BASELINE.md`, `22-HARDENING-REGISTER.md`, and `22-VERIFICATION.md` exist.
- [ ] `PASS`, `ACCEPTED_RISK`, and `BLOCKER` are used consistently across Phase 22 artifacts.
- [ ] Phase 23 can start only when `22-VERIFICATION.md` says there are no unresolved v1.1 launch-readiness blockers.
- [ ] `nyquist_compliant: true` remains set in this frontmatter.

**Approval:** pending
