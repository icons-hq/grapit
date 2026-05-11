---
phase: 24-traffic-booking-payment-core
plan: 18
subsystem: api
tags: [nestjs, pg-boss, bootstrap, module-graph, refund, qr]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: "plan 24-09 payment module wiring that imports TicketModule"
  - phase: 24-traffic-booking-payment-core
    provides: "plan 24-11 pg-boss workers and RefundService PG_BOSS usage"
  - phase: 24-traffic-booking-payment-core
    provides: "plan 24-13 QrTicketService PG_BOSS usage from TicketModule"
provides:
  - "Leaf PgbossModule exporting the shared PG_BOSS provider without worker registrations"
  - "dist cold-start that reaches /api/v1/health without the PaymentModule initialization ReferenceError"
  - "Verified PG_BOSS injection for QrTicketService and RefundService after module rewiring"
affects: [payment, refund, ticket, bootstrap]
tech-stack:
  added: []
  patterns:
    - "Provider-only leaf module for shared background queue dependencies"
    - "Worker bootstrap isolated from request-path module imports"
key-files:
  created:
    - apps/api/src/modules/jobs/pgboss.module.ts
  modified:
    - apps/api/src/modules/jobs/jobs.module.ts
    - apps/api/src/modules/ticket/ticket.module.ts
    - apps/api/src/modules/refund/refund.module.ts
key-decisions:
  - "TicketModule now resolves PG_BOSS through PgbossModule so PaymentModule no longer loads JobsModule during static bootstrap."
  - "JobsModule keeps worker registration plus PaymentModule access, while RefundModule resolves PG_BOSS directly from PgbossModule."
patterns-established:
  - "Modules that only need PG_BOSS should import PgbossModule rather than the worker registration module."
  - "Background worker registration can remain bootstrapped separately from request/response module wiring."
requirements-completed: [PAY-02, REFUND-01, REFUND-02, QR-01]
duration: 18min
completed: 2026-05-10
---

# Phase 24 Plan 18: Bootstrap Cycle Fix Summary

**Leaf `PG_BOSS` module extraction that removes the `PaymentModule -> TicketModule -> JobsModule -> PaymentModule` dist bootstrap cycle while keeping refund/QR services wired**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-10T08:34:00Z
- **Completed:** 2026-05-10T08:51:54Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added `PgbossModule` as a leaf Nest module that only provides and exports `PG_BOSS` through the existing `pgbossProvider`.
- Rewired `TicketModule` to import `PgbossModule` so the payment request path no longer pulls `JobsModule` into static bootstrap.
- Kept `JobsModule` focused on worker registration with its `PaymentModule` dependency, and verified both `QrTicketService` and `RefundService` still receive `PG_BOSS`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract a leaf PG_BOSS module and rewire the bootstrap graph** - `1117155` (`fix`)

## Files Created/Modified

- `apps/api/src/modules/jobs/pgboss.module.ts` - Exposes the shared `PG_BOSS` provider without worker registrations.
- `apps/api/src/modules/jobs/jobs.module.ts` - Imports `PgbossModule` and keeps only worker bootstrap providers on the jobs side.
- `apps/api/src/modules/ticket/ticket.module.ts` - Switches QR ticket wiring from `JobsModule` to `PgbossModule`.
- `apps/api/src/modules/refund/refund.module.ts` - Resolves `RefundService` through `PgbossModule` while preserving worker bootstrap.

## Decisions Made

- Kept the fix at the Nest module graph layer only; Toss request/response handling, refund state transitions, and QR issuance semantics were not redesigned.
- Preferred a provider-only leaf module over `forwardRef()` or broader bootstrap rewrites so the CommonJS init cycle disappears in `dist`, not just in dev transpilation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved worker bootstrap inside `RefundModule` while rewiring provider resolution**
- **Found during:** Task 1
- **Issue:** Removing `JobsModule` entirely from `RefundModule` would have orphaned `RefundCancelRetryWorker` and `CancelledSeatReleaseWorker` bootstrap unless `AppModule` was edited outside the owned write scope.
- **Fix:** `RefundModule` now imports `PgbossModule` for `RefundService` injection and keeps `JobsModule` only for worker registration, so the cycle is removed without an off-scope bootstrap edit.
- **Files modified:** `apps/api/src/modules/refund/refund.module.ts`, `apps/api/src/modules/jobs/jobs.module.ts`
- **Verification:** `pnpm --filter @grabit/api build`, dist health smoke on `PORT=18080`, package-context Nest application-context DI smoke
- **Committed in:** `1117155`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation stayed inside the owned files, preserved worker runtime behavior, and still removed the failing static bootstrap path.

## Known Stubs

None.

## Issues Encountered

- The first health-smoke rerun used `status` as a temporary zsh variable name, which is read-only in this shell. The command was rerun with `rc` and passed.
- Another executor advanced the shared phase branch after the task commit. The task commit `1117155` remained intact and the summary was prepared on top of the newer HEAD without reverting any concurrent work.

## User Setup Required

None - no external dashboard, secret, or infrastructure change was required for this bootstrap fix.

## Next Phase Readiness

- The built API artifact now stays up long enough for `curl http://127.0.0.1:18080/api/v1/health` to pass, so later verification can use the real `dist` startup path.
- `QrTicketService` and `RefundService` retain `PG_BOSS` access after the rewire, and `JobsModule` still owns refund/seat-release worker bootstrap.

## Self-Check: PASSED

- Verified `.planning/phases/24-traffic-booking-payment-core/24-18-SUMMARY.md` exists.
- Verified task commit `1117155` exists in git history.
