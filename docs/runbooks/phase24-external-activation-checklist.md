---
phase: 24-traffic-booking-payment-core
status: human_needed
last_verified: 2026-05-11 11:51:02 KST
scope: Cloudflare nameserver activation and Toss sandbox/webhook activation
---

# Phase 24 External Activation Checklist

## Purpose

Phase 24 code-level booking, queue, prewarm, seat selection, refund, QR, and local Toss SDK verification is mostly complete. The remaining work is external production activation evidence that cannot be fully proven from the repository alone:

1. `heygrabit.com` must be delegated from WHOISDomain to Cloudflare so Cloudflare WAF/rate-limit rules can execute on real edge traffic.
2. Toss Payments must be configured in the correct merchant/store context and exercised through real sandbox redirect/webhook flows.

This document is intentionally limited to the latest external steps needed to close `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md` and `.planning/phases/24-traffic-booking-payment-core/24-VERIFICATION.md`.

Do not write OTP codes, registrant contact details, Toss keys, or webhook secrets into docs, tickets, chat, screenshots, or commits.

## Latest Source Checks

| Area | Latest official guidance checked | Production implication |
| --- | --- | --- |
| Cloudflare nameservers | Cloudflare says a domain must point to the Cloudflare-assigned nameservers to activate the zone and use most application services. If the domain uses another registrar, the nameserver update is done at that registrar. | Cloudflare rules configured in the dashboard are not production-effective while the zone is still pending. WHOISDomain must replace the current NS set with the assigned Cloudflare NS pair. |
| Cloudflare pending/active status | Cloudflare describes `Pending` as not yet active for proxying traffic. For primary full setup without multi-provider DNS, only the assigned Cloudflare nameservers should be listed at the registrar/parent zone. | Mixed WHOISDomain + Cloudflare nameservers is not the target state for this Free/full setup. Verify that public resolvers return only the Cloudflare pair. |
| Cloudflare DNSSEC | Cloudflare says DNSSEC should be disabled at the registrar before replacing nameservers if DNSSEC is active; after activation it can be re-enabled through Cloudflare. | Current `dig DS heygrabit.com +short` returned no DS records, but the registrar DNSSEC screen should still be checked before final submit. |
| Toss payment redirect/confirm | Toss requires `successUrl` parameters such as `paymentKey`, `orderId`, and `amount` to be handled by the merchant server, with amount verified before confirm. | Real sandbox evidence must prove that Grabit compares the server-side amount and confirms/cancels/retries correctly for each payment branch. |
| Toss webhook registration/history | Toss webhooks are registered from Developer Center, delivered as HTTPS POST JSON, and webhook history shows delivery status. Toss retries non-200 responses. | The deployed endpoint must be registered in the correct Toss store, then history must show `Completed` for the tested events. |
| Toss general webhook verification | Toss' AI quick reference says general payment webhooks have no signature header and should be re-verified by querying Toss with `paymentKey`. Payout/seller webhooks are the signature-header case. | Current Grabit receiver has a custom shared-secret guard. For immediate sandbox evidence, register the endpoint with the supported query secret fallback. Before production reliance, add server-side Toss payment query verification to align with official guidance. |

Sources:

- Cloudflare update nameservers: https://developers.cloudflare.com/dns/nameservers/update-nameservers/
- Cloudflare full setup: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
- Cloudflare zone status: https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/
- Toss webhooks: https://docs.tosspayments.com/en/webhooks
- Toss webhook events: https://docs.tosspayments.com/reference/using-api/webhook-events
- Toss payment widget: https://docs.tosspayments.com/en/integration-widget
- Toss API keys: https://docs.tosspayments.com/reference/using-api/api-keys
- Toss LLM quick reference: https://docs.tosspayments.com/guides/v2/get-started/llms-quick-reference

## 2026-05-11 Activation Evidence

### Cloudflare

Cloudflare activation is complete for `heygrabit.com`.

- WHOISDomain nameserver cutover completed.
- Cloudflare zone id: `c7e9867fe90523f398e5c51ad911107e`
- Public resolver checks returned only:
  - `rick.ns.cloudflare.com.`
  - `wanda.ns.cloudflare.com.`
- `dig DS heygrabit.com +short` returned no stale registrar DS records.
- `curl -I https://heygrabit.com` and `curl -I https://api.heygrabit.com/api/v1/health` returned through the Cloudflare path.
- WAF smoke showed suspicious user agents receiving Cloudflare `403` with `cf-mitigated: challenge`; normal availability remained `200`.

### Toss Sandbox And Webhook

Toss sandbox webhook activation is complete for the current `개발 연동 체험 상점` store.

- Webhook name: `grabit-phase24-payment-status`
- Events: `PAYMENT_STATUS_CHANGED`, `CANCEL_STATUS_CHANGED`
- Endpoint host: `https://api.heygrabit.com`
- Secret transport: temporary query-secret fallback inside Toss Developer Center only; the full URL and secret are intentionally not recorded here.
- Toss dashboard webhook history showed `성공 PAYMENT_STATUS_CHANGED` at `2026-05-11 11:51:02 KST`.
- Cloud Run request log showed `POST /api/v1/payments/toss/webhook` returning `201` on revision `grabit-api-p24wheact2` at `2026-05-11T02:51:02.000662Z`.
- DB ledger row:
  - event id prefix class: `whtrans_*`
  - order id: `GRP-P24-1778467773443`
  - payment key: `tviva2026051...`
  - event type: `PAYMENT_STATUS_CHANGED`
  - method: `계좌이체`
  - result: `PAYMENT_STATUS_CHANGED_DONE_APPLIED`
  - processed at: `2026-05-11T02:51:02.093Z`
- Grabit server confirm for the same order returned reservation `CONFIRMED`, QR `ACTIVE`, and `paidAt=2026-05-11T02:51:01.000Z`.

Important limitation: this proves the store-specific Toss redirect, confirm, webhook delivery, and Grabit processing path using Toss test account transfer. It does not complete the full payment-method matrix for domestic card, overseas card, Alipay+, and truemoney.

### Production Drift Fixed During Activation

- `grabit-api` `minScale` was restored to `0` after an accidental `100` min-instance drift exhausted Cloud SQL capacity.
- Production Phase 24 migrations were applied; `floor_key`, `seat_key`, `async_status`, `queue_session_id`, and webhook ledger columns exist in production.
- QR ticket secrets were added to Secret Manager and injected into Cloud Run.
- `toss-secret-key` Secret Manager latest version was updated from the current Toss store API secret.
- Active production API revision is `grabit-api-p24wheact2`, serving 100% traffic without `BOOKING_ENABLED`.
- Temporary `phase24-smoke` Cloud Run tag was removed after evidence capture.
- Temporary Cloud SQL authorized network was cleared after DB evidence capture.

## Superseded 2026-05-10 Live State

Checked at `2026-05-10 23:28:30 KST`.

### DNS

`dig NS heygrabit.com +short | sort` still returns WHOISDomain:

```text
ns1.whoisdomain.kr.
ns2.whoisdomain.kr.
ns3.whoisdomain.kr.
ns4.whoisdomain.kr.
```

`dig DS heygrabit.com +short | sort` returned no public DS records.

Target Cloudflare nameservers recorded in the Phase 24 evidence:

```text
rick.ns.cloudflare.com
wanda.ns.cloudflare.com
```

Cloudflare zone id recorded in the Phase 24 evidence:

```text
c7e9867fe90523f398e5c51ad911107e
```

### Deployed API

`grabit-api` currently serves 100% traffic on:

```text
https://grabit-api-d3c6wrfdbq-du.a.run.app
```

Latest ready revision:

```text
grabit-api-00037-f8t
```

Relevant environment readiness:

```text
TOSS_SECRET_KEY: present
TOSS_WEBHOOK_SECRET: present
minScale: 0
```

Webhook guard smoke:

```text
without_secret=401
with_configured_secret_malformed_body=400
```

This means the endpoint fails closed without the shared secret, and an authenticated malformed payload reaches body validation.

## Remaining Work 1: Cloudflare Nameserver Cutover

### Why This Matters In Production

Cloudflare WAF, managed challenge, macro block, and rate-limit rules only protect real production traffic after `heygrabit.com` is actively served through Cloudflare. While public DNS still delegates to WHOISDomain, traffic can bypass the configured Cloudflare edge rules, so launch traffic protection remains unproven.

### Exact Steps

1. Open WHOISDomain domain management for `heygrabit.com`.
2. Go to the nameserver change flow.
3. Remove the current WHOISDomain authoritative nameservers:
   - `ns1.whoisdomain.kr`
   - `ns2.whoisdomain.kr`
   - `ns3.whoisdomain.kr`
   - `ns4.whoisdomain.kr`
4. Add only the Cloudflare-assigned nameservers:
   - `rick.ns.cloudflare.com`
   - `wanda.ns.cloudflare.com`
5. Before final submit, confirm registrar DNSSEC/DS settings are disabled or empty.
6. Complete the registrar contact verification OTP flow.
7. Submit the nameserver change.
8. In Cloudflare dashboard, trigger or wait for zone activation check.

If the previous WHOISDomain browser session is still open at the confirmation page, continue from the OTP step. If the session expired, restart the flow from domain management.

### Verification Commands

Run these until all public checks return the Cloudflare pair:

```bash
dig NS heygrabit.com +short | sort
dig ns heygrabit.com @1.1.1.1 +short | sort
dig ns heygrabit.com @8.8.8.8 +short | sort
dig DS heygrabit.com +short | sort
```

Expected NS output:

```text
rick.ns.cloudflare.com.
wanda.ns.cloudflare.com.
```

Cloudflare says registrar updates can take up to 24 hours. Treat cached resolver mismatch during that window as propagation, not immediate failure.

### Edge Smoke After Activation

After Cloudflare status becomes `Active`, verify both normal availability and rule execution:

```bash
curl -I https://heygrabit.com
curl -I https://api.heygrabit.com/api/v1/health
```

Then execute the Phase 24 WAF/rate-limit checks from `docs/runbooks/phase24-queue-waf-prewarm.md`:

- queue-entry managed challenge rule exists and is enabled
- booking mutation managed challenge rule exists and is enabled
- booking macro block rule exists and is enabled
- critical booking API rate-limit rule exists and is enabled
- rule analytics/logs show hits for deliberate smoke requests

### Done Criteria

- Cloudflare dashboard shows `heygrabit.com` as `Active`.
- `dig` against default resolver, `1.1.1.1`, and `8.8.8.8` returns only `rick.ns.cloudflare.com` and `wanda.ns.cloudflare.com`.
- `dig DS heygrabit.com +short` has no stale registrar DS record unless Cloudflare DNSSEC was intentionally re-enabled and the Cloudflare DS was added.
- `https://heygrabit.com` and `https://api.heygrabit.com/api/v1/health` resolve through the expected Cloudflare path.
- Cloudflare security rule smoke evidence is added to `24-HUMAN-UAT.md`.

### Rollback Guidance

Do not immediately revert nameservers if traffic fails after propagation. First check Cloudflare DNS records for apex, `www`, `api`, MX/SPF/DKIM/DMARC, and proxy status. Reverting nameservers should be the last resort if Cloudflare DNS cannot be corrected quickly.

## Remaining Work 2: Toss Sandbox Redirect And Webhook Activation

### Why This Matters In Production

Local tests prove Grabit's code paths, but they do not prove Toss merchant configuration, redirect URLs, store-specific payment method availability, webhook delivery, retry behavior, or real asynchronous status transitions. Production launch needs at least sandbox evidence from the same external system that will send live payment events later.

### Current Grabit Receiver Contract

Endpoint:

```text
POST https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/payments/toss/webhook
```

After DNS activation, prefer the custom domain only if TLS and routing are confirmed:

```text
POST https://api.heygrabit.com/api/v1/payments/toss/webhook
```

The current `TossWebhookGuard` accepts the shared secret through:

- `x-toss-webhook-secret`
- `x-grabit-toss-webhook-secret`
- `Authorization: Bearer <secret>`
- `?tossWebhookSecret=<secret>`
- `?secret=<secret>`

Official Toss docs for general payment webhooks do not document a signature header for `PAYMENT_STATUS_CHANGED` or `CANCEL_STATUS_CHANGED`. Therefore, for the next sandbox evidence run, use one of these paths:

| Path | When to use | Tradeoff |
| --- | --- | --- |
| Register endpoint with `?tossWebhookSecret=<Secret Manager value>` | Fastest way to prove the current deployed receiver with no code change, if Toss Developer Center only accepts an endpoint URL. | Secret appears in the registered URL and may appear in access logs. Keep it temporary, rotate after the evidence run, and never paste the full URL into docs. |
| Implement Toss Query API verification before external reliance | Preferred production-hardening path. Add `GET /v1/payments/{paymentKey}` or `GET /v1/payments/orders/{orderId}` verification before applying webhook state. | Requires code change and tests, but aligns with Toss' general webhook guidance and avoids relying on an undocumented custom header flow. |

If Toss Developer Center supports custom headers in the actual store UI, use `x-toss-webhook-secret`. If it only accepts URL, use the query secret fallback for sandbox evidence and then schedule the Query API hardening before live payment traffic.

### Webhook Registration Steps

1. Open Toss Payments Developer Center.
2. Select the correct merchant/store. The previous attempt failed with `올바른 상점이 아닙니다`, so do not continue in a generic or wrong store context.
3. Open the Webhook menu.
4. Register a webhook endpoint:
   - Name: `grabit-phase24-payment-status`
   - Endpoint: the Cloud Run URL above, or the custom domain URL only after Cloudflare activation.
   - Events:
     - `PAYMENT_STATUS_CHANGED`
     - `CANCEL_STATUS_CHANGED`
5. Add the Grabit webhook secret by the safest supported mechanism:
   - Preferred if UI supports headers: `x-toss-webhook-secret`.
   - Otherwise: append `?tossWebhookSecret=<Secret Manager value>` only inside the Toss UI.
6. Save the webhook and open its detail/history page.

To retrieve the secret during registration:

```bash
gcloud secrets versions access latest \
  --secret=toss-webhook-secret \
  --project=grapit-491806
```

Do not commit or document the returned value.

### Sandbox Payment Paths To Execute

Run these with Toss test keys in the correct store context:

| Path | Evidence needed |
| --- | --- |
| Domestic card | `successUrl` returns `paymentKey`, `orderId`, `amount`; server verifies amount; confirm succeeds; reservation/payment reaches confirmed/DONE state. |
| Overseas card | Required overseas disclaimer/branch appears; redirect and confirm behavior matches the selected method's result. |
| Alipay+ | Async/pending branch is visible when appropriate; webhook or later query updates state; recovery UI is available while waiting. |
| truemoney | Same async/pending/recovery evidence as Alipay+. |
| Webhook failure/retry | If a test event initially fails, Toss history should show retry status; after fixing receiver/secret, history should end at `Completed`. |

Capture only non-secret evidence:

- Toss `eventId`
- `eventType`
- Toss delivery status
- timestamp
- `orderId`
- `paymentKey` prefix or masked value
- Grabit reservation id
- final Grabit payment/reservation status
- Cloud Run log timestamp

### Server Verification Commands

Use these after sandbox activity:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   AND resource.labels.service_name="grabit-api"
   AND ("payments/toss/webhook" OR "PAYMENT_STATUS_CHANGED" OR "CANCEL_STATUS_CHANGED")' \
  --project=grapit-491806 \
  --limit=50 \
  --format='value(timestamp,textPayload,jsonPayload.message)'
```

Run regression tests after any Toss webhook code change:

```bash
pnpm --filter @grabit/api exec vitest run \
  src/modules/payment/toss-webhook.guard.spec.ts \
  src/modules/payment/toss-webhook.controller.spec.ts \
  src/modules/payment/payment.service.spec.ts
```

Run browser payment regressions:

```bash
pnpm --filter @grabit/web exec playwright test \
  e2e/toss-payment-phase24.spec.ts \
  --project=chromium \
  --reporter=line
```

For the real SDK local confirm-intercept spec:

```bash
TOSS_CLIENT_KEY_TEST="$NEXT_PUBLIC_TOSS_CLIENT_KEY" \
E2E_API_URL=http://localhost:8080 \
pnpm --filter @grabit/web exec playwright test \
  e2e/toss-payment.spec.ts \
  --project=chromium \
  --reporter=line
```

### Done Criteria

- Toss Developer Center webhook exists in the correct store.
- Webhook history shows `Completed` delivery for the relevant test events.
- Domestic card, overseas card, Alipay+, and truemoney sandbox flows each have evidence for redirect, UI branch, server state, and final recovery/confirmation.
- Cloud Run logs show webhook receipt and successful processing result codes.
- `24-HUMAN-UAT.md` records the evidence without secrets.
- `24-VERIFICATION.md` updates Phase 24 from `human_needed` only after Cloudflare and Toss evidence are both complete.

## Recommended Follow-Up Code Hardening

This is not required to create the external evidence document, but it is the safest next engineering action discovered from the latest Toss docs search.

Add official Toss general webhook verification:

1. Add `TossPaymentsClient.retrievePayment(paymentKey)` using `GET /v1/payments/{paymentKey}`.
2. In `PaymentWebhookController`, before applying `PAYMENT_STATUS_CHANGED`, re-query Toss by `paymentKey`.
3. Confirm returned `paymentKey`, `orderId`, amount, and status match the webhook payload and local pending payment/reservation.
4. Preserve idempotency through the existing `payment_webhook_events` ledger.
5. Keep the shared secret guard for additional defense where possible, but do not make production correctness depend on an undocumented Toss custom header if the Developer Center cannot send one.
6. Add tests for:
   - webhook accepted after successful Toss re-query
   - webhook rejected or marked failed when query status/order/paymentKey mismatches
   - duplicate `eventId` remains idempotent
   - stale event after terminal cancel/failure remains ignored

## Artifact Updates After Completion

Update these files when the external work is complete:

- `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md`
- `.planning/phases/24-traffic-booking-payment-core/24-VERIFICATION.md`
- `docs/runbooks/phase24-queue-waf-prewarm.md` if Cloudflare rule names, thresholds, or smoke commands changed
- this document, only if the external activation steps or official docs change

Then commit the evidence update.
