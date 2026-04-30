---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T08:36:44Z
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
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T08:36:44Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

지정된 10개 source file을 표준 깊이로 재검토했다. 요청대로 production smoke 미수행 자체는 defect로 기록하지 않았다. 이전 payment/order redaction 문제는 보강되었지만, smoke artifact의 PII redaction contract와 logs/Sentry check 입력 계약에 아직 결함이 남아 있다.

보조 검증으로 `pnpm --filter @grabit/api typecheck`, `pnpm --filter @grabit/api test -- redis.provider redis.health.indicator redis-io.adapter`, `node --check scripts/smoke-valkey-production.mjs`를 실행했고 모두 통과했다. Docker 기반 `booking-cluster-lua` integration과 실제 production smoke는 실행하지 않았다.

## Critical Issues

### CR-01: BLOCKER - Smoke artifact phone redaction이 프로젝트에서 허용하는 로컬 전화번호를 누출함

**File:** `scripts/smoke-valkey-production.mjs:88`

**Issue:** `redact()`는 `+\d{6,15}` 형태의 E.164 번호만 지우지만, 이 프로젝트는 가입/SMS 입력에서 `01012345678`, `010-1234-5678` 같은 한국 로컬 전화번호도 허용한다. `GRABIT_SMOKE_SENTRY_OBSERVATION`은 operator가 Sentry/로그 관찰값을 그대로 넣는 경로이고, `writeArtifact()`는 그 summary를 `20-HUMAN-UAT.md`에 append한다. 그런데 line 59와 line 768은 "phone numbers" redaction을 명시하므로, 현재 구현은 artifact contract를 위반하고 PII를 남길 수 있다.

**Fix:**
```js
const PHONE_PATTERN = /(?:\+\d{6,15}\b|\b01[016789]-?\d{3,4}-?\d{4}\b)/g;

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '<jwt:redacted>')
    .replace(PHONE_PATTERN, '<phone:redacted>')
    .replace(/(["']?\b(paymentKey|orderId)["']?\s*[:=]\s*)["']?[^\s"',|)}]+["']?/gi, '$1"<redacted>"')
    .replace(/\b(private customer data|customer data)\b/gi, '<customer-data:redacted>');
}
```

`01012345678`, `010-1234-5678`, `+821012345678`이 console output과 artifact output 모두에 남지 않는 regression test를 추가해야 한다.

## Warnings

### WR-01: WARNING - logs/all smoke가 요구하는 Sentry 입력이 help와 preflight 계약에 빠져 있음

**File:** `scripts/smoke-valkey-production.mjs:614`

**Issue:** `checkLogs()`는 `GRABIT_SMOKE_SENTRY_OBSERVATION`이 없으면 `ok: false`를 반환하지만, `usage()`의 required/optional environment 목록에는 이 변수가 없다. 따라서 operator가 `--check logs` 또는 `--check all`을 help대로 준비해도 script가 artifact에 FAIL을 기록한다. 이는 production evidence contract를 불명확하게 만들어 재실행과 잘못된 FAIL artifact를 유발한다.

**Fix:** `usage()`에 `GRABIT_SMOKE_SENTRY_OBSERVATION`을 `--check logs`/`--check all` 필수 입력으로 추가하고, `runChecks()`에서 logs/all 실행 전에 명시적으로 fail-fast 하거나 pending 상태를 별도 기록한다.

```js
if (
  (config.check === 'logs' || config.check === 'all')
  && !process.env.GRABIT_SMOKE_SENTRY_OBSERVATION?.trim()
) {
  throw new Error('GRABIT_SMOKE_SENTRY_OBSERVATION is required for --check logs and --check all');
}
```

---

_Reviewed: 2026-04-30T08:36:44Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
