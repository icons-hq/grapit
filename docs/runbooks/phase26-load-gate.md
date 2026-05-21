---
phase: 26-m1-canary-cutover-gates
status: operator_runbook
last_updated: 2026-05-20
scope: LOAD-01 k6 baseline and stress gates for ticketing cutover
---

# Phase 26 Load Gate

## Purpose

LOAD-01 requires a dedicated test-event 10k baseline and 20k stress attempt before live ticketing cutover. The gate passes only when both k6 runs keep `p95` under `2000ms` and `error rate` under `1%`.

Do not convert missing, failed, or unapproved load evidence to PASS. Record it as `BLOCKED`, `FAIL`, or explicit `ACCEPTED_RISK` only with owner approval in the final Gate Ledger.

## Approval Checklist

Complete every item before running load:

| Check | Required value |
| --- | --- |
| Target approval | Owner approves target, time window, and dedicated test event |
| Approval env | `PHASE26_LOAD_APPROVED=PHASE26_DEDICATED_TEST_EVENT_APPROVED` |
| API target | `GRABIT_API_URL` points to the approved production-like API base, normally `https://api.heygrabit.com/api/v1` |
| Test event | `PHASE26_TEST_PERFORMANCE_ID` and `PHASE26_TEST_SHOWTIME_ID` are dedicated test IDs, not the real Girl Rules event |
| Test marker | `PHASE26_TEST_MARKER` starts with `PHASE26_TEST` |
| Auth | `PHASE26_AUTH_HEADER` is available only in the shell/session and is never written to artifacts |
| Mutation scope | `PHASE26_MUTATION_WEIGHT` stays low; Toss confirm/cancel/query are not part of the high-volume paths |
| Stop authority | Operator is watching Cloud Run, DB, Valkey, Cloudflare, and app logs and can stop the run immediately |

If any item is missing, write blocked evidence:

```bash
node scripts/phase26/record-k6-evidence.mjs \
  --record-blocked \
  --blocked-reason "Operator-approved target, credentials, or load window unavailable"
```

## Stop Criteria

Stop the k6 process and record `FAIL` or `BLOCKED` evidence if any of these occur:

| Signal | Stop condition |
| --- | --- |
| k6 threshold | `http_req_duration p(95)<2000` or `http_req_failed rate<0.01` fails |
| Cloud Run | sustained 5xx, container restarts, revision crash, or request queue saturation |
| DB | connection exhaustion, lock waits affecting payment/reservation paths, or write errors |
| Valkey | Redis/Valkey reconnect failure, queue admission errors, seat-lock errors, or `CROSSSLOT` |
| Cloudflare | challenge/block rule unexpectedly affects normal test traffic |
| Payment provider | any Toss confirm/cancel/query receives high-volume traffic or provider errors spike |
| Safety | any sign that real users, real Girl Rules seats, real reservations, or real payments are affected |

## Docker k6 Commands

The Docker `-e` flag before the image sets container environment, but k6 script env should be passed to the k6 CLI with `-e`. Keep secrets out of shell history where possible.

Version check:

```bash
docker run --rm -i grafana/k6 version
```

Create output directory:

```bash
mkdir -p .planning/phases/26-m1-canary-cutover-gates/evidence/k6
```

Run the 10k baseline:

```bash
docker run --rm -i \
  -v "$PWD/.planning/phases/26-m1-canary-cutover-gates/evidence/k6:/out" \
  grafana/k6 run \
  -e GRABIT_API_URL="$GRABIT_API_URL" \
  -e PHASE26_LOAD_APPROVED="$PHASE26_LOAD_APPROVED" \
  -e PHASE26_TEST_PERFORMANCE_ID="$PHASE26_TEST_PERFORMANCE_ID" \
  -e PHASE26_TEST_SHOWTIME_ID="$PHASE26_TEST_SHOWTIME_ID" \
  -e PHASE26_TEST_SEAT_ID="$PHASE26_TEST_SEAT_ID" \
  -e PHASE26_TEST_MARKER="$PHASE26_TEST_MARKER" \
  -e PHASE26_AUTH_HEADER="$PHASE26_AUTH_HEADER" \
  -e PHASE26_QUEUE_SESSION_ID="$PHASE26_QUEUE_SESSION_ID" \
  -e PHASE26_QUEUE_ADMISSION_TOKEN="$PHASE26_QUEUE_ADMISSION_TOKEN" \
  -e PHASE26_READ_WEIGHT="${PHASE26_READ_WEIGHT:-75}" \
  -e PHASE26_QUEUE_WEIGHT="${PHASE26_QUEUE_WEIGHT:-20}" \
  -e PHASE26_MUTATION_WEIGHT="${PHASE26_MUTATION_WEIGHT:-5}" \
  --summary-export /out/phase26-baseline-summary.json \
  - < scripts/k6/phase26-baseline.js
```

Run the 20k stress gate:

```bash
docker run --rm -i \
  -v "$PWD/.planning/phases/26-m1-canary-cutover-gates/evidence/k6:/out" \
  grafana/k6 run \
  -e GRABIT_API_URL="$GRABIT_API_URL" \
  -e PHASE26_LOAD_APPROVED="$PHASE26_LOAD_APPROVED" \
  -e PHASE26_TEST_PERFORMANCE_ID="$PHASE26_TEST_PERFORMANCE_ID" \
  -e PHASE26_TEST_SHOWTIME_ID="$PHASE26_TEST_SHOWTIME_ID" \
  -e PHASE26_TEST_SEAT_ID="$PHASE26_TEST_SEAT_ID" \
  -e PHASE26_TEST_MARKER="$PHASE26_TEST_MARKER" \
  -e PHASE26_AUTH_HEADER="$PHASE26_AUTH_HEADER" \
  -e PHASE26_QUEUE_SESSION_ID="$PHASE26_QUEUE_SESSION_ID" \
  -e PHASE26_QUEUE_ADMISSION_TOKEN="$PHASE26_QUEUE_ADMISSION_TOKEN" \
  -e PHASE26_READ_WEIGHT="${PHASE26_READ_WEIGHT:-80}" \
  -e PHASE26_QUEUE_WEIGHT="${PHASE26_QUEUE_WEIGHT:-18}" \
  -e PHASE26_MUTATION_WEIGHT="${PHASE26_MUTATION_WEIGHT:-2}" \
  --summary-export /out/phase26-stress-summary.json \
  - < scripts/k6/phase26-stress.js
```

Record pass/fail evidence:

```bash
node scripts/phase26/record-k6-evidence.mjs \
  --baseline .planning/phases/26-m1-canary-cutover-gates/evidence/k6/phase26-baseline-summary.json \
  --stress .planning/phases/26-m1-canary-cutover-gates/evidence/k6/phase26-stress-summary.json \
  --target "$GRABIT_API_URL" \
  --performance-id "$PHASE26_TEST_PERFORMANCE_ID" \
  --showtime-id "$PHASE26_TEST_SHOWTIME_ID" \
  --window "$PHASE26_LOAD_WINDOW" \
  --approved-by "$PHASE26_LOAD_APPROVED_BY" \
  --approval-token "$PHASE26_LOAD_APPROVED"
```

## Side Metrics To Watch

Run these checks during and after each attempt:

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3

gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.metadata.annotations,spec.template.spec.containers[0].env)'

gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND (severity>=WARNING OR "queue" OR "lock" OR "prepare" OR "CROSSSLOT" OR "payment" OR "qr")' \
  --project="$PROJECT_ID" \
  --limit=100 \
  --format='value(timestamp,severity,httpRequest.status,textPayload,jsonPayload.message)'

curl -fsS https://api.heygrabit.com/api/v1/health
```

Database and Valkey checks should stay read-only unless an incident requires a reviewed runbook action. Do not run cleanup or destructive Redis commands from this load gate.

## Ledger Handling

After writing `.planning/phases/26-m1-canary-cutover-gates/evidence/26-06-load.json`:

1. `LOAD_10K_BASELINE` maps to the baseline check.
2. `LOAD_20K_STRESS` maps to the stress check.
3. `PASS` requires both p95/error-rate thresholds and valid approval metadata.
4. `FAIL` blocks cutover unless owner records `ACCEPTED_RISK` with compensating monitoring and rollback/close-booking trigger.
5. `BLOCKED` means the load gate did not run or evidence was incomplete. It is not a pass.

Never store raw Authorization headers, cookies, Toss keys, Toss `paymentKey`, QR tokens, phone numbers, emails, or real production user data in k6 summaries, copied logs, screenshots, commits, or Gate Ledger notes.
