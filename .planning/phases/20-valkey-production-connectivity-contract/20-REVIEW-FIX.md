---
phase: 20-valkey-production-connectivity-contract
fixed_at: 2026-05-04T00:52:03Z
review_path: .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-05-04T00:52:03Z
**Source review:** .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: BLOCKER - `workflow_run` can deploy an untrusted CI run

**Status:** `fixed: requires human verification`
**Files modified:** `.github/workflows/deploy.yml`
**Commit:** c2fd938
**Applied fix:** Added the same fail-closed job guard to `deploy-api` and `deploy-web`, requiring the completed CI run to be a successful canonical `push` to `main` from `github.repository` before production secrets and OIDC credentials are used.

### CR-02: BLOCKER - Production startup treats Redis pub/sub as ready before it is connected

**Status:** `fixed: requires human verification`
**Files modified:** `apps/api/src/main.ts`, `apps/api/src/modules/booking/providers/redis-io.adapter.ts`, `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts`
**Commit:** fe83f0d
**Applied fix:** Made `RedisIoAdapter.connectToRedis()` async, required the duplicated subscriber to expose ioredis readiness methods, connect successfully, and return `PONG` before wiring the Socket.IO Redis adapter. Production bootstrap now awaits that readiness result before `app.useWebSocketAdapter()`, and the minimal subscriber regression is now a negative test.

### WR-01: WARNING - Health check reports `up` for malformed Redis clients

**Status:** `fixed: requires human verification`
**Files modified:** `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`
**Commit:** ed8a2a7
**Applied fix:** Restricted the no-`ping()` health fallback to metadata-proven local in-memory Redis only. Configured Redis clients without `ping()` now report `down` with `redis ping unavailable`, with a regression test for malformed configured clients.

### WR-02: WARNING - Socket.IO smoke can race room join before lock emission

**Status:** `fixed: requires human verification`
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** fa5592d
**Applied fix:** Replaced the fixed 750ms sleep after `join-showtime` with a timeout-backed wait for the gateway `joined` event or Socket.IO ack, and fail the smoke if join returns an error payload or never acknowledges.

### WR-03: WARNING - Cleanup smoke treats malformed seat status as success

**Status:** `fixed: requires human verification`
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 992e41c
**Applied fix:** Made `readSeatState()` require a valid response body with a `seats` object. Missing seat keys are now explicitly treated as `available`, while malformed bodies, missing `seats`, or non-string seat states throw and fail the smoke evidence.

## Verification

- CR-01: Re-read `.github/workflows/deploy.yml` guard sections after edit. No YAML-specific checker is configured for GitHub Actions expressions in this repo.
- CR-02: Re-read modified sections; `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/redis-io.adapter.spec.ts --reporter=dot` passed. `pnpm --filter @grabit/api exec tsc --noEmit --pretty false` was attempted and failed only with pre-existing `@grabit/shared` resolution/admin implicit-any errors outside the modified files.
- WR-01: Re-read modified sections; `pnpm --filter @grabit/api exec vitest run src/health/__tests__/redis.health.indicator.spec.ts --reporter=dot` passed. API typecheck was attempted again and failed with the same pre-existing unrelated errors.
- WR-02: Re-read `joinShowtime()` and helper changes; `node -c scripts/smoke-valkey-production.mjs` passed.
- WR-03: Re-read `readSeatState()` changes; `node -c scripts/smoke-valkey-production.mjs` passed.

---

_Fixed: 2026-05-04T00:52:03Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
