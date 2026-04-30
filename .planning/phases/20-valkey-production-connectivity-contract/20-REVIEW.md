---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T07:10:01Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .github/workflows/deploy.yml
  - apps/api/src/config/redis.config.ts
  - apps/api/src/modules/booking/providers/redis.provider.ts
  - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
  - apps/api/src/health/redis.health.indicator.ts
  - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
  - apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts
  - apps/api/src/main.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 4
  warning: 1
  info: 0
  total: 5
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T07:10:01Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the Phase 20 deploy/config/provider/health/test/smoke changes plus the called Redis Socket.IO adapter and booking/health contracts needed to evaluate behavior. `node --check scripts/smoke-valkey-production.mjs`, smoke `--help`, and `pnpm --filter @grabit/api typecheck` passed, but the implementation still has production-blocking cluster and evidence-contract defects.

## Critical Issues

### CR-01: BLOCKER - Cluster Socket.IO subscriber duplicate ignores required options

**File:** `apps/api/src/modules/booking/providers/redis.provider.ts:625`

**Issue:** Phase 20 now returns an `ioredis.Cluster` when `VALKEY_MODE=cluster`, and `main.ts` passes that client into `RedisIoAdapter`. The adapter's existing duplicate call uses the standalone Redis signature, `duplicate({ maxRetriesPerRequest: null, enableReadyCheck: false })`. For `ioredis.Cluster`, the signature is `duplicate(overrideStartupNodes, overrideOptions)`, so that object is treated as startup-node override input and the required subscriber options are silently dropped. I verified locally that the resulting duplicate keeps `enableReadyCheck: true` and `redisOptions.maxRetriesPerRequest: 3`. Production startup still reports `redisPubSubReady=true` because `.duplicate()` exists, so the fail-closed guard does not catch the broken cluster subscriber configuration.

**Fix:**
```ts
// apps/api/src/modules/booking/providers/redis-io.adapter.ts
import IORedis, { Cluster } from 'ioredis';

function duplicateSocketSubscriber(pubClient: IORedis | Cluster): IORedis | Cluster {
  if (pubClient instanceof Cluster) {
    return pubClient.duplicate(undefined, {
      enableReadyCheck: false,
      redisOptions: {
        ...(pubClient.options.redisOptions ?? {}),
        maxRetriesPerRequest: null,
      },
    });
  }

  return pubClient.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
```

Add a real `Cluster` unit test that asserts `duplicate(undefined, { redisOptions: { maxRetriesPerRequest: null }, enableReadyCheck: false })` is used in cluster mode.

### CR-02: BLOCKER - Cluster REDIS_URL parsing drops auth and TLS

**File:** `apps/api/src/modules/booking/providers/redis.provider.ts:625`

**Issue:** In cluster mode the provider parses `REDIS_URL`, then constructs `new Cluster([{ host, port }], { redisOptions: { maxRetriesPerRequest: 3 } })`. This discards `username`, `password`, `rediss:` TLS intent, and any invalid scheme detection. A secret such as `rediss://default:PASSWORD@HOST:PORT`, which is still a documented Redis URL shape in this repo, will be converted into an unauthenticated non-TLS cluster connection. That either prevents production connectivity or silently weakens the configured transport.

**Fix:**
```ts
function buildRedisOptions(parsedUrl: URL) {
  if (parsedUrl.protocol !== 'redis:' && parsedUrl.protocol !== 'rediss:') {
    throw new Error('[redis] REDIS_URL must use redis:// or rediss://.');
  }

  return {
    maxRetriesPerRequest: 3,
    ...(parsedUrl.username ? { username: decodeURIComponent(parsedUrl.username) } : {}),
    ...(parsedUrl.password ? { password: decodeURIComponent(parsedUrl.password) } : {}),
    ...(parsedUrl.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

const redisOptions = buildRedisOptions(parsedUrl);
const client = new Cluster([{ host: parsedUrl.hostname, port }], {
  lazyConnect: true,
  scaleReads: 'master',
  enableReadyCheck: true,
  redisOptions,
  clusterRetryStrategy,
});
```

Also reject non-root URL paths in cluster mode unless a supported DB-selection strategy exists; Redis Cluster does not support arbitrary logical DB selection.

### CR-03: BLOCKER - Redis URL redaction misses rediss:// secrets

**File:** `scripts/smoke-valkey-production.mjs:81`, `apps/api/src/modules/booking/providers/redis.provider.ts:563`, `apps/api/src/health/redis.health.indicator.ts:12`

**Issue:** All three redaction functions only match `redis://`. They do not redact `rediss://default:password@host:port`, so TLS Redis URLs with credentials can leak into console output, Cloud Run logs, health detail, or the appended `20-HUMAN-UAT.md` smoke artifact when an error string includes the URL. The current tests only cover `redis://`, and the health redaction test does not exercise the error path because `ping()` returns `PONG`.

**Fix:**
```ts
const REDIS_URL_PATTERN = /\brediss?:\/\/[^\s`'")]+/gi;

function redactRedisUrl(value: string): string {
  return value.replace(REDIS_URL_PATTERN, '[redacted redis url]');
}
```

Use the shared pattern in provider logging, health output, and the smoke script. Add regression tests that pass failing error messages containing both `redis://:secret@host:6379` and `rediss://default:secret@host:6379`.

### CR-04: BLOCKER - Smoke script can pass without enforcing the stated production contract

**File:** `scripts/smoke-valkey-production.mjs:291`

**Issue:** `checkHealth()` returns `ok` when `/health` is `ok` and `redis.status` is `up`, but it does not require `mode=cluster`, `client=ioredis-cluster`, or `configured=true`, even though those are explicit PASS criteria in `20-HUMAN-UAT.md`. Separately, `modeContractOk` only checks Cloud Run `VALKEY_MODE` and live Memorystore mode; it records but does not fail on `REDIS_URL` being a raw environment value instead of a Secret Manager binding, and it does not enforce the VPC egress/network contract. This can produce an `overallOk=true` artifact that has not actually proven the Phase 20 production runtime contract.

**Fix:**
```ts
async function checkHealth(config) {
  const response = await requestJson(config, '/api/v1/health');
  const redis = redisHealthDetail(response.body);
  const mode = redis?.mode ?? redis?.metadata?.mode;
  const client = redis?.client ?? redis?.metadata?.client;
  const configured = redis?.configured ?? redis?.metadata?.configured;

  return {
    name: 'Health Ping Smoke',
    ok: response.body?.status === 'ok'
      && redis?.status === 'up'
      && mode === 'cluster'
      && client === 'ioredis-cluster'
      && configured === true,
    summary: `health=${response.body?.status ?? 'unknown'}, redis=${redis?.status ?? 'unknown'}, mode=${mode ?? 'unknown'}, client=${client ?? 'unknown'}, configured=${configured ?? 'unknown'}`,
  };
}

const runtimeContractOk =
  cloudRun.declaredValkeyMode === EXPECTED_VALKEY_MODE
  && cloudRun.redisUrlBinding === 'secret-bound'
  && cloudRun.vpcEgress === 'private-ranges-only'
  && cloudRun.networkInterfaces !== 'unknown'
  && memorystore.mode === EXPECTED_LIVE_MODE;
```

Report each failed runtime-contract field in the artifact so an operator can see exactly which prerequisite failed.

## Warnings

### WR-01: WARNING - Standalone log smoke checks only the moment after it starts

**File:** `scripts/smoke-valkey-production.mjs:497`

**Issue:** `runChecks()` sets `startedUtc = new Date().toISOString()` at process start and passes that to `checkLogs()`. When an operator runs `--check logs` after a separate `--check health`, `--check lua`, or manual smoke window, the log query starts at the `--check logs` invocation time, not at the smoke window. That can return zero failures and append clean evidence while ignoring failures produced by the smoke run that just happened.

**Fix:** Require an explicit smoke-window start for standalone log checks, or make `--check logs` read the latest artifact run timestamp.

```ts
if (config.check === 'logs' && !process.env.GRABIT_SMOKE_LOG_SINCE_UTC) {
  throw new Error('GRABIT_SMOKE_LOG_SINCE_UTC is required for standalone --check logs');
}

const logSinceIso = process.env.GRABIT_SMOKE_LOG_SINCE_UTC ?? startedUtc;
checks.push(await checkLogs(config, logSinceIso));
```

---

_Reviewed: 2026-04-30T07:10:01Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
