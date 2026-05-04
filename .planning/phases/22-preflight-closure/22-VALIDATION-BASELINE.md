# Phase 22 Validation Baseline

This baseline classifies inherited v1.1 launch-readiness gaps for `PREF-02`.
It uses historical artifacts as evidence and does not rewrite Phase 14, 15, 16,
18, 20, or 21 records as newly executed Phase 22 proof.

## Classification Rules

- `COMPLETE`: existing evidence path proves the launch-readiness behavior.
  A `COMPLETE` row must cite a concrete artifact path and must not depend on
  human-needed dashboard, provider, or operator evidence.
- `ACCEPTED_CAVEAT`: evidence exists, but a human, provider, dashboard, or
  historical traceability caveat remains visible with owner/date or explicit
  reason.
- `BLOCKER`: evidence is missing or failing and can break the launch path.
  A `BLOCKER` row must name an owner and a concrete next action.
- `D-18`: each v1.1 validation gap is classified as `COMPLETE`,
  `ACCEPTED_CAVEAT`, or `BLOCKER`.
- `D-19`: human-needed or operator-needed evidence remains visible and is not
  converted into automated proof.
- `D-20`: traceability points to existing evidence or this Phase 22 baseline
  without implying prior work was newly executed.

## v1.1 Gap Matrix

| Area | Source | Requirement / Legacy ID | Classification | Evidence Path | Reason | Owner | Next Action |
|------|--------|--------------------------|----------------|---------------|--------|-------|-------------|
| SMS real-device OTP | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `SMS-02` | `BLOCKER` | `git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md`; `.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-HUMAN-UAT.md` | Post-CROSSSLOT production real-device UAT and zero-CROSSSLOT/Sentry window remain unchecked. | Operator + Maintainer | Run real-device signup OTP UAT on production, capture redacted screenshot/log evidence, and record the 1-hour `sms.verify_failed` / `CROSSSLOT` / Sentry `provider=valkey` observation result. |
| Email reset-to-login | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `CUTOVER-05 / DEBT-01` | `COMPLETE` | `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md`; `.planning/phases/18-password-reset-production-api-origin-fix/18-HUMAN-UAT.md` | Phase 18 records reset email receipt, confirm POST 200 to the public API origin, and successful login after password reset. | Maintainer | Preserve Phase 18 evidence in Phase 22 ledger; do not reclassify the separate email-service observation caveat as completed proof. |
| Email provider observation caveat | `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`; `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` | `CUTOVER-04 / CUTOVER-05` | `ACCEPTED_CAVEAT` | `git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`; `git show bd8220e:.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` | Gmail/reset-to-login evidence exists, but Naver/Daum inbox checks, Sentry email-service zero-count, and formal observation closeout remain human/provider caveats. | Operator + Maintainer | Record Phase 22 operator decision: collect missing provider/dashboard evidence, accept it explicitly as launch risk, or promote to blocker. |
| Legal public/sign-off | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `Phase 16 legal gates` | `BLOCKER` | `git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md`; `.planning/phases/16-legal-pages-launch-url/16-HUMAN-UAT.md` | External factual sign-off, mailbox receipt, and production URL smoke checks remain open. | Operator + Maintainer | Complete factual sign-off, verify `support@heygrabit.com` / `privacy@heygrabit.com` mailbox receipt, and run production legal URL/Footer/dialog smoke checks. |
| Seat lock ownership enforcement | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `VALK-03 / UX-02 / UX-03 / UX-04 / UX-05 / UX-06` | `COMPLETE` | `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` | Phase 19 passed 11/11 must-haves and closed the prior SVG seat select -> Valkey lock -> reservation/payment ownership blocker. | Maintainer | Use Phase 19 as the baseline evidence for booking lock ownership; no Phase 22 re-execution required. |
| Valkey production runtime | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `VALK-03 / VALK-04 / VALK-05` | `BLOCKER` | `git show bd8220e:.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`; `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` | Live Cloud Run -> Valkey smoke and provider observation evidence remain missing. | Operator + Maintainer | Run revision-scoped production Valkey smoke for health, Lua, Socket.IO, idle reconnect, and log/Sentry cleanliness, or keep Phase 23 readiness blocked. |
| R2 production evidence | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `R2-02` | `ACCEPTED_CAVEAT` | `.planning/phases/08-r2/08-VERIFICATION.md`; `.planning/quick/260427-pcf-r2-cors/260427-pcf-SUMMARY.md`; `.planning/quick/260427-pcf-r2-cors/grapit-assets-cors.json` | Historical R2 CORS/upload evidence exists, including checksum-header hardening, but live Phase 22 provider proof and custom-domain cutover evidence are not newly collected here. | Maintainer | Carry the R2 caveat into the Phase 22 ledger/hardening register and collect live provider proof if the fanmeet launch surface depends on it. |
| Missing/stale verification artifacts | `.planning/STATE.md` | `verification_gap Phase 10, 10.1, 11, 12, 13, 14, 15, 16, 18, 20` | `ACCEPTED_CAVEAT` | `.planning/STATE.md`; `.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md` | Historical validation artifact cleanup is preserved as caveat unless the gap blocks Phase 23 launch readiness. | Maintainer | Use this baseline and Phase 21 backfill to decide whether each stale/human-needed row is a Phase 23 blocker, accepted caveat, or already covered by newer evidence. |

## Historical Artifact References

Use these exact commands to inspect archived evidence without editing historical
artifacts:

```bash
git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md
git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md
git show bd8220e:.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md
git show bd8220e:.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md
git show bd8220e:.planning/phases/21-verification-artifact-backfill/21-VERIFICATION.md
```

## Baseline Summary

- Total Rows: 8
- COMPLETE: 2
- ACCEPTED_CAVEAT: 3
- BLOCKER: 3
- Phase 23 Readiness Impact: Blocked by listed rows.

Phase 23 cannot treat this inherited v1.1 validation surface as launch-ready
until the `BLOCKER` rows are resolved or explicitly reclassified by a later
Phase 22 gate artifact with owner, evidence path, and redaction-safe rationale.
`ACCEPTED_CAVEAT` rows remain visible inputs for the evidence ledger and must
not be collapsed into `COMPLETE` without direct supporting evidence.
