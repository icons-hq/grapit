---
phase: 24
slug: traffic-booking-payment-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-08
---

# Phase 24 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.0 for API/web unit tests; Playwright 1.59.1 for web E2E |
| Config file | `apps/api/vitest.config.ts`, `apps/api/vitest.integration.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` |
| Quick run command | `pnpm --filter @grabit/api test -- src/modules/reservation/reservation.service.spec.ts && pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx` |
| Full suite command | `pnpm test && pnpm --filter @grabit/api test:integration && pnpm --filter @grabit/web test:e2e` |
| Estimated runtime | Quick: ~60-120 seconds; full: project-dependent |

---

## Sampling Rate

- After every task commit: run the narrowest affected Vitest suite plus any touched booking E2E slice.
- After every plan wave: run `pnpm test` and the relevant `pnpm --filter @grabit/web test:e2e --grep ...` scenario set.
- Before `$gsd-verify-work`: full suite must be green, including `pnpm --filter @grabit/api test:integration`.
- Max feedback latency: keep targeted checks under 120 seconds where possible.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-W0-01 | TBD | 0 | TRAF-01 | T-QUEUE-01 | Admission token is required for booking mutations and cannot be replayed across user/device/session | API unit | `pnpm --filter @grabit/api test -- src/modules/queue/queue.service.spec.ts` | no | pending |
| 24-W0-02 | TBD | 0 | TRAF-02 | T-MACRO-01 | Booking-critical rate/macro decisions distinguish queue redirect, 429, challenge, and block states | API unit + web E2E | `pnpm --filter @grabit/api test -- src/modules/traffic/traffic-defense.service.spec.ts && pnpm --filter @grabit/web test:e2e --grep "queue|rate"` | no | pending |
| 24-W0-03 | TBD | 0 | TRAF-03 | T-OPS-01 | Prewarm control path requires authenticated internal access and cannot be triggered anonymously | API unit + manual smoke | `pnpm --filter @grabit/api test -- src/modules/ops/prewarm.service.spec.ts` | no | pending |
| 24-W0-04 | TBD | 0 | BOOK-01 | T-SEAT-01 | Floor-aware seat identity prevents cross-floor seat collisions | web component + API unit | `pnpm --filter @grabit/web test -- components/booking/__tests__/seat-map-viewer.test.tsx` | yes-extend | pending |
| 24-W0-05 | TBD | 0 | BOOK-02 | T-LOCK-01 | Payment deadline and lock expiry cannot confirm stale or foreign-owned locks | web unit + E2E | `pnpm --filter @grabit/web test -- hooks/__tests__/use-booking.test.tsx && pnpm --filter @grabit/web test:e2e --grep "toss-payment"` | yes-extend | pending |
| 24-W0-06 | TBD | 0 | BOOK-03 | T-POLICY-01 | Event max-ticket and cancel/change policy are enforced server-side, not only in UI | API unit | `pnpm --filter @grabit/api test -- src/modules/booking/booking-policy.service.spec.ts` | no | pending |
| 24-W0-07 | TBD | 0 | PAY-02 | T-PAY-01 | Domestic sync payment and foreign async webhook branches are idempotent and consent-gated | API webhook + web E2E | `pnpm --filter @grabit/api test -- src/modules/payment/toss-webhook.controller.spec.ts && pnpm --filter @grabit/web test:e2e --grep "toss-payment"` | partial | pending |
| 24-W0-08 | TBD | 0 | REFUND-01 | T-REFUND-01 | Refund preview/state changes are durable and double-submit safe | API unit + web component | `pnpm --filter @grabit/api test -- src/modules/refund/refund.service.spec.ts && pnpm --filter @grabit/web test -- components/reservation/__tests__/refund-timeline.test.tsx` | no | pending |
| 24-W0-09 | TBD | 0 | REFUND-02 | T-REOPEN-01 | User cancellations reopen seats only through delayed random hold unless operator manual-open bypass is used | API unit + integration | `pnpm --filter @grabit/api test -- src/modules/jobs/cancelled-seat-release.worker.spec.ts` | no | pending |
| 24-W0-10 | TBD | 0 | QR-01 | T-QR-01 | QR JWT/HMAC issuance uses signed claims and durable ticket status before My Page/email exposure | API unit + web E2E | `pnpm --filter @grabit/api test -- src/modules/ticket/qr-ticket.service.spec.ts && pnpm --filter @grabit/web test:e2e --grep "booking complete"` | no | pending |

Status values: pending, green, red, flaky.

---

## Wave 0 Requirements

- [ ] `apps/api/src/modules/queue/queue.service.spec.ts` - admission state, batch admission, ETA math, token validation.
- [ ] `apps/api/src/modules/queue/queue.guard.spec.ts` - guard enforcement on `lockSeat`, `prepareReservation`, `confirmPayment`.
- [ ] `apps/api/src/modules/traffic/traffic-defense.service.spec.ts` - endpoint-specific limits, macro scoring, user-facing failure categorization.
- [ ] `apps/api/src/modules/ops/prewarm.service.spec.ts` - protected prewarm control path behavior.
- [ ] `apps/api/src/modules/payment/toss-webhook.controller.spec.ts` - `PAYMENT_STATUS_CHANGED` and `CANCEL_STATUS_CHANGED` idempotency/retry behavior.
- [ ] `apps/api/src/modules/refund/refund.service.spec.ts` - refund preview, refund state machine, duplicate request guard.
- [ ] `apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts` - random delayed reopen and manual-open bypass.
- [ ] `apps/api/src/modules/ticket/qr-ticket.service.spec.ts` - QR JWT claims, ticket status checks, D-1 email enqueue.
- [ ] `apps/web/e2e/booking-queue.spec.ts` - queue position/ETA/auto-entry and localized failure states.
- [ ] `apps/web/components/booking/__tests__/floor-selector.test.tsx` - floor switching without selection loss.
- [ ] `apps/web/components/reservation/__tests__/refund-timeline.test.tsx` - refund timeline states and delayed-deposit CTA.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloudflare WAF custom/rate-limit rules | TRAF-02 | Cloudflare account plan and bot-score field availability must be confirmed in the actual account | Verify rule export/dashboard screenshots or API output show booking endpoint challenge/block/rate-limit rules and document the plan limitation if bot-score fields are unavailable |
| Cloud Scheduler prewarm runbook | TRAF-03 | The final production project/service names and IAM bindings are environment-specific | Run the documented prewarm smoke against staging/test service and capture authenticated scheduler/control-path evidence |
| Toss sandbox foreign wallet behavior | PAY-02 | Provider sandbox behavior can differ by Toss test account and wallet provider | Capture domestic card, overseas card, Alipay+, and TrueMoney test-key results or document provider-specific sandbox limitations |

---

## Validation Sign-Off

- [ ] All plans include automated verify commands or explicit Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing test references listed above.
- [ ] No watch-mode flags in verification commands.
- [ ] Feedback latency target is under 120 seconds for targeted checks.
- [ ] `nyquist_compliant: true` is set after Wave 0 tests exist and are referenced by plans.

**Approval:** pending
