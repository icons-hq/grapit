---
status: passed
phase: 24-traffic-booking-payment-core
source:
  - 24-01-SUMMARY.md
  - 24-02-SUMMARY.md
  - 24-03-SUMMARY.md
  - 24-04-SUMMARY.md
  - 24-05-SUMMARY.md
  - 24-06-SUMMARY.md
  - 24-07-SUMMARY.md
  - 24-08-SUMMARY.md
  - 24-09-SUMMARY.md
  - 24-10-SUMMARY.md
  - 24-11-SUMMARY.md
  - 24-12-SUMMARY.md
  - 24-13-SUMMARY.md
  - 24-14-SUMMARY.md
  - 24-15-SUMMARY.md
  - 24-16-SUMMARY.md
  - 24-17-SUMMARY.md
  - 24-VERIFICATION.md
  - 24-HUMAN-UAT.md
started: 2026-05-10T17:18:04+09:00
updated: 2026-05-11T12:57:25+09:00
mode: automated
---

# Phase 24: Automated UAT

## Current Test

[testing complete after gap closure]

## Tests

### 1. Shared booking/performance contracts compile and validate
expected: Queue admission, floor-aware seats, payment deadline, refund timeline, cancelled-seat hold, QR ticket, seatMaps, and bookingPolicy contracts validate through shared package tests.
result: pass
evidence:
  - command: pnpm --filter @grabit/shared test
    result: PASS, 7 files / 37 tests

### 2. API and web TypeScript contracts compile
expected: API and web code typecheck against the Phase 24 floor-aware booking/payment/refund/QR contract without type errors.
result: pass
evidence:
  - command: pnpm --filter @grabit/api typecheck
    result: PASS
  - command: pnpm --filter @grabit/web typecheck
    result: PASS

### 3. API unit behavior remains green
expected: Queue, booking, reservation, payment webhook/idempotency, refund, jobs, traffic-defense, prewarm, and QR unit tests pass.
result: pass
evidence:
  - command: pnpm --filter @grabit/api test
    result: PASS, 53 files / 582 tests

### 4. Web unit/component behavior remains green
expected: Booking UI, queue hooks, floor selector, Toss recovery helpers, QR/refund surfaces, admin floor editor, and visible copy tests pass.
result: pass
evidence:
  - command: pnpm --filter @grabit/web test
    result: PASS, 55 files / 348 tests
notes:
  - jsdom emitted non-fatal act/window API warnings in existing tests.

### 5. Production build artifacts compile
expected: Root production build succeeds for shared, API, and web packages.
result: pass
evidence:
  - command: pnpm build
    result: PASS, 3 packages built from turbo cache with API TSC 0 issues and Next.js production routes generated

### 6. Lint has no blocking errors
expected: API and web lint produce no errors that block verification.
result: pass
evidence:
  - command: pnpm --filter @grabit/api lint
    result: PASS with 43 warnings
  - command: pnpm --filter @grabit/web lint
    result: PASS with 33 warnings
notes:
  - Web warnings include Phase 24 touch surfaces such as booking-page, svg-preview, use-booking, and countdown-timer React Compiler warnings.

### 7. API production cold start boots from dist
expected: Starting `node dist/main.js` after build boots the API server and exposes `/api/v1/health`.
result: pass
resolved_at: 2026-05-10T17:51:54+09:00
reported: "Initial dist cold start failed with ReferenceError: Cannot access 'PaymentModule' before initialization."
resolution: "Plan 24-18 extracted `PgbossModule` and removed the PaymentModule -> TicketModule -> JobsModule -> PaymentModule static bootstrap cycle."
evidence:
  - command: PORT=18080 NODE_ENV=development pnpm --filter @grabit/api start
    result: PASS after Plan 24-18; dist health smoke reached `/api/v1/health`

### 8. API integration suite passes against real containers
expected: testcontainers-backed Postgres/Valkey integration tests pass for booking Lua locks, cluster behavior, SMS throttling, and admin dashboard DB migrations.
result: pass
resolved_at: 2026-05-10T17:52:39+09:00
reported: "Initial Docker-backed integration run failed in booking Valkey specs and fresh migration replay."
resolution: "Plan 24-19 refreshed floor-aware booking integration fixtures, aligned encoded Redis seat keys, and removed the duplicate translation draft index from migration 0012."
evidence:
  - command: pnpm --filter @grabit/api test:integration
    result: PASS after Plan 24-19, 5 files / 41 tests
  - command: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts src/modules/booking/__tests__/booking.service.integration.spec.ts test/booking-cluster-lua.integration.spec.ts
    result: PASS, 2 files / 16 tests

### 9. Queue browser states render before booking entry
expected: Queue waiting, retry, challenge, and blocked states render distinct user-facing copy and safe metadata before entering booking.
result: pass
resolved_at: 2026-05-10T17:50:32+09:00
reported: "Initial Playwright queue waiting test had a strict locator collision on repeated localized copy."
resolution: "Plan 24-20 added stable queue metric selectors and scoped the browser assertions to metric tiles."
evidence:
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-queue.spec.ts e2e/booking-complete-qr.spec.ts e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: PASS after Plan 24-20 for queue waiting slice; later Phase 24 browser recovery and QR slices stayed green
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-queue.spec.ts --project=chromium --reporter=line
    result: PASS, 4 tests

### 10. QR and payment recovery browser flows render
expected: Complete route shows QR follow-up and D-1 email notice, reservation detail shows QR ticket, and pending/failed/expired Toss recovery states render inline without accidental success confirmation.
result: pass
evidence:
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-complete-qr.spec.ts e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: Covered inside the Phase 24 browser slice; all 5 QR/payment-recovery tests passed

### 11. External Cloudflare, GCP Scheduler, and real Toss sandbox round trips are fully verified
expected: Cloudflare WAF/rate-limit/challenge/block rules, Cloud Scheduler prewarm, and Toss sandbox domestic/overseas/Alipay+/TrueMoney redirects/webhooks are verified against real third-party services.
result: pass
resolved_at: 2026-05-11T12:57:25+09:00
reason: "Cloudflare activation, GCP Scheduler/OIDC prewarm, Toss sandbox webhook activation, and domestic/overseas/Alipay+/TrueMoney method-matrix evidence were completed through external account/browser/CLI verification and recorded in 24-HUMAN-UAT.md, 24-VERIFICATION.md, and docs/runbooks/phase24-external-activation-checklist.md."

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Starting the built API artifact boots the server and exposes the health endpoint."
  status: resolved
  reason: "Plan 24-18 extracted `PgbossModule`, removed the static module cycle, and verified dist health smoke."
  severity: resolved
  test: 7
  root_cause: "Static Nest module cycle: PaymentModule imports TicketModule, TicketModule imports JobsModule, and JobsModule imports PaymentModule. Built CommonJS metadata evaluation reaches jobs.module.js before PaymentModule initialization completes, causing the dist cold start ReferenceError."
  artifacts:
    - path: "apps/api/src/modules/payment/payment.module.ts"
      issue: "Imports TicketModule, starting the Payment -> Ticket -> Jobs -> Payment cycle."
    - path: "apps/api/src/modules/ticket/ticket.module.ts"
      issue: "Imports JobsModule only to provide PG_BOSS to QrTicketService."
    - path: "apps/api/src/modules/jobs/jobs.module.ts"
      issue: "Imports PaymentModule for TossPaymentsClient used by RefundCancelRetryWorker, completing the module cycle."
    - path: "apps/api/src/modules/jobs/refund-cancel-retry.worker.ts"
      issue: "Depends on TossPaymentsClient, which currently comes only through PaymentModule."
  resolved_with:
    - "24-18-SUMMARY.md"
    - "Commit `1117155`"
  debug_session: "not written"

- truth: "API integration tests pass against real Postgres and Valkey containers."
  status: resolved
  reason: "Plan 24-19 refreshed floor-aware integration fixtures and made the migration chain fresh-DB safe."
  severity: resolved
  test: 8
  root_cause: "Multiple independent integration regressions: BookingService integration specs have stale DB mocks without leftJoin after getMaxTicketsPerUser was added, booking ownership fixtures still seed pre-Phase-24 raw Redis seat keys instead of encoded floor-aware runtime keys, and migration 0012 recreates a translation_drafts partial unique index already created by migration 0007."
  artifacts:
    - path: "apps/api/src/modules/booking/booking.service.ts"
      issue: "lockSeat now calls getMaxTicketsPerUser(), whose Drizzle query requires select().from().leftJoin().where(); seat IDs are normalized to floor-aware encoded runtime keys such as 1F%3AA-1."
    - path: "apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts"
      issue: "mockDb only implements select().from().where(), and ownership fixtures seed raw A-1/A-2 lock keys."
    - path: "apps/api/test/booking-cluster-lua.integration.spec.ts"
      issue: "Same stale mockDb and raw lock-key fixture assumptions in cluster-mode coverage."
    - path: "apps/api/src/database/migrations/0007_phase23_launch_foundation.sql"
      issue: "Creates idx_translation_drafts_one_published_per_source_locale."
    - path: "apps/api/src/database/migrations/0012_phase24_booking_core.sql"
      issue: "Creates idx_translation_drafts_one_published_per_source_locale again, breaking fresh migration."
  resolved_with:
    - "24-19-SUMMARY.md"
    - "Commits `3dbfbdb` and `f4e904c`"
  debug_session: ".planning/debug/phase24-api-integration.md"

- truth: "Phase 24 queue browser waiting-state test passes while verifying position, ETA, and remaining-seat copy."
  status: resolved
  reason: "Plan 24-20 added metric tile selectors and strict-safe Playwright assertions."
  severity: resolved
  test: 9
  root_cause: "The queue waiting Playwright test uses broad page-level getByText assertions for localized metric labels. The waiting helper copy repeats the same substrings, so strict mode matches both the metric label and helper paragraph although the UI snapshot is correct."
  artifacts:
    - path: "apps/web/e2e/booking-queue.spec.ts"
      issue: "Uses unscoped `page.getByText(koMessages.booking.queue.metrics.position)` for metric labels."
    - path: "apps/web/components/booking/queue-waiting.tsx"
      issue: "Renders metric labels and helper copy on the same screen."
    - path: "apps/web/messages/ko.json"
      issue: "waiting helper includes `현재 순번` and `예상 대기`, colliding with metric labels."
    - path: "apps/web/test-results/booking-queue-booking-queu-59c97-entering-the-booking-screen-chromium/error-context.md"
      issue: "Shows strict locator violation and both matching elements."
  resolved_with:
    - "24-20-SUMMARY.md"
    - "Commit `b18462e`"
  debug_session: ".planning/debug/phase24-queue-browser.md"
