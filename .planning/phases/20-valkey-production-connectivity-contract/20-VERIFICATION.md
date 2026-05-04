---
phase: 20-valkey-production-connectivity-contract
verified: 2026-04-30T09:08:34Z
status: human_needed
pending_production_smoke: true
score: 6/9 must-haves verified
overrides_applied: 0
human_needed: true
evidence_artifact: .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
human_verification:
  - test: "Run revision-scoped production Valkey smoke"
    expected: "20-HUMAN-UAT.md contains checked PASS evidence for health, Lua lock/status/unlock, Socket.IO two-instance propagation, idle reconnect, log/Sentry cleanliness, scale restore, and final result."
    why_human: "The user explicitly requested skipping production smoke; PSC/private networking, production auth, Cloud Run revision traffic, and safe fixture approval cannot be proven from local code checks."
  - test: "Confirm Socket.IO propagation uses distinct Cloud Run instances"
    expected: "Cloud Logging ties the two smoke clients to at least two distinct instance IDs for the recorded latestReadyRevisionName, or the checkpoint remains FAIL."
    why_human: "The deployed service currently uses session affinity, so operator-side runtime evidence is required to avoid treating two local sockets as two Cloud Run instances."
---

# Phase 20: Valkey Production Connectivity Contract Verification Report

**Phase Goal:** Cloud Run -> Google Memorystore for Valkey production runtime contract를 cluster/standalone 설정, VPC egress, idle reconnect, Socket.IO pub/sub까지 실제 운영 조건에서 검증 가능하게 만든다.
**Verified:** 2026-04-30T09:08:34Z
**Status:** human_needed / pending-production-smoke
**Re-verification:** No - previous `20-VERIFICATION.md` was an informal pending-smoke artifact with no `gaps:` frontmatter.

## Goal Achievement

코드와 로컬 자동 검증 기준으로는 production Valkey mode contract, fail-closed behavior, health metadata, cluster Lua guard, smoke/UAT gate가 존재하고 동작한다. 하지만 phase goal의 핵심 런타임 증거인 Cloud Run revision -> Valkey health/Lua/Socket.IO/idle/log smoke는 아직 없다. `20-HUMAN-UAT.md`에는 95개의 unchecked checkbox가 있고 checked PASS evidence가 0개다.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `production Valkey mode detection/connection config`가 deployment contract로 고정된다. | VERIFIED | `.github/workflows/deploy.yml:134` has `VALKEY_MODE=cluster`; `apps/api/src/config/redis.config.ts:5` exposes `redis.mode`; `redis.provider.ts:649-676` creates cluster client when mode is `cluster`. |
| 2 | Production missing `REDIS_URL` or missing/invalid `VALKEY_MODE` fails closed and avoids `InMemoryRedis`. | VERIFIED | `redis.provider.ts:626-647` production `REDIS_URL` hard-fail; `redis.provider.ts:530-548` `VALKEY_MODE` required/validated; provider tests passed. |
| 3 | Safe runtime state is exposed without secrets. | VERIFIED | `redis.health.indicator.ts:53-75` attaches sanitized `mode/client/configured`; provider metadata helper at `redis.provider.ts:511-524`; redaction grep on `20-HUMAN-UAT.md` found no value-sensitive evidence. |
| 4 | Production Socket.IO adapter failure is visible before serving. | VERIFIED | `main.ts:52-67` production Redis `PING`, `redisPubSubReady`, and bootstrap abort phrase; adapter wiring in `redis-io.adapter.ts:87-105`. |
| 5 | Booking lock/status/unlock Lua and ownership helpers run under Valkey Cluster without `CROSSSLOT`. | VERIFIED | `booking-cluster-lua.integration.spec.ts:159-261` covers `CROSSSLOT`, `CLUSTER KEYSLOT`, `lockSeat`, `getSeatStatus`, `unlockSeat`, `assertOwnedSeatLocks`, and `consumeOwnedSeatLocks`; integration test passed. |
| 6 | Repeatable production smoke/evidence gate exists and is redaction-aware. | VERIFIED | `scripts/smoke-valkey-production.mjs:34-62`, `694-788` implement checks and artifact append; `20-HUMAN-UAT.md` contains required operator sections and commands. |
| 7 | Cloud Run revision has recorded Valkey ping, Lua lock path, and Socket.IO propagation smoke evidence. | HUMAN NEEDED | `20-HUMAN-UAT.md` has no checked PASS rows and no `Production Smoke Run` append. User requested skipping this smoke. |
| 8 | Socket.IO `seat-update` propagation is proven across two Cloud Run API instances. | HUMAN NEEDED | Smoke code requires distinct instance IDs (`smoke-valkey-production.mjs:584-593`), but no production run evidence exists. Session affinity at `.github/workflows/deploy.yml:124` makes operator evidence mandatory. |
| 9 | Idle reconnect runtime proof and log/Sentry cleanliness are recorded for the smoke window. | HUMAN NEEDED | Script implements idle/log checks (`smoke-valkey-production.mjs:604-640`), but `20-HUMAN-UAT.md` has no idle/log PASS evidence. |

**Score:** 6/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/config/redis.config.ts` | `VALKEY_MODE` config namespace | VERIFIED | `mode: process.env['VALKEY_MODE'] ?? ''`. |
| `apps/api/src/modules/booking/providers/redis.provider.ts` | fail-closed standalone/cluster `REDIS_CLIENT` plus metadata | VERIFIED | Exports metadata helper and creates `new Cluster`; tests passed. |
| `.github/workflows/deploy.yml` | Cloud Run `VALKEY_MODE=cluster`, VPC egress, scale-to-zero retained | VERIFIED | Lines 118, 124, 128, 134, 149 preserve contract inputs. |
| `apps/api/src/health/redis.health.indicator.ts` | sanitized Valkey health metadata | VERIFIED | Uses `getRedisRuntimeMetadata()` and redacts down messages. |
| `apps/api/src/modules/booking/providers/redis-io.adapter.ts` | Redis-backed Socket.IO adapter wiring | VERIFIED WITH WARNING | Wires duplicate subscriber; `20-REVIEW.md` still warns about permissive minimal-sub-client test coverage. |
| `apps/api/src/main.ts` | production Redis ping and pub/sub fail-closed bootstrap | VERIFIED | Production `PING` and adapter readiness gate before listen. |
| `apps/api/test/booking-cluster-lua.integration.spec.ts` | cluster Lua integration guard | VERIFIED | Docker/testcontainers integration test passed. |
| `scripts/smoke-valkey-production.mjs` | repeatable production smoke command | VERIFIED WITH WARNING | Syntax/help checks passed; review warnings remain around session affinity, join ack, and status parsing reliability. |
| `20-HUMAN-UAT.md` | operator production evidence artifact | HUMAN NEEDED | Runbook exists, but no real revision-scoped PASS evidence is recorded. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `.github/workflows/deploy.yml` | `redis.config.ts` | `VALKEY_MODE=cluster` env -> `process.env['VALKEY_MODE']` | VERIFIED | Manual grep confirms both ends. |
| `redis.config.ts` | `redis.provider.ts` | `ConfigService.get('redis.mode')` | VERIFIED | `redis.provider.ts:623` reads `redis.mode`; SDK false-negative was due escaped pattern matching. |
| `redis.provider.ts` | `redis.health.indicator.ts` | `getRedisRuntimeMetadata(redis)` | VERIFIED | SDK key-link check passed. |
| `redis-io.adapter.ts` | `main.ts` | `connectToRedis()` -> `redisPubSubReady` | VERIFIED | SDK key-link check passed. |
| `booking-cluster-lua.integration.spec.ts` | `BookingService` | real `lockSeat/getSeatStatus/unlockSeat` calls | VERIFIED | SDK key-link check passed. |
| `smoke-valkey-production.mjs` | `20-HUMAN-UAT.md` | default artifact URL / append | VERIFIED | SDK key-link check passed. |
| `20-HUMAN-UAT.md` | Cloud Run `grabit-api` / Memorystore `grabit-valkey` | operator `gcloud` evidence fields | HUMAN NEEDED | Commands and fields exist, but no runtime evidence values are filled. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `redis.provider.ts` | `modeValue`, `url` | `ConfigService` -> root env / Cloud Run env-secret binding | Yes in runtime config; locally test-covered | VERIFIED |
| `redis.health.indicator.ts` | `metadata`, `pong` | injected `REDIS_CLIENT.ping()` and metadata symbol | Yes when API runs | VERIFIED |
| `main.ts` | `redisPubSubReady`, `pong` | `REDIS_CLIENT` and `RedisIoAdapter.connectToRedis()` | Yes when API runs | VERIFIED |
| `booking-cluster-lua.integration.spec.ts` | cluster keys and lock state | `valkey/valkey:8` testcontainer + `BookingService` | Yes; integration test passed | VERIFIED |
| `smoke-valkey-production.mjs` | Cloud Run revision, Memorystore mode, health/Lua/socket/log evidence | `gcloud`, production API, Socket.IO, Cloud Logging, Sentry observation env | Not yet executed against production | HUMAN NEEDED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Smoke script parses | `node --check scripts/smoke-valkey-production.mjs` | exit 0 | PASS |
| Smoke help resolves `socket.io-client` from `apps/web` | `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help` | exit 0 | PASS |
| API typecheck | `pnpm --filter @grabit/api exec tsc --noEmit --pretty false` | exit 0 | PASS |
| Provider/health/adapter unit tests | `pnpm --filter @grabit/api exec vitest run ... --run` | 3 files, 40 tests passed | PASS |
| Booking cluster Lua integration | `pnpm --filter @grabit/api test:integration -- booking-cluster-lua` | 5 files, 41 tests passed; target spec contributed 5 tests | PASS |
| Human artifact value redaction | `rg` value-sensitive patterns against `20-HUMAN-UAT.md` | no matches | PASS |
| Real production smoke | `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all` | not run by user request | HUMAN NEEDED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VALK-02 | 20-01, 20-04 | Google Memorystore for Valkey provisioning / PSC + Direct VPC Egress | HUMAN NEEDED | Deploy and smoke contract exist, but live Cloud Run -> Memorystore evidence is absent. |
| VALK-03 | 20-03, 20-04 | Seat lock Lua Valkey compatibility | VERIFIED | Cluster Lua integration test passed. |
| VALK-04 | 20-02, 20-04 | Socket.IO Redis adapter Valkey pub/sub behavior | HUMAN NEEDED | Code adapter/fail-closed path verified; production pub/sub propagation still needs runtime evidence. |
| VALK-05 | 20-01, 20-02, 20-04 | Cloud Run -> Valkey VPC networking | HUMAN NEEDED | VPC deploy flags and smoke checks exist; actual runtime path not proven. |
| SC-1 | 20-02, 20-04 | Health/runtime state support for smoke | VERIFIED | Health metadata and local tests pass. `SC-1` is not a standalone ID in `REQUIREMENTS.md`; mapped from phase plan. |
| SC-2 | 20-03, 20-04 | Cluster Lua guard | VERIFIED | `booking-cluster-lua` integration test passed. `SC-2` is not a standalone ID in `REQUIREMENTS.md`; mapped from phase plan. |
| SC-3 | 20-01, 20-03, 20-04 | Cluster mode/fail-closed contract | VERIFIED | Deploy/config/provider tests and cluster Lua guard pass. `SC-3` is not a standalone ID in `REQUIREMENTS.md`; mapped from phase plan. |
| SC-4 | 20-02, 20-04 | Socket.IO adapter visibility/fail-closed | VERIFIED WITH HUMAN FOLLOW-UP | Bootstrap fail-closed is verified; real pub/sub propagation remains human-needed. `SC-4` is not a standalone ID in `REQUIREMENTS.md`; mapped from phase plan. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts` | 88 | Test accepts `duplicate()` returning `{}` as non-throwing | WARNING | Does not currently break the real `IORedis`/`Cluster` path, but weakens future adapter readiness coverage. |
| `.github/workflows/deploy.yml` | 124 | `--session-affinity` with two-socket smoke | WARNING | Production Socket.IO smoke may false-fail unless operator proves distinct instance IDs or adjusts the smoke precondition. |
| `scripts/smoke-valkey-production.mjs` | 512 | `join-showtime` waits 750ms instead of server ack | WARNING | Can produce flaky false timeout under cold starts/network jitter. |
| `scripts/smoke-valkey-production.mjs` | 371 | malformed seat status maps to `unknown` | WARNING | Cleanup proof is less strict than ideal; prior lock status check reduces false-pass risk but does not eliminate it. |
| grep scan | multiple | `return null`, `= {}`, `console.log` | INFO | Matches are intentional retry stops, local accumulators, or CLI output; no blocker stub found. |

### Human Verification Required

### 1. Production Smoke Approval

**Test:** Fill approved smoke env/auth/fixture values and run `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all`.
**Expected:** `20-HUMAN-UAT.md` records real revision-scoped PASS evidence for health, Lua, Socket.IO, idle reconnect, log/Sentry cleanliness, scale restore, redaction review, and final result.
**Why human:** Requires production auth, safe fixture approval, Cloud Run traffic/revision context, PSC/private networking, and Sentry/Cloud Logging observation.

### 2. Distinct Instance Socket.IO Proof

**Test:** Ensure the Socket.IO smoke evidence ties both client IDs to at least two distinct Cloud Run instance IDs for the recorded `latestReadyRevisionName`.
**Expected:** D-10 and D-13 are PASS only with distinct instance evidence; otherwise the checkpoint remains FAIL.
**Why human:** The deployed service has session affinity, so automated local inspection cannot prove how production routed the sockets.

### Gaps Summary

No automated blocker gap was found in the code/config/test artifacts. The phase must remain `human_needed` because the runtime production evidence has intentionally not been collected. Do not mark Phase 20 passed until `20-HUMAN-UAT.md` contains real checked PASS evidence.

---

_Verified: 2026-04-30T09:08:34Z_
_Verifier: the agent (gsd-verifier)_
