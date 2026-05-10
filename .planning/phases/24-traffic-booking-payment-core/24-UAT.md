---
status: diagnosed
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
updated: 2026-05-10T17:28:11+09:00
mode: automated
---

# Phase 24: Automated UAT

## Current Test

[testing complete]

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
result: issue
reported: "PORT=18080 NODE_ENV=development pnpm --filter @grabit/api start exits immediately with ReferenceError: Cannot access 'PaymentModule' before initialization from dist/modules/payment/payment.module.js via jobs.module.js and ticket.module.js."
severity: blocker
evidence:
  - command: PORT=18080 NODE_ENV=development pnpm --filter @grabit/api start
    result: FAIL, process exits before listening

### 8. API integration suite passes against real containers
expected: testcontainers-backed Postgres/Valkey integration tests pass for booking Lua locks, cluster behavior, SMS throttling, and admin dashboard DB migrations.
result: issue
reported: "After starting Docker Desktop, pnpm --filter @grabit/api test:integration fails: 11 booking Lua/Valkey tests fail, and admin dashboard integration fails during fresh Drizzle migration because idx_translation_drafts_one_published_per_source_locale already exists."
severity: blocker
evidence:
  - command: pnpm --filter @grabit/api test:integration
    result: FAIL, 3 failed files / 11 failed tests / 28 passed / 2 skipped
  - passing_slice: test/sms-throttle.integration.spec.ts and test/sms-cluster-crossslot.integration.spec.ts passed after Docker startup

### 9. Queue browser states render before booking entry
expected: Queue waiting, retry, challenge, and blocked states render distinct user-facing copy and safe metadata before entering booking.
result: issue
reported: "Playwright Phase 24 browser slice fails 1/9: queue waiting test strict locator resolves '현재 순번' in both the metric label and helper sentence, although the page snapshot shows the waiting surface, position 12, ETA 2m 45s, and remaining seats 24 rendered."
severity: minor
evidence:
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-queue.spec.ts e2e/booking-complete-qr.spec.ts e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: FAIL, 8 passed / 1 failed
  - failed_test: e2e/booking-queue.spec.ts queue waiting shows localized position and ETA before entering the booking screen

### 10. QR and payment recovery browser flows render
expected: Complete route shows QR follow-up and D-1 email notice, reservation detail shows QR ticket, and pending/failed/expired Toss recovery states render inline without accidental success confirmation.
result: pass
evidence:
  - command: pnpm --filter @grabit/web exec playwright test e2e/booking-complete-qr.spec.ts e2e/toss-payment-phase24.spec.ts --project=chromium --reporter=line
    result: Covered inside the Phase 24 browser slice; all 5 QR/payment-recovery tests passed

### 11. External Cloudflare, GCP Scheduler, and real Toss sandbox round trips are fully verified
expected: Cloudflare WAF/rate-limit/challenge/block rules, Cloud Scheduler prewarm, and Toss sandbox domestic/overseas/Alipay+/TrueMoney redirects/webhooks are verified against real third-party services.
result: blocked
blocked_by: third-party
reason: "Cloudflare zone/dashboard state, GCP Scheduler/OIDC deployment state, and Toss sandbox merchant redirect/webhook round trips require external account configuration that is not available from the local repository. Local runbooks, code paths, unit tests, and mocked browser recovery tests were exercised instead."

## Summary

total: 11
passed: 7
issues: 3
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "Starting the built API artifact boots the server and exposes the health endpoint."
  status: failed
  reason: "User reported: PORT=18080 NODE_ENV=development pnpm --filter @grabit/api start exits immediately with ReferenceError: Cannot access 'PaymentModule' before initialization from dist/modules/payment/payment.module.js via jobs.module.js and ticket.module.js."
  severity: blocker
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
  missing:
    - "Break JobsModule's direct dependency on PaymentModule, preferably by moving TossPaymentsClient into a leaf/shared TossPaymentsModule or by splitting the pg-boss provider into a module that TicketModule can import without importing workers."
    - "Rebuild and rerun `PORT=18080 NODE_ENV=development pnpm --filter @grabit/api start` to prove dist cold start reaches listen/health."
  debug_session: "not written"

- truth: "API integration tests pass against real Postgres and Valkey containers."
  status: failed
  reason: "User reported: pnpm --filter @grabit/api test:integration fails after Docker starts: BookingService real-Valkey integration specs are stale against floor-aware seatKey and bookingPolicy DB calls, and admin-dashboard fresh migration fails because 0012_phase24_booking_core.sql recreates idx_translation_drafts_one_published_per_source_locale from 0007."
  severity: blocker
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
  missing:
    - "Update booking integration DB stubs to support the current getMaxTicketsPerUser query or use a real seeded Drizzle path."
    - "Update Valkey integration fixture keys and expectations to use Phase 24 canonical runtime seat keys."
    - "Remove the duplicate translation_drafts partial index creation from migration 0012 or otherwise make the migration chain fresh-DB safe."
    - "Rerun `pnpm --filter @grabit/api test:integration` with Docker running."
  debug_session: ".planning/debug/phase24-api-integration.md"

- truth: "Phase 24 queue browser waiting-state test passes while verifying position, ETA, and remaining-seat copy."
  status: failed
  reason: "User reported: Playwright strict locator for '현재 순번' matches both the metric label and the helper sentence, causing 1 queue browser test failure even though the page snapshot shows the expected queue waiting UI."
  severity: minor
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
  missing:
    - "Scope metric assertions to the metric section/card or use exact/semantic locators for label-value tiles."
    - "Rerun the Phase 24 Playwright slice after selector repair."
  debug_session: ".planning/debug/phase24-queue-browser.md"
