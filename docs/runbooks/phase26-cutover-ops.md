---
phase: 26-m1-canary-cutover-gates
status: active_runbook
last_updated: 2026-05-20
scope: OPS-01 one-person cutover operations, monitoring evidence, WAF smoke, and incident handling
---

# Phase 26 Cutover Operations Runbook

## Purpose

이 runbook은 Phase 26 `OPS-01`의 one-person on-call 절차입니다. 목표는
ticketing cutover 전후에 `Sentry`, `Cloud Run logs`, `Cloudflare`, 그리고
business metrics를 evidence로 남기고, 문제가 보이면 즉시 rollback 또는
close-booking 결정을 내릴 수 있게 하는 것입니다.

Phase 26은 Cloud Run traffic-split canary를 PASS evidence로 사용하지 않습니다.
운영 흐름은 `CI/CD green -> 100% direct deploy -> 15-minute watch`입니다.

## Baseline

| Area | Value |
| --- | --- |
| GCP project | `grapit-491806` |
| Region | `asia-northeast3` |
| API service | `grabit-api` |
| Web service | `grabit-web` |
| API health | `https://api.heygrabit.com/api/v1/health` |
| Runtime flag | `https://heygrabit.com/api/runtime-flags` |
| Evidence artifact | `.planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json` |
| Collector | `node scripts/phase26/monitoring-evidence.mjs --write-template` |

## Operator Rules

1. Raw provider secrets, Toss keys, payment keys, QR tokens, cookies, bearer
   tokens, OTP values, full IPs, e-mail addresses, phone numbers, and PII must
   never be pasted into docs, commits, screenshots, or evidence artifacts.
2. Normal-pass WAF smoke and suspicious challenge/block/rate-limit smoke are
   separate evidence rows. Do not use suspicious smoke as proof that normal
   buyers can pass.
3. Suspicious WAF smoke is low-volume only. Stop immediately if real users are
   challenged or blocked.
4. `BOOKING_ENABLED=true` remains no-go until the Gate Ledger allows it.
5. Real Girl Rules users, reservations, payments, tickets, and seat state are
   not rehearsal or cleanup targets.

## Fast dry-run

Run this before a cutover window and after any incident response:

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3

node scripts/phase26/monitoring-evidence.mjs --write-template

gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'

curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags
```

Expected evidence:

- `26-09-ops-monitoring.json` exists and lists Cloud Run, Sentry, Cloudflare,
  queue, payment, QR, refund, sellout, and remaining seats categories.
- API health is HTTP 200.
- `runtime-flags` does not show `bookingEnabled:true` unless final cutover is
  explicitly approved.

## Monitoring order

During the first 15-minute direct-deploy watch and during live ticketing, check
signals in this order:

1. Cloudflare normal-pass and suspicious WAF smoke.
2. Cloud Run health, 5xx rate, and API logs.
3. Queue length and admission rate.
4. Seat lock, reservation prepare, and payment confirm success/failure.
5. Toss payment failure, webhook, cancel, and provider dashboard state.
6. QR issuance and My Page/complete-page visibility.
7. Refund job failures and cancel job buildup.
8. Remaining seats and sellout behavior.

## Procedures

Each incident class below includes at least one dry-run command or read-only
query shape, plus an evidence path or evidence fields to record.

### PG / DB incident

Use this for high latency, exhausted DB connections, transaction failures, or
payment/reservation/ticket query errors.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND (severity>=WARNING OR "database" OR "pg" OR "transaction" OR "connection")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Read-only SQL shape:

```sql
select
  r.status as reservation_status,
  p.status as payment_status,
  t.status as ticket_status
from reservations r
left join payments p on p.reservation_id = r.id
left join tickets t on t.reservation_id = r.id
where r.toss_order_id = '<masked-order-id>';
```

Evidence path:

- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json`

Close-booking trigger:

- DB errors cause payment confirm, seat lock, reservation prepare, or QR
  issuance to become unsafe or unverifiable.

### Valkey incident

Use this for queue admission stuck, `CROSSSLOT`, lock key mismatch, Redis/Valkey
health failure, or Socket.IO adapter errors.

Dry-run command:

```bash
node scripts/smoke-valkey-production.mjs --check health

gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("CROSSSLOT" OR "Redis" OR "Valkey" OR "queue" OR "lock-seat")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Evidence fields:

- health result
- queue admission state
- lock key command class
- redacted session/showtime identifiers only

Close-booking trigger:

- Seat lock/prepare side-effect mismatch, queue admission stuck, or Valkey
  reconnect failure that affects live booking safety.

### Cloud Run incident

Use this for API health failure, web route failure, deploy regression, high 5xx,
or revision/image drift.

Dry-run command:

```bash
gcloud run services describe grabit-api \
  --project=grapit-491806 \
  --region=asia-northeast3 \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'

gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND (severity>=ERROR OR httpRequest.status>=500)' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,httpRequest.status,textPayload,jsonPayload.message)'
```

Rollback command shape:

```bash
gcloud run services update-traffic grabit-api \
  --project=grapit-491806 \
  --region=asia-northeast3 \
  --to-revisions LAST_KNOWN_GOOD_REVISION=100
```

Evidence fields:

- current revision
- previous known-good revision
- failed smoke category
- health/log status

Rollback trigger:

- health 5xx, login/refresh failure, public event detail 5xx, queue entry 5xx,
  `BOOKING_ENABLED=false` while side effects occur, or unsafe payment confirm.

### Cloudflare WAF incident

Use this for normal user challenge, bot/macro flood, WAF rule drift, or active
rule evidence collection.

Normal-pass smoke:

```bash
curl -I https://heygrabit.com
curl -I https://api.heygrabit.com/api/v1/health
```

Suspicious challenge/block/rate-limit smoke:

```bash
curl -I https://heygrabit.com/booking \
  -H 'User-Agent: phase26-low-volume-smoke'
```

Evidence requirements:

- Cloudflare active rule state for queue-entry challenge.
- Cloudflare booking mutation rate-limit state.
- Cloudflare macro/block rule state.
- Normal-pass status and suspicious challenge/block/rate-limit status recorded
  as separate rows.

Close-booking trigger:

- WAF bypass or false-positive behavior makes queue abuse, booking mutation
  abuse, or normal buyer access unsafe.

### Toss / payment failure incident

Use this for Toss redirect failure, webhook failure, confirm/cancel failure,
provider mismatch, payment failure spike, or `DONE` payment without local state.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("payments/toss" OR "webhook" OR "confirm" OR "cancel" OR "payment failure")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,httpRequest.status,textPayload,jsonPayload.message)'
```

Read-only SQL shape:

```sql
select
  r.status as reservation_status,
  p.status as payment_status,
  p.provider,
  p.method,
  t.status as ticket_status
from reservations r
left join payments p on p.reservation_id = r.id
left join tickets t on t.reservation_id = r.id
where r.toss_order_id = '<masked-order-id>';
```

Evidence fields:

- masked order ID
- payment status
- reservation status
- ticket status
- webhook ledger result
- provider dashboard status class, never raw payment key

Close-booking trigger:

- Payment confirm succeeds without reservation/QR, payment failure spike exceeds
  operator threshold, webhook retry backlog grows, or provider truth cannot be
  reconciled with local state.

### Queue stuck incident

Use this when users remain waiting despite capacity, admission tokens reject
valid booking mutations, or queue length does not decrease.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("queue" OR "admission" OR "remainingSeats" OR "queue admission stuck")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Business metrics:

- queue length
- admission rate
- remaining seats
- active admission count
- lock/prepare success after admission

Close-booking trigger:

- Queue admission stuck blocks valid users or allows booking mutation without
  valid admission.

### Oversell-risk incident

Use this for duplicate sale, seat lock mismatch, prepare/confirm side-effect
mismatch, negative remaining seats, or sold seat conflict.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("sold" OR "seat" OR "lock-seat" OR "prepare" OR "confirm" OR "판매 불가능한 좌석")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Read-only SQL shape:

```sql
select
  showtime_id,
  floor_key,
  seat_key,
  count(*) as sold_rows
from seat_inventories
where status = 'sold'
group by showtime_id, floor_key, seat_key
having count(*) > 1;
```

Evidence fields:

- duplicate sale count
- affected showtime ID masked or scoped to dedicated test event
- lock/prepare/confirm mismatch class
- remaining seats snapshot

Immediate action:

- Close booking first, then reconcile provider/payment truth. Do not manually
  delete production rows as the first response.

### QR issuance incident

Use this when payment is `DONE` and reservation is `CONFIRMED`, but QR is
missing on the payment complete page or My Page/ticket detail.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("QR" OR "qr" OR "QrTicketService" OR "ticket")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Read-only SQL shape:

```sql
select
  r.status as reservation_status,
  p.status as payment_status,
  t.status as ticket_status,
  t.issued_at,
  t.email_scheduled_at
from reservations r
left join payments p on p.reservation_id = r.id
left join tickets t on t.reservation_id = r.id
where r.toss_order_id = '<masked-order-id>';
```

Close-booking trigger:

- Payment confirm success without reservation/QR, duplicate active QR, or QR
  token verification failure for confirmed paid reservations.

### Refund job failure incident

Use this for refund/cancel job buildup, Toss cancel retry exhaustion, or refund
state drift.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("refund" OR "cancel" OR "pg-boss" OR "refundCancelRetry")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Evidence fields:

- retryable job count
- terminal failed job count
- payment cancel state
- reservation/ticket state

Close-booking trigger:

- Accumulated refund/cancel job failures make financial reconciliation unsafe.

### Sellout and remaining seats incident

Use this when remaining seats reach zero, public state diverges from DB/queue
state, or sellout still permits new lock/prepare side effects.

Dry-run command:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("remainingSeats" OR "sellout" OR "sold out" OR "lock-seat" OR "prepare")' \
  --project=grapit-491806 \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message)'
```

Evidence fields:

- remaining seats
- sold/disabled/held_cancelled count
- active lock count
- queue admission count
- public sellout state

Close-booking trigger:

- remaining seats is negative, sellout allows new side effects, or public state
  contradicts reservation/payment/ticket truth.

## Evidence capture format

Use the collector first:

```bash
node scripts/phase26/monitoring-evidence.mjs --write-template
```

If provider/API/dashboard results are available, write a local JSON file with
sanitized result summaries and merge it:

```bash
node scripts/phase26/monitoring-evidence.mjs \
  --from-json /path/to/redacted-provider-results.json \
  --out .planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json
```

Required evidence fields:

- source
- command or dashboard query shape
- timestamp
- environment
- result classification
- redacted summary
- rollback or close-booking trigger if non-PASS

## No-go states

Do not enable live booking when any of these are true:

- Cloud Run health, auth/session, public detail, queue entry, or payment-safe
  smoke is failing.
- Cloudflare active-rule evidence is missing or normal-pass and suspicious
  smoke are not separated.
- Sentry alert dry-run evidence is missing.
- Queue length/admission, lock/prepare/confirm, payment, QR, refund, remaining
  seats, or sellout metrics are stale or contradictory.
- A payment can reach `DONE` without confirmed reservation and QR visibility.
- Duplicate sale, seat mismatch, queue admission stuck, or refund/cancel job
  buildup is observed.

---

*Related:* `.planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md`,
`.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json`,
`docs/runbooks/phase24-production-operations-handling.md`,
`docs/runbooks/phase24-queue-waf-prewarm.md`
