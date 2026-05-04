# Phase 22 Evidence Ledger

This ledger is the canonical Phase 22 gate matrix for `PREF-01`, `PREF-02`, and `PREF-03`.

Phase 22 records v2.0 preflight evidence only. Historical Phase 14, Phase 15, and Phase 16 artifacts are canonical context for traceability, but they must not be rewritten or represented as newly executed Phase 22 evidence.

## Status Vocabulary

- Gate statuses: `PASS`, `ACCEPTED_RISK`, `BLOCKER`
- Validation statuses: `COMPLETE`, `ACCEPTED_CAVEAT`, `BLOCKER`

`D-01`: `PASS` requires direct evidence, `ACCEPTED_RISK` requires explicit risk acceptance, and `BLOCKER` means a launch path can break or required evidence is missing/failing.

`D-04`: Phase 22 gate artifacts use only `PASS`, `ACCEPTED_RISK`, and `BLOCKER` for launch gates. Validation backfill artifacts use only `COMPLETE`, `ACCEPTED_CAVEAT`, and `BLOCKER`.

## Redaction Rules

Before any evidence path, screenshot, log snippet, provider id, or note is committed, redact raw OTPs, full phone numbers, full recipient email addresses, reset links, reset tokens, cookies, bearer headers, Redis URLs, Secret Manager values, R2 keys, Resend tokens, and provider secrets.

Evidence rows may cite sanitized file paths, log queries, provider ids, Sentry references, or Cloud Run references after redaction. Missing evidence starts as `BLOCKER`, not `PASS`.

## Gate Matrix

| Gate | Requirement | Status | Evidence | Checked At | Owner | Risk / Caveat | Next Action |
|------|-------------|--------|----------|------------|-------|---------------|-------------|
| SMS | PREF-01 | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#sms-real-device-gate` | TBD | Maintainer | Real-device SMS evidence not recorded yet | Complete real-device signup OTP and 1-hour provider observation in 22-HUMAN-UAT.md |
| Email | PREF-01 | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#email-reset-to-login-gate` | TBD | Maintainer | Gmail reset-to-login evidence not recorded yet | Complete Gmail password reset-to-login evidence in 22-HUMAN-UAT.md |
| Legal | PREF-01 | BLOCKER | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#legal-public-and-sign-off-gate` | TBD | Maintainer | Public URL, mailbox, and factual sign-off evidence not recorded yet | Complete public URL, mailbox, and factual sign-off evidence in 22-HUMAN-UAT.md |
| Validation Backfill | PREF-02 | BLOCKER | `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md` | TBD | Maintainer | v1.1 gap classification not recorded yet | Classify v1.1 gaps in 22-VALIDATION-BASELINE.md |
| Hardening | PREF-03 | BLOCKER | `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` | TBD | Maintainer | Valkey/R2/SMS/email/legal fragility classification not recorded yet | Classify Valkey/R2/SMS/email/legal fragility in 22-HARDENING-REGISTER.md |

`D-03`: Phase 22 writes new evidence artifacts and references historical Phase 14/15/16 evidence without rewriting it. A row may use historical artifacts as context, but a Phase 22 `PASS` must point to a Phase 22 evidence path or observation record.

## Accepted Risk Approval Rule

`D-02`: Every `ACCEPTED_RISK` row requires maintainer approval, operator approval, owner, and KST date. The maintainer records the technical risk, the operator accepts the business launch risk, and the row must keep a clear residual risk/caveat rather than using success copy.
