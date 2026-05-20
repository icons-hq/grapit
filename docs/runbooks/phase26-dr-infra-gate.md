---
phase: 26-m1-canary-cutover-gates
status: active_runbook
last_updated: 2026-05-20
scope: DR-01 and INFRA-01 evidence gates for Cloud Run, Cloud SQL, Valkey, pgBouncer, HA/read replica, and DB pool sizing
---

# Phase 26 DR And Infra Gate Runbook

## Purpose

This runbook is the operator-safe gate for `DR-01` and `INFRA-01` before payment cutover.

The rule is strict: `PASS` is allowed only for an actual successful drill. Configuration review alone is `CONFIG_READY_NOT_DRILLED`, and unresolved or unapproved work remains `BLOCKED`. `ACCEPTED_RISK` requires explicit owner approval, compensating monitoring, and a rollback or close-booking trigger.

## Baseline

Use the Grabit production project and Seoul region explicitly on every command.

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3
API_SERVICE=grabit-api
WEB_SERVICE=grabit-web
CLOUD_SQL_INSTANCE=grapit-db
EVIDENCE=.planning/phases/26-m1-canary-cutover-gates/evidence/26-08-dr-infra.json
```

Never rely on the local active `gcloud` project. Never paste raw `DATABASE_URL`, Redis URLs, cookies, auth headers, JWTs, provider tokens, payment identifiers, SQL row dumps, or PII into evidence.

## Gate Classification Rules

| State | Meaning | Cutover effect |
| --- | --- | --- |
| `PASS` | The named drill actually ran successfully and evidence was recorded. | Can satisfy the gate. |
| `CONFIG_READY_NOT_DRILLED` | Config or command readiness was collected, but no drill ran. | Non-PASS; requires owner approval before final cutover. |
| `ACCEPTED_RISK` | Owner accepts a non-PASS gate with compensating monitoring and rollback trigger. | Non-PASS but may be allowed by final Gate Ledger approval. |
| `BLOCKED` | Approval, safe target, permissions, credentials, or evidence are missing. | No-go. |
| `FAIL` | The drill ran and failed. | No-go unless later remediated or explicitly accepted as risk. |

Do not convert `CONFIG_READY_NOT_DRILLED` or `ACCEPTED_RISK` to `PASS` in the Gate Ledger or summaries.

## Evidence Collector

Run the read-only collector first. It records Cloud Run service/revision/traffic/env summaries, Cloud SQL backup/PITR/HA/read-replica metadata, `DB_POOL_MAX` and timeout settings, pgBouncer config evidence if present, and Valkey smoke state.

```bash
node scripts/phase26/infra-evidence.mjs \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --output "$EVIDENCE"
```

Expected result:

- Cloud Run commands include `--project=grapit-491806` and `--region=asia-northeast3`.
- `DATABASE_URL`, Redis URLs, cookies, tokens, and provider keys are redacted.
- `DR_CLOUD_SQL_PITR` stays `BLOCKED` until owner-approved safe-target restore evidence exists.
- `INFRA_POOL_PGBOUNCER` and `INFRA_HA_REPLICA` stay `CONFIG_READY_NOT_DRILLED` unless actually drilled.

## Owner Approval Before Restore Or Rollback Drill

Before any Cloud SQL restore/PITR or production rollback drill, record owner approval outside the repo and export only non-secret metadata:

```bash
export PHASE26_DR_APPROVED=true
export PHASE26_DR_APPROVER="owner"
export PHASE26_RESTORE_TARGET="grapit-db-p26-dr-YYYYMMDD-HHMM"
export PHASE26_RESTORE_WINDOW="YYYY-MM-DDTHH:MM:SSZ..YYYY-MM-DDTHH:MM:SSZ"
```

Approval must cover:

- Safe restore target name and region.
- Expected cost and cleanup timing.
- Drill window and rollback trigger.
- Confirmation that the source production instance is not overwritten.

If any field is missing, classify restore as `BLOCKED`. Do not run PITR or restore commands.

## Cloud Run Rollback Drill

### Readiness Evidence

```bash
gcloud run services describe "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'

gcloud run services describe "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'

gcloud run revisions list \
  --service="$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --sort-by='~metadata.creationTimestamp' \
  --limit=5 \
  --format='table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)'
```

Readiness evidence alone is `CONFIG_READY_NOT_DRILLED`.

### Actual Rollback Drill

Only run this during an approved window and only with a known previous-good revision.

```bash
LAST_KNOWN_GOOD_REVISION=grabit-api-previous-good

gcloud run services update-traffic "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions="${LAST_KNOWN_GOOD_REVISION}=100" \
  --quiet

curl -fsS https://api.heygrabit.com/api/v1/health

gcloud run services update-traffic "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-latest \
  --quiet
```

Record `PASS` only after the rollback command and restore-to-latest command both complete and health/log smoke stays clean. If the command fails, record `FAIL`. If the approved window is unavailable, record `CONFIG_READY_NOT_DRILLED`.

Rollback trigger: health 5xx, login/refresh failure, public detail 5xx, unsafe `BOOKING_ENABLED=false` side effects, queue entry 5xx, or payment confirm unsafe behavior.

## Cloud SQL PITR / Restore Drill

### Readiness Evidence

```bash
gcloud sql instances describe "$CLOUD_SQL_INSTANCE" \
  --project="$PROJECT_ID" \
  --format='json(name,region,databaseVersion,settings.availabilityType,settings.backupConfiguration,settings.dataDiskSizeGb)'

gcloud sql backups list \
  --instance="$CLOUD_SQL_INSTANCE" \
  --project="$PROJECT_ID" \
  --limit=5 \
  --sort-by='~endTime' \
  --format='table(id,status,type,windowStartTime,endTime)'
```

Backup and PITR config evidence is not enough for `PASS`; it is `CONFIG_READY_NOT_DRILLED` unless the safe-target restore completes.

### Safe-Target PITR Restore

Use a new target instance. Never restore into `grapit-db`.

```bash
RESTORE_POINT_UTC=YYYY-MM-DDTHH:MM:SS.000Z

gcloud sql instances clone "$CLOUD_SQL_INSTANCE" "$PHASE26_RESTORE_TARGET" \
  --project="$PROJECT_ID" \
  --point-in-time="$RESTORE_POINT_UTC" \
  --quiet

gcloud sql instances describe "$PHASE26_RESTORE_TARGET" \
  --project="$PROJECT_ID" \
  --format='json(name,state,region,databaseVersion,settings.availabilityType,settings.backupConfiguration.pointInTimeRecoveryEnabled)'
```

Optional smoke after clone:

```bash
gcloud sql databases list \
  --instance="$PHASE26_RESTORE_TARGET" \
  --project="$PROJECT_ID" \
  --format='table(name,charset,collation)'
```

Record `PASS` only if the clone reaches a usable state and the evidence confirms it is a separate safe target. Record `FAIL` if clone or smoke fails. Record `BLOCKED` if `PHASE26_DR_APPROVED`, `PHASE26_RESTORE_TARGET`, permission, billing, or PITR logs are missing.

Cleanup target after evidence retention:

```bash
gcloud sql instances delete "$PHASE26_RESTORE_TARGET" \
  --project="$PROJECT_ID" \
  --quiet
```

Rollback trigger: do not run destructive rehearsal cleanup unless backup/PITR readiness and restore target handling are accounted for.

## Valkey Reconnect / Failure Smoke

The existing smoke script needs operator-approved auth and safe fixture IDs. Without those inputs, `DR_VALKEY_RECONNECT` remains `BLOCKED`.

```bash
export GRABIT_API_URL=https://api.heygrabit.com
export GRABIT_SMOKE_AUTH_HEADER_FILE=/path/to/untracked-auth-header.txt
export GRABIT_SMOKE_PERFORMANCE_ID=approved-test-performance-uuid
export GRABIT_SMOKE_SHOWTIME_ID=approved-test-showtime-uuid
export GRABIT_SMOKE_SEAT_ID=approved-test-seat-id
export GRABIT_GCP_PROJECT="$PROJECT_ID"
export GRABIT_GCP_REGION="$REGION"
export GRABIT_SMOKE_ARTIFACT=.planning/phases/26-m1-canary-cutover-gates/evidence/26-08-valkey-smoke.md

node scripts/smoke-valkey-production.mjs --check health
node scripts/smoke-valkey-production.mjs --check idle
node scripts/smoke-valkey-production.mjs --check logs

node scripts/phase26/infra-evidence.mjs \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --run-valkey-smoke health \
  --output "$EVIDENCE"
```

Record `PASS` only when the smoke actually succeeds with safe fixtures and sanitized logs. Record `BLOCKED` when credentials or safe fixture IDs are missing. Record `FAIL` for connection, `CROSSSLOT`, timeout, or reconnect errors.

Close-booking trigger: queue, seat lock, or payment safety signals degrade after Valkey disruption.

## pgBouncer And DB Pool Sizing

Current deployment evidence must include:

```bash
rg -n "DB_POOL_MAX|DB_POOL_IDLE_TIMEOUT_MS|DB_POOL_CONNECTION_TIMEOUT_MS|--max-instances" .github/workflows/deploy.yml
rg -n "DB_POOL_MAX|DB_POOL_IDLE_TIMEOUT_MS|DB_POOL_CONNECTION_TIMEOUT_MS|new Pool" apps/api/src/database/drizzle.provider.ts
rg -n "pgBouncer|pool_mode|transaction" .github apps scripts docs || true
```

Interpretation:

- `DB_POOL_MAX` proves per-instance application pool sizing is configured.
- Cloud Run `--max-instances` times `DB_POOL_MAX` is the maximum app-side DB connection demand.
- pgBouncer transaction pooling is `PASS` only if pgBouncer is deployed and exercised under a drill/load window.
- If `DB_POOL_MAX` exists but pgBouncer is missing or untested, classify `INFRA_POOL_PGBOUNCER` as `CONFIG_READY_NOT_DRILLED` or owner-approved `ACCEPTED_RISK`, never `PASS`.

Rollback trigger: DB connection saturation affecting queue, reservation prepare, payment confirm, or seat safety.

## Cloud SQL HA And Read Replica

Collect config evidence:

```bash
gcloud sql instances list \
  --project="$PROJECT_ID" \
  --format='table(name,region,databaseVersion,settings.availabilityType,instanceType,masterInstanceName,state)'

gcloud sql instances describe "$CLOUD_SQL_INSTANCE" \
  --project="$PROJECT_ID" \
  --format='json(name,region,settings.availabilityType,settings.locationPreference,replicaNames)'
```

Interpretation:

- `settings.availabilityType=REGIONAL` is HA configuration evidence.
- `READ_REPLICA_INSTANCE` or `replicaNames` is read replica configuration evidence.
- HA/read replica is `PASS` only after failover/read-replica behavior is actually drilled or validated in the approved window.
- Zonal primary without replica remains `CONFIG_READY_NOT_DRILLED` or `BLOCKED` depending on owner approval and cutover tolerance.

Rollback trigger: database failover/read capacity risk causes payment, queue, or seat safety failures.

## Evidence Close-Out Checklist

Before final cutover readiness, confirm:

- `node scripts/phase26/infra-evidence.mjs --help` works.
- `$EVIDENCE` exists and contains only redacted data.
- Every row uses one of `PASS`, `FAIL`, `ACCEPTED_RISK`, `CONFIG_READY_NOT_DRILLED`, or `BLOCKED`.
- No undrilled infrastructure row is marked `PASS`.
- Safe-target restore approval and cleanup are recorded when PITR/restore runs.
- Rollback/close-booking triggers are attached to every non-PASS gate.

Final reminder: `BOOKING_ENABLED=true` remains no-go while `DR_CLOUD_SQL_PITR`, `DR_VALKEY_RECONNECT`, `INFRA_POOL_PGBOUNCER`, or `INFRA_HA_REPLICA` are `BLOCKED` or unapproved non-PASS.
