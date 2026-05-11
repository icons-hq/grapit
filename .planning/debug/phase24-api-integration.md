---
status: diagnosed
trigger: "Phase 24 UAT gap diagnosis only. Do not edit source code. Diagnose API integration test failures after Docker starts."
created: 2026-05-10T08:24:50Z
updated: 2026-05-10T08:33:55Z
---

## Current Focus

hypothesis: Confirmed multiple independent causes: stale booking integration fixtures/mocks versus Phase 24 runtime behavior, plus a duplicate index definition across migrations.
test: Diagnosis complete.
expecting: No further tests needed for root-cause identification.
next_action: Report the confirmed causes with file references and fix direction.

## Symptoms

expected: API integration tests should pass against real Postgres and Valkey containers after Docker starts.
actual: `pnpm --filter @grabit/api test:integration` fails after Docker starts. BookingService real-Valkey and Valkey Cluster integration specs fail with `this.db.select(...).from(...).leftJoin is not a function`, lock ownership helpers report expired locks, and admin dashboard integration fails during fresh Drizzle migration because `idx_translation_drafts_one_published_per_source_locale` already exists.
errors: "`this.db.select(...).from(...).leftJoin is not a function`; lock ownership helpers reporting expired locks; `idx_translation_drafts_one_published_per_source_locale` already exists"
reproduction: Start Docker dependencies, then run `pnpm --filter @grabit/api test:integration`.
started: Phase 24 UAT gap observed after Docker-backed integration test run.

## Eliminated

## Evidence

- timestamp: 2026-05-10T08:29:30Z
  checked: apps/api/src/modules/booking/booking.service.ts
  found: `lockSeat()` now always calls `getMaxTicketsPerUser()`, and that query chain requires `.select().from().leftJoin().where()`.
  implication: Any integration mock DB that only implements `.select().from().where()` will now throw `leftJoin is not a function` before Redis lock creation.

- timestamp: 2026-05-10T08:29:30Z
  checked: apps/api/src/modules/booking/__tests__/booking.service.integration.spec.ts and apps/api/test/booking-cluster-lua.integration.spec.ts
  found: Both specs build `mockDb` without `leftJoin`, expect Redis lock keys like `{showtime}:seat:A-1`, and seed ownership-helper fixtures with raw `A-1` / `A-2` members.
  implication: The specs are stale against Phase 24 booking-policy lookup and floor-aware encoded runtime seat IDs.

- timestamp: 2026-05-10T08:29:30Z
  checked: apps/api/src/database/migrations/0007_phase23_launch_foundation.sql and 0012_phase24_booking_core.sql
  found: Both migrations create `idx_translation_drafts_one_published_per_source_locale`.
  implication: Fresh migrations will fail on 0012 with `already exists` once 0007 has run.

- timestamp: 2026-05-10T08:33:55Z
  checked: `pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts src/modules/booking/__tests__/booking.service.integration.spec.ts --reporter=verbose`
  found: Lock-path tests fail at `BookingService.getMaxTicketsPerUser` with `this.db.select(...).from(...).leftJoin is not a function`, while ownership-helper tests fail with `LOCK_EXPIRED_MESSAGE` instead of owner/other-owner outcomes.
  implication: The stale mock DB and stale lock-key fixtures are separate failures inside the same spec file.

- timestamp: 2026-05-10T08:33:55Z
  checked: `pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/booking-cluster-lua.integration.spec.ts --reporter=verbose`
  found: Cluster lock-path test fails with the same `leftJoin` error, and ownership-helper tests fail with expired-lock conflicts.
  implication: The same two booking-spec regressions also affect cluster-mode integration coverage.

- timestamp: 2026-05-10T08:33:55Z
  checked: `pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/admin-dashboard.integration.spec.ts --reporter=verbose`
  found: Drizzle migrate fails at `test/admin-dashboard.integration.spec.ts:65` when executing `CREATE UNIQUE INDEX "idx_translation_drafts_one_published_per_source_locale"...`, with Postgres error `relation "idx_translation_drafts_one_published_per_source_locale" already exists`.
  implication: The admin integration failure is an independent migration-definition bug, not a container/runtime issue.

## Resolution

root_cause:
  1. Booking integration specs still mock the DB as `.select().from().where()` even though `BookingService.lockSeat()` now calls `getMaxTicketsPerUser()` and requires `.leftJoin()` against `booking_policies`.
  2. Booking ownership-helper fixtures still seed pre-Phase-24 raw seat keys (`A-1`) even though Phase 24 normalizes unprefixed seats to floor-aware encoded runtime keys (`1F:A-1` -> `1F%3AA-1`).
  3. Migration `0012_phase24_booking_core.sql` recreates `idx_translation_drafts_one_published_per_source_locale`, which `0007_phase23_launch_foundation.sql` already created.
fix: Diagnose-only session; no code changes applied.
verification:
files_changed: []
