---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-05-04T00:33:11Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .github/workflows/deploy.yml
  - apps/api/src/config/redis.config.ts
  - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
  - apps/api/src/health/redis.health.indicator.ts
  - apps/api/src/main.ts
  - apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts
  - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
  - apps/api/src/modules/booking/providers/redis.provider.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 2
  warning: 3
  info: 0
  total: 5
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-05-04T00:33:11Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

명시된 Valkey production connectivity 관련 10개 파일을 표준 깊이로 검토했다. 핵심 위험은 deploy workflow가 `workflow_run` 트리거를 신뢰하는 방식과, production bootstrap이 Socket.IO Redis pub/sub 준비 상태를 실제로 검증하지 않는 점이다. 둘 다 production 배포 또는 multi-instance 좌석 업데이트 계약을 깨뜨릴 수 있으므로 ship 전 수정이 필요하다.

보조 확인으로 `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts --reporter=dot`를 실행했고 통과했다. 이 통과는 아래 findings를 반박하지 않는다.

## Critical Issues

### CR-01: BLOCKER - `workflow_run` can deploy an untrusted CI run

**Classification:** BLOCKER
**File:** `.github/workflows/deploy.yml:3`

**Issue:** Deploy는 `workflow_run` 완료 이벤트에서 `conclusion == 'success'`만 확인한 뒤 `github.event.workflow_run.head_sha`를 checkout하고, 같은 job에서 GCP OIDC 및 production secrets를 사용한다. `workflow_run`은 PR CI 완료로도 발생할 수 있으므로, triggering run이 `push` to canonical `main`인지와 `head_repository`가 현재 repo인지 검증하지 않으면 fork/PR head SHA가 production deploy 권한을 얻는 경로가 생긴다.

**Fix:**
```yaml
jobs:
  deploy-api:
    if: >-
      ${{
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_branch == 'main' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      }}
```
동일한 guard를 `deploy-web`에도 적용하고, 가능하면 deploy workflow를 `push`/`workflow_dispatch` 기반으로 단순화한다.

### CR-02: BLOCKER - Production startup treats Redis pub/sub as ready before it is connected

**Classification:** BLOCKER
**File:** `apps/api/src/main.ts:59`

**Issue:** `main.ts`는 `redisIoAdapter.connectToRedis()`의 boolean을 production fail-closed 근거로 사용한다. 그런데 adapter 쪽 동작은 `duplicate()`가 존재하면 subscriber 연결, subscribe 가능 여부, adapter runtime error를 기다리지 않고 즉시 `true`를 반환한다. 따라서 Redis `PING`은 성공하지만 Socket.IO subscriber connection 또는 pub/sub wiring이 실패하는 경우에도 Cloud Run instance가 정상 기동되어 multi-instance `seat-update` broadcast가 깨질 수 있다. `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts:88`은 `duplicate()`가 `{}`를 반환해도 throw하지 않는 것을 허용해 이 false-ready contract를 테스트로 고정하고 있다.

**Fix:**
```ts
const redisPubSubReady = await redisIoAdapter.connectToRedis();
if (process.env['NODE_ENV'] === 'production' && !redisPubSubReady) {
  process.exit(1);
}
```
`connectToRedis()`를 async로 바꾸고 duplicated subscriber의 실제 connection/subscription 준비를 검증한 뒤에만 `true`를 반환하게 한다. `{}` 같은 minimal subscriber는 실패로 처리하는 negative test를 추가한다.

## Warnings

### WR-01: WARNING - Health check reports `up` for malformed Redis clients

**Classification:** WARNING
**File:** `apps/api/src/health/redis.health.indicator.ts:55`

**Issue:** `redis.ping`이 없으면 health indicator가 `up`을 반환한다. 현재 `InMemoryRedis`는 `ping()`을 구현하므로 이 branch는 실제 local fallback을 위한 branch가 아니라, 잘못 주입된 Redis-like object를 healthy로 숨기는 branch가 됐다. DI/provider 회귀가 발생하면 `/health`가 Redis 경로를 검증하지 못한다.

**Fix:** `getRedisRuntimeMetadata(redis).client === 'in-memory' && configured === false`인 경우에만 no-ping fallback을 허용하고, 그 외에는 `indicator.down({ message: 'redis ping unavailable', ...metadata })`를 반환한다.

### WR-02: WARNING - Socket.IO smoke can race room join before lock emission

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:512`

**Issue:** `joinShowtime()`은 `join-showtime`을 emit한 뒤 750ms sleep만 한다. Cloud Run cold start, gateway scheduling, network jitter가 있으면 socket이 room에 들어가기 전에 lock request가 발생하고, Redis pub/sub가 정상이어도 `waitForSeatUpdate()`가 timeout될 수 있다.

**Fix:** gateway의 `joined` event 또는 Socket.IO ack를 timeout과 함께 기다린 뒤 lock request를 보내도록 smoke를 바꾼다.

### WR-03: WARNING - Cleanup smoke treats malformed seat status as success

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:371`

**Issue:** `readSeatState()`는 `body.seats`가 없거나 응답 shape이 깨져도 `unknown`을 반환한다. `unlockAndVerifySeat()`는 `afterState !== 'locked'`이면 cleanup success로 처리하므로, seat-status endpoint가 malformed response를 반환해도 cleanup PASS evidence가 기록될 수 있다.

**Fix:** `body.seats`가 object인지 먼저 검증하고, seat가 map에 없을 때만 explicit `available` 상태로 취급한다. malformed response는 throw해서 smoke 실패로 남긴다.

---

_Reviewed: 2026-05-04T00:33:11Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
