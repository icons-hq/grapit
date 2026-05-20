# Phase 26 Gate Ledger

This ledger is the cutover source of truth for Phase 26. `BOOKING_ENABLED=true`
is no-go until every required gate is `PASS` or explicitly owner-approved as
`ACCEPTED_RISK` or `CONFIG_READY_NOT_DRILLED`.

Empty, missing, failed, blocked, unreviewed, or malformed rows are no-go.
`ACCEPTED_RISK` and `CONFIG_READY_NOT_DRILLED` are never `PASS`.

Cloud Run traffic-split canary is not used as Phase 26 PASS evidence. Phase 26
uses CI/CD green, 100% direct deploy, and a 15-minute strict watch.

Evidence must be redacted. Do not store raw Toss keys, payment keys, QR tokens,
cookies, OTP values, raw customer rows, or unmasked PII in this ledger.

## Required Gate Rows

| Gate ID | Requirements | Initial State | Environment | No-Go Reason |
| --- | --- | --- | --- | --- |
| `M1_DIRECT_DEPLOY_WATCH` | M1-01 | BLOCKED | production | Direct deploy strict-watch evidence has not been recorded. |
| `M1_LOCALE_SCOPE` | M1-01 | BLOCKED | production | Current active locale smoke has not reconciled older five-locale wording with code. |
| `ADMIN_CUTOVER_UI` | M1-01, OPS-01, OPS-02 | BLOCKED | production | Admin Gate Ledger/cutover readiness surface is not available yet. |
| `QR_VISIBILITY` | PAY-01 | BLOCKED | production-like | Confirmed payment QR visibility is a known cutover blocker until fixed and verified. |
| `TOSS_TEST_REHEARSAL` | PAY-01 | BLOCKED | production-like-test-keys | Toss test-key ticketing rehearsal has not completed. |
| `TOSS_TEST_SECRET_ROTATION` | PAY-01 | ACCEPTED_RISK | provider-secret-manager-ci | Exposed Toss test secret was not rotated in this execution window; owner approved continuing with redacted CLI binding evidence and non-PASS D-24 risk tracking. |
| `TOSS_LIVE_KEY_SMOKE` | PAY-01 | BLOCKED | production-live-keys-booking-disabled | Toss live-key smoke is unavailable until review/live keys are ready. |
| `BOOKING_ENABLED_GO_NO_GO` | M1-01, PAY-01, OPS-02 | BLOCKED | production | Final booking-enabled readiness check has not run. |
| `LOAD_10K_BASELINE` | LOAD-01 | BLOCKED | production-like-dedicated-test-event | 10k baseline load gate has not run. |
| `LOAD_20K_STRESS` | LOAD-01 | BLOCKED | production-like-dedicated-test-event | 20k stress load gate has not run. |
| `DR_CLOUD_RUN_ROLLBACK` | DR-01, M1-01 | BLOCKED | production | Cloud Run rollback drill/evidence is missing. |
| `DR_CLOUD_SQL_PITR` | DR-01, INFRA-01 | BLOCKED | production-safe-target | Cloud SQL PITR/restore path evidence is missing. |
| `DR_VALKEY_RECONNECT` | DR-01 | BLOCKED | production | Valkey reconnect/failure behavior evidence is missing. |
| `INFRA_POOL_PGBOUNCER` | INFRA-01 | BLOCKED | production-config | DB pool sizing/pgBouncer preparedness evidence is missing. |
| `INFRA_HA_REPLICA` | INFRA-01 | BLOCKED | production-config | HA/read replica preparedness evidence is missing. |
| `WAF_ACTIVE_RULES` | OPS-01, M1-01 | BLOCKED | cloudflare-production | Cloudflare WAF/rate-limit active-rule and smoke evidence is missing. |
| `ONCALL_PLAYBOOKS` | OPS-01 | BLOCKED | operations | One-person on-call playbook dry-run evidence is missing. |
| `FIRST_24H_WATCH` | OPS-02 | BLOCKED | production | First-2h and first-24h monitoring cadence/runbook is missing. |
| `CLEANUP_ISOLATION` | PAY-01, OPS-01 | BLOCKED | production-like-dedicated-test-event | Dedicated test-event cleanup safety evidence is missing. |

## Source Coverage

### Goal

Phase 26 is implemented as gate-driven ticketing cutover readiness, not Cloud
Run traffic-split canary. The ledger blocks live booking until evidence is
accounted for.

### Requirements

| Requirement | Covered By |
| --- | --- |
| `M1-01` | 26-01 Gate Ledger, 26-07 direct deploy watch, 26-11 admin API, 26-12 admin UI |
| `LOAD-01` | 26-01 load gate rows, 26-06 k6 baseline/stress gates |
| `DR-01` | 26-01 DR rows, 26-08 DR/infra evidence |
| `INFRA-01` | 26-01 infra rows, 26-08 infra evidence, 26-10 final readiness |
| `OPS-01` | 26-01 ops rows, 26-09 monitoring/WAF/on-call, 26-11/26-12 admin visibility |
| `PAY-01` | 26-01 payment rows, 26-02 QR contract, 26-03 QR visibility, 26-04 Toss hardening, 26-05 rehearsal, 26-10 live cutover |
| `OPS-02` | 26-01 first-24h row, 26-09 watch plan, 26-10 final triggers, 26-12 admin visibility |

### Decisions

| Decision | Coverage |
| --- | --- |
| `D-01` | 26-01 state model and 26-10 final readiness |
| `D-02` | 26-01 required ledger fields and validator |
| `D-03` | 26-01 approval metadata and 26-10 owner-approved non-PASS rules |
| `D-04` | 26-01 initialized no-go rows and 26-10 booking-enabled check |
| `D-05` | 26-01 policy text and 26-07 direct deploy watch |
| `D-06` | 26-07 direct deploy watch |
| `D-07` | 26-07 strict watch smoke coverage |
| `D-08` | 26-07 rollback triggers and 26-10 close-booking runbook |
| `D-09` | 26-06 k6 thresholds and accepted-risk handling |
| `D-10` | 26-05 ticketing rehearsal |
| `D-11` | 26-05 dedicated test-event isolation |
| `D-12` | 26-08 DR/infra classification |
| `D-13` | 26-05 production data safety and cleanup denylist |
| `D-14` | 26-05 dry-run counts and restore-point confirmation |
| `D-15` | 26-05 stop-on-unexpected-row cleanup rule |
| `D-16` | 26-09 Sentry, Cloud Run, Cloudflare, and business metrics |
| `D-17` | 26-09 WAF/rate-limit evidence |
| `D-18` | 26-09 one-person on-call dry-run evidence |
| `D-19` | 26-10 live keys with BOOKING_ENABLED=false before enablement |
| `D-20` | 26-04/26-05 test-key rehearsal limits and 26-10 live-key separation |
| `D-21` | 26-04 test-key rehearsal now and 26-10 live-key smoke later |
| `D-22` | 26-10 live-key smoke scope |
| `D-23` | 26-04 Toss webhook re-query hardening |
| `D-24` | 26-01 `TOSS_TEST_SECRET_ROTATION`, 26-04 rotation evidence, 26-10 final readiness |
| `D-25` | 26-03 QR visibility blocker fix |
| `D-26` | 26-03 payment complete and My Page/ticket detail QR coverage |
| `D-27` | 26-02 field-scan contract smoke |
| `D-28` | 26-02/26-03 preserve Phase 27 scanner/use-processing boundary |
| `D-29` | 26-09 first-2h and first-24h cadence |
| `D-30` | 26-10 financial/seat safety close-booking triggers |

### Validation Rows

| Validation Row | Covered By |
| --- | --- |
| `26-W0-M1` | 26-07, 26-11, 26-12 |
| `26-W0-LOAD` | 26-06 |
| `26-W0-DR` | 26-08 |
| `26-W0-INFRA` | 26-08, 26-10 |
| `26-W0-OPS1` | 26-09, 26-11, 26-12 |
| `26-W0-PAY` | 26-02, 26-03, 26-04, 26-05, 26-10 |
| `26-W0-OPS2` | 26-09, 26-10, 26-12 |

### UI-SPEC Surfaces

| Surface | Covered By |
| --- | --- |
| Gate Ledger readiness surface | 26-01, 26-11, 26-12 |
| Direct deploy watch | 26-07 |
| Dedicated test-event rehearsal | 26-05 |
| QR completion surfaces | 26-02, 26-03 |
| Toss test/live cutover | 26-04, 26-05, 26-10 |
| Monitoring and first-24h watch | 26-09, 26-10 |

Full field-staff mobile QR scanner and ticket use-processing UI are Phase 27
scope. Phase 26 verifies the QR payload and visibility contract only.

## Operator Rules

- `PASS` requires direct evidence.
- `FAIL` and `BLOCKED` are no-go.
- Empty evidence is no-go.
- `ACCEPTED_RISK` requires owner approval, failed gate, compensating monitoring,
  and rollback or close-booking trigger.
- `CONFIG_READY_NOT_DRILLED` requires owner approval and remains non-PASS.
- Real Girl Rules event data, real users, real payments, real tickets, real
  sessions, and real seat state are protected from rehearsal cleanup.

## Accepted-Risk Entries

| Gate ID | Approved At | Evidence | Rationale | Monitoring / Trigger |
| --- | --- | --- | --- | --- |
| `TOSS_TEST_SECRET_ROTATION` | 2026-05-20T06:08:22Z | `.planning/phases/26-m1-canary-cutover-gates/evidence/26-04-toss-hardening.json` | D-24 rotation/reissue was not completed, but the owner approved continuing as non-PASS accepted risk. Raw Toss key material is not stored in repo artifacts. | Keep `BOOKING_ENABLED=false` until final cutover checks; close booking or block live enablement on Toss rehearsal failure, live-key smoke unavailability, webhook/provider mismatch, or any secret leakage. |
