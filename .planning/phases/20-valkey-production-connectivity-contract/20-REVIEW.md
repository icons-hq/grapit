---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T09:02:12Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - .github/workflows/deploy.yml
  - apps/api/src/config/redis.config.ts
  - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
  - apps/api/src/health/redis.health.indicator.ts
  - apps/api/src/main.ts
  - apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts
  - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
  - apps/api/src/modules/booking/providers/redis-io.adapter.ts
  - apps/api/src/modules/booking/providers/redis.provider.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T09:02:12Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Commit `2adafff` 이후 Valkey/Redis production connectivity 변경을 표준 깊이로 재검토했다. 사용자가 의도적으로 production smoke를 skip한 사실은 결함으로 기록하지 않았다. 대신 source와 artifact contract 자체에서 false pass/false fail을 만들 수 있는 지점만 기록했다.

보조 확인:
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false` 통과
- `pnpm --filter @grabit/api test:integration -- booking-cluster-lua` 통과
- 관련 unit test command도 통과했으나, 기존 npm script 인자 전달 방식 때문에 전체 API unit suite가 실행됐다.

## Warnings

### WR-01: WARNING - Socket.IO smoke assumes two sockets imply two Cloud Run instances despite session affinity

**File:** `.github/workflows/deploy.yml:124`, `scripts/smoke-valkey-production.mjs:548`

**Issue:** API deployment enables `--session-affinity`, but `checkSocketIo()` only preflights `min-instances >= 2` and then opens two sockets from the same operator process. With Cloud Run session affinity, those connections can legitimately land on the same instance, so the script can mark D-10/D-13 as FAIL even when Redis pub/sub works. This makes the production smoke artifact inconclusive/flaky rather than a reliable connectivity contract.

**Fix:** Include session-affinity state in `getCloudRunEvidence()` and make `checkSocketIo()` require an explicit safe condition: temporarily disable session affinity for the smoke and restore it, or require two independent client affinity contexts and record that precondition. At minimum, fail preflight with a targeted message when session affinity is enabled instead of implying `min-instances=2` is sufficient.

### WR-02: WARNING - Adapter tests lock in success for an invalid Redis subscriber

**File:** `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts:88`, `apps/api/src/modules/booking/providers/redis-io.adapter.ts:88`

**Issue:** The test named `does not throw when duplicate is present but returns a minimal sub client` explicitly treats `duplicate()` returning `{}` as acceptable. The production bootstrap then trusts `connectToRedis()`'s boolean as "pub/sub ready". This weakens the fail-closed contract: future provider changes or incompatible clients could return a truthy but unusable subscriber and still pass this test.

**Fix:** Remove the permissive test and make `connectToRedis()` validate the duplicated client surface needed by `@socket.io/redis-adapter` before returning `true`, or catch adapter construction failures and return `false`. Add a negative test that `duplicate()` returning `{}` is not considered wired.

### WR-03: WARNING - Socket.IO smoke does not wait for the room join acknowledgement

**File:** `scripts/smoke-valkey-production.mjs:512`

**Issue:** `joinShowtime()` emits `join-showtime` and sleeps for 750 ms before the lock request. Under cold starts, network jitter, or a slow gateway, the lock can be emitted before one socket has actually joined the room, causing a false timeout in `waitForSeatUpdate()` even though Redis pub/sub is healthy.

**Fix:** Wait for a deterministic server signal. For example, have the client listen for the gateway's `joined` event with a timeout before proceeding, or change the gateway event to use an acknowledgement callback and await that ack in the smoke script.

### WR-04: WARNING - Cleanup verification treats malformed seat status as success

**File:** `scripts/smoke-valkey-production.mjs:371`

**Issue:** `readSeatState()` returns the sentinel string `unknown` both when a seat is legitimately absent from the `seats` map and when the response body is malformed or missing `seats`. `unlockAndVerifySeat()` then treats every state other than `locked` as cleanup success. A broken status endpoint can therefore produce PASS evidence for cleanup.

**Fix:** Parse the seat-status response into an explicit shape, e.g. require `body.seats` to be an object. Return `available` only when that object exists and does not contain the seat; throw on malformed responses instead of mapping them to `unknown`.

---

_Reviewed: 2026-04-30T09:02:12Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
