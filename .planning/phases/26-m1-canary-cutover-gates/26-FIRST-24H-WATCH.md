---
phase: 26-m1-canary-cutover-gates
artifact: first-24h-watch
requirements: [OPS-02]
source_decisions: [D-29, D-30]
created: 2026-05-20
status: ready_for_operator_execution
---

# Phase 26 First-24h Watch

## Purpose

이 문서는 live ticketing open 이후 첫 24시간 동안 한 명의 operator가 실행할
watch checklist입니다. 첫 2시간은 5-10분 간격으로 queue, payment, seat,
QR, Cloud Run, Sentry, Cloudflare를 확인합니다. 이후 24시간까지는 30-60분
간격으로 같은 metric categories를 확인합니다.

`BOOKING_ENABLED=true` 이후 financial/seat safety 기준을 위반하면 즉시
close-booking 또는 rollback을 실행합니다.

Related context:

- `.planning/phases/26-m1-canary-cutover-gates/26-CONTEXT.md` D-29, D-30
- `docs/runbooks/phase26-cutover-ops.md`
- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json`

## Operator setup

Before opening ticketing:

```bash
PROJECT_ID=grapit-491806
REGION=asia-northeast3

node scripts/phase26/monitoring-evidence.mjs --write-template
curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags
```

Evidence fields to keep for every watch entry:

| Field | Required value |
| --- | --- |
| `timestampKst` | KST timestamp of the check |
| `operator` | operator initials or owner name |
| `cadenceWindow` | `first-2h` or `first-24h` |
| `queue` | length, admission rate, stuck indicator |
| `payment` | confirm success, payment failure count/spike, webhook/cancel state |
| `seat` | lock success, prepare success, remaining seats, sellout state |
| `qr` | QR issuance count, complete page visibility, My Page visibility |
| `cloudRun` | health, 5xx/error logs, latest revision |
| `sentry` | alert dry-run/live alert status, issue spike summary |
| `cloudflare` | normal-pass, suspicious challenge/block/rate-limit, active rule state |
| `decision` | continue, close-booking, rollback, or monitor-only |
| `evidenceRef` | artifact path or redacted dashboard/log reference |

Do not record raw Toss keys, payment keys, QR tokens, cookies, bearer tokens,
OTPs, full IP addresses, e-mail addresses, phone numbers, or PII.

## First 2 hours: 5-10 minute cadence

Start immediately after live booking is opened. Repeat every 5-10 minutes until
the 2-hour mark.

| Check | Evidence source | PASS shape | close-booking / rollback condition |
| --- | --- | --- | --- |
| Queue length and admission rate | Queue logs, Valkey queue snapshot, `26-09-ops-monitoring.json` | Queue length is finite, admission rate continues, no queue admission stuck | queue admission stuck, admission token rejects valid users, or queue bypass allows booking mutation |
| Seat lock and prepare | Booking/reservation logs, DB read-only snapshot | seat lock and prepare success/failure match admission and remaining seats | seat lock/prepare side-effect mismatch, duplicate lock, or remaining seats below zero |
| Payment confirm | Cloud Run payment logs, Toss dashboard, payments/reservations read-only SQL | confirm success always has matching reservation/QR, payment failure does not spike | payment failure spike, confirm success without reservation/QR, provider/local state mismatch |
| QR issuance | `QrTicketService` logs, tickets table, complete page, My Page | active QR exists for confirmed paid reservation and is visible | payment confirmed but QR missing, duplicate active QR, QR verification failure |
| Refund/cancel jobs | pg-boss logs, payment cancel/refund state | retry queue is empty or within reviewed policy | refund/cancel job buildup, terminal failures, or provider truth cannot be reconciled |
| Cloud Run | health endpoint, revision, 5xx/error logs | API health 200, no critical 5xx, known revision | health 5xx, public detail 5xx, auth/session failure, unsafe payment logs |
| Sentry | alert dry-run/live alert, issue count | no new release-blocking payment/queue/QR/DB issue spike | alert spike in payment, queue, DB, QR, auth/session, or public detail |
| Cloudflare | normal-pass smoke and suspicious smoke | normal-pass succeeds; suspicious challenge/block/rate-limit evidence is separate | normal buyers blocked, WAF bypass on booking mutation abuse, or suspicious smoke affects real users |
| Sellout behavior | remaining seats, public state, queue admission | remaining seats reaches zero without new side effects | sellout still allows lock/prepare/confirm or public state contradicts DB truth |

Suggested command set:

```bash
curl -fsS https://api.heygrabit.com/api/v1/health
curl -fsS https://heygrabit.com/api/runtime-flags

gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND (severity>=WARNING OR "queue" OR "confirm" OR "payment" OR "refund" OR "qr" OR "remainingSeats")' \
  --project="$PROJECT_ID" \
  --limit=100 \
  --format='value(timestamp,severity,httpRequest.status,textPayload,jsonPayload.message)'
```

## 2h to 24h: 30-60 minute cadence

After the intensive watch passes the first 2 hours, continue until 24 hours
after ticketing open. Repeat every 30-60 minutes.

| Check | Evidence source | Required result | Escalation |
| --- | --- | --- | --- |
| Queue and admission | queue length, admission rate, queue logs | stable or empty queue, no queue admission stuck | close-booking if valid users cannot enter or bypass is observed |
| Payment and Toss | payments table, Toss dashboard, webhook logs | payment success/failure within expected range, no unreconciled DONE state | close-booking on payment failure spike or provider/local mismatch |
| Seat safety | lock/prepare/confirm counts, remaining seats | no duplicate sale, no negative remaining seats, sellout blocks side effects | close-booking immediately on duplicate sale or seat lock/prepare mismatch |
| QR | active ticket count, complete page, My Page | confirmed paid reservations expose active QR | close-booking if reservation/QR linkage fails after payment confirm |
| Refund/cancel job | pg-boss/refund logs | no refund/cancel job buildup beyond retry policy | close-booking if financial reconciliation is unsafe |
| Cloud Run | health, 5xx logs, revision | stable health and no critical error trend | rollback if new revision is the likely cause |
| Sentry | issue/alert state | no untriaged critical issue spike | rollback or close-booking depending on blast radius |
| Cloudflare | active rules, normal-pass, suspicious challenge/block/rate-limit | normal traffic passes and suspicious traffic is controlled | narrow WAF or close-booking if real buyers are affected |
| Sellout | remaining seats and public state | sold-out state is consistent across API/UI/queue | close-booking if sellout behavior allows new side effects |

## Immediate close-booking triggers

If any item below is observed, do not wait for the next 5-10 or 30-60 minute
cycle. Execute close-booking first, then investigate with the runbook.

| Trigger | Why it is unsafe | Required action | Evidence to record |
| --- | --- | --- | --- |
| duplicate sale | Two or more sold rows or paid reservations claim the same seat | close-booking immediately; stop new lock/prepare/confirm | showtime, floor, seat key masked/scoped; query shape; timestamp |
| payment confirm success without reservation/QR | Buyer paid but local reservation or QR is missing | close-booking immediately; reconcile Toss/local truth | masked order ID, payment status, reservation status, QR/ticket status |
| payment failure spike | Financial path may be failing for valid buyers | close-booking or payment-safe rollback depending on root cause | failure count, time window, provider status class, Cloud Run revision |
| seat lock/prepare side-effect mismatch | Seat inventory can drift or oversell | close-booking immediately | lock count, prepare count, remaining seats, affected dedicated test/live scope |
| queue admission stuck | Valid buyers cannot progress or admission guard is inconsistent | close-booking if live users are affected; otherwise pause admission | queue length, admission rate, stuck session class, log query |
| refund/cancel job buildup | Financial reconciliation may become unsafe | close-booking until retry/cancel backlog is understood | refund job count, cancel job count, terminal failures, latest error class |

## Immediate rollback triggers

Rollback is appropriate when the latest deploy or runtime config is the likely
cause. Use rollback for user-path critical failures:

- Cloud Run health 5xx.
- login/refresh failure.
- public event detail 5xx.
- queue entry 5xx.
- `BOOKING_ENABLED=false` while lock/prepare/payment side effects occur.
- payment confirm unsafe behavior after deploy.

Rollback command shape:

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

## Watch log template

Copy this block into the evidence artifact source note or an operator log. Keep
the values redacted.

```md
### YYYY-MM-DD HH:mm KST - first-24h watch

- Operator:
- Cadence window: first-2h | first-24h
- Queue: length=, admissionRate=, queue admission stuck=no|yes
- Payment: confirmSuccess=, payment failure=, webhook/cancel=
- Seat: lockSuccess=, prepareSuccess=, remaining seats=, sellout=
- QR: issued=, completePageVisible=yes|no, myPageVisible=yes|no
- Cloud Run: health=, revision=, criticalLogs=no|yes
- Sentry: alertDryRun/liveAlert=, issueSpike=no|yes
- Cloudflare: normalPass=, suspicious challenge/block/rate-limit=
- Decision: continue | close-booking | rollback | monitor-only
- Evidence ref: .planning/phases/26-m1-canary-cutover-gates/evidence/26-09-ops-monitoring.json
- Follow-up:
```

## Completion condition

The first-24h watch can be closed only when:

- First 2 hours have completed with 5-10 minute checks.
- The remaining period has completed with 30-60 minute checks until 24 hours.
- No unresolved duplicate sale, reservation/QR mismatch, payment failure spike,
  seat lock/prepare mismatch, queue admission stuck, refund/cancel job buildup,
  Cloud Run critical error, Sentry critical spike, or Cloudflare false-positive
  remains open.
- All non-PASS rows are still visible as non-PASS in the Gate Ledger unless the
  owner has explicitly approved `ACCEPTED_RISK` or `CONFIG_READY_NOT_DRILLED`.
