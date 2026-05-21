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

## Current Gate Rows

| Gate ID | Requirements | State | Approval | Evidence | No-Go / Caveat |
| --- | --- | --- | --- | --- | --- |
| `M1_DIRECT_DEPLOY_WATCH` | M1-01 | PASS | not_requested | 1 | Direct deploy strict-watch evidence recorded. |
| `M1_LOCALE_SCOPE` | M1-01 | BLOCKED | not_requested | 1 | Active locale smoke exists, but older five-locale launch wording remains reconciled as non-PASS in Plan 26-07. |
| `ADMIN_CUTOVER_UI` | M1-01, OPS-01, OPS-02 | BLOCKED | not_requested | 3 | Admin cutover API/UI are implemented, but deployed authenticated admin API smoke and runtime CUTOVER_GATE_LEDGER_PATH evidence are still missing. |
| `QR_VISIBILITY` | PAY-01 | PASS | not_requested | 2 | Payment complete page and My Page QR visibility regression evidence recorded. |
| `TOSS_TEST_REHEARSAL` | PAY-01 | BLOCKED | not_requested | 1 | Dedicated test-event approval and required PHASE26_TEST_* fixtures were not provided in this executor context; no production-like rehearsal, Toss confirm, or cleanup mutation was run. |
| `TOSS_TEST_SECRET_ROTATION` | PAY-01 | ACCEPTED_RISK | approved / owner | 1 | D-24 preferred rotation/reissue was not completed, but owner instructed to proceed. This remains non-PASS evidence and must not be treated as final live readiness. |
| `TOSS_LIVE_KEY_SMOKE` | PAY-01 | BLOCKED | not_requested | 1 | Owner did not confirm Toss review completion or live-key availability in this executor context. No live key prefix/class, server confirm/query/cancel, webhook, or widget smoke was run. |
| `BOOKING_ENABLED_GO_NO_GO` | M1-01, PAY-01, OPS-02 | BLOCKED | not_requested | 1 | Live-key smoke and/or required Gate Ledger rows are not ready; BOOKING_ENABLED=true was not applied. |
| `LOAD_10K_BASELINE` | LOAD-01 | BLOCKED | not_requested | 1 | Dedicated test-event fixture, operator-approved load window, and k6 summary files are not available; real Girl Rules event was not targeted. |
| `LOAD_20K_STRESS` | LOAD-01 | BLOCKED | not_requested | 1 | Dedicated test-event fixture, operator-approved load window, and k6 summary files are not available; real Girl Rules event was not targeted. |
| `DR_CLOUD_RUN_ROLLBACK` | DR-01, M1-01 | CONFIG_READY_NOT_DRILLED | not_requested | 1 | Cloud Run service/revision/traffic metadata collected, but rollback was not drilled. |
| `DR_CLOUD_SQL_PITR` | DR-01, INFRA-01 | BLOCKED | not_requested | 1 | Cloud SQL PITR/restore lacks owner-approved safe target, permissions, or PITR metadata. |
| `DR_VALKEY_RECONNECT` | DR-01 | BLOCKED | not_requested | 1 | Valkey reconnect/failure smoke did not run or lacked required credentials/fixtures. |
| `INFRA_POOL_PGBOUNCER` | INFRA-01 | CONFIG_READY_NOT_DRILLED | not_requested | 1 | DB_POOL_MAX was collected, but pgBouncer transaction pooling evidence was not found or drilled. |
| `INFRA_HA_REPLICA` | INFRA-01 | CONFIG_READY_NOT_DRILLED | not_requested | 1 | Cloud SQL HA/read-replica drill evidence is absent; keep non-PASS until approved or drilled. |
| `WAF_ACTIVE_RULES` | OPS-01, M1-01 | BLOCKED | not_requested | 1 | Cloudflare WAF/rate-limit active-rule and smoke evidence remains pending provider evidence. |
| `ONCALL_PLAYBOOKS` | OPS-01 | BLOCKED | not_requested | 2 | One-person on-call playbook exists, but dry-run/provider evidence remains pending. |
| `FIRST_24H_WATCH` | OPS-02 | BLOCKED | not_requested | 2 | First-24h watch runbook exists, but live post-open watch handoff has not started. |
| `CLEANUP_ISOLATION` | PAY-01, OPS-01 | BLOCKED | not_requested | 1 | Dedicated test-event approval and required PHASE26_TEST_* fixtures were not provided in this executor context; no production-like rehearsal, Toss confirm, or cleanup mutation was run. |

## Final Readiness

- M1_LOCALE_SCOPE: BLOCKED is no-go
- ADMIN_CUTOVER_UI: BLOCKED is no-go
- TOSS_TEST_REHEARSAL: BLOCKED is no-go
- TOSS_LIVE_KEY_SMOKE: BLOCKED is no-go
- BOOKING_ENABLED_GO_NO_GO: BLOCKED is no-go
- LOAD_10K_BASELINE: BLOCKED is no-go
- LOAD_20K_STRESS: BLOCKED is no-go
- DR_CLOUD_RUN_ROLLBACK: CONFIG_READY_NOT_DRILLED requires owner approval, monitoring, and rollback/close trigger
- DR_CLOUD_SQL_PITR: BLOCKED is no-go
- DR_VALKEY_RECONNECT: BLOCKED is no-go
- INFRA_POOL_PGBOUNCER: CONFIG_READY_NOT_DRILLED requires owner approval, monitoring, and rollback/close trigger
- INFRA_HA_REPLICA: CONFIG_READY_NOT_DRILLED requires owner approval, monitoring, and rollback/close trigger
- WAF_ACTIVE_RULES: BLOCKED is no-go
- ONCALL_PLAYBOOKS: BLOCKED is no-go
- FIRST_24H_WATCH: BLOCKED is no-go
- CLEANUP_ISOLATION: BLOCKED is no-go

## Accepted-Risk Entries

- `TOSS_TEST_SECRET_ROTATION` remains `ACCEPTED_RISK` with approval `approved` by `owner`. Evidence: .planning/phases/26-m1-canary-cutover-gates/evidence/26-04-toss-hardening.json.

## Config-Ready-Not-Drilled Entries

- `DR_CLOUD_RUN_ROLLBACK` remains `CONFIG_READY_NOT_DRILLED`; this is non-PASS and requires owner approval before it can stop blocking. Evidence: .planning/phases/26-m1-canary-cutover-gates/evidence/26-08-dr-infra.json.
- `INFRA_POOL_PGBOUNCER` remains `CONFIG_READY_NOT_DRILLED`; this is non-PASS and requires owner approval before it can stop blocking. Evidence: .planning/phases/26-m1-canary-cutover-gates/evidence/26-08-dr-infra.json.
- `INFRA_HA_REPLICA` remains `CONFIG_READY_NOT_DRILLED`; this is non-PASS and requires owner approval before it can stop blocking. Evidence: .planning/phases/26-m1-canary-cutover-gates/evidence/26-08-dr-infra.json.

## Operator Rules

- `PASS` requires direct evidence.
- `FAIL` and `BLOCKED` are no-go.
- Empty evidence is no-go.
- `ACCEPTED_RISK` requires owner approval, failed gate, compensating monitoring, and rollback or close-booking trigger.
- `CONFIG_READY_NOT_DRILLED` requires owner approval and remains non-PASS.
- Real Girl Rules event data, real users, real payments, real tickets, real sessions, and real seat state are protected from rehearsal cleanup.
