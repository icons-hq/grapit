---
phase: 20-valkey-production-connectivity-contract
plan: 02
subsystem: api-infra
tags: [valkey, redis, health, socket.io, cloud-run, testing]

requires:
  - phase: 20-valkey-production-connectivity-contract
    provides: Plan 20-01 VALKEY_MODE and sanitized Redis runtime metadata helper
  - phase: 17-local-dev-health-indicator-fix-inmemoryredis-ping-capability
    provides: Local InMemoryRedis ping capability and health fallback boundary
provides:
  - Sanitized Redis health mode/client/configured metadata
  - Local in-memory Redis fallback visibility in health output
  - Production bootstrap hard-fail when Socket.IO Redis pub/sub is not wired
  - Focused RED/GREEN tests for health metadata and adapter readiness visibility
affects: [phase-20, valkey-health, socketio-pubsub, cloud-run-production-smoke]

tech-stack:
  added: []
  patterns:
    - "Health detail includes only sanitized mode/client/configured runtime metadata."
    - "Production bootstrap stores RedisIoAdapter readiness and aborts if pub/sub is not wired."
    - "Local InMemoryRedis fallback remains explicit and test/development-only."

key-files:
  created:
    - .planning/phases/20-valkey-production-connectivity-contract/20-02-SUMMARY.md
  modified:
    - apps/api/src/health/redis.health.indicator.ts
    - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
    - apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts
    - apps/api/src/main.ts

key-decisions:
  - "Keep `/api/v1/health` response shape stable by adding metadata inside the existing RedisHealthIndicator detail."
  - "Preserve RedisIoAdapter local false fallback, but make production bootstrap fail closed when that fallback would be used."
  - "Use existing RedisIoAdapter duplicate behavior; no adapter source rewrite was needed beyond tests and bootstrap consumption."

patterns-established:
  - "Health metadata contract: `getRedisRuntimeMetadata(redis)` feeds `mode`, `client`, and `configured` into Terminus up/down detail."
  - "Bootstrap readiness contract: `redisPubSubReady` must be true in production before `app.useWebSocketAdapter(redisIoAdapter)` can continue."

requirements-completed: [VALK-04, VALK-05, SC-1, SC-4]

duration: 5min
completed: 2026-04-30
---

# Phase 20 Plan 02: Valkey Health And Socket.IO Adapter Visibility Summary

**Redis health now reports sanitized Valkey runtime metadata, and production startup fails visibly if Socket.IO Redis pub/sub is not wired.**

## Performance

- **Duration:** 5min
- **Started:** 2026-04-30T06:30:18Z
- **Completed:** 2026-04-30T06:35:47Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added focused RED tests for Redis health `mode`, `client`, and `configured` metadata on up, down, and local fallback paths.
- Added sanitized metadata to `RedisHealthIndicator` without changing the `HealthController` response shape.
- Added RED coverage proving `main.ts` must store `redisPubSubReady` and contain the production failure phrase.
- Updated bootstrap so production aborts with `Socket.IO Redis adapter failed to wire in production` when Redis-backed Socket.IO pub/sub is unavailable.

## Task Commits

1. **Task 1 RED: Redis health metadata tests** - `09c7231` (test)
2. **Task 1 GREEN: sanitized Redis health metadata** - `97bb733` (feat)
3. **Task 2 RED: adapter bootstrap visibility test** - `08af049` (test)
4. **Task 2 GREEN: production pub/sub fail-closed** - `942a819` (feat)
5. **Auto-fix: health metadata typecheck** - `d17f5e2` (fix)

## Files Created/Modified

- `apps/api/src/health/redis.health.indicator.ts` - Imports `getRedisRuntimeMetadata()`, attaches sanitized metadata to Terminus up/down detail, and redacts sensitive values from health error messages.
- `apps/api/src/health/__tests__/redis.health.indicator.spec.ts` - Covers cluster metadata, down-path metadata, local fallback metadata, and forbidden secret/PII/payment strings.
- `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts` - Covers local fallback warning visibility and static bootstrap fail-closed contract.
- `apps/api/src/main.ts` - Stores `redisPubSubReady`, aborts production startup on false, and preserves `app.useWebSocketAdapter(redisIoAdapter)`.
- `.planning/phases/20-valkey-production-connectivity-contract/20-02-SUMMARY.md` - Records execution outcome.

## Decisions Made

- Metadata is added at the Redis health indicator layer, not by wrapping `HealthController`, so `/api/v1/health` remains a standard Terminus response.
- The adapter source already returned boolean readiness and warned on local fallback; `main.ts` now consumes that contract instead of introducing a second adapter abstraction.
- Health error messages are sanitized before output because bootstrap logs and health detail are operator-visible production evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Terminus AdditionalData type inference**
- **Found during:** Plan-level `pnpm --filter @grabit/api typecheck`
- **Issue:** Passing `RedisRuntimeMetadata` directly to `indicator.up(metadata)` failed TypeScript overload resolution because Terminus expects an indexable additional-data object.
- **Fix:** Passed metadata as an object literal with `{ ...metadata }`, preserving runtime output while satisfying the Terminus type contract.
- **Files modified:** `apps/api/src/health/redis.health.indicator.ts`
- **Verification:** Focused health/adapter tests passed and `pnpm --filter @grabit/api typecheck` passed.
- **Committed in:** `d17f5e2`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** No scope change. The fix was required for the planned implementation to compile.

## Issues Encountered

- `docs/v2.0-fanmeet-milestone-spec.md` is an unrelated untracked file present in the worktree and was left untouched.
- `STATE.md` and `ROADMAP.md` were not modified because the parallel orchestrator owns shared state updates for this execution mode.

## Verification

```bash
pnpm --filter @grabit/api exec vitest run src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts --run
```

Result: PASS, 2 files passed, 9 tests passed.

```bash
pnpm --filter @grabit/api typecheck
```

Result: PASS.

```bash
rg -n "getRedisRuntimeMetadata|ioredis-cluster|ping unavailable" apps/api/src/health/redis.health.indicator.ts apps/api/src/health/__tests__/redis.health.indicator.spec.ts
```

Result: PASS, all required health metadata strings present.

```bash
rg -n "redisPubSubReady|Socket.IO Redis adapter failed to wire in production" apps/api/src/main.ts
```

Result: PASS, bootstrap readiness and production failure phrase present.

## Known Stubs

None. The only `= null` scan hit is `RedisIoAdapter`'s intentional internal `adapterConstructor` initial state, not a UI/data stub.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required in this plan.

## Next Phase Readiness

Plan 20-03 can continue cluster Lua coverage independently. Plan 20-04 can use `/api/v1/health` metadata and the `redisPubSubReady` fail-closed bootstrap contract as production smoke evidence inputs.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/20-valkey-production-connectivity-contract/20-02-SUMMARY.md`.
- Modified source/test files exist at expected paths.
- Task commits found in git log: `09c7231`, `97bb733`, `08af049`, `942a819`, `d17f5e2`.
- `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` have no worktree diff from this plan.
- Unrelated untracked files were left unstaged: `.planning/phases/20-valkey-production-connectivity-contract/20-03-SUMMARY.md` and `docs/v2.0-fanmeet-milestone-spec.md`.

---
*Phase: 20-valkey-production-connectivity-contract*
*Completed: 2026-04-30*
