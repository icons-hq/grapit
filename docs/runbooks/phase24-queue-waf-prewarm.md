# Phase 24 Queue, WAF, and Prewarm Runbook

## Purpose

Phase 24 traffic defense must distinguish retryable rate limits, suspicious traffic that should receive `Managed Challenge`, and clear macro behavior that should be blocked before booking-critical capacity is exhausted.

This runbook also documents the protected prewarm control path that Cloud Scheduler can call with `POST` plus `OIDC`, because Cloud Scheduler does not provide a direct JSON `PATCH` flow to the Cloud Run Admin API for service-level min-instance updates.

## Scope

- `queue-entry`, `lock-seat`, `prepare-reservation`, `confirm-payment`, `signup`, and `sms`
- Cloudflare WAF custom rules and rate limiting rules for booking-critical traffic
- Internal prewarm scale-up and `step-down` jobs driven by Cloud Scheduler
- Non-Enterprise fallback when `cf.bot_management.*` fields are not available

## Contract Invariants

- Preserve D-06 progressive defense: normal traffic gets endpoint-specific rate limits, suspicious traffic gets Cloudflare `Managed Challenge`, and clear macro behavior gets `Block`.
- Preserve the existing app-layer route contract from Phase 24-05:
  - `POST /api/v1/internal/prewarm/services/:serviceName`
  - `POST /api/v1/internal/prewarm/services/:serviceName/step-down`
- Preserve the existing dual-factor guard from Phase 24-05:
  - Google-signed Scheduler `OIDC` bearer token
  - `x-prewarm-control-token` second factor
- Treat the five `PREWARM_*` settings as a deploy-time invariant. Future API deploys must continue to inject them through `.github/workflows/deploy.yml`.

## Cloudflare Rule Groups

### Group 1: Queue Entry Challenge

Goal: slow suspicious queue-entry bursts before scarce booking APIs are reachable.

- Match `queue-entry` paths only.
- Primary action: `Managed Challenge`
- Use this on aggressive anonymous bursts, repeated refresh loops, and obvious automation that is not severe enough for a hard block.

Recommended expression shape:

- Path filter for `/booking` entry or the queue entry API path
- Method filter for `GET`/`POST`
- Rate limiting threshold tuned for the launch window

### Group 2: Booking Mutation Rate Limits

Goal: protect write-heavy booking endpoints with tighter per-endpoint counters than the site-wide default.

Endpoints:

- `lock-seat`
- `prepare-reservation`
- `confirm-payment`
- `signup`
- `sms`

Operational rule:

- Use Cloudflare rate limiting for anonymous spikes first.
- Keep the app-layer named throttlers enabled for richer identity-based keys (`userId`, session cookie, admission token, IP).
- Treat `TRAFFIC_RATE_LIMITED` as retryable, not as a generic security failure.

### Group 3: Macro / Bot Escalation

Goal: escalate from retry to challenge to block for repeated booking-critical attempts.

- Suspicious repeated `lock-seat` / `prepare-reservation` / `confirm-payment` attempts should map to `Managed Challenge`.
- Clear macro patterns should map to `Block`.
- Use app-layer macro scoring to correlate repeated attempts across account, phone, email, payment method, device-ish identity, and admission token.

## Non-Enterprise Fallback

Do not assume `cf.bot_management.score`, `cf.bot_management.js_detection.passed`, or other Enterprise-only bot fields are available.

If the active Cloudflare plan does not expose Enterprise bot variables:

- Keep `Managed Challenge` and path-specific rate limiting rules in Cloudflare.
- Keep `queue-entry`, `lock-seat`, `prepare-reservation`, and `confirm-payment` app-layer scoring active.
- Record any later Bot Management upgrade separately; it is not required for Phase 24 correctness.

## Internal Prewarm Control Path

Routes:

- `POST /api/v1/internal/prewarm/services/:serviceName`
- `POST /api/v1/internal/prewarm/services/:serviceName/step-down`

Security requirements:

- Cloud Scheduler sends a Google-signed `OIDC` ID token in `Authorization: Bearer <token>`.
- The app validates:
  - `iss` is `https://accounts.google.com` or `accounts.google.com`
  - `aud` equals `PREWARM_ALLOWED_AUDIENCE`
  - `email` equals `PREWARM_ALLOWED_SCHEDULER_EMAIL`
- The caller must also send `x-prewarm-control-token: <PREWARM_CONTROL_TOKEN>` as a second factor.

Runtime environment variables:

- `PREWARM_CONTROL_TOKEN`
- `PREWARM_PROJECT_ID`
- `PREWARM_REGION`
- `PREWARM_ALLOWED_SCHEDULER_EMAIL`
- `PREWARM_ALLOWED_AUDIENCE`

Request bodies:

- Scale-up: `{"minInstances": 100}`
- `step-down`: `{"minInstances": 0}` or omit `minInstances` to use the controller default of `0`

## Cloud Scheduler Setup

### Required API Enablement

- Enable `cloudscheduler.googleapis.com` in project `grapit-491806` before creating or updating jobs.
- Keep Scheduler jobs in `asia-northeast3` so the operational surface matches the API runtime region.

### Required Scheduler Service Account

- Create or reuse a dedicated service account:
  - `scheduler-prewarm@grapit-491806.iam.gserviceaccount.com`
- Only substitute a different principal if the project already has an equivalent dedicated Scheduler caller for the same protected prewarm path.
- Grant the operator creating jobs `iam.serviceAccounts.actAs` on that service account.
- Configure each job to use `OIDC`, not OAuth, because the target is the app endpoint and the app validates the ID token itself.

### Required Cloud Run Runtime Permissions

- The deployed `grabit-api` revision currently runs as `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`.
- That runtime principal must be allowed to update the `grabit-api` service through the Cloud Run Admin API.
- The current live fallback binding is:
  - `roles/run.admin` for `serviceAccount:grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`
- Because the update request preserves the service template service account, the same runtime principal also needs:
  - `roles/iam.serviceAccountUser` on `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` for `serviceAccount:grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`
- If either binding is missing, the prewarm endpoint can return `503` even when the route, OIDC audience, and control token are all correct.

### Required Target URL / Audience Contract

- Resolve the live target URL from the deployed service before creating jobs:

```bash
TARGET_URL="$(gcloud run services describe grabit-api \
  --project=grapit-491806 \
  --region=asia-northeast3 \
  --format='value(status.url)')"
```

- If production is serving the prewarm endpoint from a custom domain instead of the `run.app` hostname, replace `TARGET_URL` with that exact deployed URL after verification.
- `PREWARM_ALLOWED_AUDIENCE` must equal the exact live scale-up endpoint URL, not a stale hardcoded domain.
- The current Phase 24-05 app contract validates a single shared audience value, so both jobs must reuse the same `--oidc-token-audience` value even though the step-down job calls a different URI.
- Use this exact shared audience value:
  - `${TARGET_URL}/api/v1/internal/prewarm/services/grabit-api`
- The step-down job keeps its `/step-down` `--uri`, but its `--oidc-token-audience` must still use the shared scale-up endpoint audience above.
- The deploy contract must keep `grabit-api` `--max-instances` greater than or equal to the requested prewarm `minInstances`.
- On the current Grapit Cloud Run service, `run.googleapis.com/network-interfaces` is enabled, which caps `autoscaling.knative.dev/maxScale` at `100`. For the live Phase 24 rollout, use `{"minInstances":100}` and keep `--max-instances=100`.

### Scale-Up Job

```bash
TARGET_URL="${TARGET_URL:?set TARGET_URL first}"
PREWARM_CONTROL_TOKEN="${PREWARM_CONTROL_TOKEN:?set PREWARM_CONTROL_TOKEN first}"

gcloud scheduler jobs create http grabit-prewarm-scale-up \
  --location=asia-northeast3 \
  --schedule="25 09 * * *" \
  --time-zone="Asia/Seoul" \
  --uri="${TARGET_URL}/api/v1/internal/prewarm/services/grabit-api" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-prewarm-control-token=${PREWARM_CONTROL_TOKEN}" \
  --message-body='{"minInstances":100}' \
  --oidc-service-account-email="scheduler-prewarm@grapit-491806.iam.gserviceaccount.com" \
  --oidc-token-audience="${TARGET_URL}/api/v1/internal/prewarm/services/grabit-api"
```

### Step-Down Job

```bash
TARGET_URL="${TARGET_URL:?set TARGET_URL first}"
PREWARM_CONTROL_TOKEN="${PREWARM_CONTROL_TOKEN:?set PREWARM_CONTROL_TOKEN first}"

gcloud scheduler jobs create http grabit-prewarm-step-down \
  --location=asia-northeast3 \
  --schedule="10 11 * * *" \
  --time-zone="Asia/Seoul" \
  --uri="${TARGET_URL}/api/v1/internal/prewarm/services/grabit-api/step-down" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-prewarm-control-token=${PREWARM_CONTROL_TOKEN}" \
  --message-body='{"minInstances":0}' \
  --oidc-service-account-email="scheduler-prewarm@grapit-491806.iam.gserviceaccount.com" \
  --oidc-token-audience="${TARGET_URL}/api/v1/internal/prewarm/services/grabit-api"
```

Operational note:

- Cloud Scheduler `create http` supports `POST` or `PUT` bodies but not a direct JSON `PATCH` flow for this use case.
- The app endpoint exists specifically to translate Scheduler `POST` requests into the Cloud Run Admin API `PATCH ...?update_mask=template.scaling.minInstanceCount`.
- Do not change the app-layer routes or swap the request flow to a direct Scheduler-to-Cloud-Run-Admin-API call. This runbook closes the operational gap without changing the protected Phase 24-05 contract.
- For manual operator smoke tests, do not fire `scale-up` and `step-down` back-to-back against the same live revision without waiting for the first Cloud Run update to settle, or the second request can fail with a version conflict.

## Verification

### App-Layer Checks

- Confirm the traffic module returns `TRAFFIC_RATE_LIMITED`, `SECURITY_CHALLENGE_REQUIRED`, and `SECURITY_BLOCKED`.
- Confirm `queue-entry` anonymous tracker fallback uses session cookie + IP, not IP-only.

### Scheduler / Prewarm Checks

- Send a signed Scheduler request with the expected `OIDC` audience and service-account email.
- Confirm the app rejects:
  - missing `Authorization` bearer token
  - wrong `aud`
  - wrong `email`
  - missing or wrong `x-prewarm-control-token`
- Confirm scale-up and `step-down` both return accepted responses and emit Cloud Run operation names.

### Cloudflare Checks

- `Managed Challenge` is present on queue-entry suspicious traffic rules.
- `lock-seat`, `prepare-reservation`, and `confirm-payment` rate rules exist in the active zone.
- If Enterprise bot fields are unavailable, the runbook fallback remains in effect and no rule expression references `cf.bot_management.*`.
