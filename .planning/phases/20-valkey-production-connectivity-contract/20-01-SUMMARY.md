---
phase: 20-valkey-production-connectivity-contract
plan: 01
subsystem: api-infra
tags: [valkey, redis, ioredis, cloud-run, config, testing]

requires:
  - phase: 07-valkey
    provides: REDIS_CLIENT provider, production REDIS_URL hard-fail, Cloud Run Valkey secret/VPC wiring
  - phase: 17-local-dev-health-indicator-fix-inmemoryredis-ping-capability
    provides: InMemoryRedis ping parity and local health fallback boundary
provides:
  - Explicit VALKEY_MODE runtime config contract
  - REDIS_CLIENT standalone vs cluster client selection
  - Sanitized Redis runtime metadata helper for downstream health output
  - Cloud Run VALKEY_MODE=cluster production env contract
affects: [phase-20, valkey-health, cloud-run-deploy, booking-locks]

tech-stack:
  added: []
  patterns:
    - "VALKEY_MODE is required in production when REDIS_URL is configured"
    - "REDIS_CLIENT attaches non-enumerable sanitized runtime metadata"
    - "ioredis Cluster is selected only for redis.mode=cluster"

key-files:
  created:
    - .planning/phases/20-valkey-production-connectivity-contract/20-01-SUMMARY.md
  modified:
    - apps/api/src/config/redis.config.ts
    - apps/api/src/modules/booking/providers/redis.provider.ts
    - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
    - .github/workflows/deploy.yml

key-decisions:
  - "Use VALKEY_MODE=cluster as the explicit production Cloud Run contract because live Memorystore is CLUSTER / shardCount=1."
  - "Keep all client selection inside REDIS_CLIENT; no booking or reservation service rewrites."
  - "Expose only sanitized runtime metadata, never REDIS_URL or host details."

patterns-established:
  - "Provider metadata helper: getRedisRuntimeMetadata(redis) returns mode/client/configured without leaking connection details."
  - "Production mode parsing: missing or invalid VALKEY_MODE fails before InMemoryRedis fallback can be used."

requirements-completed: [VALK-02, VALK-05, SC-3]

duration: 5min
completed: 2026-04-30
---

# Phase 20 Plan 01: Valkey Production Connectivity Contract Summary

**Cloud Run now declares `VALKEY_MODE=cluster`, and the API Redis provider intentionally creates standalone or cluster clients with redacted runtime metadata.**

## Performance

- **Duration:** 5min
- **Started:** 2026-04-30T06:21:00Z
- **Completed:** 2026-04-30T06:26:08Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `redis.mode` config from `VALKEY_MODE`.
- Added focused provider tests for production missing/invalid mode, redaction, cluster metadata, and local `InMemoryRedis` metadata.
- Implemented `ValkeyMode`, `RedisRuntimeMetadata`, `getRedisRuntimeMetadata()`, and explicit `IORedis` vs `Cluster` creation in `REDIS_CLIENT`.
- Pinned the API Cloud Run deployment contract to `VALKEY_MODE=cluster` while preserving `REDIS_URL`, VPC egress, session affinity, and `--min-instances=0`.

## Task Commits

1. **Task 1: Add VALKEY_MODE config and provider contract tests** - `1a30d32` (test)
2. **Task 2: Implement standalone/cluster REDIS_CLIENT creation** - `2259670` (feat)
3. **Task 3: Pin Cloud Run deploy contract to VALKEY_MODE=cluster** - `0c53b46` (chore)

## Files Created/Modified

- `apps/api/src/config/redis.config.ts` - Adds `mode: process.env['VALKEY_MODE'] ?? ''`.
- `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` - Covers missing/invalid `VALKEY_MODE`, redaction, and runtime metadata.
- `apps/api/src/modules/booking/providers/redis.provider.ts` - Selects standalone vs cluster clients and attaches sanitized metadata.
- `.github/workflows/deploy.yml` - Adds `VALKEY_MODE=cluster` to API Cloud Run env vars.
- `.planning/phases/20-valkey-production-connectivity-contract/20-01-SUMMARY.md` - Records execution outcome.

## Decisions Made

- `VALKEY_MODE=cluster` is the production deploy value because the live Memorystore instance is cluster-mode.
- Non-production with a configured `REDIS_URL` defaults to standalone when `VALKEY_MODE` is omitted, preserving local/dev behavior.
- Provider errors mention env var names but never include the raw URL or host; error logging sanitizes Redis URLs, IPs, auth/token labels, phone-like values, and payment-like key/value fields.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The worktree already had `.planning/STATE.md` modified and `docs/v2.0-fanmeet-milestone-spec.md` untracked before this executor's edits. Both were left untouched per parallel execution instructions.

## Verification

```bash
pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts --run
```

Result: PASS, 25 tests passed.

```bash
pnpm --filter @grabit/api typecheck
```

Result: PASS.

```bash
rg -n "VALKEY_MODE=cluster|REDIS_URL=redis-url:latest|--vpc-egress=private-ranges-only|--min-instances=0" .github/workflows/deploy.yml
```

Result: PASS, all required deploy contract strings present.

```bash
rg -n "new Cluster|getRedisRuntimeMetadata|VALKEY_MODE" apps/api/src/modules/booking/providers/redis.provider.ts apps/api/src/config/redis.config.ts
```

Result: PASS, provider/config contract strings present.

## User Setup Required

None - no external service configuration required in this plan.

## Next Phase Readiness

Plan 20-02 can import `getRedisRuntimeMetadata()` to expose sanitized health detail. Reservation ownership semantics were not touched, and `apps/api/src/modules/reservation/reservation.service.ts` was not modified.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/20-valkey-production-connectivity-contract/20-01-SUMMARY.md`.
- Modified source/config files exist at expected paths.
- Task commits found in git log: `1a30d32`, `2259670`, `0c53b46`.
- `.planning/ROADMAP.md` has no worktree diff from this plan.
- `.planning/STATE.md` has a pre-existing worktree diff and was left unstaged/uncommitted per orchestrator ownership.

---
*Phase: 20-valkey-production-connectivity-contract*
*Completed: 2026-04-30*
