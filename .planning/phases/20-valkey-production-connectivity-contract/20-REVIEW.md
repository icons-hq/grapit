---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T07:28:11Z
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
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T07:28:11Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Re-reviewed the Phase 20 Valkey production connectivity changes after `20-REVIEW-FIX.md`, with emphasis on CR-01, CR-02, CR-03, CR-04, and WR-01. CR-01, CR-02, CR-03, and the original WR-01 are resolved in code: the cluster subscriber duplicate now uses the correct `Cluster#duplicate(undefined, overrideOptions)` shape, cluster Redis URLs preserve auth/TLS, Redis URL redaction covers `redis://` and `rediss://`, and standalone `--check logs` now requires `GRABIT_SMOKE_LOG_SINCE_UTC`.

CR-04 is only partially resolved. The smoke script now validates Redis mode/client/configuration and several Cloud Run/Valkey runtime fields, but it can still run the HTTP/Lua/Socket.IO checks against an arbitrary `GRABIT_API_URL` while separately checking metadata for the real `grabit-api` service. That leaves a production evidence false-positive path. Production smoke itself remains intentionally deferred and is not reported as a missing code issue.

Verification run during review:

- `node --check scripts/smoke-valkey-production.mjs`
- `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/redis-io.adapter.spec.ts src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts`
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`

## Critical Issues

### CR-04: BLOCKER - Smoke checks can still target a non-production API origin

**File:** `scripts/smoke-valkey-production.mjs:124`

**Issue:** `loadConfig()` parses `GRABIT_API_URL`, but never enforces the production origin that the same script documents at lines 43-45 and `20-HUMAN-UAT.md` requires as `https://api.heygrabit.com`. `runChecks()` then fetches Cloud Run and Memorystore evidence for the fixed `grabit-api`/`grabit-valkey` production resources, while `checkHealth()`, `checkLua()`, `checkSocketIo()`, and `checkIdle()` execute against whatever host the operator supplied. Because `overallOk` only combines runtime metadata and check booleans, the script can append a PASS artifact if `GRABIT_API_URL` points to another compatible deployment. That does not prove the deployed production API revision reaches production Valkey, so the original CR-04 false-positive class remains open.

**Fix:**
```js
const EXPECTED_API_ORIGIN = 'https://api.heygrabit.com';

function parseProductionApiUrl(rawValue) {
  const apiUrl = new URL(rawValue);
  if (
    apiUrl.origin !== EXPECTED_API_ORIGIN ||
    apiUrl.pathname !== '/' ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw new Error(`GRABIT_API_URL must be exactly ${EXPECTED_API_ORIGIN}`);
  }
  return apiUrl;
}

async function loadConfig(check) {
  const apiUrl = parseProductionApiUrl(getEnv('GRABIT_API_URL'));
  // existing config loading...
}
```

Add a regression check for `GRABIT_API_URL=https://staging.example.com` and `GRABIT_API_URL=http://localhost:8080`; both must fail before any gcloud or HTTP smoke call runs.

## Warnings

### WR-02: WARNING - Lua smoke accepts any status string containing "locked"

**File:** `scripts/smoke-valkey-production.mjs:363`

**Issue:** `checkLua()` decides that the status check passed with `statusSummary.includes('locked')`. Since `statusSummary` is a formatted string, values such as `not_locked`, `unlocked`, or any future error/status text containing the substring `locked` would satisfy the PASS condition. The smoke is supposed to prove the selected seat is exactly in the `locked` state after the lock call, so this weakens the production verification signal.

**Fix:**
```js
const seatState = status.body?.seats?.[config.seatId] ?? status.body?.[config.seatId] ?? 'unknown';
const seatLocked = seatState === 'locked';
statusSummary = `seat=${config.seatId}, state=${seatState}`;

return {
  name: 'Lua Lock Status Unlock Smoke',
  ok: locked && seatLocked && unlockOk,
  summary: `lock=${locked ? 'PASS' : 'FAIL'}, status=${statusSummary}, unlock=${unlockOk ? 'PASS' : 'FAIL'}`,
};
```

---

_Reviewed: 2026-04-30T07:28:11Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
