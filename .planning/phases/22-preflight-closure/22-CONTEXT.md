# Phase 22: Preflight Closure - Context

**Gathered:** 2026-05-04T16:12:52+09:00
**Updated:** 2026-05-04T16:34:37+09:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 22 is now the merged v2.0 preflight phase. It closes the launch-facing operator/human gates inherited from Phase 14 SMS OTP, Phase 15 email cutover, and Phase 16 legal launch; backfills v1.1 validation artifacts into a launch-readiness baseline; and resolves or classifies Valkey/R2/SMS/email/legal fragility as launch blockers.

This phase does not add new fanmeet product functionality, global SMS expansion, multinational consent, admin console scope, or booking/payment features. It may plan direct fixes when a failed gate or hardening finding is on an already-shipped surface that must be stable before Phase 23 Launch Foundation expands the launch surface.

**Merged former phases:** 22 Operator UAT gates, 23 Nyquist validation backfill, 24 Operational hardening sweep.

</domain>

<decisions>
## Implementation Decisions

### Evidence Acceptance Policy
- **D-01:** Use a gate matrix. `PASS` requires direct evidence, `ACCEPTED_RISK` requires explicit risk acceptance, and `BLOCKER` means a launch path can break and evidence is missing or failing.
- **D-02:** `ACCEPTED_RISK` requires both maintainer and operator approval. The maintainer records the technical risk; the operator accepts the business launch risk.
- **D-03:** Phase 22 writes a v2.0-only evidence ledger and launch-readiness baseline. Do not rewrite historical Phase 14/15/16 artifacts as if they had new evidence; reference them as canonical context and supplement traceability only where the backfill task explicitly owns it.
- **D-04:** Use the status terms `PASS`, `ACCEPTED_RISK`, and `BLOCKER` consistently across the Phase 22 gate ledger, UAT, and verification docs.

### SMS Real-Device Gate
- **D-05:** SMS `PASS` requires a real-device signup OTP happy path and failure-copy verification. The happy path is `send-code -> SMS received -> verify-code success -> signup step3 verified`.
- **D-06:** Failure-copy verification must show that wrong code, expired/resend, and system-error messages are not collapsed into the same "wrong OTP" copy. This closes the Phase 14 server-message-priority intent.
- **D-07:** Run a short targeted observation window immediately after real-device UAT. Check the last 1 hour for `sms.verify_failed`, `CROSSSLOT`, and Sentry `provider=valkey` errors.
- **D-08:** SMS evidence should be screenshots plus sanitized logs. Mask test phone numbers and do not include raw OTPs.
- **D-09:** If SMS fails on the same Phase 14 SMS path, Phase 22 may include the fix plan. Global SMS expansion, provider-cost monitoring, and 5-country SMS policy belong to Phase 23 Launch Foundation unless an existing SMS fragility blocks preflight closure.

### Email Inbox Gate
- **D-10:** Email `PASS` requires Resend accepted evidence plus one inbox observation. The chosen inbox is Gmail.
- **D-11:** Naver/Daum untested or unconfirmed status defaults to `ACCEPTED_RISK`, not `BLOCKER`, as long as D-02 maintainer/operator approval is recorded.
- **D-12:** The user flow to verify is password reset email -> reset confirm -> login with the new password. Do not stop at email receipt only.
- **D-13:** Email evidence must be a redacted bundle: Resend email id, Cloud Run/Sentry result, and Gmail screenshot. Redact email address, reset token, reset link, and any secret values.

### Legal Public/Sign-Off Gate
- **D-14:** Legal technical `PASS` requires public URL checks, Footer link checks, signup/booking dialog content checks, and production robots/canonical checks.
- **D-15:** Legal sign-off is factual sign-off only. The operator confirms business identity, representative, business registration number, mail-order registration number, address, customer support contact, privacy/support mailbox, and effective date. External legal counsel review is not required in this phase.
- **D-16:** Include `support@heygrabit.com` and `privacy@heygrabit.com` mailbox receipt checks in the legal gate.
- **D-17:** If legal gate fails on direct Phase 16 launch surface gaps such as route, link, robots/canonical, placeholder gate, mailbox receipt, or sign-off document gaps, Phase 22 may include fix plans. Multinational consent, legal schema lock, and PIPA/PDPA/PIPL expansion belong to Phase 23 Launch Foundation.

### Validation Backfill Gate
- **D-18:** Validation backfill should classify each v1.1 gap as `COMPLETE`, `ACCEPTED_CAVEAT`, or `BLOCKER`, with an evidence path or explicit reason.
- **D-19:** Do not mark human-needed or operator-needed evidence as automated proof. If evidence still needs a person, keep it visible as a gate or accepted caveat.
- **D-20:** Traceability updates are allowed when they point to existing evidence or the new Phase 22 baseline; they must not imply prior work was newly executed.

### Operational Hardening Gate
- **D-21:** Valkey/R2/SMS/email/legal fragile points should close as one of: concrete fix, accepted risk with owner/date, or launch blocker.
- **D-22:** Pre-existing debug sessions should be closed, converted into explicit v2.0 risks, or linked to a Phase 22 fix task.
- **D-23:** Any direct code fix in this phase must stay on already-shipped operational surfaces. New fanmeet functionality starts in Phase 23+.

### the agent's Discretion
No discretionary implementation choices were delegated to the agent. Downstream agents should follow the locked decisions above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v2.0 Scope
- `.planning/ROADMAP.md` — Active roadmap; Phase 22 goal and success criteria.
- `.planning/REQUIREMENTS.md` — `PREF-01`, `PREF-02`, `PREF-03` requirements and v2.0 traceability.
- `.planning/PROJECT.md` — Project constraints, current milestone, and key decisions.
- `.planning/STATE.md` — Current deferred UAT/verification gaps and v2.0 starting state.
- `docs/v2.0-fanmeet-milestone-spec.md` — Source milestone spec; merged Phase 22-27 model and launch risk register.
- `.planning/milestones/v1.1-ROADMAP.md` — Archived v1.1 details for Phase 14/15/16/22 context.

### SMS Gate Context
- `.planning/debug/signup-sms-otp-verify-wrong.md` — Root cause for the SMS OTP CROSSSLOT failure and frontend wrong-copy masking.
- `.planning/quick/260424-l23-sms-throttle-integration-spec-ts-l220-27/SUMMARY.md` — Phase 14 integration test unblock and current SMS integration baseline.

### Email Gate Context
- `.planning/debug/password-reset-email-not-delivered-prod.md` — Root cause for Resend/heygrabit.com operational cutover failure.
- `apps/api/src/modules/auth/email/email.service.ts` — Resend send path, retry policy, Sentry capture, and non-dev hard-fail behavior.
- `apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx` — Existing reset request/confirm production API origin regression coverage.

### Legal Gate Context
- `.planning/debug/legal-pages-404-heygrabit.md` — Root cause for missing legal public URLs before Phase 16.
- `.planning/quick/260428-phase16-review-doc-fixes/SUMMARY.md` — Phase 16 doc/test fixes and remaining manual legal/operator gate.
- `apps/web/content/legal/__tests__/legal-content.test.ts` — Legal placeholder, business identity, effective date, and provider disclosure guards.
- `apps/web/app/legal/__tests__/metadata.test.ts` — Legal metadata, robots, and canonical tests.
- `apps/web/components/layout/footer.tsx` — Current Footer legal/support link surface.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/modules/sms/sms.service.ts`: canonical SMS key builders, hash-tagged Valkey OTP/attempt/verified keys, `sms.verify_failed` logging, and Sentry `provider=valkey` capture.
- `apps/web/components/auth/phone-verification.tsx`: existing UI path already prefers server `message` on `verified: false`, which supports the failure-copy gate.
- `apps/api/test/sms-cluster-crossslot.integration.spec.ts`: cluster-mode CROSSSLOT guard for SMS key shape.
- `apps/api/src/modules/auth/email/email.service.ts`: Resend accepted id path, retry, Cloud Run log text, and Sentry `component=email-service` capture.
- `apps/web/app/auth/reset-password/page.tsx` and tests: production reset request/confirm flow already uses public API origin and supports the email UAT path.
- `apps/web/app/legal/*`, `apps/web/components/legal/terms-markdown.tsx`, and legal tests: existing public legal rendering, metadata, robots, and content guard assets.

### Established Patterns
- Do not mark missing human/operator evidence as automated proof.
- Redact PII, OTPs, reset links, tokens, and secrets in planning artifacts.
- Keep historical v1.1 artifacts intact in this phase; write a new v2.0 evidence ledger.
- Treat direct launch-surface regressions as Phase 22 candidates, but defer broader feature expansion to mapped v2.0 phases.
- Preserve the requirement IDs exactly; only the phase execution grouping changed.

### Integration Points
- New Phase 22 artifacts should likely include a `22-HUMAN-UAT.md` or equivalent evidence ledger, a validation baseline/backfill artifact, a hardening register, and `22-VERIFICATION.md` summary.
- SMS evidence connects to `SmsService` logs, Sentry `provider=valkey`, real-device signup UI, and sanitized screenshots.
- Email evidence connects to Resend send result, Cloud Run/Sentry email-service logs, Gmail receipt, reset confirm, and login.
- Legal evidence connects to public legal routes, Footer, signup/booking legal dialogs, robots/canonical output, and support/privacy mailbox receipts.
- Validation and hardening evidence connects to `.planning/STATE.md` deferred items, archived v1.1 verification/UAT files, debug session notes, and quick task summaries.

</code_context>

<specifics>
## Specific Ideas

- The evidence ledger should make `ACCEPTED_RISK` visibly different from `PASS`; it is a conscious launch risk, not a completed gate.
- For SMS, the 1-hour observation should be targeted around the UAT timestamp rather than an open-ended 72-hour delay.
- For email, Gmail receipt plus Resend accepted evidence is enough for `PASS`; Naver/Daum can be recorded as `ACCEPTED_RISK` when approved.
- For legal, factual sign-off is intentionally narrower than legal counsel review because external counsel is out of v2.0 scope.

</specifics>

<deferred>
## Deferred Ideas

- Five-country SMS policy, provider cost monitoring, and global SMS launch behavior belong to Phase 23 Launch Foundation unless an existing blocker must be closed in Phase 22.
- Multinational consent, legal schema lock, PIPA/PDPA/PIPL expansion, and audit log behavior belong to Phase 23 Launch Foundation.
- Naver/Daum mailbox behavior can be rechecked in Phase 26 M1 Canary + Cutover Gates if left as `ACCEPTED_RISK` in Phase 22.

</deferred>

---

*Phase: 22-Preflight Closure*
*Context gathered: 2026-05-04T16:12:52+09:00*
