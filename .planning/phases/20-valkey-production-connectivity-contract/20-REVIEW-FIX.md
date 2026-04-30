---
phase: 20-valkey-production-connectivity-contract
fixed_at: 2026-04-30T08:12:08Z
review_path: .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
iteration: 5
findings_in_scope: 17
fixed: 17
skipped: 0
status: all_fixed
---

# Phase 20: Code Review Fix Report

**Fixed at:** 2026-04-30T08:12:08Z
**Source review:** .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW.md
**Iteration:** 5

**Summary:**
- Findings in scope: 17
- Fixed: 17
- Skipped: 0
- Production smoke remains deferred; this report does not mark Phase 20 passed or complete.
- Iteration 4 closes the 2026-04-30T07:46:48Z follow-up review: Redis/health auth-value redaction, post-unlock seat-state proof, strict idle seconds parsing, and failed-check artifact capture.
- Iteration 5 closes the 2026-04-30T08:08:14Z follow-up review: production bootstrap Redis ping, required Sentry evidence, broader bearer redaction, Socket.IO preflight min-instances guard, and non-Error health rejection handling.

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

### CR-01 Final Follow-up: BLOCKER - Smoke PASS is not tied to the traffic-serving Cloud Run revision

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`, `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md`
**Commit:** 485f56b
**Applied fix:** Added a runtime contract gate requiring the recorded `latestReadyRevisionName` to serve 100% of public traffic before automated smoke can PASS. Socket.IO instance lookup and log keyword queries now include `resource.labels.revision_name="${latestReadyRevisionName}"`, and the UAT artifact records traffic split plus the revision-scoped log filter requirement.

### CR-01 Iteration 4: BLOCKER - Redis/health sanitizers redact labels but leave secret values

**Status:** fixed
**Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`, `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`
**Commit:** dc445c5
**Applied fix:** Added explicit `Authorization: Bearer`, `Cookie`, `JWT:` label, and JWT-like value patterns to both Redis provider and health sanitizers. Regression tests now include bearer, cookie, and JWT-like values and assert that raw credential material is absent from provider logs and health down responses.

### CR-02 Iteration 4: BLOCKER - Lua smoke can pass unlock while the seat remains locked

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** dc445c5
**Applied fix:** Added `readSeatState()` and `unlockAndVerifySeat()` so Lua and Socket.IO smoke paths query seat status after `DELETE` and require the post-unlock state to be anything other than `locked`. Cleanup failures now make the smoke check fail instead of treating transport success as Redis cleanup proof.

### WR-01 Iteration 4: WARNING - Idle seconds parser accepts malformed values

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** dc445c5
**Applied fix:** Replaced `Number.parseInt()` with a strict positive-integer regex so values such as `30m`, `1.5`, or `1800abc` fail before production contact.

### WR-02 Iteration 4: WARNING - Failed smoke checks abort before writing FAIL evidence

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** dc445c5
**Applied fix:** Added `captureCheck()` plus fallback Cloud Run and Memorystore evidence objects. Per-check failures are now recorded as `ok: false` summaries in the artifact, while unsafe setup validation such as missing required inputs still fails fast.

### CR-01 Iteration 5: BLOCKER - Production startup can serve before Redis ping succeeds

**Status:** fixed
**Files modified:** `apps/api/src/main.ts`
**Commit:** 3170858
**Applied fix:** Added a production-only bootstrap `redisClient.ping()` before Socket.IO adapter wiring and `app.listen()`. Non-`PONG` responses throw through the existing fatal bootstrap handler.

### CR-02 Iteration 5: BLOCKER - Log smoke can PASS without Sentry evidence

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 3170858
**Applied fix:** `checkLogs()` now requires a non-empty `GRABIT_SMOKE_SENTRY_OBSERVATION` for PASS. Missing Sentry observation records `Sentry observation=missing` and returns `ok: false`.

### CR-03 Iteration 5: BLOCKER - Smoke bearer redaction can leave token suffixes

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 3170858
**Applied fix:** Expanded the smoke `Authorization: Bearer` redaction pattern to consume any non-whitespace token value, covering opaque tokens with `+`, `/`, or `=` characters.

### WR-01 Iteration 5: WARNING - Two-instance Socket.IO smoke conflicts with default min-instances=0

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 3170858
**Applied fix:** Added a preflight return before opening Socket.IO clients or mutating seats when Cloud Run `min-instances` evidence is below 2. The FAIL summary instructs the operator to temporarily set `min-instances=2` and restore pre-state.

### WR-02 Iteration 5: WARNING - Redis health can throw on non-Error rejection

**Status:** fixed
**Files modified:** `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`
**Commit:** 3170858
**Applied fix:** Converted non-Error rejection values with `String(err)` before sanitization and added an `ECONNRESET` string rejection regression test.

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
- CR-01 final follow-up: `node --check scripts/smoke-valkey-production.mjs`; `rg -n "isLatestReadyServingAllTraffic|cloudRunRevisionFilter|resource\\.labels\\.revision_name|Traffic split|latestReadyRevisionName serving 100% traffic" scripts/smoke-valkey-production.mjs .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md`
- Iteration 4: `node --check scripts/smoke-valkey-production.mjs`
- Iteration 4: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- Iteration 4: `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts`
- Iteration 4: `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`
- Iteration 4: malformed `GRABIT_SMOKE_IDLE_SECONDS=30m` fails with `GRABIT_SMOKE_IDLE_SECONDS must be a positive integer`
- Iteration 4: `rg -n "parsePositiveInteger|unlockAndVerifySeat|captureCheck|fallbackCloudRun|fallbackMemorystore|afterState|GRABIT_SMOKE_IDLE_SECONDS" scripts/smoke-valkey-production.mjs`
- Iteration 5: `node --check scripts/smoke-valkey-production.mjs`
- Iteration 5: `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- Iteration 5: `pnpm --filter @grabit/api exec vitest run src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/providers/__tests__/redis.provider.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts`
- Iteration 5: `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`
- Iteration 5: `rg -n 'redisClient\\.ping\\(\\)|Redis ping returned|preflight failed: min-instances|set grabit-api temporary min-instances=2|ECONNRESET' apps/api/src/main.ts apps/api/src/health apps/api/src/modules/booking/providers scripts/smoke-valkey-production.mjs`
- Iteration 5: `rg -n 'Authorization:\\\\s\\*Bearer\\\\s\\+\\[\\^\\\\s' scripts/smoke-valkey-production.mjs`

---

_Fixed: 2026-04-30T08:12:08Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 5_
