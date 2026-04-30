---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:27:08Z
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

**Reviewed:** 2026-04-30T08:27:08Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 재검토했다. 요청대로 production smoke 미수행 자체는 source defect로 보고하지 않았다. 이전 review의 phone/order redaction 보강은 일부 반영되었지만, artifact에 가장 흔하게 들어오는 JSON-style key/value 형태가 아직 누락되어 security defect가 남아 있다.

검증 보조로 `pnpm --filter @grabit/api typecheck`, `pnpm --filter @grabit/api test -- redis.provider redis.health.indicator redis-io.adapter`, `pnpm --filter @grabit/api test:integration -- booking-cluster-lua`, `node --check scripts/smoke-valkey-production.mjs`를 실행했다. Typecheck, unit suite, integration suite, syntax check는 통과했다.

## Critical Issues

### CR-01: BLOCKER - Smoke artifact redaction이 JSON-style payment/order 값을 누출함

**File:** `scripts/smoke-valkey-production.mjs:89`

**Issue:** `redact()`는 `paymentKey=...`, `orderId: ...` 형태만 지우고, 실제 API error body나 Sentry observation에서 흔한 JSON 형태인 `"paymentKey":"pk_test_123"` / `"orderId":"ORD-1"`은 그대로 남긴다. `requestJson()`은 non-OK response body를 `JSON.stringify(body)`로 error summary에 넣고, `writeArtifact()`는 그 summary를 `20-HUMAN-UAT.md`에 append하므로 production smoke artifact에 payment/order identifiers가 누출될 수 있다. line 768의 artifact contract도 `paymentKey`, `orderId` redaction을 명시하고 있어 현재 구현은 보안 및 artifact contract 양쪽을 위반한다.

**Fix:**
```js
function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(/\+[1-9]\d{5,14}\b/g, '+<redacted>')
    .replace(/(["']?\b(?:paymentKey|orderId)["']?\s*[:=]\s*)["']?[^"',\s|)]+["']?/gi, '$1"<redacted>"')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

`"paymentKey":"pk_test_123"`, `{"orderId":"ORD-1"}`, `paymentKey=pk_test_123`, `orderId: ORD-1`이 console output과 artifact output 양쪽에 남지 않는 regression test를 추가해야 한다.

---

_Reviewed: 2026-04-30T08:27:08Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
