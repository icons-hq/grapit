---
phase: 26-m1-canary-cutover-gates
status: active_runbook
last_updated: 2026-10-02
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
4. `BOOKING_ENABLED=true` remains no-go until the Gate Ledger allows it. The
   packaged phase26 ledger is now a historical record: `/admin/cutover` reports
   it as stale and unscoped. A new opening needs a fresh ledger that names the
   opening, or per-performance publication/sale-state/sale-time checks plus an
   owner approval recorded as the Gate 1 waiver. Change the gate only through
   the kill switch in `managed-demo-cost-floor.md#sitewide-booking-kill-switch`.
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
- `runtime-flags` returns a current `serverNow` (epoch ms) with
  `Cache-Control: no-store` and no `Age` header. Browsers use it to correct
  device clock skew for the booking open instant and countdowns, so the
  Cloudflare edge must not cache this path.

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

## Dedicated test-event load gate

`LOAD_10K_BASELINE` and `LOAD_20K_STRESS` mean 10,000 / 20,000 concurrent
synthetic buyers. `scripts/k6/phase26-baseline.js` and `phase26-stress.js`
ramp `ramping-vus` to that target (`PHASE26_<BASELINE|STRESS>_RAMP_UP`,
default `60s`, then `_HOLD` `10m`, `_RAMP_DOWN` `30s`) so the opening spike
is modelled. Each VU is one buyer browser walking the real purchase path:
performance detail + seat map, queue enter with status polling while
`WAITING`, then (by weight) seat lock, prepare and, in `pg-stub` mode, confirm.
Abandoned checkouts call `cancel-pending` and release their locks. k6 empties
each VU's cookie jar after every iteration, so the script seeds the buyer's
refresh cookie at the start of every iteration and each journey re-enters the
queue, which reuses that buyer's queue session.

Inputs (all required unless a default is shown; files are mounted privately and
never committed):

| Variable | Meaning |
| --- | --- |
| `GRABIT_API_URL` | Explicit API base ending in `/api/v1`; there is no production default |
| `PHASE26_TEST_PERFORMANCE_ID`, `PHASE26_TEST_SHOWTIME_ID` | Dedicated test event and showtime UUIDs |
| `PHASE26_TEST_MARKER` | Token matching `^PHASE26[_-][A-Za-z0-9_-]{6,}$`; the performance title must start with it |
| `PHASE26_TEST_ORDER_PREFIX` | Order ID prefix for prepare/confirm, e.g. `PHASE26_ORD-`, so cleanup can scope the orders |
| `PHASE26_LOAD_APPROVED` | `PHASE26_DEDICATED_TEST_EVENT_APPROVED` |
| `PHASE26_USER_POOL_FILE` | JSON array of `{ "accessToken", "refreshToken" }`, one distinct buyer per VU (at least the target VU count), written by `scripts/phase26/provision-load-buyers.mjs` (see "Synthetic buyer pool" below). The refresh token is sent as the `refreshToken` cookie and must belong to a persisted refresh family; the queue admission cookie is taken from the enter response, never from a header. k6 never refreshes tokens, so access tokens must outlive VU initialisation plus the whole run plus 2 minutes; `setup()` re-checks this after all VUs are initialised and also calls `GET /users/me` for the first and last buyer, aborting before any load unless the API authenticates them as email- and phone-verified `user` accounts of this target |
| `PHASE26_SEAT_POOL_FILE` | JSON array of floor-aware seat selections (`seatId`, `seatKey`, `floorKey`, `floorLabel`, `tierName`, `price`, `row`, `number`) of the test showtime. Seats are partitioned per VU (VU n owns its own slice), so buyers never contend for a seat and a sold seat is never locked again. It needs at least the target VU count of seats, and in `pg-stub` mode the target VU count × `PHASE26_MAX_PURCHASES_PER_VU` (20,000 × 1 for stress); the scripts refuse a smaller pool. The test performance must also keep at least 1,000 remaining seats, because the queue admits at most `min(remaining seats, 1,000)` buyers at a time |
| `PHASE26_CONFIRM_MODE` | `off` (default) or `pg-stub`. Use `pg-stub` only against an isolated deployment whose API process preloads `scripts/revamp/pg-stub-preload.mjs` (`GRABIT_PG_STUB=isolated-load-test-only`); it sends synthetic payment keys |
| `PHASE26_MAX_PURCHASES_PER_VU` | Default `1`. Purchases per buyer in `pg-stub` mode; keep it at or below the test event's per-user ticket limit. A confirm that times out or returns 5xx counts as a used seat, because the server may have sold it |
| `PHASE26_READ_WEIGHT` / `PHASE26_QUEUE_WEIGHT` / `PHASE26_MUTATION_WEIGHT` | Journey depth weights (baseline 75/20/5, stress 80/18/2). The scripts refuse a mix that one buyer could send faster than the API's per-buyer throttles allow (below) |
| `PHASE26_THINK_TIME_SECONDS` / `PHASE26_QUEUE_POLL_SECONDS` | Default `3` / `2`. The think time ends every iteration, so a buyer runs at most 60 / think-time journeys per minute; a `WAITING` buyer polls the queue status at the poll interval |

Run with the scripts directory mounted, because the entries import `./lib`:

```bash
docker run --rm -v "$PWD/scripts/k6:/scripts:ro" -v "$PRIVATE_DIR:/private:ro" -v "$OUT_DIR:/out" \
  grafana/k6 run -e GRABIT_API_URL=... -e PHASE26_USER_POOL_FILE=/private/users.json \
  -e PHASE26_SEAT_POOL_FILE=/private/seats.json ... \
  --summary-export /out/phase26-baseline-summary.json /scripts/phase26-baseline.js
node scripts/phase26/record-k6-evidence.mjs --baseline "$OUT_DIR/phase26-baseline-summary.json" \
  --stress "$OUT_DIR/phase26-stress-summary.json" ...
```

`record-k6-evidence.mjs` never records PASS when the summary's peak `vus` is
below the gate target, when any of `read/queue/lock/prepare/confirm` has no
tagged requests, when queue traffic is below 5% of requests, when
lock/prepare/confirm each have fewer than 500 requests, or when any flow breaks
p95 < 2s / error rate < 1%. Purchase traffic is judged by volume, not share:
only admitted buyers can lock, and the API admits at most 1,000 at a time
(`QUEUE_MAX_ACTIVE_ADMISSIONS`, held for the 600 s active window). With the
default weights roughly 1,000 admitted buyers each reach lock/prepare/confirm
at least once, while about 9,000 (baseline) or 19,000 (stress) buyers wait and
poll the queue every 2 seconds, so lock stays a fraction of a percent of all
requests in a healthy run (roughly 0.3% without confirm and 0.03% with one
`pg-stub` purchase per buyer). 500 is half of one full admission wave. If a
run lands below it, adjust in this order and never lower the queue weight:

1. Check the queue really admitted about 1,000 buyers (`phase26_queue_admitted`,
   `phase26_queue_not_admitted{state}`) and that the test performance kept at
   least 1,000 remaining seats.
2. Lengthen `PHASE26_<BASELINE|STRESS>_HOLD`: each extra 10 minutes is another
   admission wave.
3. In `pg-stub` mode, raise `PHASE26_MAX_PURCHASES_PER_VU` (at or below the
   event's per-user ticket limit) with a matching seat pool.
4. Only then raise `PHASE26_MUTATION_WEIGHT`, within the per-buyer throttles.

Without a PG-stubbed target the confirm flow is unmeasured, so the gate stays
`BLOCKED` unless the owner records `--accepted-risk`.

Every buyer is one user to the API's throttles, so the journey mix must stay
under them or the run fails on 429s that real traffic would not cause. The
scripts compute the worst case from the think time (at most 60 / think-time
journeys per minute) and refuse to start when it exceeds one of these limits:

| API throttle (per buyer) | Limit | Requests per journey |
| --- | --- | --- |
| `default`, public browse (keyed by the refresh cookie) | 60 / 60 s | 2 (detail + seat map) |
| `default`, authenticated | 60 / 60 s | enter, lock + unlock, prepare + cancel, confirm; a `WAITING` buyer adds 60 / poll-interval status polls |
| `queue-entry` | 20 / 60 s | 1 per queue or booking journey |
| `lock-seat` | 12 / 15 s | 1 per booking journey |
| `prepare-reservation` | 8 / 60 s | 1 per booking journey |
| `confirm-payment` | 6 / 60 s | 1 per booking journey in `pg-stub` mode |

With the default 3 s think time, booking share × 20 must stay at or below 8 for
prepare and 6 for confirm, so a booking share above about 30% (`pg-stub`) or
40% needs a longer think time. A think time below 2 s or a poll interval of 1 s
always exceeds the `default` limit. The limits mirror `app.module.ts` and
`traffic-defense.service.ts`; the unit test fails when they drift.

### Synthetic buyer pool

Buyers cannot be logged in through the API for this run: `POST /auth/login`
allows 60 requests per minute per client, so 10,000 buyers take about 167
minutes and 20,000 about 333 minutes, while API access tokens live 15 minutes
(`jwtExpiresIn` is fixed in `apps/api/src/config/auth.config.ts`). k6 does not
call `/auth/refresh` either: it is throttled per client like login, and it
rotates the refresh token, so the pool would become single-use. Instead,
`scripts/phase26/provision-load-buyers.mjs` writes the buyers and their refresh
families directly into the database of the target the k6 run hits and signs
the access tokens with that target's `JWT_SECRET`:

```bash
# The proxy and both secrets belong to the same target as GRABIT_API_URL.
export PHASE26_LOAD_APPROVED=PHASE26_DEDICATED_TEST_EVENT_APPROVED
export PHASE26_TARGET_DATABASE_URL=...   # e.g. through cloud-sql-proxy on 127.0.0.1
export PHASE26_TARGET_JWT_SECRET=...     # the target API's JWT_SECRET, byte for byte
node scripts/phase26/provision-load-buyers.mjs provision --count 20000 --valid-for 2h \
  --out "$PRIVATE_DIR/users.json"
```

- Buyers are `phase26-buyer-000001…@phase26-load.invalid` with phones in the
  unassignable `010-0XXX-XXXX` range: active `user` rows with email and phone
  verified, no password, no social login and no admin capability, so nobody can
  sign in as them. Rerunning reuses them and revokes their previous families.
  Any other account in the namespace aborts the run without changes.
- Each access token and its refresh family expire after `--valid-for`
  (default `2h`, at most `6h`); provision once for the baseline and the stress
  run if both fit in the window. The pool file is created `0600`, never
  overwritten, and must stay in `$PRIVATE_DIR`. Nothing secret is printed.
- Until they are deleted, the buyers count as members in admin user statistics.
- After the run, revoke the pool at once (this stops queue entry, lock, prepare
  and confirm for every pool token) and delete the buyers after the dedicated
  test-event cleanup has removed their reservations:

  ```bash
  node scripts/phase26/provision-load-buyers.mjs cleanup                 # right after k6
  node scripts/phase26/provision-load-buyers.mjs cleanup --delete-users  # after the test-event cleanup
  ```

  Deletion is refused as a whole (`synthetic_buyers_still_referenced`, families
  stay revoked) while any buyer still has reservations or audit rows. Cleanup
  only touches accounts the script could have created and reports any other
  namespace account as `skippedAccounts`.

Never run either command against a target other than the one under test, and
never point it at real buyer accounts. The seat pool is still prepared by the
operator from the test showtime.

## Dedicated test-event cleanup

`scripts/phase26/cleanup-dry-run.sql` and `cleanup-test-event.sql` delete only a
positively identified test event: the marker must match
`^PHASE26[_-][A-Za-z0-9_-]{6,}$`, the performance title must start with it, the
performance must not be `published`, and it must have no future
`booking_starts_at`. Unpublish the test event in admin before cleanup. Order IDs
are matched literally with `starts_with()`, so `_` in a prefix is not a
wildcard. Run the dry-run first and pass its exact counts to the execution
script; `rehearsal-smoke.mjs` applies the same marker and title rule. Then
delete the synthetic load buyers with
`scripts/phase26/provision-load-buyers.mjs cleanup --delete-users`.

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
