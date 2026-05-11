---
status: complete
quick_id: 260511-fw2
slug: fix-toss-webhook-timestamp-validation-fo
created: 2026-05-11T02:26:29.258Z
completed: 2026-05-11T02:51:02Z
---

# Fix Toss Webhook Timestamp Validation For Phase 24 Activation

## Goal

Finish the Phase 24 external activation evidence by fixing the deployed Toss webhook receiver so the correct Toss store can deliver sandbox payment webhooks successfully.

## Tasks

1. Verify current-store Toss webhook delivery against Cloud Run and identify the 400 failure boundary.
2. Update webhook payload validation to accept Toss' real timestamp format and tolerate provider variants without dropping the event.
3. Support Toss payment webhook idempotency from the transmission header when `eventId` is unavailable in the body.
4. Run focused webhook controller regression tests.
5. Build and deploy a new API image with active production booking disabled and smoke booking enabled only for payment verification.
6. Execute a real Toss sandbox redirect/confirm/webhook smoke and record evidence without secrets.
7. Remove the temporary smoke tag and update Phase 24 evidence artifacts.
