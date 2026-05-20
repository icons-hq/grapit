---
phase: 26
slug: m1-canary-cutover-gates
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-20
---

# Phase 26 - Security

**Phase:** 26 - m1-canary-cutover-gates  
**ASVS Level:** 1  
**Result:** SECURED  
**Threats Closed:** 53/53  
**threats_open:** 0  
**Generated:** 2026-05-20

## Scope

This audit verifies only the declared Phase 26 threat register. Implementation files were treated as read-only; this file is the only artifact written.

Disposition summary:

- `mitigate`: 53 verified
- `accept`: 0 declared
- `transfer`: 0 declared

## Verification Commands

- `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --strict` - PASS
- `node scripts/phase26/validate-gate-ledger.mjs --ledger .planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json --booking-enabled-check` - EXPECTED NO-GO; failed on BLOCKED/CONFIG_READY_NOT_DRILLED rows instead of enabling booking
- `pnpm --filter @grabit/api test -- admin-cutover toss-payments.client toss-webhook.controller qr-ticket.service reservation.service` - PASS, 72 files / 739 tests
- `pnpm --filter @grabit/web test:e2e -- admin-cutover.spec.ts phase26-qr-visibility.spec.ts phase26-m1-smoke.spec.ts` - PASS, 6 tests

## Threat Register

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-26-01-01 | Tampering | mitigate | CLOSED | `scripts/phase26/validate-gate-ledger.mjs:8-35`, `:180-263` validate required rows, states, structure, and strict mode. |
| T-26-01-02 | Information Disclosure | mitigate | CLOSED | `scripts/phase26/validate-gate-ledger.mjs:54-66`, `:163-177` scan ledger text for Toss keys, payment keys, QR tokens, cookies, JWTs, OTPs, and PII markers. |
| T-26-01-03 | Repudiation | mitigate | CLOSED | `scripts/phase26/validate-gate-ledger.mjs:149-160`, `:265-302`; `26-GATE-LEDGER.json:172-193` require approved non-PASS metadata and preserve D-24 accepted-risk fields. |
| T-26-01-04 | Elevation of Privilege | mitigate | CLOSED | `scripts/phase26/validate-gate-ledger.mjs:265-302`; booking-enabled check returned expected no-go for BLOCKED/unapproved/config rows. |
| T-26-01-05 | Denial of Service | mitigate | CLOSED | `26-GATE-LEDGER.json:488-511`; `scripts/phase26/cleanup-dry-run.sql:8-18`, `scripts/phase26/cleanup-test-event.sql:8-28` keep cleanup BLOCKED and require scoped IDs, dry-run, denylist, and restore confirmation. |
| T-26-02-01 | Spoofing | mitigate | CLOSED | `apps/api/src/modules/ticket/qr-ticket.service.ts:232-261`, `:520-628`; `qr-ticket.service.spec.ts:218-285`, `:444-524` preserve secretVersion/keyring verification and scanner-input tests. |
| T-26-02-02 | Information Disclosure | mitigate | CLOSED | `scripts/phase26/field-scan-contract-smoke.mjs:35-38`, `:211-244`; `evidence/26-02-qr-contract.json:1-14` write masked contract metadata only. |
| T-26-02-03 | Tampering | mitigate | CLOSED | `qr-ticket.service.spec.ts:398-524`; `reservation.service.ts:1380-1439`; `reservation.service.spec.ts:2307-2377` require DONE payment/reservation linkage before active QR readiness. |
| T-26-02-04 | Repudiation | mitigate | CLOSED | `scripts/phase26/field-scan-contract-smoke.mjs:229-244`, `:255-330`; `evidence/26-02-qr-contract.json:1-14` record timestamp, environment, command shape, and masked identifiers. |
| T-26-03-01 | Information Disclosure | mitigate | CLOSED | `booking-complete.tsx:45`, `:144-174`; `reservation-detail.tsx:116-117`, `:210-246`; `phase26-qr-visibility.spec.ts:108-163` render masked QR metadata and assert raw token/payment/JTI absence. |
| T-26-03-02 | Spoofing | mitigate | CLOSED | `booking-complete.tsx:45`, `:144-149`; `reservation-detail.tsx:116-117`, `:210-215`; `phase26-qr-visibility.spec.ts:131-156` show ready only for active server QR state. |
| T-26-03-03 | Repudiation | mitigate | CLOSED | `evidence/26-03-qr-visibility.json:14-43`, `:47-60` records command shape, target surfaces, result, masked identifiers, and redaction notes. |
| T-26-04-01 | Spoofing | mitigate | CLOSED | `payment-webhook.controller.ts:82-88`, `:173-234`; `toss-webhook.controller.spec.ts:264-313`, `:348-406` re-query Toss before applying final webhook state and fail closed on mismatch. |
| T-26-04-02 | Tampering | mitigate | CLOSED | `toss-payments.client.ts:45-58`, `:91-128`; `toss-payments.client.spec.ts:36-92` add and test `Idempotency-Key` for confirm/cancel. |
| T-26-04-03 | Information Disclosure | mitigate | CLOSED | `toss-payments.client.ts:72-85`; `toss-payments.client.spec.ts:115-135`; `evidence/26-04-toss-hardening.json:21-39` redact keys/payment identifiers and record only class/prefix metadata. |
| T-26-04-04 | Repudiation | mitigate | CLOSED | `payment-webhook.controller.ts:71-108`; `payment.service.ts:191-233`, `:745-758`; webhook tests assert processed/failed ledger outcomes. |
| T-26-04-05 | Elevation of Privilege | mitigate | CLOSED | `26-GATE-LEDGER.json:196-248`; `docs/runbooks/phase26-live-payment-cutover.md:187-210`; `evidence/26-10-live-cutover.json:5-34` keep live cutover BLOCKED and booking disabled. |
| T-26-05-01 | Tampering | mitigate | CLOSED | `cleanup-dry-run.sql:8-18`, `:62-92`, `:106-199`; `cleanup-test-event.sql:8-28`, `:134-176`, `:269-354` require test IDs, marker, denylist, dry-run counts, approval, and restore point. |
| T-26-05-02 | Denial of Service | mitigate | CLOSED | `rehearsal-smoke.mjs:17-25`, `:819-841`, `:893-918`; `evidence/26-05-rehearsal.json:34-65` keeps rehearsal functional/BLOCKED and separates high-volume load to Plan 26-06. |
| T-26-05-03 | Information Disclosure | mitigate | CLOSED | `rehearsal-smoke.mjs:123-150`; `evidence/26-05-rehearsal.json:16` redacts auth, cookies, payment keys, QR tokens, order IDs, and PII markers. |
| T-26-05-04 | Repudiation | mitigate | CLOSED | `rehearsal-smoke.mjs:70-75`, `:893-918`; `evidence/26-05-rehearsal.json:34-65` records BLOCKED/NOT_RUN before mutation unless owner approval and confirmations exist. |
| T-26-06-01 | Denial of Service | mitigate | CLOSED | `scripts/k6/phase26-baseline.js:8-29`, `:150-188`, `:247-265`; `scripts/k6/phase26-stress.js:8-29`, `:150-188`, `:247-265`; runbook requires owner approval, dedicated event, stop criteria, and no high-volume Toss. |
| T-26-06-02 | Tampering | mitigate | CLOSED | `record-k6-evidence.mjs:138-155`, `:198-222`, `:245-258`; `evidence/26-06-load.json:24-39` records p95/error-rate and preserves FAIL/BLOCKED. |
| T-26-06-03 | Repudiation | mitigate | CLOSED | `record-k6-evidence.mjs:158-180`, `:260-304`; `evidence/26-06-load.json:13-22` records target, time window, approval state, and command shapes. |
| T-26-06-04 | Information Disclosure | mitigate | CLOSED | `record-k6-evidence.mjs:321-338`; `docs/runbooks/phase26-load-gate.md:153-163` prevent auth headers, cookies, payment keys, QR tokens, PII, and Toss keys from artifacts. |
| T-26-07-01 | Denial of Service | mitigate | CLOSED | `direct-deploy-watch.mjs:80-119`, `:594-635`; `docs/runbooks/phase26-direct-deploy-watch.md:135-171` require 15-minute strict watch and rollback triggers. |
| T-26-07-02 | Tampering | mitigate | CLOSED | `apps/web/e2e/phase26-m1-smoke.spec.ts:73-132`, `:266-300` asserts booking-disabled path has no lock/prepare/payment side effects. |
| T-26-07-03 | Repudiation | mitigate | CLOSED | `direct-deploy-watch.mjs:333-424`, `:493-530`, `:594-635`; `evidence/26-07-direct-deploy-watch.json:1-50` record revision IDs, timestamps, commands, and redacted log summaries. |
| T-26-07-04 | Information Disclosure | mitigate | CLOSED | `direct-deploy-watch.mjs:24-31`, `:223-248`, `:493-530`; runbook `phase26-direct-deploy-watch.md:211-230` clips and redacts logs/tokens/payment identifiers. |
| T-26-08-01 | Tampering | mitigate | CLOSED | `infra-evidence.mjs:54-73`, `:368-417`; `docs/runbooks/phase26-dr-infra-gate.md:73-190` require owner-approved safe target and explicit project/region before restore. |
| T-26-08-02 | Denial of Service | mitigate | CLOSED | `infra-evidence.mjs:419-478`; `docs/runbooks/phase26-dr-infra-gate.md:93-143`; `evidence/26-08-dr-infra.json:25-70` preserves rollback drill as non-PASS until drilled. |
| T-26-08-03 | Information Disclosure | mitigate | CLOSED | `infra-evidence.mjs:22-33`, `:132-149`, `:189-204`, `:534-561`; `evidence/26-08-dr-infra.json:72-166`, `:243-256` redact DB/Redis URLs and provider tokens. |
| T-26-08-04 | Repudiation | mitigate | CLOSED | `infra-evidence.mjs:383-417`; `docs/runbooks/phase26-dr-infra-gate.md:14-42`; `26-GATE-LEDGER.json:294-410` preserve CONFIG_READY_NOT_DRILLED distinct from PASS. |
| T-26-09-01 | Information Disclosure | mitigate | CLOSED | `monitoring-evidence.mjs:150-159`, `:205-220`; `evidence/26-09-ops-monitoring.json:219-230` redact tokens, cookies, payment keys, raw IPs, and PII. |
| T-26-09-02 | Denial of Service | mitigate | CLOSED | `monitoring-evidence.mjs:90-114`; `docs/runbooks/phase26-cutover-ops.md:33-45`, `:206-236`; evidence keeps normal and suspicious WAF smoke separate. |
| T-26-09-03 | Tampering | mitigate | CLOSED | `monitoring-evidence.mjs:17-88`, `:257-294`; `evidence/26-09-ops-monitoring.json:97-217` record source, timestamp, query/command shape, and classification for each metric. |
| T-26-09-04 | Repudiation | mitigate | CLOSED | `26-FIRST-24H-WATCH.md:41-59`, `:110-135`, `:156-176`; `evidence/26-09-ops-monitoring.json:219-230` define trigger, timestamp, evidence, and action-owner fields. |
| T-26-09-05 | Elevation of Privilege | mitigate | CLOSED | `validate-gate-ledger.mjs:149-160`, `:265-302`; `26-GATE-LEDGER.json:417-485` require approval and rollback/close trigger for non-PASS monitoring rows. |
| T-26-10-01 | Information Disclosure | mitigate | CLOSED | `docs/runbooks/phase26-live-payment-cutover.md:21-23`, `:85-119`; `evidence/26-10-live-cutover.json:60-68`; validator secret scan passed. |
| T-26-10-02 | Tampering | mitigate | CLOSED | `cutover-readiness.mjs:71-79`, `:191-347`, `:457-491`; strict validator passed and booking-enabled check preserved non-PASS blockers. |
| T-26-10-03 | Elevation of Privilege | mitigate | CLOSED | `cutover-readiness.mjs:508-577`; `docs/runbooks/phase26-live-payment-cutover.md:187-224`; `evidence/26-10-live-cutover.json:5-34` records `bookingEnabledApplied=false` and no owner mutation. |
| T-26-10-04 | Spoofing | mitigate | CLOSED | `docs/runbooks/phase26-live-payment-cutover.md:121-185`; `cutover-readiness.mjs:405-429`; missing live smoke remains BLOCKED until query/cancel/webhook re-verification is run safely. |
| T-26-10-05 | Denial of Service | mitigate | CLOSED | `docs/runbooks/phase26-live-payment-cutover.md:233-280`; `direct-deploy-watch.mjs:594-635`; `26-FIRST-24H-WATCH.md:14-20`, `:110-135` define immediate rollback/close-booking handoff. |
| T-26-10-06 | Repudiation | mitigate | CLOSED | `cutover-readiness.mjs:494-505`, `:580-617`; `validate-gate-ledger.mjs:149-160`; accepted-risk rows require failed gate, approver, timestamp, monitoring, and rollback trigger. |
| T-26-11-01 | Information Disclosure | mitigate | CLOSED | `admin-cutover.service.ts:9-30`, `:164-168`, `:352-369`; `admin-cutover.service.spec.ts:164-221` expose redacted metadata/evidence refs only. |
| T-26-11-02 | Elevation of Privilege | mitigate | CLOSED | `admin-cutover.controller.ts:9-20`; `admin-cutover.controller.spec.ts:99-123`; `admin.module.ts:33-69` require admin role plus `audit.read`. |
| T-26-11-03 | Tampering | mitigate | CLOSED | `admin-cutover.service.ts:133-163`, `:172-245`, `:248-267`; service tests `:24-73`, `:115-133` preserve exact states and synthesize missing gates as BLOCKED. |
| T-26-11-04 | Repudiation | mitigate | CLOSED | `admin-cutover.service.ts:210-245`; `admin-cutover.service.spec.ts:75-113` finalEnableAllowed requires approvalState, approver, monitoring, and rollback trigger for approved non-PASS. |
| T-26-11-05 | Denial of Service | mitigate | CLOSED | `apps/api/Dockerfile:20-21`; `.github/workflows/deploy.yml:218-230`; `admin-cutover.service.ts:95-107`, `:269-308`, `:376-382`; runtime artifact missing returns BLOCKED/no-go instead of 500. |
| T-26-12-01 | Spoofing | mitigate | CLOSED | `use-admin-cutover.ts:32-53`; `cutover-gate-ledger.tsx:115-127`, `:340-367`; UI renders server-provided `finalEnableAllowed` and `firstBlockingGate`. |
| T-26-12-02 | Information Disclosure | mitigate | CLOSED | `cutover-gate-ledger.tsx:259-279`; `admin-cutover.spec.ts:114-117`; UI displays refs/redaction notes only, not provider payloads or secrets. |
| T-26-12-03 | Repudiation | mitigate | CLOSED | `cutover-gate-ledger.tsx:220-257`, `:397-418`; `admin-cutover.spec.ts:43-79`, `:145-154` show approval state, approver, monitoring, and rollback trigger for non-PASS rows. |
| T-26-12-04 | Elevation of Privilege | mitigate | CLOSED | `cutover-gate-ledger.tsx:537-559`; `admin-cutover.spec.ts:156-164`; `26-12-SUMMARY.md:27-32`, `:71-75` keep CTA disabled without server-approved readiness and no client mutation exists. |

## Unregistered Flags

None. Explicit `## Threat Flags` sections in the Phase 26 summaries record no unmapped attack surface. Summaries without a `## Threat Flags` section did not contain explicit unmapped flags in their implementation notes.

## Accepted Risk / Non-PASS Gate Handling

No threat in the formal register has disposition `accept`. The implementation does preserve operational non-PASS gate states as mitigation evidence:

- `TOSS_TEST_SECRET_ROTATION` remains `ACCEPTED_RISK` with owner approval metadata in `26-GATE-LEDGER.json:172-193`.
- Live key smoke, BOOKING_ENABLED go/no-go, load, DR, WAF, on-call, first-24h watch, and cleanup isolation remain BLOCKED or CONFIG_READY_NOT_DRILLED where external/operator evidence is intentionally absent.
- Final live booking is not marked ready; `--booking-enabled-check` fails closed.

## Accepted Risks Log

No accepted risks declared in the Phase 26 formal threat register.

Operational non-PASS gate states are preserved above because they are cutover controls, not accepted security threats for this audit.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-20 | 53 | 53 | 0 | gsd-security-auditor |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-20
