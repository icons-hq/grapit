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
| SMS real-device OTP | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `SMS-02` | `ACCEPTED_CAVEAT` | `git show bd8220e:.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#sms-real-device-gate`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | Post-CROSSSLOT production real-device UAT and zero-CROSSSLOT/Sentry window remain unchecked, but maintainer and operator accepted the launch risk on 2026-05-04 KST. | Operator + Maintainer | Collect direct real-device signup OTP and provider observation evidence before production launch/significant traffic or if a related SMS incident occurs. |
| Email reset-to-login | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `CUTOVER-05 / DEBT-01` | `COMPLETE` | `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md`; `.planning/phases/18-password-reset-production-api-origin-fix/18-HUMAN-UAT.md` | Phase 18 records reset email receipt, confirm POST 200 to the public API origin, and successful login after password reset. | Maintainer | Preserve Phase 18 evidence in Phase 22 ledger; do not reclassify the separate email-service observation caveat as completed proof. |
| Email provider observation caveat | `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`; `.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` | `CUTOVER-04 / CUTOVER-05` | `ACCEPTED_CAVEAT` | `git show bd8220e:.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`; `git show bd8220e:.planning/phases/18-password-reset-production-api-origin-fix/18-VERIFICATION.md` | Gmail/reset-to-login evidence exists, but Naver/Daum inbox checks, Sentry email-service zero-count, and formal observation closeout remain human/provider caveats. | Operator + Maintainer | Record Phase 22 operator decision: collect missing provider/dashboard evidence, accept it explicitly as launch risk, or promote to blocker. |
| Legal public/sign-off | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `Phase 16 legal gates` | `ACCEPTED_CAVEAT` | `git show bd8220e:.planning/phases/16-legal-pages-launch-url/16-VERIFICATION.md`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#legal-public-and-sign-off-gate`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | External factual sign-off, mailbox receipt, and production URL smoke checks remain open, but maintainer and operator accepted the launch risk on 2026-05-04 KST. | Operator + Maintainer | Collect factual sign-off, mailbox receipt, and production legal URL/Footer/dialog smoke evidence before production launch/significant traffic or if a related legal incident occurs. |
| Seat lock ownership enforcement | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `VALK-03 / UX-02 / UX-03 / UX-04 / UX-05 / UX-06` | `COMPLETE` | `.planning/phases/19-seat-lock-ownership-enforcement/19-VERIFICATION.md` | Phase 19 passed 11/11 must-haves and closed the prior SVG seat select -> Valkey lock -> reservation/payment ownership blocker. | Maintainer | Use Phase 19 as the baseline evidence for booking lock ownership; no Phase 22 re-execution required. |
| Valkey production runtime | `.planning/milestones/v1.1-MILESTONE-AUDIT.md` | `VALK-03 / VALK-04 / VALK-05` | `ACCEPTED_CAVEAT` | `git show bd8220e:.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`; `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md#register` | Live Cloud Run -> Valkey smoke and provider observation evidence remain missing, but maintainer and operator accepted the launch risk on 2026-05-04 KST. | Operator + Maintainer | Run revision-scoped production Valkey smoke for health, Lua, Socket.IO, idle reconnect, and log/Sentry cleanliness before production launch/significant traffic or if a related Valkey incident occurs. |
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
- ACCEPTED_CAVEAT: 6
- BLOCKER: 0
- Phase 23 Readiness Impact: Ready only with accepted caveats.

Phase 23 can treat this inherited v1.1 validation surface as ready only with
the `ACCEPTED_CAVEAT` rows above. These caveats remain visible inputs for the
evidence ledger and must not be collapsed into `COMPLETE` without direct
supporting evidence.
