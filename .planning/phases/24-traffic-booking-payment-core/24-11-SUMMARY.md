---
phase: 24-traffic-booking-payment-core
plan: 11
subsystem: api
tags: [nestjs, drizzle, pg-boss, refund, toss-payments, jobs]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: plan 24-03 seat inventory hold fields and floor-aware booking policy data
  - phase: 24-traffic-booking-payment-core
    provides: plan 24-09 refund/queue shared booking contracts and schema migrations
provides:
  - refund preview and visible refund state-machine orchestration
  - transient Toss cancel retry jobs via pg-boss
  - delayed cancelled-seat reopen worker with imminent-showtime guard
affects: [phase-24 web refund timeline, phase-25 operator tooling, reservation cancellation cutover]
tech-stack:
  added: [pg-boss]
  patterns:
    - explicit refund state machine with retryable sent_to_pg state
    - held_cancelled seat reopening only through delayed background jobs
key-files:
  created:
    - apps/api/src/modules/refund/refund.module.ts
    - apps/api/src/modules/refund/refund.controller.ts
    - apps/api/src/modules/refund/refund.service.ts
    - apps/api/src/modules/refund/refund.service.spec.ts
    - apps/api/src/modules/jobs/jobs.module.ts
    - apps/api/src/modules/jobs/pgboss.provider.ts
    - apps/api/src/modules/jobs/cancelled-seat-release.worker.ts
    - apps/api/src/modules/jobs/cancelled-seat-release.worker.spec.ts
    - apps/api/src/modules/jobs/refund-cancel-retry.worker.ts
    - apps/api/src/modules/jobs/refund-cancel-retry.worker.spec.ts
  modified:
    - apps/api/package.json
    - pnpm-lock.yaml
    - apps/api/src/app.module.ts
key-decisions:
  - "Transient Toss cancel failures remain in sent_to_pg and enqueue refund-cancel-retry instead of collapsing straight to failed."
  - "Successful user refund completion moves seats into held_cancelled with a randomized pg-boss reopen job and a SHOWTIME_IMMINENT skip reason."
  - "RefundModule is mounted through AppModule so refund routes and worker registration are active at bootstrap."
patterns-established:
  - "Refund timeline mapping uses requested -> sent_to_pg -> processing_at_pg -> completed|failed as the durable source of truth."
  - "Seat reopen jobs persist releaseAt on seat_inventories before enqueue and replace the placeholder reopenJobId after job creation."
requirements-completed: [REFUND-01, REFUND-02]
duration: 3 min
completed: 2026-05-08
---

# Phase 24 Plan 11: Refund State and Delayed Reopen Summary

**Refund preview/request endpoints with durable requested→sent_to_pg→processing_at_pg→completed/failed transitions and pg-boss-backed cancelled-seat reopen/retry workers**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-08T17:29:13+09:00
- **Completed:** 2026-05-08T17:31:50+09:00
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added `RefundService` plus `refund-preview` / `refund` endpoints so refund state is persisted and queryable instead of inferred from reservation cancellation side effects.
- Added `pg-boss` provider, `refund-cancel-retry` worker, and `release-cancelled-seat` worker for transient PG retry and delayed seat reopen behavior.
- Added an imminent-showtime guard so held cancelled seats stay unavailable when the reopen time lands within 5 minutes of `showtimeAt`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build refund preview and refund state-machine orchestration**
   - `55c5a0d` (`test`)
   - `a706503` (`feat`)
2. **Task 2: Add pg-boss delayed reopen infrastructure for held-cancelled seats**
   - `74ff6d4` (`test`)
   - `1354721` (`feat`)

**Additional fix:** `35f1ac7` (`fix`) wires `RefundModule` into `AppModule` so the new routes/workers are actually bootstrapped.

## Files Created/Modified

- `apps/api/src/modules/refund/refund.service.ts` - Refund preview/read model, idempotent refund request orchestration, Toss cancel retry scheduling, held-cancelled seat transition.
- `apps/api/src/modules/refund/refund.controller.ts` - Authenticated `GET /reservations/:id/refund-preview` and `POST /reservations/:id/refund` endpoints.
- `apps/api/src/modules/jobs/pgboss.provider.ts` - Lazy pg-boss provider with explicit unavailable fallback and shared job payload contracts.
- `apps/api/src/modules/jobs/cancelled-seat-release.worker.ts` - Delayed reopen worker with random 60-600 second release window and `SHOWTIME_IMMINENT` preservation path.
- `apps/api/src/modules/jobs/refund-cancel-retry.worker.ts` - Durable retry worker for transient Toss cancel failures and non-terminal PG processing states.
- `apps/api/package.json` / `pnpm-lock.yaml` - Added `pg-boss` dependency required for real background job execution.
- `apps/api/src/app.module.ts` - Mounted `RefundModule` so the new controller and workers load at startup.

## Decisions Made

- Transient Toss cancel errors are treated as retryable infrastructure/provider failures and keep the refund in `sent_to_pg` with recorded error metadata.
- Seats are not reopened at refund-complete time; they are moved to `held_cancelled` first and only reopened by the delayed worker.
- The reopen worker preserves `held_cancelled` with `SHOWTIME_IMMINENT` when the scheduled release is too close to showtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing `pg-boss` dependency**
- **Found during:** Task 2
- **Issue:** The plan required pg-boss-backed jobs, but `@grabit/api` did not depend on `pg-boss`, so the provider could not initialize a real worker runtime.
- **Fix:** Added `pg-boss@12.18.2` to `apps/api/package.json` and refreshed `pnpm-lock.yaml`.
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @grabit/api typecheck`
- **Committed in:** `1354721`

**2. [Rule 3 - Blocking] Bootstrapped `RefundModule` outside the original write scope**
- **Found during:** Post-task runtime review
- **Issue:** The new refund controller/workers would remain inert unless `RefundModule` was imported by `AppModule`.
- **Fix:** Added `RefundModule` to `apps/api/src/app.module.ts`.
- **Files modified:** `apps/api/src/app.module.ts`
- **Verification:** `pnpm --filter @grabit/api typecheck`
- **Committed in:** `35f1ac7`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both deviations were required for runtime viability. No unrelated scope was edited.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: endpoint | `apps/api/src/modules/refund/refund.controller.ts` | Adds authenticated refund preview/request endpoints that mutate financial state and rely on idempotent refund orchestration. |

## Issues Encountered

- `vitest run -- <path>` under the current API config still collects the broader suite, so targeted verification includes unrelated passing test noise. The plan-targeted specs still passed and were used as the acceptance signal.

## User Setup Required

None - no external dashboard or secret setup was added by this plan.

## Next Phase Readiness

- Web refund timeline work can bind directly to `GET /reservations/:id/refund-preview` and `POST /reservations/:id/refund`.
- `pg-boss` workers are bootstrapped through `RefundModule` and `AppModule`.
- Legacy `ReservationController.cancelReservation()` still exists outside this plan's write scope. End-to-end D-17 enforcement requires callers to cut over from the old immediate-reopen path to the new refund flow.

## Self-Check: PASSED

- Verified `.planning/phases/24-traffic-booking-payment-core/24-11-SUMMARY.md` exists.
- Verified task/fix commits `55c5a0d`, `a706503`, `74ff6d4`, `1354721`, and `35f1ac7` exist in git history.
