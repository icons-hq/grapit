---
phase: 20-valkey-production-connectivity-contract
reviewed: 2026-04-30T07:36:54Z
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
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-04-30T07:36:54Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

`20-REVIEW-FIX.md` iteration 2 이후 지정된 11개 source file을 표준 깊이로 재검토했다. 이전 이슈 중 CR-01, CR-02, CR-03, CR-04 follow-up, WR-01, WR-02는 코드상 해결된 것을 확인했다: cluster subscriber duplicate overload, cluster REDIS_URL auth/TLS propagation, `redis://`/`rediss://` redaction, production API origin 강제, standalone logs `since` 강제, Lua status exact match가 모두 반영되어 있다.

다만 원래 CR-04 계열의 false-positive 위험이 하나 남아 있다. smoke script는 `latestReadyRevisionName`을 artifact에 기록하지만, 자동 PASS 조건에서 실제 public traffic이 그 revision으로 100% 향하는지 확인하지 않고 Cloud Logging query도 revision으로 제한하지 않는다. Production smoke 실행 자체가 아직 deferred인 점은 이 리뷰에서 문제로 삼지 않았다.

검증 중 실행한 명령:

- `node --check scripts/smoke-valkey-production.mjs`
- `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help`
- `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/redis-io.adapter.spec.ts src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts`
- `pnpm --filter @grabit/api exec tsc --noEmit --pretty false`
- `GRABIT_API_URL=http://localhost:8080 node scripts/smoke-valkey-production.mjs --check health` failed before auth/gcloud/HTTP with `GRABIT_API_URL must be exactly https://api.heygrabit.com`
- `GRABIT_API_URL=https://staging.example.com node scripts/smoke-valkey-production.mjs --check health` failed with the same production-origin guard

## Critical Issues

### CR-01: BLOCKER - Smoke PASS is not tied to the traffic-serving Cloud Run revision

**File:** `scripts/smoke-valkey-production.mjs:275`

**Issue:** `getCloudRunEvidence()` captures `latestReadyRevisionName` and `traffic`, but `runtimeContractFailures()` only checks Valkey mode, REDIS_URL binding, VPC egress, and network interface fields. `runChecks()` then allows `overallOk` when those runtime fields and HTTP/Lua/Socket.IO checks pass, even if production traffic is split, pinned to an older revision, or not serving the recorded `latestReadyRevisionName`. `writeArtifact()` records the latest ready revision as evidence, and `checkLogs()`/`lookupSocketInstances()` query only by service name, not by revision. This can produce a PASS artifact that does not prove the exact deployed Cloud Run API revision reached production Valkey, contradicting `20-HUMAN-UAT.md`'s revision-scoped evidence contract.

**Fix:**
```js
function runtimeContractFailures(cloudRun, memorystore) {
  const failures = [];
  // existing checks...

  const servingTraffic = Array.isArray(cloudRun.traffic)
    ? cloudRun.traffic.filter((entry) => Number(entry.percent ?? 0) > 0)
    : [];
  const latest = cloudRun.latestReadyRevisionName;
  const latestIsServingAllTraffic = servingTraffic.length === 1
    && servingTraffic[0].percent === 100
    && (
      servingTraffic[0].revisionName === latest
      || servingTraffic[0].latestRevision === true
    );

  if (!latest || latest === 'unknown' || !latestIsServingAllTraffic) {
    failures.push(`traffic is not 100% on latestReadyRevisionName=${latest}`);
  }

  return failures;
}

function cloudRunRevisionFilter(config, cloudRun) {
  return [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `resource.labels.location="${config.region}"`,
    `resource.labels.revision_name="${cloudRun.latestReadyRevisionName}"`,
  ];
}
```

Pass `cloudRun` into `checkLogs()` and `lookupSocketInstances()`, build their filters with `resource.labels.revision_name`, and write the traffic split into the artifact. If traffic is intentionally split, the script should fail automated PASS and require the operator to target or record the exact serving revision explicitly.

---

_Reviewed: 2026-04-30T07:36:54Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
