---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:08:14Z
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
  critical: 3
  warning: 2
  info: 0
  total: 5
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T08:08:14Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 검토했다. Production smoke가 실제로 실행되지 않은 점은 요청대로 결함으로 보지 않았다. 대신 향후 production smoke나 Cloud Run 배포가 Valkey 연결 상태를 잘못 증명하거나, 민감한 smoke 입력을 남길 수 있는 source/artifact-contract 결함만 보고한다.

검증 중 `pnpm --filter @grabit/api typecheck`와 `node --check scripts/smoke-valkey-production.mjs`는 통과했다. 통과 여부와 별개로 아래 결함은 런타임/증거 계약상 수정이 필요하다.

## Critical Issues

### CR-01: BLOCKER - Production startup이 unreachable Valkey에서 fail-closed 하지 않음

**File:** `apps/api/src/modules/booking/providers/redis.provider.ts:675`

**Issue:** Production provider가 ioredis Cluster 연결을 `client.connect().catch(() => {})`로 시작하고, standalone 경로도 line 694에서 같은 방식으로 연결 실패를 삼킨다. `apps/api/src/main.ts:53`은 Socket.IO adapter를 만들 수 있었는지만 확인하고, Redis/Valkey가 실제 연결을 받았는지 또는 `PING`에 응답했는지는 확인하지 않는다. 따라서 잘못된 `REDIS_URL`, 깨진 VPC route, 중단된 Memorystore instance가 있어도 Cloud Run revision은 listen 상태가 될 수 있고, 배포 단계는 해당 revision으로 traffic을 보낼 수 있다. 좌석 locking 실패는 이후 사용자 요청 시점까지 지연된다.

**Fix:**
```ts
const redisClient = app.get<IORedis>(REDIS_CLIENT);

if (process.env['NODE_ENV'] === 'production') {
  const pong = await redisClient.ping();
  if (pong !== 'PONG') {
    throw new Error(`[bootstrap] Redis ping returned ${pong}`);
  }
}
```

Production에서는 삼키는 `catch`를 제거하거나 provider factory를 async로 바꿔 연결 완료를 기다린 뒤 반환해야 한다. `/health`는 지속 모니터링으로 유지하되, shared Redis client가 사용 가능한 상태가 되기 전에는 booking API가 serving을 시작하지 않게 막아야 한다.

### CR-02: BLOCKER - 필수 Sentry evidence 없이 smoke log check가 PASS 가능

**File:** `scripts/smoke-valkey-production.mjs:607`

**Issue:** `GRABIT_SMOKE_SENTRY_OBSERVATION`이 없으면 script는 "operator-required" 문자열을 대신 넣지만, `checkLogs()`는 여전히 `ok: count === 0`을 반환한다. 그 결과 `--check logs` 또는 `--check all`이 필수 Sentry dashboard/API observation 없이도 overall PASS를 만들 수 있다. 이는 향후 production smoke evidence를 오해하게 만드는 artifact-contract 결함이다.

**Fix:**
```js
const sentryObservation = process.env.GRABIT_SMOKE_SENTRY_OBSERVATION?.trim();
if (!sentryObservation) {
  return {
    name: 'Log And Sentry Cleanliness',
    ok: false,
    summary: `revision=${cloudRun.latestReadyRevisionName}; since=${sinceIso}; Cloud Logging failure keyword count=${count}; Sentry observation=missing`,
  };
}
```

대안으로 `--check logs`와 `--check all`에서 Sentry observation이 없으면 fail-fast 해야 한다. Cloud Logging과 Sentry evidence가 모두 있을 때만 log cleanliness를 PASS로 표시해야 한다.

### CR-03: BLOCKER - Smoke redaction이 bearer token suffix를 누출할 수 있음

**File:** `scripts/smoke-valkey-production.mjs:85`

**Issue:** `parseAuthHeader()`는 `(.+)`로 임의의 bearer token 문자열을 허용하지만, `redact()`는 `[A-Za-z0-9._-]+`에 맞는 `Authorization: Bearer` 값만 치환한다. Opaque bearer token에는 `+`, `/`, `=`가 흔히 포함될 수 있으므로 `Authorization: Bearer abc+/==` 같은 값은 현재 로직에서 `abc`만 지워지고 `+/==`가 console output 또는 `20-HUMAN-UAT.md`에 남는다. 이 script는 실제 operator auth material을 다루므로 partial leakage도 security defect다.

**Fix:**
```js
function redact(value) {
  return String(value)
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(REDIS_URL_PATTERN, '[redacted redis url]');
}
```

`Authorization: Bearer abc+/==` 같은 regression case를 추가하고, redaction 이후 token fragment가 남지 않는지 assert 해야 한다.

## Warnings

### WR-01: WARNING - Deploy contract와 two-instance Socket.IO smoke가 충돌함

**File:** `.github/workflows/deploy.yml:118`

**Issue:** API service는 `--min-instances=0`으로 배포되지만, `scripts/smoke-valkey-production.mjs:544`는 `Socket.IO Two-Instance Propagation`이 PASS하려면 `minInstances >= 2`를 요구한다. 현재 커밋된 deploy contract 기준으로는 일반 production service가 smoke precondition을 만족하지 못하므로, `--check socketio` / `--check all`은 환경적 이유로 실패하거나 operator가 문서화되지 않은 수동 변경을 해야 한다.

**Fix:** 비용상 production 기본값을 유지해야 한다면 smoke precondition을 script에 명시해야 한다. 예를 들어 smoke script가 API service를 임시로 `min-instances=2`로 올리고, ready instance 2개를 기다린 뒤 propagation proof를 실행하고, `finally`에서 이전 값을 복구하게 만든다. 또는 좌석을 변경하기 전에 "set min instances to 2"라는 명확한 preflight error로 실패해야 한다.

### WR-02: WARNING - non-Error rejection에서 Redis health가 down 대신 throw 가능

**File:** `apps/api/src/health/redis.health.indicator.ts:74`

**Issue:** catch block이 `err`를 `Error`로 cast한 뒤 `(err as Error).message`를 `sanitizeHealthMessage()`에 넘긴다. `redis.ping()`이 string 또는 다른 non-Error value로 reject하면 `message`가 `undefined`가 되고 sanitizer가 `undefined`에 `.replace()`를 호출한다. Redis-down 결과를 반환해야 할 상황이 unhandled health-check exception으로 바뀐다.

**Fix:**
```ts
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return indicator.down({
    ...metadata,
    message: sanitizeHealthMessage(message),
  });
}
```

`mockRedis.ping.mockRejectedValueOnce('ECONNRESET')` unit test를 추가하고 health result가 `down`인지 assert 해야 한다.

---

_Reviewed: 2026-04-30T08:08:14Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
