# Phase 20 HUMAN-UAT - Valkey Production Connectivity Contract

**Created:** 2026-04-30 (KST)
**Goal:** Prove the deployed Cloud Run API revision reaches Google Memorystore for Valkey in `CLUSTER` mode and preserves booking lock and Socket.IO semantics.
**Status:** Pending operator production smoke. Do not mark final PASS until real revision-scoped evidence is recorded.

---

## Automated Gate

Run these local/code-level gates before requesting operator approval:

- [ ] command: `node --check scripts/smoke-valkey-production.mjs`
- [ ] command: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- [ ] command: `rg -n "GRABIT_SMOKE_AUTH_HEADER_FILE|GRABIT_SMOKE_ARTIFACT|--help|--check all|createRequire|\\.\\./apps/web/package\\.json|webRequire\\('socket\\.io-client'\\)|CROSSSLOT|MOVED|ASK|ECONNRESET|ETIMEDOUT|redact" scripts/smoke-valkey-production.mjs`
- [ ] command: `rg -n "status: pending-production-smoke|human_needed: true|Observable Truths|20-HUMAN-UAT.md" .planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md`

The smoke script resolves `socket.io-client` through `createRequire(new URL('../apps/web/package.json', import.meta.url))`, not through bare root resolution and not by adding a root or API dependency.

`GRABIT_SMOKE_ARTIFACT` is optional. Prefer the script-root default artifact path. If an operator overrides it, relative override values are resolved by the caller's current working directory.

## Production Runtime Contract

Expected production contract:

- [ ] Cloud Run service: `grabit-api`
- [ ] Production API origin: `https://api.heygrabit.com`
- [ ] Google Cloud project: `grapit-491806`
- [ ] Google Cloud region: `asia-northeast3`
- [ ] Memorystore instance: `grabit-valkey`
- [ ] Live Memorystore mode: `CLUSTER`
- [ ] Cloud Run environment: `VALKEY_MODE=cluster`
- [ ] Redis URL source: Secret Manager binding only, no raw value recorded
- [ ] VPC egress: private ranges through the configured Cloud Run network/subnet

Commands:

```bash
gcloud memorystore instances describe grabit-valkey --location=asia-northeast3 --project=grapit-491806
gcloud run services describe grabit-api --region=asia-northeast3 --project=grapit-491806
```

Evidence fields:

- [ ] `grabit-valkey` state:
- [ ] `grabit-valkey` mode:
- [ ] `grabit-valkey` engine version:
- [ ] Cloud Run `VALKEY_MODE=cluster` observed:
- [ ] Cloud Run `REDIS_URL` secret binding observed:
- [ ] Cloud Run VPC egress observed:
- [ ] Runtime mode comparison result: PASS / FAIL

## Safe Fixture Approval

The production smoke must use a non-customer fixture approved by the operator.

- [ ] `GRABIT_SMOKE_SHOWTIME_ID` approved:
- [ ] `GRABIT_SMOKE_SEAT_ID` approved:
- [ ] Fixture does not represent a real customer purchase:
- [ ] Fixture can be locked temporarily without service impact:
- [ ] Auth context is a smoke-only or operator-approved account:
- [ ] Any lock attempt has unlock success proof or TTL expiry proof:

Do not record the auth header value, token, cookie value, full user identifier, phone number, payment identifier, or private customer data.

## Cloud Run Revision Evidence

Record the exact revision serving the smoke:

```bash
gcloud run services describe grabit-api --region=asia-northeast3 --project=grapit-491806 --format='value(status.latestReadyRevisionName)'
gcloud run services describe grabit-api --region=asia-northeast3 --project=grapit-491806 --format=json
```

Evidence fields:

- [ ] Smoke timestamp UTC:
- [ ] Smoke timestamp KST:
- [ ] `latestReadyRevisionName`:
- [ ] Image digest or Git SHA tag:
- [ ] Traffic split:
- [ ] Target URL host only:
- [ ] Smoke command shape:

## Health Ping Smoke

Commands:

```bash
curl -fsS "$GRABIT_API_URL/api/v1/health"
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all
```

PASS criteria:

- [ ] `/api/v1/health` returns success from the deployed `grabit-api` revision.
- [ ] `redis.status` is `up`.
- [ ] Health metadata shows `mode=cluster`, `client=ioredis-cluster`, and configured Redis.
- [ ] No raw connection string or auth material appears in output.

Evidence fields:

- [ ] Health result: PASS / FAIL
- [ ] Health response summary:
- [ ] Revision tied to health response:

## Lua Lock Status Unlock Smoke

The smoke script exercises:

- `POST /api/v1/booking/seats/lock`
- `GET /api/v1/booking/schedules/:showtimeId/seats`
- `DELETE /api/v1/booking/seats/lock/:showtimeId/:seatId`

PASS criteria:

- [ ] Lock succeeds for the operator-approved safe fixture.
- [ ] Status shows the selected seat as locked after lock.
- [ ] Unlock succeeds, or TTL expiry proof is recorded if unlock cannot complete.
- [ ] Phase 19 lock ownership semantics are not weakened.
- [ ] No real inventory remains locked after the smoke.

Evidence fields:

- [ ] Lua lock result: PASS / FAIL
- [ ] Seat status result: PASS / FAIL
- [ ] Unlock or TTL expiry result: PASS / FAIL
- [ ] Cleanup timestamp UTC:

## Socket.IO Two-Instance Propagation

The smoke must prove Redis adapter propagation across at least two Cloud Run API instances, not just two local clients.

Temporary scale command, only if needed:

```bash
gcloud run services update grabit-api --region=asia-northeast3 --project=grapit-491806 --min-instances=2
```

PASS criteria:

- [ ] D-10 PASS / FAIL: `seat-update` from a lock event reaches clients connected through distinct Cloud Run instance IDs.
- [ ] D-13 PASS / FAIL: no production adapter fallback or missing Redis pub/sub is observed.
- [ ] Two Socket.IO client IDs are recorded without auth values.
- [ ] Cloud Logging connects those client IDs to at least two distinct Cloud Run instance IDs.
- [ ] Both clients receive the expected `seat-update` event.

Evidence fields:

- [ ] Socket.IO propagation result: PASS / FAIL
- [ ] Client A id:
- [ ] Client B id:
- [ ] Distinct Cloud Run instance count:
- [ ] Redis adapter fallback observed: yes / no

## Idle Reconnect Window

Default idle wait is `GRABIT_SMOKE_IDLE_SECONDS=1800`.

PASS criteria:

- [ ] After the idle window, health ping still passes.
- [ ] After the idle window, Lua lock/status/unlock still passes.
- [ ] After the idle window, Socket.IO subscription and `seat-update` propagation still pass.
- [ ] No persistent reconnect errors appear in Cloud Logging or Sentry.

Evidence fields:

- [ ] Idle wait seconds:
- [ ] Idle health result: PASS / FAIL
- [ ] Idle Lua result: PASS / FAIL
- [ ] Idle Socket.IO result: PASS / FAIL
- [ ] Idle reconnect result: PASS / FAIL

## Log And Sentry Cleanliness

Cloud Logging must be checked for the smoke window and the exact revision.

Failure keywords:

- `CROSSSLOT`
- `MOVED`
- `ASK`
- `ECONNRESET`
- `ETIMEDOUT`
- `duplicate/subscriber connection loss`
- `persistent adapter fallback`
- startup hard-fail
- health red
- cluster mode mismatch

Evidence fields:

- [ ] Cloud Logging query window:
- [ ] Cloud Logging failure keyword count:
- [ ] Sentry observation result, either zero-count or redacted event id:
- [ ] Log and Sentry cleanliness result: PASS / FAIL

## Scale Pre-State And Restore

Record pre-state before any temporary scale change:

```bash
gcloud run services describe grabit-api --region=asia-northeast3 --project=grapit-491806 --format=json
```

If scaling to two instances is needed, run:

```bash
gcloud run services update grabit-api --region=asia-northeast3 --project=grapit-491806 --min-instances=2
```

Restore the recorded pre-state immediately after the multi-instance check. For the normal cost-minimized state:

```bash
gcloud run services update grabit-api --region=asia-northeast3 --project=grapit-491806 --min-instances=0
```

D-12 is PASS only after the temporary min-instances change is restored to the recorded pre-state.

Evidence fields:

- [ ] Pre-state min-instances:
- [ ] Temporary scale command used:
- [ ] Restore command used:
- [ ] Scale restored: PASS / FAIL
- [ ] D-12 result: PASS / FAIL

## Rollback Checklist

D-15 rollback scope:

- [ ] Roll back the Cloud Run `grabit-api` revision to the last known good revision.
- [ ] Roll back `REDIS_URL` secret binding if the secret revision is implicated.
- [ ] Roll back `VALKEY_MODE` only with explicit operator approval and matching live mode evidence.
- [ ] Re-run `/api/v1/health`.
- [ ] Re-run lock/status/unlock or TTL expiry smoke.
- [ ] Re-run Socket.IO smoke.
- [ ] Re-check Cloud Logging and Sentry after rollback.

D-16 failure modes that trigger rollback or hold:

- startup hard-fail
- health red
- cluster mode mismatch
- `CROSSSLOT`
- `MOVED`/`ASK`
- `ECONNRESET`
- `ETIMEDOUT`
- duplicate/subscriber connection loss
- persistent adapter fallback

## PII And Secret Redaction Rules

Never record actual secret or customer values.

Banned values:

- full `redis://` connection values
- `Authorization` header values
- `Cookie` header values
- JWT-like token values
- phone numbers
- payment data
- private customer data

Allowed values:

- Cloud Run service name and revision name
- public host only, such as `api.heygrabit.com`
- PASS / FAIL result text
- redacted event ids
- command shape without secrets
- safe fixture IDs only if the operator confirms they are non-customer fixtures

## Final Phase 20 Result

- [ ] Health Ping Smoke PASS
- [ ] Lua Lock Status Unlock Smoke PASS
- [ ] Socket.IO Two-Instance Propagation PASS
- [ ] Idle Reconnect Window PASS
- [ ] Log And Sentry Cleanliness PASS
- [ ] Scale restored PASS
- [ ] Rollback checklist reviewed
- [ ] Redaction review complete
- [ ] Final Phase 20 Result PASS

Current state: pending production smoke. The only valid resume signal for Plan 20-04 continuation is `approved` after this file contains real revision-scoped evidence.
