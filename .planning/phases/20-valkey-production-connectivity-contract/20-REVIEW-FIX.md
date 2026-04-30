---
phase: 20-valkey-production-connectivity-contract
fixed_at: 2026-04-30T07:30:41Z
review_path: .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
iteration: 2
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-04-30T07:30:41Z
**Source review:** .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0
- Production smoke remains deferred; this report does not mark Phase 20 passed or complete.

## Fixed Issues

### CR-01: BLOCKER - Cluster Socket.IO subscriber duplicate ignores required options

**Status:** fixed
**Files modified:** `apps/api/src/modules/booking/providers/redis-io.adapter.ts`, `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts`
**Commit:** 93e2a99
**Applied fix:** Added a cluster-aware subscriber duplicate helper that passes cluster overrides as the second `Cluster#duplicate()` argument, preserving `enableReadyCheck: false` and `redisOptions.maxRetriesPerRequest: null`. Added a real `Cluster` unit test for the overload shape.

### CR-02: BLOCKER - Cluster REDIS_URL parsing drops auth and TLS

**Status:** fixed
**Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`
**Commit:** 98e762c
**Applied fix:** Validated Redis URL schemes, propagated username/password/TLS into cluster `redisOptions`, and rejected cluster URLs that select unsupported logical databases. Added regression tests for TLS/auth preservation and DB path rejection.

### CR-03: BLOCKER - Redis URL redaction misses rediss:// secrets

**Status:** fixed
**Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`, `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`, `scripts/smoke-valkey-production.mjs`
**Commit:** 3bf5587
**Applied fix:** Updated provider, health, and smoke redaction to match both `redis://` and `rediss://` URLs. Added provider log and health down-message regression tests that include both URL schemes.

### CR-04: BLOCKER - Smoke script can pass without enforcing the stated production contract

**Status:** fixed: requires human verification
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** e67e464
**Applied fix:** Required health smoke to prove `mode=cluster`, `client=ioredis-cluster`, and `configured=true`. Strengthened runtime contract checks to require Cloud Run `VALKEY_MODE=cluster`, Secret Manager REDIS_URL binding, private-ranges VPC egress, configured network interfaces, and live Memorystore `CLUSTER` mode. Artifact output now lists each failed runtime contract field.

### WR-01: WARNING - Standalone log smoke checks only the moment after it starts

**Status:** fixed: requires human verification
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 4b6616f
**Applied fix:** Standalone `--check logs` now requires `GRABIT_SMOKE_LOG_SINCE_UTC`; `--check all` still uses the current run start time. Log summaries include the queried `since` timestamp.

### CR-04 Follow-up: BLOCKER - Smoke checks can still target a non-production API origin

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** e878458
**Applied fix:** Added `parseProductionApiUrl()` and `EXPECTED_API_ORIGIN=https://api.heygrabit.com`, then routed `GRABIT_API_URL` through that parser before reading auth, running `gcloud`, or contacting any HTTP/Socket.IO endpoint. `localhost` and staging origins now fail before smoke execution.

### WR-02: WARNING - Lua smoke accepts any status string containing "locked"

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** e878458
**Applied fix:** Replaced `statusSummary.includes('locked')` with an exact `seatState === 'locked'` predicate so `not_locked`, `unlocked`, or error text containing the substring cannot satisfy the Lua smoke status gate.

## Skipped Issues

None - all in-scope findings were fixed.

## Verification

- CR-01: `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`; `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/redis-io.adapter.spec.ts`
- CR-02: `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`; `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts`
- CR-03: `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`; `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts`; `node --check scripts/smoke-valkey-production.mjs`
- CR-04: `node --check scripts/smoke-valkey-production.mjs`
- WR-01: `node --check scripts/smoke-valkey-production.mjs`
- CR-04 follow-up: `GRABIT_API_URL=http://localhost:8080 node scripts/smoke-valkey-production.mjs --check health` fails with `GRABIT_API_URL must be exactly https://api.heygrabit.com`; `GRABIT_API_URL=https://staging.example.com node scripts/smoke-valkey-production.mjs --check health` fails with the same message
- WR-02: `rg -n "statusSummary\\.includes" scripts/smoke-valkey-production.mjs` returns no matches; `rg -n "const seatLocked = seatState === 'locked'" scripts/smoke-valkey-production.mjs` finds the exact-state predicate

---

_Fixed: 2026-04-30T07:30:41Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 2_
