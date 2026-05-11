---
phase: 24-traffic-booking-payment-core
status: active_runbook
last_updated: 2026-05-11
scope: production operations for queue, booking, Toss payments, Cloud Run, Cloudflare, secrets, and evidence handling
---

# Phase 24 Production Operations Handling

## Purpose

This document is the operator-facing handling guide for the Phase 24 booking/payment surface after external activation evidence was closed.

It answers what to do during normal operations, launch traffic, payment incidents, rollback, secret rotation, and evidence capture. It does not replace the implementation docs or the external activation checklist; it describes how to handle production safely once those systems are active.

Related documents:

- `docs/runbooks/phase24-external-activation-checklist.md`
- `docs/runbooks/phase24-queue-waf-prewarm.md`
- `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md`
- `.planning/phases/24-traffic-booking-payment-core/24-VERIFICATION.md`

## Current Production Baseline

Verified on 2026-05-11 KST after the Phase 24 method-matrix closure:

| Area | Current baseline |
| --- | --- |
| Project | `grapit-491806` |
| Region | `asia-northeast3` |
| API service | `grabit-api` |
| Web service | `grabit-web` |
| API revision | `grabit-api-p24whesmoke2`, 100% traffic |
| Web revision | `grabit-web-00030-z27`, 100% traffic |
| API image | `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:phase24-gapfix-amd64-20260511123047` |
| Web image | `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-web:phase24-gapfix-web-amd64-20260511124323` |
| Booking gate | `BOOKING_ENABLED` must remain absent or false until the approved cutover phase |
| Runtime flag check | `https://heygrabit.com/api/runtime-flags` must return `{"bookingEnabled":false}` before public booking cutover |
| Cloudflare | `heygrabit.com` delegates to Cloudflare and WAF smoke has passed |
| Toss webhook | Correct-store sandbox webhook is registered; temporary query-secret fallback exists and must be rotated/removed before live reliance |

## Operator Rules

These rules are stricter than convenience during launch work.

1. Do not paste secrets into docs, issue trackers, chats, screenshots, shell history snippets, or commit messages.
2. Do not record full Toss `paymentKey`, webhook endpoint query secret, access token, refresh cookie, OTP, or card information.
3. Do not set `BOOKING_ENABLED=true` unless the explicit launch cutover gate approves it.
4. Do not leave Cloud Run smoke tags, `BOOKING_ENABLED=true`, elevated `minScale`, or temporary database access open after a smoke test.
5. Do not manually mutate reservation/payment/ticket tables as the first response to an incident. Read first, classify the state, and prefer idempotent application paths or a reviewed transaction.
6. Do not use broad Redis destructive commands such as `FLUSHDB` for queue incidents. Clear only named keys after mapping the affected performance/session.
7. Treat accepted caveats as caveats, not proof. The domestic-card full buyer-auth checkout still needs an authorized manual repeat before live payment traffic.

## Fast Status Check

Run this before and after any production handling.

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3

gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image,spec.template.spec.containers[0].env)'

gcloud run services describe grabit-web \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'

curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags
```

Expected:

- API health returns HTTP 200.
- `runtime-flags` returns `{"bookingEnabled":false}` until cutover.
- API and web traffic add up to 100% and point to known revisions.
- No temporary traffic tag remains unless a current smoke test is in progress.

## Launch Traffic Handling

### Before A Ticketing Window

1. Confirm Cloudflare is active:

```bash
dig NS heygrabit.com +short | sort
dig ns heygrabit.com @1.1.1.1 +short | sort
dig ns heygrabit.com @8.8.8.8 +short | sort
dig DS heygrabit.com +short | sort
```

Expected NS:

```text
rick.ns.cloudflare.com.
wanda.ns.cloudflare.com.
```

2. Confirm Cloudflare rules are active in the dashboard:
   - `phase24-queue-entry-managed-challenge`
   - `phase24-booking-mutation-managed-challenge`
   - `phase24-booking-macro-block`
   - `phase24-critical-booking-api-rate-limit`

3. Confirm prewarm jobs exist:

```bash
gcloud scheduler jobs describe grabit-prewarm-scale-up \
  --project="$PROJECT_ID" \
  --location="$REGION"

gcloud scheduler jobs describe grabit-prewarm-step-down \
  --project="$PROJECT_ID" \
  --location="$REGION"
```

4. If manual prewarm is needed, run scale-up, wait for the Cloud Run update to settle, and only then run any step-down test:

```bash
gcloud scheduler jobs run grabit-prewarm-scale-up \
  --project="$PROJECT_ID" \
  --location="$REGION"
```

Do not fire scale-up and step-down back-to-back. Cloud Run service version conflicts can return a transient failure even when IAM and route configuration are correct.

### During A Ticketing Window

Monitor in this order:

1. Cloudflare challenge/block spikes.
2. API health and Cloud Run 5xx rate.
3. Queue admission logs and Redis errors.
4. Reservation prepare/confirm errors.
5. Toss redirect, confirm, and webhook status.
6. QR issuance and email scheduling side effects.

Useful log query:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND (severity>=WARNING
        OR "CROSSSLOT"
        OR "payments/toss/webhook"
        OR "queue"
        OR "confirm"
        OR "refund"
        OR "qr")' \
  --project="$PROJECT_ID" \
  --limit=100 \
  --format='value(timestamp,severity,textPayload,jsonPayload.message,httpRequest.status)'
```

### After A Ticketing Window

1. Confirm `grabit-api` min instances returned to the intended idle value.
2. Confirm `BOOKING_ENABLED` is not accidentally enabled outside the approved window.
3. Remove smoke tags:

```bash
gcloud run services update-traffic grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --remove-tags=phase24-smoke

gcloud run services update-traffic grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --remove-tags=phase24-methodmatrix
```

4. Capture redacted evidence: revisions, timestamps, HTTP statuses, order IDs, booking numbers, and masked payment keys only.

## Cloud Run Deploy And Rollback Handling

### No-Traffic Smoke Revision

Use a no-traffic deploy when validating a risky API or web image:

```bash
gcloud run deploy grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$API_IMAGE" \
  --no-traffic \
  --tag=phase24-smoke \
  --quiet
```

Smoke only the tagged URL. If the smoke passes, shift traffic intentionally. If it fails, remove the tag and do not move traffic.

### Controlled Traffic Shift

Shift by revision, not by assumption:

```bash
gcloud run services update-traffic grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions NEW_REVISION=10,OLD_REVISION=90
```

Increase only after health, logs, and functional smoke stay clean.

### Immediate Rollback

Use this when booking, payment, auth, or health is broken:

```bash
gcloud run services update-traffic grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --to-revisions LAST_KNOWN_GOOD_REVISION=100
```

Then verify:

```bash
gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(status.latestReadyRevisionName,status.traffic)'

curl -fsS https://api.heygrabit.com/api/v1/health
```

Do the same for `grabit-web` if the issue is web-rendering, pending/complete pages, locale routing, or static asset behavior.

## Booking Gate Handling

`BOOKING_ENABLED` is the hard production cutover gate.

Before cutover:

- API must block booking mutations.
- Web must not expose scarce booking/payment as generally available.
- Test-key evidence can use temporary smoke paths only when documented and reverted.

Check:

```bash
curl -fsS https://heygrabit.com/api/runtime-flags

gcloud run services describe grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format='json(spec.template.spec.containers[0].env)' \
  | jq '[.[]? | select(.name=="BOOKING_ENABLED")]'
```

Restore off:

```bash
gcloud run services update grabit-api \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --remove-env-vars=BOOKING_ENABLED
```

If `BOOKING_ENABLED=true` was accidentally live:

1. Remove it immediately.
2. Check for new reservations, payments, seat locks, and sold seats in the exposure window.
3. Record the exact revision, exposure interval, and affected order/reservation IDs.
4. Do not silently delete rows. Classify each state and reconcile through the application path or a reviewed DB transaction.

## Toss Payment Handling

### Normal Flow Expectations

| Flow | Expected behavior |
| --- | --- |
| Domestic sync branch | User authenticates, Grabit receives `paymentKey/orderId/amount`, server verifies amount, then confirms. |
| Overseas card | Grabit uses `CARD` with overseas-card-only branch and completes through the sync card path. |
| Alipay+ | Grabit uses `FOREIGN_EASY_PAY`; user sees pending UI until `PAYMENT_STATUS_CHANGED` completes. Toss provider `ALIPAY` maps to internal `ALIPAY_PLUS`. |
| truemoney | Grabit uses `FOREIGN_EASY_PAY`; user sees pending UI until webhook completion. |
| Webhook | Receiver writes idempotency ledger and only then applies payment/reservation/ticket side effects. |

### Webhook Delivery Monitoring

Toss webhooks are delivered as HTTPS POST JSON. The Toss docs say webhook history statuses are `Completed`, `Sending`, and `Failed`, and non-200 responses are retried up to 7 times with increasing intervals. Current sandbox evidence showed Grabit webhooks accepted with HTTP 201, but live hardening should prefer an explicit 200 response to match Toss' documented expectation.

Check Cloud Run:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND "payments/toss/webhook"' \
  --project="$PROJECT_ID" \
  --limit=50 \
  --format='value(timestamp,httpRequest.status,textPayload,jsonPayload.message)'
```

Check DB ledger with read-only access:

```sql
select
  event_type,
  toss_order_id,
  processing_result_code,
  received_at,
  processed_at
from payment_webhook_events
where toss_order_id = '<ORDER_ID>'
order by received_at desc;
```

Do not document full webhook payloads if they contain secrets, PII, or full payment keys.

### Pending Payment Stuck

Symptoms:

- User is on pending page longer than expected.
- Toss dashboard shows `Sending` or `Failed`.
- `payment_webhook_events` has no processed row or shows a failed result.
- Reservation remains `PENDING_PAYMENT`.

Handling:

1. Verify the order in Toss Developer Center.
2. Check Cloud Run webhook status.
3. Check `payment_webhook_events` by `orderId`.
4. If Toss says payment is not `DONE`, do not confirm locally.
5. If Toss says `DONE` and webhook failed, replay through the receiver if Toss supports retry from dashboard, or use a reviewed admin/reconciliation path after implementing Toss Query API verification.
6. If the user-facing pending page is stale, keep the reservation in recoverable pending state and show support guidance rather than forcing confirmation.

### Duplicate Webhook Or Retry

Expected:

- Duplicate event IDs or transmission IDs must not duplicate bookings, sold seats, payments, refunds, or QR tickets.
- Existing `DONE` state for the same reservation/payment should be treated idempotently.

Handling:

1. Confirm `payment_webhook_events.processing_result_code`.
2. Confirm only one active QR ticket exists for the reservation.
3. Confirm sold seat rows belong to the same reservation.
4. If duplicate side effects exist, stop live traffic increase and open an incident.

### Domestic Card Caveat

Phase 24 accepted the domestic-card full buyer-auth checkout as an operational caveat:

- Verified: Grabit `CARD/CARD/KRW` branch, Toss READY response, authenticated webhook receiver, DB ledger, reservation confirmation, QR activation, and complete UI.
- Not automated: an operator manually entering test card details through the full domestic-card checkout.

Before live payment traffic, repeat domestic-card buyer-auth once with an authorized test card and record only:

- timestamp
- order ID
- booking number
- masked payment key prefix
- final reservation/payment/ticket status
- Cloud Run revision

Do not record card number, approval secret, full payment key, OTP, or screenshots containing sensitive data.

## Toss Secret Rotation And Query-Secret Removal

The current query-secret fallback was used to prove sandbox delivery when the Toss UI did not provide a custom header path. It should not be the long-term live posture because URL-carried secrets can appear in request logs.

### Rotation Procedure

1. Generate a new high-entropy value locally without printing it in chat or docs.
2. Add a new Secret Manager version:

```bash
printf '%s' "$NEW_TOSS_WEBHOOK_SECRET" | gcloud secrets versions add toss-webhook-secret \
  --project="$PROJECT_ID" \
  --data-file=-
```

3. Redeploy or update `grabit-api` so new instances read the latest secret.
4. Update Toss Developer Center webhook endpoint or header configuration.
5. Send a sandbox test webhook or execute a small sandbox payment.
6. Verify Cloud Run webhook 2xx and DB ledger processing.
7. Remove old query-secret endpoint URLs from Toss Developer Center.
8. Disable or destroy stale secret versions only after all active revisions are confirmed off the old value.

### Target Hardening

Implement server-side Toss Query API verification before relying on live payment webhooks:

1. Retrieve payment by `paymentKey` or `orderId` from Toss.
2. Compare Toss result against local expected `orderId`, `paymentKey`, amount, currency, and status.
3. Apply local state only after the re-query matches.
4. Preserve the existing webhook ledger for idempotency and audit.
5. Keep the shared-secret guard as defense-in-depth, not as the only correctness check.

## Cloudflare Handling

### Normal Operations

Cloudflare should absorb suspicious anonymous traffic before it reaches Cloud Run.

Expected rule behavior:

- Queue entry suspicious traffic: `Managed Challenge`
- Booking mutation suspicious traffic: `Managed Challenge`
- Clear macro behavior: `Block`
- Critical booking API rate limit: short mitigation window, enough to protect the API without locking out normal users

Smoke normal availability:

```bash
curl -I https://heygrabit.com
curl -I https://api.heygrabit.com/api/v1/health
```

Smoke challenge behavior with a deliberate suspicious user-agent only from an operator machine:

```bash
curl -I https://heygrabit.com/booking \
  -H 'User-Agent: phase24-macro-smoke'
```

Expected suspicious response can be Cloudflare `403` with `cf-mitigated: challenge`.

### False Positive Handling

If real users are challenged or blocked unexpectedly:

1. Identify which Cloudflare rule fired.
2. Compare affected path, method, country, ASN, and user-agent against the rule expression.
3. Prefer lowering a `Block` to `Managed Challenge` before disabling protection entirely.
4. Keep app-layer throttles active even if Cloudflare rules are temporarily relaxed.
5. Record the rule name, old expression, new expression, timestamp, and reason.

## Redis Queue Handling

### Known Incident Class: Redis Cluster `CROSSSLOT`

A production queue smoke exposed `CROSSSLOT` when stale session purge attempted one multi-key `DEL` across different hash tags. The code now deletes stale session keys one by one.

If `CROSSSLOT` appears again:

1. Capture the exact command boundary from logs.
2. Identify whether the Redis command touches keys with different hash tags.
3. Do not flush the database.
4. Prefer a code fix that serializes the cross-slot operation or aligns hash tags intentionally.
5. Add a regression test that asserts cluster-safe command shape.

### Stuck Queue Session Handling

Symptoms:

- User remains in waiting even after capacity exists.
- Admission token exists but reservation APIs reject admission.
- Queue snapshot shows inconsistent `position`, `remainingSeats`, or active session count.

Handling:

1. Read queue session record by performance and session ID.
2. Check identity key, session ref key, admission token key, waiting sorted set, and active admissions set.
3. If manual cleanup is necessary, delete only the affected keys.
4. Re-run queue entry smoke and confirm admission state.
5. Record redacted session ID, performance ID, command class, and result.

## Database Handling

### Access Rule

Use Cloud SQL Auth Proxy or a sanctioned private path. Do not leave temporary public authorized networks in place after evidence capture.

Read-only first:

```sql
select
  r.status as reservation_status,
  r.booking_number,
  p.status as payment_status,
  p.method,
  p.provider,
  p.currency,
  t.status as ticket_status
from reservations r
left join payments p on p.reservation_id = r.id
left join tickets t on t.reservation_id = r.id
where r.toss_order_id = '<ORDER_ID>';
```

Manual mutation rule:

1. Export the before-state for the affected rows.
2. Write the intended transaction in a scratch note.
3. Get review for the transaction if the change touches payment, reservation, sold seats, refunds, or tickets.
4. Execute inside an explicit transaction.
5. Re-read the row set and record redacted evidence.

Never use manual DB writes to bypass a Toss status uncertainty. Resolve provider truth first.

## Refund Handling

Expected state model:

- `requested`
- `sent_to_pg`
- `processing_at_pg`
- `completed`
- `failed`

Transient Toss cancel failures should remain retryable and should not collapse directly into a final failed user state unless the retry policy is exhausted or a terminal provider response exists.

Handling:

1. Check refund state and latest error metadata.
2. Check pg-boss retry job state for `refundCancelRetry`.
3. Check payment and reservation state still match the refund request.
4. Do not manually reopen seats if the refund is not terminal.
5. If a cancelled seat is held, respect the randomized hold unless manual-open policy explicitly applies.

## QR Ticket Handling

After payment completion:

- Ticket status should become active.
- QR token should be issued once per reservation.
- D-1 email scheduling should exist for the target showtime.

Incident handling:

1. If payment is `DONE` and reservation is `CONFIRMED` but no QR ticket exists, check webhook processing and ticket issuance errors.
2. Re-run idempotent ticket issuance only through the application path or a reviewed repair command.
3. Confirm no duplicate active ticket exists.
4. Record ticket status, booking number, and masked order ID only.

## Incident Matrix

| Symptom | First check | Immediate action | Escalation |
| --- | --- | --- | --- |
| API health fails | Cloud Run revision traffic and logs | Roll back to last known-good API revision | Open incident; block traffic increase |
| Web complete/pending page wrong | Web revision and browser smoke | Roll back web or deploy fixed web image | Check route/build artifact drift |
| Queue entry fails with `CROSSSLOT` | API logs around queue purge/admission | Stop smoke, avoid manual Redis flush | Patch command shape and add regression |
| Users stuck pending after foreign wallet | Toss dashboard, webhook logs, DB ledger | Do not force-confirm without provider truth | Re-query Toss or replay webhook safely |
| Webhook `Sending` or `Failed` | Toss webhook history and Cloud Run status | Fix receiver/secret/reachability | Rotate secret if leaked; retry after fix |
| Cloudflare blocks normal users | Cloudflare rule analytics | Lower block to challenge or narrow expression | Keep app-layer throttles active |
| Cloud SQL capacity exhausted | Cloud Run minScale/maxScale and DB connections | Step down minScale if accidental | Reassess launch capacity plan |
| Refund stuck retrying | Refund row and pg-boss job | Preserve retryable state | Manual reconciliation after provider truth |
| QR missing after confirmed payment | Ticket row and webhook result | Re-run idempotent issuance path | Repair with reviewed transaction only if needed |

## Evidence Template

Use this format for operational notes and UAT updates:

```md
### YYYY-MM-DD HH:mm KST - <incident or operation>

- Operator:
- Service:
- Revision:
- Image:
- Scope:
- Trigger:
- Commands:
- Result:
- User-visible impact:
- Redacted IDs:
  - orderId:
  - reservationId:
  - bookingNumber:
  - paymentKeyPrefix:
- Rollback or cleanup:
- Follow-up:
```

Do not include raw secrets, full payment keys, cookies, access tokens, OTPs, card data, full webhook URLs containing query secrets, or screenshots with sensitive fields.

## Official References Checked

- Toss webhooks: https://docs.tosspayments.com/en/webhooks
- Cloud Run rollbacks, gradual rollouts, and traffic migration: https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration
- Google Secret Manager rotation schedules: https://cloud.google.com/secret-manager/docs/rotation-recommendations
- Cloudflare WAF custom rules: https://developers.cloudflare.com/waf/custom-rules/
