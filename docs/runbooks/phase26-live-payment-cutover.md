---
phase: 26-m1-canary-cutover-gates
plan: 26-10
status: ready_for_operator_execution
scope: PAY-01 live payment and BOOKING_ENABLED cutover
last_updated: 2026-05-20
---

# Phase 26 Live Payment Cutover Runbook

## Purpose

This runbook is the PAY-01 and OPS-02 live payment cutover gate. The sequence is
two-step by design:

1. Inject and verify Toss live keys while `BOOKING_ENABLED=false`.
2. Run live key smoke and Gate Ledger readiness.
3. Enable `BOOKING_ENABLED=true` only after the Gate Ledger allows it and the
   owner records the final go decision.

Do not paste raw Toss keys, payment keys, cookies, bearer tokens, QR tokens,
OTP values, phone numbers, e-mail addresses, or customer data into this file,
shell output, screenshots, issues, or evidence artifacts.

## Baseline

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3
API_SERVICE=grabit-api
WEB_SERVICE=grabit-web
API_URL=https://api.heygrabit.com
WEB_URL=https://heygrabit.com
LEDGER=.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json
LIVE_EVIDENCE=.planning/phases/26-m1-canary-cutover-gates/evidence/26-10-live-cutover.json
```

The production booking flag must stay closed before live smoke:

```bash
curl -fsS "$WEB_URL/api/runtime-flags"
```

Expected before Step 3:

```json
{"bookingEnabled":false}
```

## Step 0: TOSS_TEST_SECRET_ROTATION Gate

Before relying on any test-key rehearsal evidence, inspect the Gate Ledger row
`TOSS_TEST_SECRET_ROTATION`.

Allowed outcomes:

- `PASS`: the exposed Toss test secret was reissued or rotated, then Secret
  Manager, Cloud Run, and CI bindings were updated and verified.
- `ACCEPTED_RISK`: only allowed when the owner explicitly approved D-24
  progression, with approver, timestamp, failed gate, compensating monitoring,
  and rollback or close-booking trigger recorded.

Stop immediately when:

- The row is missing.
- The row is `BLOCKED` or `FAIL`.
- The row is non-PASS without explicit D-24 owner-approved risk metadata.
- Any artifact contains raw Toss key material.

Command:

```bash
node scripts/phase26/cutover-readiness.mjs --aggregate-only
node - <<'NODE'
const fs = require('fs');
const ledger = JSON.parse(fs.readFileSync(process.env.LEDGER || '.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json', 'utf8'));
const row = ledger.gates.find((gate) => gate.gateId === 'TOSS_TEST_SECRET_ROTATION');
if (!row) throw new Error('missing TOSS_TEST_SECRET_ROTATION');
if (row.state === 'BLOCKED' || row.state === 'FAIL') throw new Error(`blocked rotation gate: ${row.state}`);
if (row.state !== 'PASS' && row.approvalState !== 'approved') throw new Error('non-PASS rotation gate lacks D-24 owner approval');
console.log(`${row.gateId}: ${row.state}`);
NODE
```

## Step 1: Inject Live Keys With BOOKING_ENABLED=false

Live key injection is allowed only after Toss review/live-key availability is
confirmed by the operator.

Required checks:

1. `TOSS_CLIENT_KEY` is a live client-key class and is available only where the
   web build/runtime expects a client key.
2. `TOSS_SECRET_KEY` is stored as a server-only Secret Manager binding for
   `grabit-api`.
3. `TOSS_SECRET_KEY` is not present in the web image, browser bundle, client
   runtime flags, Cloud Run web env, logs, or evidence.
4. `BOOKING_ENABLED=false` remains true during all live-key smoke checks.

Inspect Cloud Run bindings without printing secret values:

```bash
gcloud run services describe "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,spec.template.spec.containers[0].env)'

gcloud run services describe "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,spec.template.spec.containers[0].env)'
```

Expected evidence shape:

- API has `TOSS_SECRET_KEY=<secret-bound>`.
- Web does not expose a server secret.
- Client key evidence records only key class and a short redacted prefix.
- Runtime flags still show `BOOKING_ENABLED=false`.

## Step 2: Live Key Smoke

Run these checks while `BOOKING_ENABLED=false`. Use a dedicated safe fixture and
avoid the real Girl Rules event unless the owner explicitly approves the final
go window.

### 2.1 Key Class And Server-Only Handling

Record only class and redacted prefix:

- live key class/prefix for client key.
- live key class/prefix for server secret.
- Secret Manager version metadata.
- Cloud Run binding names.

Leakage scan:

```bash
rg -n "live_sk_|test_sk_|TOSS_SECRET_KEY|paymentKey\\s*[:=]|Authorization: Bearer|Cookie:" \
  apps/web apps/api docs .planning/phases/26-m1-canary-cutover-gates \
  --glob '!**/node_modules/**'
```

Expected: no raw secret, no raw payment key, no auth header, no cookie, no QR
token. Known safe strings such as variable names may appear only as command
shape or policy text.

### 2.2 Widget And Client-Key Initialization

Open a safe booking/payment page and verify:

- Toss widget initializes with the live client-key class.
- No server secret appears in browser console, network payload, source maps, or
  runtime flag responses.
- Payment request is not allowed to create live booking side effects while
  `BOOKING_ENABLED=false`.

### 2.3 Server Confirm, Query, Cancel

Where Toss and the merchant state allow a safe live transaction, verify the
server-only flow:

1. `confirm` uses server-side amount verification.
2. `query` re-verifies provider truth by payment identifier before final local
   state is trusted.
3. `cancel` or close/reversal path is available for the safe smoke transaction.
4. Idempotency behavior is preserved for retryable `confirm` and `cancel`.

Do not record the raw payment identifier. Use masked order/payment labels only.

If safe live transaction state is unavailable, record `BLOCKED` in
`26-10-live-cutover.json` and stop before Step 3.

### 2.4 Webhook Delivery And Query Re-Verification

Verify:

- Toss webhook delivery reaches the production API endpoint.
- The app re-queries Toss by payment identifier before applying final local
  payment state.
- Webhook evidence stores event class, timestamp, HTTP status, and masked
  identifiers only.

If webhook delivery or query re-verification cannot be proven, keep live booking
closed.

## Step 3: Gate Ledger Approval And BOOKING_ENABLED=true

Run readiness:

```bash
node scripts/phase26/cutover-readiness.mjs \
  --ledger "$LEDGER" \
  --booking-enabled-check
```

`BOOKING_ENABLED=true` may be applied only when the command exits 0 and the
owner records final approval.

No-go conditions include:

- Any required Gate Ledger row is `BLOCKED` or `FAIL`.
- Any required row has missing evidence.
- Any `ACCEPTED_RISK` or `CONFIG_READY_NOT_DRILLED` row lacks owner approval,
  approver, timestamp, monitoring, and rollback/close trigger.
- `TOSS_TEST_SECRET_ROTATION` is missing, `BLOCKED`, `FAIL`, or unapproved.
- `TOSS_LIVE_KEY_SMOKE` is missing or non-PASS without explicit allowed
  semantics.
- Admin cutover API/UI runtime artifact evidence is missing.
- First-2h/24h monitoring handoff is missing.

Enable only through the approved Cloud Run/Secret Manager path:

```bash
gcloud run services update "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars=BOOKING_ENABLED=true

gcloud run services update "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars=BOOKING_ENABLED=true
```

Then verify:

```bash
curl -fsS "$WEB_URL/api/runtime-flags"
curl -fsS "$API_URL/api/v1/health"
```

## Rollback And Close-Booking

Close booking first when financial or seat safety is uncertain:

```bash
gcloud run services update "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars=BOOKING_ENABLED=false

gcloud run services update "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars=BOOKING_ENABLED=false
```

Rollback the latest API revision when deploy/runtime config is the likely cause:

```bash
gcloud run services update-traffic "$API_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions LAST_KNOWN_GOOD_API_REVISION=100
```

Rollback the latest Web revision when frontend/runtime display is the likely
cause:

```bash
gcloud run services update-traffic "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions LAST_KNOWN_GOOD_WEB_REVISION=100
```

Immediate close-booking triggers:

- Duplicate sale.
- Payment confirm success without reservation or QR.
- Payment failure spike.
- Seat lock or prepare side-effect mismatch.
- Queue admission stuck.
- Refund/cancel job buildup.
- Provider/local Toss state mismatch.
- Raw secret leakage in frontend, logs, docs, artifacts, or screenshots.

## First-2h And 24h Watch Handoff

After `BOOKING_ENABLED=true`, start the first-2h intensive watch immediately:

- Every 5-10 minutes for the first 2 hours.
- Every 30-60 minutes until 24h after ticketing open.

Use:

- `.planning/phases/26-m1-canary-cutover-gates/26-FIRST-24H-WATCH.md`
- `docs/runbooks/phase26-direct-deploy-watch.md`
- `docs/runbooks/phase26-cutover-ops.md`
- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-10-live-cutover.json`

Minimum watch categories:

- Queue length/admission rate.
- Seat lock/prepare and remaining seats.
- Toss confirm/query/cancel/webhook.
- QR issuance and visibility.
- Refund/cancel jobs.
- Cloud Run health and critical logs.
- Sentry alert/issue spikes.
- Cloudflare normal-pass and suspicious challenge/block/rate-limit evidence.

The 24h watch is not complete while any duplicate sale, reservation/QR mismatch,
payment failure spike, seat mismatch, queue stuck, refund/cancel backlog,
critical Cloud Run/Sentry spike, or Cloudflare false-positive remains open.
