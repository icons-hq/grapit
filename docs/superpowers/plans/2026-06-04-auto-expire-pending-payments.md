# Auto Expire Pending Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically expire stale `PENDING_PAYMENT` reservations after `payment_deadline_at` passes.

**Architecture:** Add a NestJS background worker that periodically updates expired pending reservations to `FAILED` and releases their Redis seat locks through `BookingService.unlockAllSeats`. Reuse the existing Drizzle schema and booking service patterns; no database migration is needed because `reservations.payment_deadline_at` and its index already exist.

**Tech Stack:** NestJS 11, Drizzle ORM, PostgreSQL, Vitest, existing `JobsModule`.

---

### Task 1: Pending Payment Expiration Worker

**Files:**
- Create: `apps/api/src/modules/jobs/pending-payment-expiration.worker.ts`
- Create: `apps/api/src/modules/jobs/pending-payment-expiration.worker.spec.ts`
- Modify: `apps/api/src/modules/jobs/jobs.module.ts`

- [ ] **Step 1: Write the failing worker test**

Create `apps/api/src/modules/jobs/pending-payment-expiration.worker.spec.ts` with tests that instantiate the worker against a small Drizzle-like mock. Cover:
- expired `PENDING_PAYMENT` rows are updated to `FAILED`,
- matching Redis seat locks are released through `BookingService.unlockAllSeats`,
- async handoff payments with `IN_PROGRESS` or `DONE` are excluded by the sweep query,
- non-expired rows are ignored,
- worker registers an interval on module init and clears it on destroy.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @grabit/api exec vitest run src/modules/jobs/pending-payment-expiration.worker.spec.ts
```

Expected: FAIL because `pending-payment-expiration.worker.ts` does not exist.

- [ ] **Step 3: Implement minimal worker**

Create `PendingPaymentExpirationWorker` with:
- constructor dependencies `DRIZZLE`, `BookingService`, and optional `ConfigService`,
- `onModuleInit()` starting one interval when `PENDING_PAYMENT_EXPIRATION_SWEEP_INTERVAL_MS` is positive or defaulting to 60 seconds,
- `onModuleDestroy()` clearing the interval,
- public `sweepExpiredPendingPayments(now = new Date())`,
- one atomic SQL update that marks expired `PENDING_PAYMENT` reservations as `FAILED`, excludes existing `IN_PROGRESS`/`DONE` payments, and calls `BookingService.unlockAllSeats` for each expired reservation.

- [ ] **Step 4: Register worker**

Add `PendingPaymentExpirationWorker` to `JobsModule.providers` and `JobsModule.exports`.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
pnpm --filter @grabit/api exec vitest run src/modules/jobs/pending-payment-expiration.worker.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run adjacent regression tests**

Run:

```bash
pnpm --filter @grabit/api exec vitest run src/modules/reservation/reservation.service.spec.ts src/modules/payment/payment.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/jobs/pending-payment-expiration.worker.ts apps/api/src/modules/jobs/pending-payment-expiration.worker.spec.ts apps/api/src/modules/jobs/jobs.module.ts docs/superpowers/plans/2026-06-04-auto-expire-pending-payments.md
git commit -m "feat: auto-expire pending payments"
```
