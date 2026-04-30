---
phase: 20-valkey-production-connectivity-contract
plan: 03
subsystem: api-testing
tags: [valkey, cluster, booking, lua, integration-test, testcontainers, crossslot]

requires:
  - phase: 20-valkey-production-connectivity-contract
    provides: VALKEY_MODE cluster client contract from Plan 20-01
  - phase: 14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag
    provides: single-node Valkey Cluster testcontainers bootstrap pattern
  - phase: 19-seat-lock-ownership-enforcement
    provides: BookingService assertOwnedSeatLocks and consumeOwnedSeatLocks semantics
provides:
  - Booking Lua cluster-mode integration guard
  - CROSSSLOT negative guard for legacy booking keys without shared showtime hash tag
  - CLUSTER KEYSLOT proof for booking {showtimeId} hash-tag keys
affects: [VALK-03, SC-2, SC-3, booking-locks, phase-20]

tech-stack:
  added: []
  patterns:
    - "Single-node valkey/valkey:8 Cluster bootstrap with CONFIG SET cluster-announce-ip/port, CLUSTER ADDSLOTSRANGE, dynamic natMap"
    - "BookingService cluster tests call public lock/status/unlock and ownership helper APIs without copying production Lua scripts"

key-files:
  created:
    - apps/api/test/booking-cluster-lua.integration.spec.ts
    - .planning/phases/20-valkey-production-connectivity-contract/20-03-SUMMARY.md
  modified: []

key-decisions:
  - "Reuse the Phase 14 Valkey Cluster testcontainers pattern for booking Lua instead of adding production code changes."
  - "Verify Phase 19 ownership helpers through BookingService public methods under IORedis.Cluster."
  - "Keep booking.service.ts and reservation.service.ts unchanged; this plan is a cluster guard only."

patterns-established:
  - "Booking cluster Lua regression guard: CROSSSLOT negative test plus CLUSTER KEYSLOT same-slot proof."
  - "Cluster integration tests use synthetic user/showtime/seat identifiers and do not log REDIS_URL or customer data."

requirements-completed: [VALK-03, SC-2, SC-3]

duration: 5min
completed: 2026-04-30
---

# Phase 20 Plan 03: Booking Cluster Lua Integration Guard Summary

**Booking lock/status/unlock and Phase 19 ownership helper Lua paths now run against a single-shard Valkey Cluster guard with explicit CROSSSLOT and KEYSLOT coverage.**

## Performance

- **Duration:** 5min
- **Started:** 2026-04-30T06:30:40Z
- **Completed:** 2026-04-30T06:35:38Z
- **Tasks:** 1 TDD task
- **Files modified:** 1 source test file, 1 summary file

## Accomplishments

- Added `apps/api/test/booking-cluster-lua.integration.spec.ts`.
- Bootstraps `GenericContainer('valkey/valkey:8')` in cluster mode with runtime `cluster-announce-ip`, `cluster-announce-port`, `CLUSTER ADDSLOTSRANGE 0 16383`, and dynamic `natMap`.
- Verifies legacy booking keys without shared `{showtimeId}` hash tags reject with `CROSSSLOT`.
- Verifies `{showtimeId}:user-seats:{userId}`, `{showtimeId}:seat:{seatId}`, and `{showtimeId}:locked-seats` share a `CLUSTER KEYSLOT`.
- Runs `BookingService.lockSeat()`, `getSeatStatus()`, `unlockSeat()`, `assertOwnedSeatLocks()`, and `consumeOwnedSeatLocks()` through `IORedis.Cluster`.

## Task Commits

Each TDD gate was committed atomically:

1. **RED: add failing booking cluster Lua guard** - `79a4eb4` (test)
2. **GREEN: implement booking cluster Lua guard** - `6bc7a3b` (feat)

## Files Created/Modified

- `apps/api/test/booking-cluster-lua.integration.spec.ts` - New Docker/testcontainers integration spec for booking Lua cluster safety.
- `.planning/phases/20-valkey-production-connectivity-contract/20-03-SUMMARY.md` - Execution summary.

## Decisions Made

- Used the same single-node Valkey Cluster pattern as Phase 14 to keep cluster-mode coverage fast and aligned with the existing guard.
- Instantiated `BookingService` with the real `IORedis.Cluster` client plus the existing minimal mock DB/gateway shape from booking integration tests.
- Did not modify `booking.service.ts`, `reservation.service.ts`, ownership Lua scripts, or production runtime semantics.

## TDD Gate Compliance

- RED commit `79a4eb4` added a failing `booking-cluster-lua` integration spec placeholder. Verification failed with `booking cluster Lua guard not implemented yet`.
- GREEN commit `6bc7a3b` replaced the placeholder with the full Valkey Cluster harness and booking scenarios. Verification passed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Docker/testcontainers were available, so the integration command ran to completion. No Docker gate needed.
- `docs/v2.0-fanmeet-milestone-spec.md` was already untracked in this worktree and was left untouched.

## Verification

```bash
pnpm --filter @grabit/api test:integration -- booking-cluster-lua
```

Result: PASS. Vitest reported 5 integration files passed and 41 tests passed; `booking-cluster-lua.integration.spec.ts` contributed 5 passing tests.

```bash
rg -n "GenericContainer\('valkey/valkey:8'\)|ADDSLOTSRANGE|CROSSSLOT|CLUSTER', 'KEYSLOT'|assertOwnedSeatLocks|consumeOwnedSeatLocks" apps/api/test/booking-cluster-lua.integration.spec.ts
```

Result: PASS. All required guard strings were found.

```bash
git diff -- apps/api/src/modules/booking/booking.service.ts apps/api/src/modules/reservation/reservation.service.ts
```

Result: PASS. No production service diff.

```bash
pnpm --filter @grabit/api typecheck
```

Result: PASS.

## Known Stubs

None. Stub scan found only the local `natMap = {}` accumulator used while building the cluster `natMap`; it is not UI/runtime placeholder data.

## Threat Flags

None beyond the planned threat model. This plan added only an ephemeral testcontainers Valkey Cluster integration spec with synthetic IDs and no new network endpoint, auth path, file access boundary, or schema change.

## User Setup Required

None. Docker/testcontainers were available during execution.

## Next Phase Readiness

Plan 20-04 can rely on automated booking Lua cluster coverage while focusing on production smoke/UAT evidence for Cloud Run health, Socket.IO propagation, idle reconnect, rollback, and clean logs.

## Self-Check: PASSED

- Found `apps/api/test/booking-cluster-lua.integration.spec.ts`.
- Found `.planning/phases/20-valkey-production-connectivity-contract/20-03-SUMMARY.md`.
- Found task commits in git log: `79a4eb4`, `6bc7a3b`.
- `.planning/STATE.md` and `.planning/ROADMAP.md` have no diff from this plan.
- Untracked `.planning/phases/20-valkey-production-connectivity-contract/20-02-SUMMARY.md` and `docs/v2.0-fanmeet-milestone-spec.md` were left untouched.

---
*Phase: 20-valkey-production-connectivity-contract*
*Completed: 2026-04-30*
