---
status: complete
quick_id: 260511-fw2
slug: fix-toss-webhook-timestamp-validation-fo
completed: 2026-05-11T02:51:02Z
---

# Summary

Completed Phase 24 external activation cleanup for Cloudflare and the Toss sandbox webhook path.

## Changes

- Updated `PaymentWebhookController` schema so Toss webhook timestamps without timezone offsets are accepted.
- Added provider fallback tolerance for real Toss webhook payload variants.
- Added `tosspayments-webhook-transmission-id` fallback support for webhook idempotency when payment webhook bodies do not carry `eventId`.
- Added focused regression coverage for offset timestamps, local timestamps, unknown provider fallback, and transmission-id fallback.
- Deployed image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:phase24-webhook-eventid-202605111147`.
- Verified active Cloud Run revision `grabit-api-p24wheact2` serves 100% traffic without `BOOKING_ENABLED`.
- Verified real Toss sandbox transfer order `GRP-P24-1778467773443` reached Grabit `CONFIRMED`, QR `ACTIVE`, Cloud Run webhook HTTP 201, and DB ledger `PAYMENT_STATUS_CHANGED_DONE_APPLIED`.
- Removed the temporary `phase24-smoke` tag after evidence capture.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/payment/toss-webhook.controller.spec.ts --reporter=dot`
- Cloud Run logging: `POST /api/v1/payments/toss/webhook` returned 201 at `2026-05-11T02:51:02.000662Z`.
- Toss dashboard history: `성공 PAYMENT_STATUS_CHANGED 2026-05-11 11:51:02`.
- Production DB `payment_webhook_events`: latest order processed with `PAYMENT_STATUS_CHANGED_DONE_APPLIED`.
