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
| SMS | PREF-01 | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#sms-real-device-gate`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | 2026-05-04 KST | Maintainer + Operator | Direct real-device SMS happy-path, failure-copy, and SMS provider observation evidence was not collected; maintainer and operator accepted the launch risk on 2026-05-04 KST. | Collect direct SMS evidence before production launch/significant traffic or if a related SMS/provider incident occurs. |
| Email | PREF-01 | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#email-reset-to-login-gate`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | 2026-05-04 KST | Maintainer + Operator | Direct Gmail receipt, Resend id, reset-confirm, post-reset login, and email-service observation evidence was not collected; maintainer and operator accepted the launch risk on 2026-05-04 KST. | Collect direct email evidence before production launch/significant traffic or if a related email/provider incident occurs. |
| Legal | PREF-01 | ACCEPTED_RISK | `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#legal-public-and-sign-off-gate`; `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md#provider-observation` | 2026-05-04 KST | Maintainer + Operator | Direct legal public URL, Footer/mailto, robots/canonical, mailbox receipt, factual sign-off, and public-surface observation evidence was not collected; maintainer and operator accepted the launch risk on 2026-05-04 KST. | Collect direct legal evidence before production launch/significant traffic or if a related legal/public-surface incident occurs. |
| Validation Backfill | PREF-02 | BLOCKER | `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md#baseline-summary` | 2026-05-04 KST | Maintainer + Operator | Source baseline still contains 3 `BLOCKER` rows: SMS real-device OTP, legal public/sign-off, and Valkey production runtime. `ACCEPTED_CAVEAT` rows also remain visible and are not counted as `PASS`. | Resolve or explicitly reclassify the baseline `BLOCKER` rows with owner, evidence path, and redaction-safe rationale before treating PREF-02 as launch-ready. |
| Hardening | PREF-03 | BLOCKER | `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md#register` | 2026-05-04 KST | Maintainer + Operator | Source register still contains `BLOCKER` findings for Valkey production smoke, R2 provider/config evidence, SMS real-device/provider observation, email reset-to-login/provider observation, and legal public/sign-off evidence. One SMS `ACCEPTED_RISK` row also lacks recorded `D-02` approval in this register. | Close findings as concrete fixes or record accepted risk approvals in the hardening register before treating PREF-03 as launch-ready. |

`D-03`: Phase 22 writes new evidence artifacts and references historical Phase 14/15/16 evidence without rewriting it. A row may use historical artifacts as context, but a Phase 22 `PASS` must point to a Phase 22 evidence path or observation record.

## Accepted Risk Approval Rule

`D-02`: Every `ACCEPTED_RISK` row requires maintainer approval, operator approval, owner, and KST date. The maintainer records the technical risk, the operator accepts the business launch risk, and the row must keep a clear residual risk/caveat rather than using success copy.

## Final Gate Counts

- PASS: 0
- ACCEPTED_RISK: 3
- BLOCKER: 2

These counts cover the five final Phase 22 gate rows above. They do not convert validation `ACCEPTED_CAVEAT` rows or accepted-risk human UAT rows into green `PASS` evidence.

## Decision Coverage

| Decision | Implemented By | Coverage |
|----------|----------------|----------|
| D-01 | `22-EVIDENCE-LEDGER.md` | Final gate statuses distinguish `PASS`, `ACCEPTED_RISK`, and `BLOCKER`; missing/failing evidence remains visible. |
| D-02 | `22-EVIDENCE-LEDGER.md` | Accepted-risk rows require maintainer and operator approval with owner and KST date. |
| D-03 | `22-EVIDENCE-LEDGER.md` | Phase 22 ledger references current Phase 22 artifacts and does not rewrite historical evidence as newly executed proof. |
| D-04 | `22-EVIDENCE-LEDGER.md` | Final gate rows use only `PASS`, `ACCEPTED_RISK`, and `BLOCKER`. |
| D-05 | `22-HUMAN-UAT.md` | SMS real-device happy path is tracked as accepted risk, not PASS. |
| D-06 | `22-HUMAN-UAT.md` | SMS wrong-code, expired/resend, and system-error copy checks are tracked as accepted risk, not PASS. |
| D-07 | `22-HUMAN-UAT.md` | SMS Cloud Run/Sentry provider observation is tracked as accepted risk, not PASS. |
| D-08 | `22-HUMAN-UAT.md` | SMS redaction rules ban raw OTPs and full phone numbers. |
| D-09 | `22-HUMAN-UAT.md` | SMS next actions keep direct evidence/fix follow-up on shipped SMS surfaces only. |
| D-10 | `22-HUMAN-UAT.md` | Gmail receipt and Resend accepted evidence are tracked as accepted risk, not PASS. |
| D-11 | `22-HUMAN-UAT.md` | Naver/Daum inbox caveat is explicitly accepted as launch risk. |
| D-12 | `22-HUMAN-UAT.md` | Reset confirm and login-with-new-password checks are tracked as accepted risk, not email receipt-only proof. |
| D-13 | `22-HUMAN-UAT.md` | Email evidence bundle and Cloud Run/Sentry observation remain accepted risk with redaction requirements. |
| D-14 | `22-HUMAN-UAT.md` | Legal public URL, Footer/mailto, robots/canonical, and public-surface observation checks are tracked as accepted risk. |
| D-15 | `22-HUMAN-UAT.md` | Legal factual sign-off fields are tracked as accepted risk; external counsel review remains out of Phase 22. |
| D-16 | `22-HUMAN-UAT.md` | Support/privacy mailbox receipt checks are tracked as accepted risk. |
| D-17 | `22-HUMAN-UAT.md` | Legal next actions stay on shipped public legal surfaces; broader multinational consent is deferred. |
| D-18 | `22-VALIDATION-BASELINE.md` | v1.1 gaps are classified as `COMPLETE`, `ACCEPTED_CAVEAT`, or `BLOCKER`. |
| D-19 | `22-VALIDATION-BASELINE.md` | Human/provider/operator-needed evidence remains visible and is not converted into automated proof. |
| D-20 | `22-VALIDATION-BASELINE.md` | Traceability points to existing evidence or the Phase 22 baseline without implying historical re-execution. |
| D-21 | `22-HARDENING-REGISTER.md` | Fragile points close as `concrete fix`, `ACCEPTED_RISK`, or `BLOCKER`. |
| D-22 | `22-HARDENING-REGISTER.md` | Pre-existing debug sessions are routed to closed status, v2.0 risk, or blocker follow-up. |
| D-23 | `22-HARDENING-REGISTER.md` | Direct fix scope stays limited to already-shipped operational surfaces. |
