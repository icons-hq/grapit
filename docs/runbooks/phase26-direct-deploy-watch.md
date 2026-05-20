---
phase: 26-m1-canary-cutover-gates
plan: 26-07
status: active_runbook
scope: M1 direct deploy strict-watch gate
last_updated: 2026-05-20
---

# Phase 26 Direct Deploy Watch Runbook

## Purpose

This runbook is the M1-01 operator gate for Phase 26.

The only deploy sequence for this gate is:

1. CI/CD green.
2. 100% direct deploy.
3. 15-minute strict watch.
4. Rollback if any critical user-path trigger fires.

This follows Phase 26 D-05 through D-08. It supersedes older canary wording with direct deploy evidence and strict watch evidence.

## Scope

Watch these production paths immediately after the direct deploy:

- API health.
- Auth/session login/refresh.
- Public event detail.
- BOOKING_ENABLED=false booking-disabled behavior.
- Queue entry.
- Payment-safe path and payment confirm safety.
- Cloud Run logs for API/Web critical errors.

Evidence must be redacted. Do not store raw cookies, bearer tokens, Toss keys, full paymentKey/orderId values, QR tokens, OTP values, phone numbers, email addresses, or PII.

## Baseline

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3
API_SERVICE=grabit-api
WEB_SERVICE=grabit-web
API_URL=https://api.heygrabit.com
WEB_URL=https://heygrabit.com
EVIDENCE=.planning/phases/26-m1-canary-cutover-gates/evidence/26-07-direct-deploy-watch.json
```

BOOKING_ENABLED=false is required during this M1 watch unless a later approved cutover gate explicitly changes it.

## Preconditions

- GitHub Actions Deploy workflow is green for the commit being deployed.
- The deploy has reached 100% direct deploy for both `grabit-api` and `grabit-web`.
- Previous known-good API and Web revision IDs are identified before the watch starts.
- Operator has safe auth/session, queue entry, and payment-safe smoke commands that do not print secrets.
- Public detail URL points to a safe published event and does not mutate live booking state.

## Fast Status Commands

Cloud Run status:

```bash
gcloud run services describe "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'

gcloud run services describe "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'
```

Health:

```bash
curl -fsS "$API_URL/api/v1/health"
```

Runtime flags:

```bash
curl -fsS "$WEB_URL/api/runtime-flags"
```

Expected runtime flag result:

```json
{"bookingEnabled":false}
```

M1 Playwright smoke:

```bash
CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e -- phase26-m1-smoke.spec.ts
```

Direct deploy watch CLI:

```bash
node scripts/phase26/direct-deploy-watch.mjs \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --public-detail-url="$WEB_URL/performance/<safe-performance-id>" \
  --rollback-api-revision="<previous-api-revision>" \
  --rollback-web-revision="<previous-web-revision>" \
  --auth-smoke-command="<redacted-safe-auth-session-smoke>" \
  --queue-smoke-command="<redacted-safe-queue-entry-smoke>" \
  --payment-safe-command="<redacted-safe-payment-smoke>" \
  --evidence="$EVIDENCE"
```

Cloud Run logs:

```bash
WATCH_START_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name=("grabit-api" OR "grabit-web")
   AND timestamp>="'"$WATCH_START_UTC"'"
   AND (severity>=WARNING
        OR "auth/refresh"
        OR "queue"
        OR "confirm"
        OR "health"
        OR "payment")' \
  --project="$PROJECT_ID" \
  --limit=100 \
  --format='value(timestamp,severity,resource.labels.service_name,httpRequest.status,textPayload,jsonPayload.message)'
```

## 15-Minute Strict Watch

Run checks in this order at deploy completion, then repeat during the 15-minute strict watch:

1. Cloud Run latest ready revision and 100% direct deploy traffic.
2. API health.
3. Runtime flags and BOOKING_ENABLED=false.
4. Auth/session login/refresh.
5. Public event detail.
6. Queue entry.
7. Payment-safe path and payment confirm safety.
8. Cloud Run logs.

Record:

- Timestamp.
- API/Web latest ready revision IDs.
- Previous rollback revision IDs in short form.
- HTTP status codes.
- Smoke command shapes.
- Redacted log summary.
- PASS, FAIL, BLOCKED, or NO_GO decision.

## Rollback Triggers

Rollback immediately and keep the M1 gate NO_GO if any of these occur:

| Trigger | Examples | Immediate action |
| --- | --- | --- |
| health 5xx | `/api/v1/health` returns 5xx or times out repeatedly | rollback API revision |
| login/refresh failure | safe account cannot login, `/auth/refresh` fails, session user changes unexpectedly | rollback API/Web depending on fault |
| public detail non-2xx | event detail returns 3xx/4xx/5xx or app error boundary for safe published event | rollback Web first, API if data/API fault |
| BOOKING_ENABLED=false side effects | seat lock, reservation prepare, Toss branch/confirm, payment row, or sold seat side effect occurs while disabled | rollback or close booking immediately |
| queue entry 5xx | queue enter/session path returns 5xx or Cloud Run queue errors spike | rollback API revision |
| payment confirm unsafe behavior | payment confirm runs when disabled, confirms without safe reservation/QR state, or creates unsafe provider side effect | rollback API and keep booking closed |

Accepted risk is not PASS evidence. Any trigger needs a root cause fix and a clean full watch before M1 can be marked PASS.

## Rollback Commands

API rollback:

```bash
gcloud run services update-traffic "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions "<previous-api-revision>=100"

curl -fsS "$API_URL/api/v1/health"
```

Web rollback:

```bash
gcloud run services update-traffic "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions "<previous-web-revision>=100"

curl -fsS "$WEB_URL/api/runtime-flags"
```

After rollback:

```bash
gcloud run services describe "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic)'

gcloud run services describe "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic)'
```

## Evidence Rules

Use `.planning/phases/26-m1-canary-cutover-gates/evidence/26-07-direct-deploy-watch.json` for the redacted watch output.

Evidence can include:

- Revision ID prefixes.
- Command shapes.
- HTTP status codes.
- Redacted log excerpts.
- Aggregated check status.

Evidence must not include:

- Raw cookies or bearer tokens.
- Toss secret/client keys.
- Full paymentKey or orderId values.
- QR token/JWT/HMAC payloads.
- OTP values.
- Phone numbers, email addresses, or raw user rows.

## PASS Rule

M1 direct deploy watch can be marked PASS only when all strict-watch checks pass for the full 15-minute window:

- CI/CD green.
- 100% direct deploy.
- Health check green.
- Auth/session login/refresh green.
- Public event detail returns 2xx.
- BOOKING_ENABLED=false with no booking side effects.
- Queue entry below 500.
- Payment confirm safe behavior.
- Cloud Run logs clear of critical watch patterns.

If any row is FAIL or BLOCKED, keep `M1_DIRECT_DEPLOY_WATCH` as no-go until fixed or explicitly owner-approved as non-PASS in the Gate Ledger.
