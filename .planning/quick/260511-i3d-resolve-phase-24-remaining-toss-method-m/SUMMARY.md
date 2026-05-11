---
status: complete
quick_id: 260511-i3d
slug: resolve-phase-24-remaining-toss-method-m
completed: 2026-05-11T04:05:04Z
---

# Summary

Closed the remaining Phase 24 Toss method-matrix blocker and recorded the accepted domestic buyer-card authentication caveat.

## Changes

- Fixed production Redis Cluster `CROSSSLOT` queue admission failure by deleting stale queue-session keys one at a time.
- Added Toss webhook schema support for provider `ALIPAY` and service-level normalization to internal `ALIPAY_PLUS`.
- Added regression coverage for one-key stale-session purge and Toss `ALIPAY` webhook parsing/normalization.
- Deployed API image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-api:phase24-gapfix-amd64-20260511123047`.
- Deployed web image `asia-northeast3-docker.pkg.dev/grapit-491806/grabit/grabit-web:phase24-gapfix-web-amd64-20260511124323`.
- Verified overseas card, Alipay+, truemoney, and domestic card branch/webhook ledger evidence in production without recording secrets.
- Updated `24-HUMAN-UAT.md`, `24-VERIFICATION.md`, and `docs/runbooks/phase24-external-activation-checklist.md`.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.service.spec.ts src/modules/payment/toss-webhook.guard.spec.ts src/modules/payment/toss-webhook.controller.spec.ts src/modules/payment/payment.service.spec.ts`
- `pnpm --filter @grabit/api typecheck`
- `pnpm --filter @grabit/web exec playwright test e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line`
- `pnpm --filter @grabit/web build`
- Production DB ledger: all method-matrix orders reached reservation `CONFIRMED`, payment `DONE`, QR `active`, and webhook result `PAYMENT_STATUS_CHANGED_DONE_APPLIED`.
- Production runtime flags: `https://heygrabit.com/api/runtime-flags` returned `{"bookingEnabled":false}` after smoke completion.

## Accepted Caveat

Fully authenticated domestic buyer-card entry should be repeated manually by an authorized operator before live payment traffic. The Phase 24 blocker is closed because the Grabit branch, Toss READY response, authenticated webhook receiver, DB ledger, reservation confirmation, QR activation, and complete UI were verified without storing sensitive card data.
