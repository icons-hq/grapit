---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:18:53Z
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

**Reviewed:** 2026-04-30T08:18:53Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 재검토했다. 요청대로 production smoke 미수행 자체는 결함으로 보고하지 않았다. 이전 review의 startup ping, Sentry observation, bearer redaction, min-instances preflight, non-Error health rejection 항목은 현재 코드에서 반영되어 있었다.

검증 중 `pnpm --filter @grabit/api typecheck`, `node --check scripts/smoke-valkey-production.mjs`, 그리고 API unit test suite는 통과했다. 다만 smoke artifact가 약속한 redaction 범위보다 좁게 동작해 민감 데이터가 `20-HUMAN-UAT.md`에 남을 수 있는 security defect가 남아 있다.

## Critical Issues

### CR-01: BLOCKER - Smoke artifact redaction이 international phone/order 값을 누출할 수 있음

**File:** `scripts/smoke-valkey-production.mjs:88`

**Issue:** `writeArtifact()`는 line 768에서 `phone numbers`, `paymentKey`, `orderId`를 redaction한다고 기록하지만, 실제 `redact()`는 line 88에서 `+82...` 전화번호만 지우고 line 89에서 `paymentKey|orderId` 값이 12자 이상인 경우만 지운다. 이 codebase의 phone parser는 E.164 international number를 허용하므로 `+8613800138000` 같은 값이 Sentry observation, Cloud Logging error, non-OK response body에 포함되면 artifact에 그대로 append된다. `orderId=ORD-1`처럼 짧은 safe/test order id도 redaction contract와 달리 남는다. Production smoke script는 operator auth와 production evidence를 다루므로 partial redaction은 정보 노출 위험이다.

**Fix:**
```js
function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(/\+[1-9]\d{5,14}\b/g, '+<redacted>')
    .replace(/\b(paymentKey|orderId)\s*[:=]\s*"?[^\s"',|)]+/gi, '$1=<redacted>')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

`+821012345678`, `+8613800138000`, `+12025550123`, `orderId=ORD-1`, and quoted JSON-style payment/order values가 모두 artifact/console output에 남지 않는 regression check를 추가해야 한다.

---

_Reviewed: 2026-04-30T08:18:53Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
