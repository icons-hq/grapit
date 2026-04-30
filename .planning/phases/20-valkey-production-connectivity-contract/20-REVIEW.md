---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T07:46:48Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - .github/workflows/deploy.yml
  - apps/api/src/config/redis.config.ts
  - apps/api/src/modules/booking/providers/redis.provider.ts
  - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
  - apps/api/src/modules/booking/providers/redis-io.adapter.ts
  - apps/api/src/health/redis.health.indicator.ts
  - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
  - apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts
  - apps/api/src/main.ts
  - apps/api/test/booking-cluster-lua.integration.spec.ts
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T07:46:48Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

`20-REVIEW-FIX.md` iteration 3 및 commit `485f56b` 이후 지정된 11개 source file을 표준 깊이로 재검토했다. 이전 blocking issue였던 traffic-serving `latestReadyRevisionName` gate는 `runtimeContractFailures()`에 반영되어 있고, Socket.IO instance lookup 및 log keyword query도 `cloudRunRevisionFilter()`를 통해 `resource.labels.revision_name="${latestReadyRevisionName}"`로 제한된다. 따라서 prior issue의 핵심인 "latest ready revision 기록만 하고 실제 traffic/log scope는 묶지 않는 문제"는 코드상 해결된 것으로 확인했다. Production smoke 자체가 deferred인 점은 요청대로 code issue로 보고하지 않았다.

다만 final smoke와 redaction 표면에 shipping 전에 막아야 할 결함이 남아 있다. 특히 public health output과 Redis provider log sanitizer는 `Authorization`/`Cookie`/`JWT` label만 치환하고 값은 남길 수 있으며, Lua smoke는 `DELETE` status code만 보고 unlock 성공으로 처리해 lock이 실제로 사라졌는지 증명하지 않는다.

검증 중 실행한 명령:

- `node --check scripts/smoke-valkey-production.mjs`
- `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts`

## Critical Issues

### CR-01: BLOCKER - Redis/health sanitizers redact labels but leave secret values

**File:** `apps/api/src/modules/booking/providers/redis.provider.ts:581`, `apps/api/src/health/redis.health.indicator.ts:12`

**Issue:** `sanitizeRedisErrorMessage()` and `sanitizeHealthMessage()` replace only the words `Authorization`, `Cookie`, and `JWT`. A message such as `Authorization: Bearer abc.def.ghi Cookie: session=topsecret JWT: header.payload.signature` becomes `[redacted secret]: Bearer abc.def.ghi [redacted secret]: session=topsecret [redacted secret]: header.payload.signature`, so the credential values remain. The health endpoint is public and returns sanitized error messages on Redis ping failure, so this is a real secret exposure path if an upstream error includes auth material.

**Fix:**
```ts
const AUTH_HEADER_PATTERN = /\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi;
const COOKIE_HEADER_PATTERN = /\bCookie:\s*[^`\n\r]+/gi;
const JWT_PATTERN = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;

function sanitizeMessage(message: string): string {
  return message
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(AUTH_HEADER_PATTERN, 'Authorization: Bearer [redacted]')
    .replace(COOKIE_HEADER_PATTERN, 'Cookie: [redacted]')
    .replace(JWT_PATTERN, '[jwt:redacted]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted host]')
    .replace(/\+\d{6,15}\b/g, '[redacted phone]')
    .replace(/\b(paymentKey|orderId|token|secret)=\S+/gi, '$1=[redacted]');
}
```

Add regression tests that reject the original `Bearer`, cookie value, and JWT-like token in both provider logs and health down responses. Prefer a shared sanitizer helper so provider, health, and smoke redaction cannot drift again.

### CR-02: BLOCKER - Lua smoke can pass unlock while the seat remains locked

**File:** `scripts/smoke-valkey-production.mjs:409`

**Issue:** `checkLua()` sets `unlockOk` from the HTTP status only (`204` or `200`) and then returns PASS when `locked && seatLocked && unlockOk`. The current booking `DELETE /booking/seats/lock/:showtimeId/:seatId` controller returns `204` after calling `unlockSeat()` and does not expose the boolean result, so the smoke can pass even if Redis failed to delete the lock. The same cleanup pattern is used in Socket.IO smoke. That leaves the production contract able to certify lock/status/unlock without proving the unlock cleanup, and it can leave the safe fixture locked until TTL.

**Fix:**
```js
async function unlockAndVerifySeat(config) {
  const unlock = await fetch(new URL(
    `/api/v1/booking/seats/lock/${encodeURIComponent(config.showtimeId)}/${encodeURIComponent(config.seatId)}`,
    config.apiUrl,
  ), {
    method: 'DELETE',
    headers: config.authHeaders,
  });
  if (unlock.status !== 204 && unlock.status !== 200) {
    const text = await unlock.text();
    throw new Error(`unlock failed with ${unlock.status}: ${redact(text)}`);
  }

  const after = await requestJson(
    config,
    `/api/v1/booking/schedules/${encodeURIComponent(config.showtimeId)}/seats`,
  );
  const afterState = after.body?.seats?.[config.seatId] ?? after.body?.[config.seatId] ?? 'unknown';
  return afterState !== 'locked';
}
```

Use this in `checkLua()` and in the Socket.IO cleanup path; record the post-unlock state in the artifact summary. If Socket.IO cleanup is part of the check, also wait for or explicitly query the `available` state instead of treating `DELETE` transport success as Redis cleanup proof.

## Warnings

### WR-01: WARNING - Idle seconds parser accepts malformed values

**File:** `scripts/smoke-valkey-production.mjs:126`

**Issue:** `parsePositiveInteger()` uses `Number.parseInt()`, so values like `30m`, `1.5`, or `1800abc` are accepted as `30`, `1`, and `1800`. A typo in `GRABIT_SMOKE_IDLE_SECONDS` can silently shorten the idle reconnect window and produce misleading evidence.

**Fix:**
```js
function parsePositiveInteger(name, value) {
  const trimmed = String(value).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(trimmed);
}
```

### WR-02: WARNING - Failed smoke checks abort before writing FAIL evidence

**File:** `scripts/smoke-valkey-production.mjs:359`

**Issue:** `requestJson()` throws on any non-2xx response, and `runChecks()` does not wrap individual checks before `writeArtifact()`. A Redis-down `/health` response, failed Lua request, Socket.IO connection error, or `gcloud` failure exits the script without appending a FAIL block to `20-HUMAN-UAT.md`. The exit code is correct, but the evidence artifact contract becomes unreliable exactly when a production failure needs a recorded, redacted summary.

**Fix:**
```js
async function captureCheck(name, run) {
  try {
    return await run();
  } catch (error) {
    return {
      name,
      ok: false,
      summary: redact(error?.message ?? error),
    };
  }
}

checks.push(await captureCheck('Health Ping Smoke', () => checkHealth(config)));
```

Keep truly unsafe setup failures fail-fast before mutation, but once an artifact path and target are known, convert per-check failures into `ok: false` summaries so `writeArtifact()` always records the failed production observation.

---

_Reviewed: 2026-04-30T07:46:48Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
