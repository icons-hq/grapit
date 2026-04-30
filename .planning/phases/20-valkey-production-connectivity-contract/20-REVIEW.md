---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:44:10Z
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
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T08:44:10Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 재검토했다. Production smoke 미수행은 사용자 요청에 따른 의도적 skip이므로 source defect로 기록하지 않았다.

Commit `6119823`의 phone redaction과 Sentry preflight 보강은 이전 finding을 대부분 닫았지만, smoke artifact redaction이 JSON 형태의 auth/cookie header 값을 지우지 못한다. 이 경로는 operator가 `GRABIT_SMOKE_SENTRY_OBSERVATION`에 Sentry/log payload를 붙이는 계약과 직접 연결되어 있어, artifact에 credential material이 남을 수 있다.

보조 검증:
- `node --check scripts/smoke-valkey-production.mjs` 통과
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false` 통과
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts` 통과: 3 files, 40 tests
- `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help` 통과
- source-extracted `redact()` harness에서 `{"Authorization":"Bearer super-secret-token","Cookie":"sid=topsecret"}` 값이 그대로 남는 것을 확인

## Critical Issues

### CR-01: BLOCKER - Smoke artifact redaction misses JSON auth/cookie headers

**File:** `scripts/smoke-valkey-production.mjs:87`

**Issue:** `redact()`는 `Authorization: Bearer ...`와 `Cookie: ...` 텍스트 header만 제거한다. 하지만 `GRABIT_SMOKE_SENTRY_OBSERVATION`은 operator가 Sentry/Cloud Logging payload를 넣는 입력이고, 그런 payload는 흔히 `{"Authorization":"Bearer ..."}` 또는 `{"Cookie":"..."}` 같은 JSON 형태로 나타난다. 이 값은 line 624 summary에 포함되고 line 778/784를 통해 `20-HUMAN-UAT.md`에 append된다. 현재 구현은 artifact contract의 "Authorization, Cookie redaction"을 만족하지 못해 bearer token이나 session cookie가 commit 대상 evidence artifact에 남을 수 있다.

**Fix:**
```js
const AUTH_HEADER_PATTERN =
  /\bAuthorization:\s*Bearer\s+[^\s`'")]+|["']?authorization["']?\s*:\s*["']?Bearer\s+[^"',\s)}]+["']?/gi;
const COOKIE_HEADER_PATTERN =
  /\bCookie:\s*[^`\n\r]+|["']?cookie["']?\s*:\s*["']?[^"',\n\r)}]+["']?/gi;

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(AUTH_HEADER_PATTERN, 'Authorization: Bearer <redacted>')
    .replace(COOKIE_HEADER_PATTERN, 'Cookie: <redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(PHONE_PATTERN, '<phone:redacted>')
    .replace(/(["']?\b(paymentKey|orderId)["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi, '$1"<redacted>"')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

동일한 regression harness에 colon header와 JSON header를 모두 넣어 console output과 artifact output에서 raw bearer/cookie 값이 사라지는지 확인해야 한다. 같은 sanitizer pattern을 쓰는 `apps/api/src/health/redis.health.indicator.ts:11`와 `apps/api/src/modules/booking/providers/redis.provider.ts:18`도 drift 없이 같이 harden하는 편이 안전하다.

---

_Reviewed: 2026-04-30T08:44:10Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
