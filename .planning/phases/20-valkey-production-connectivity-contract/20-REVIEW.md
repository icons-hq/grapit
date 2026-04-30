---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:51:04Z
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

**Reviewed:** 2026-04-30T08:51:04Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 재검토했다. Production smoke 미수행은 사용자 요청에 따른 의도적 skip이므로 source defect로 기록하지 않았다.

Commit `6558702`의 JSON-style `Authorization`/`Cookie` redaction은 이전 blocker를 닫았다. 다만 같은 smoke artifact sanitizer가 `JWT:` label 형태의 credential을 지우지 못한다. 이 값은 operator가 붙이는 Sentry/log observation을 통해 `20-HUMAN-UAT.md`에 기록될 수 있으므로, redaction contract가 아직 완전하지 않다.

보조 검증:
- `node --check scripts/smoke-valkey-production.mjs` 통과
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false` 통과
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts` 통과: 3 files, 40 tests
- `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help` 통과
- source-extracted `redact()` harness에서 raw/JSON `Authorization`/`Cookie`는 제거됐지만 `JWT: header.payload.signature`가 그대로 남는 것을 확인

## Critical Issues

### CR-01: BLOCKER - Smoke artifact redaction misses JWT-labeled tokens

**File:** `scripts/smoke-valkey-production.mjs:91`

**Issue:** `redact()`는 긴 JWT-like 값만 제거하고, `JWT: <value>` label 형태를 처리하지 않는다. 그런데 help text와 artifact output은 JWT redaction을 보장한다고 선언하고 있으며, `GRABIT_SMOKE_SENTRY_OBSERVATION` 값은 line 619-626에서 summary로 들어가 line 780/786을 통해 `20-HUMAN-UAT.md`에 append된다. Sentry/Cloud Logging payload나 operator note가 `JWT: header.payload.signature`처럼 label을 포함하면 credential material이 commit 대상 artifact에 남는다.

**Fix:**
```js
const JWT_LABEL_PATTERN = /\bJWT:\s*[^\s`'")]+/gi;
const JWT_VALUE_PATTERN = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/(["']\bAuthorization["']\s*:\s*["']?)Bearer\s+[^"',}\]\s]+["']?/gi, '$1Bearer <redacted>"')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/(["']\bCookie["']\s*:\s*["']?)[^"',}\]\r\n]+["']?/gi, '$1<redacted>"')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(JWT_LABEL_PATTERN, 'JWT: <redacted>')
    .replace(JWT_VALUE_PATTERN, '<jwt:redacted>')
    .replace(PHONE_PATTERN, '<phone:redacted>')
    .replace(/(["']?\b(paymentKey|orderId)["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi, '$1"<redacted>"')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

동일한 regression harness에 `JWT: header.payload.signature`, 실제 긴 JWT, raw/JSON `Authorization`, raw/JSON `Cookie`, phone, payment/order 값을 함께 넣고 console output과 artifact output 모두에서 raw 값이 사라지는지 확인해야 한다.

---

_Reviewed: 2026-04-30T08:51:04Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
