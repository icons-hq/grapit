---
phase: 24-traffic-booking-payment-core
plan: "04"
subsystem: api
tags: [queue, admission, redis, socket.io, booking, reservation]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: migrated booking-core schema and booking-disabled mutation gates from 24-03
provides:
  - cookie-only queue admission service with waiting/admitted/expired state snapshots
  - server-side AdmissionGuard enforcement on lock, prepare, and confirm mutation paths
  - sorted-set parity in local InMemoryRedis for queue runtime testing and dev fallback
affects: [24-05, 24-07, 24-08, 24-09, booking, queue]
tech-stack:
  added: []
  patterns:
    - Valkey sorted-set queue sessions keyed by performance with separate identity/session/token refs
    - cookie-only admission enforcement through guard-attached queue context instead of trusting request bodies
    - dev fallback Redis mocks must grow with new booking-runtime Redis primitives
key-files:
  created:
    - apps/api/src/modules/queue/queue.module.ts
    - apps/api/src/modules/queue/queue.controller.ts
    - apps/api/src/modules/queue/queue.gateway.ts
    - apps/api/src/modules/queue/queue.service.ts
    - apps/api/src/modules/queue/queue.service.spec.ts
    - apps/api/src/modules/queue/queue.guard.spec.ts
    - apps/api/src/modules/queue/guards/admission.guard.ts
  modified:
    - apps/api/src/app.module.ts
    - apps/api/src/modules/booking/booking.controller.ts
    - apps/api/src/modules/reservation/reservation.controller.ts
    - apps/api/src/modules/traffic/traffic-defense.service.ts
    - apps/api/src/modules/booking/providers/redis.provider.ts
    - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
key-decisions:
  - "Queue admission identity reuses the Phase 23 refresh-token family as the device slot, so admission binding stays aligned with the three-device session policy."
  - "The raw admission token is rotated server-side and transported only through the `grabit_queue_admission` cookie; controllers do not return the opaque token in JSON."
  - "QueueModule is registered globally and imported once by AppModule so existing booking/reservation modules can consume AdmissionGuard without extra module rewiring."
patterns-established:
  - "Queue runtime state uses Redis identity keys, session refs, token refs, a waiting ZSET, and an active-admissions SET per performance."
  - "When legacy request bodies still mirror queueAdmission fields, the guard/controller layer should reconstruct authoritative admission context from cookies and mask token echoes."
  - "If a new booking-runtime feature depends on Redis sorted-set semantics, InMemoryRedis parity must be extended in the same change."
requirements-completed: [TRAF-01]
duration: 14m 40s
completed: 2026-05-08
---

# Phase 24 Plan 04: Traffic + Booking + Payment Core Summary

**Queue entry, realtime waiting-state snapshots, and cookie-only admission enforcement now gate every scarce-seat mutation path on the API boundary.**

## Performance

- **Duration:** 14m 40s
- **Started:** 2026-05-08T15:51:53+09:00
- **Completed:** 2026-05-08T16:06:33+09:00
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added `QueueModule` with `POST /api/v1/queue/performances/:performanceId/enter`, `GET /api/v1/queue/sessions/:queueSessionId`, queue session reuse, and `/queue` Socket.IO realtime events.
- Bound admission sessions to `userId + refreshTokenFamilyId + deviceSlotId + queueSessionId`, with explicit `WAITING`, `ADMITTED`, `PAYMENT_RECOVERY`, and `EXPIRED` server states.
- Enforced admission on `lockSeat`, `prepareReservation`, and `confirmPayment` via `AdmissionGuard`, keeping the opaque token cookie-only and reconstructing trusted queue context server-side.
- Extended local `InMemoryRedis` with sorted-set operations so queue behavior works without a production Valkey connection during dev/test fallback.

## Task Commits

1. **Task 1 RED: queue admission contract tests** - `c8243f6` (`test`)
2. **Task 1 GREEN: queue admission service/runtime** - `9ea15f4` (`feat`)
3. **Task 2 RED: admission guard tests** - `913d7ec` (`test`)
4. **Task 2 GREEN: booking mutation admission enforcement** - `9fa7e3f` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/queue/queue.service.ts` - Redis-backed queue session lifecycle, admission validation, waiting/admitted/expired reconciliation, and remaining-seat snapshots.
- `apps/api/src/modules/queue/queue.controller.ts` - Queue entry/status HTTP API and `grabit_queue_admission` cookie handling.
- `apps/api/src/modules/queue/queue.gateway.ts` - `/queue` namespace with `queue:position`, `queue:admitted`, and `queue:expired` events.
- `apps/api/src/modules/queue/queue.module.ts` - Global queue runtime module exporting service/gateway/guard.
- `apps/api/src/modules/queue/queue.service.spec.ts` - TDD coverage for queue session creation/reuse plus transport/runtime source contracts.
- `apps/api/src/modules/queue/queue.guard.spec.ts` - TDD coverage for cookie-only admission enforcement and controller wiring.
- `apps/api/src/modules/queue/guards/admission.guard.ts` - Guard that validates cookie-backed queue admission against showtime/order binding.
- `apps/api/src/modules/booking/booking.controller.ts` - Applies `AdmissionGuard` to `lockSeat`.
- `apps/api/src/modules/reservation/reservation.controller.ts` - Applies `AdmissionGuard` to `prepareReservation` and `confirmPayment`, overrides untrusted body queueAdmission, and masks admission token echoes.
- `apps/api/src/app.module.ts` - Wires `QueueModule` into the API runtime.
- `apps/api/src/modules/traffic/traffic-defense.service.ts` - Extends the named `queue-entry` throttler matcher to the real queue enter route.
- `apps/api/src/modules/booking/providers/redis.provider.ts` - Adds `zadd`, `zrange`, `zrank`, `zrem`, and `zcard` to `InMemoryRedis`.
- `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` - Covers sorted-set parity needed by the new queue runtime.

## Decisions Made

- Reused refresh-token family as `deviceSlotId` instead of inventing a second browser fingerprint contract, because Phase 23 already defined family as the device slot.
- Treated client-supplied `queueAdmission` bodies as transitional mirrors, not an authority source; the guard now rebuilds the authoritative context from cookies and server-side validation.
- Masked `prepareReservation` admission token echoes with `cookie-bound` so the transport stays cookie-only while current shared contracts still require a non-empty string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired QueueModule into AppModule and aligned queue-entry throttling with the real route**
- **Found during:** Task 1
- **Issue:** The plan file list did not include runtime module registration or the existing traffic matcher update, so the new queue endpoints would either be unreachable or miss the named `queue-entry` throttler policy.
- **Fix:** Imported `QueueModule` in `AppModule` and extended `TrafficDefenseService` to match `POST /queue/performances/:performanceId/enter`.
- **Files modified:** `apps/api/src/app.module.ts`, `apps/api/src/modules/traffic/traffic-defense.service.ts`
- **Verification:** `pnpm --filter @grabit/api typecheck`, `pnpm --filter @grabit/api test -- src/modules/queue/queue.service.spec.ts`
- **Committed in:** `9ea15f4`

**2. [Rule 3 - Blocking] Extended InMemoryRedis with sorted-set queue primitives**
- **Found during:** Task 1
- **Issue:** The new queue runtime depends on `zadd`, `zrange`, `zrank`, `zrem`, and `zcard`, but the repo's local/dev `InMemoryRedis` fallback only covered string/set/Lua operations.
- **Fix:** Added the required sorted-set operations and a focused parity test so queue APIs work without REDIS_URL in development/test fallback.
- **Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts`, `pnpm --filter @grabit/api typecheck`
- **Committed in:** `9ea15f4`

**3. [Rule 2 - Missing Critical] Reconstructed prepareReservation queue context from guard state and masked token echoes**
- **Found during:** Task 2
- **Issue:** The shared booking request/response contract still mirrors `queueAdmission` in JSON, which would have forced a JS-readable admission token and violated the cookie-only transport requirement.
- **Fix:** Added `AdmissionGuard`, relaxed the transport input schema for `prepareReservation`, overwrote body queue data with guard-attached server context, and masked response echoes as `cookie-bound`.
- **Files modified:** `apps/api/src/modules/queue/guards/admission.guard.ts`, `apps/api/src/modules/queue/queue.module.ts`, `apps/api/src/modules/booking/booking.controller.ts`, `apps/api/src/modules/reservation/reservation.controller.ts`
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.guard.spec.ts src/modules/queue/queue.service.spec.ts`, `pnpm --filter @grabit/api test -- src/modules/queue/queue.guard.spec.ts`, `pnpm --filter @grabit/api typecheck`
- **Committed in:** `9fa7e3f`

---

**Total deviations:** 3 auto-fixed (Rule 2: 2, Rule 3: 1)
**Impact on plan:** All deviations were required to make the queue runtime reachable, locally executable, and consistent with the cookie-only admission policy. No architectural scope change was introduced.

## Issues Encountered

- Task 2 wiring was initially drafted too early while Task 1 GREEN was still in progress, which would have broken the RED/GREEN boundary. The uncommitted guard/controller edits were removed before the Task 1 commit so Task 2 could keep a real failing RED phase.
- `pnpm --filter @grabit/api test -- <file>` still expands to the full API suite in this repo, so exact plan verification was validated as a full-suite pass rather than a single-file run.

## Known Stubs

- `apps/api/src/modules/reservation/reservation.controller.ts:73` uses the literal `cookie-bound` when echoing `queueAdmission.admissionToken`.
  Reason: intentional masking placeholder to keep the opaque token cookie-only until the shared/web transport contract stops requiring a non-empty token string in JSON.

## Threat Flags

None - the new queue HTTP/socket surfaces and admission guard stay inside the plan's queue/admission threat model and implement the required identity/time-window mitigations.

## User Setup Required

None - no new external services or secrets were introduced.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.service.spec.ts src/modules/booking/providers/__tests__/redis.provider.spec.ts` - PASS
- `pnpm --filter @grabit/api exec vitest run src/modules/queue/queue.guard.spec.ts src/modules/queue/queue.service.spec.ts` - PASS
- `pnpm --filter @grabit/api typecheck` - PASS
- `pnpm --filter @grabit/api test -- src/modules/queue/queue.service.spec.ts` - PASS (full API suite, 534 tests)
- `pnpm --filter @grabit/api test -- src/modules/queue/queue.guard.spec.ts` - PASS (full API suite, 538 tests)
- `rg -n "queue/performances/:performanceId/enter|httpOnly: true|sameSite: 'lax'|path: '/api/v1'|maxAge: 780000|queue:position|queue:admitted|queue:expired|WAITING|ADMITTED|EXPIRED|QUEUE_ACTIVE_WINDOW_SECONDS = 600|QUEUE_REENTRY_GRACE_SECONDS = 180|grabit_queue_admission|AdmissionGuard" apps/api/src/modules/queue apps/api/src/modules/booking/booking.controller.ts apps/api/src/modules/reservation/reservation.controller.ts` - PASS

## TDD Gate Compliance

- RED commit exists for Task 1: `c8243f6`
- GREEN commit exists after Task 1 RED: `9ea15f4`
- RED commit exists for Task 2: `913d7ec`
- GREEN commit exists after Task 2 RED: `9fa7e3f`
- Refactor commit: Not needed

## Next Phase Readiness

- Downstream web booking work can now call `/api/v1/queue/performances/:performanceId/enter`, subscribe to `/queue`, and poll `/api/v1/queue/sessions/:queueSessionId` for transparent waiting-state UX.
- Booking mutation APIs now assume the browser entered the queue first; the legacy confirm page's placeholder `queueAdmission` payload is no longer authoritative.
- Later queue/web contract cleanup should remove the transitional JSON token placeholder once shared types stop requiring `queueAdmission.admissionToken` in request/response bodies.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-04-SUMMARY.md`.
- Verified task commits `c8243f6`, `9ea15f4`, `913d7ec`, and `9fa7e3f` exist in git history.
