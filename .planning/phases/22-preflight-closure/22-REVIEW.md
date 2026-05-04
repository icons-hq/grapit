---
phase: 22-preflight-closure
reviewed: 2026-05-04T09:46:40Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-05-04T09:46:40Z
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found

## Summary

`scripts/smoke-valkey-production.mjs`를 표준 깊이로 검토했다. BLOCKER급 보안 취약점이나 데이터 손실 위험은 확인되지 않았지만, production smoke가 네트워크/CLI 지연 시 무기한 멈추거나 Cloud Logging 지연으로 거짓 실패할 수 있는 WARNING급 안정성 결함이 있다.

## Warnings

### WR-01: gcloud 호출이 timeout과 spawn 오류 처리를 하지 않아 smoke가 무기한 멈출 수 있음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:199`
**Issue:** `runCli()`가 `spawnSync()`를 timeout 없이 실행하고 `result.error`도 별도로 반영하지 않는다. `gcloud` 인증 프롬프트, 네트워크 정지, SDK hang이 발생하면 smoke process가 종료되지 않아 `22-preflight-closure` 검증 artifact가 생성되지 않는다. `gcloud` binary가 없을 때도 실제 원인 대신 빈 stderr 기반 실패가 기록되어 운영자가 원인을 바로 알기 어렵다.
**Fix:**
```js
const GCLOUD_TIMEOUT_MS = 60_000;

function runCli(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    timeout: GCLOUD_TIMEOUT_MS,
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    },
  });

  const spawnError = result.error ? String(result.error.message ?? result.error) : '';

  return {
    ok: result.status === 0 && !spawnError,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: spawnError || result.stderr || '',
    shape: `${command} ${args.join(' ')}`,
  };
}
```

### WR-02: HTTP fetch에 timeout이 없어 API/TLS stall 시 검증이 끝나지 않음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:344`
**Issue:** `requestJson()`와 `unlockAndVerifySeat()`의 direct `fetch()`는 timeout이나 abort signal을 사용하지 않는다. production API, TLS handshake, 또는 Cloud Run/LB가 응답을 멈추면 health/lua/socketio/idle check가 fail artifact를 남기지 못하고 계속 대기할 수 있다.
**Fix:**
```js
const HTTP_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options = {}) {
  return await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

async function requestJson(config, path, options = {}) {
  const url = new URL(path, config.apiUrl);
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  // existing response parsing...
}
```

`unlockAndVerifySeat()`의 `fetch()`도 같은 helper를 사용해야 한다.

### WR-03: Cloud Logging instance proof가 단일 5초 sleep에 의존해 거짓 실패할 수 있음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:597`
**Issue:** `lookupSocketInstances()`는 socket 연결 직후 `sleep(5000)` 한 번만 기다린 뒤 Cloud Logging을 조회한다. Cloud Logging ingestion은 몇 초 이상 지연될 수 있으므로 실제로 두 Cloud Run instance에 연결됐더라도 `instances.length`가 0 또는 1로 나와 D-10/D-13 검증이 FAIL 처리될 수 있다. 이 결함은 production runtime 문제가 아니라 검증 도구의 flaky failure를 만든다.
**Fix:**
```js
const LOG_LOOKUP_TIMEOUT_MS = 60_000;
const LOG_LOOKUP_INTERVAL_MS = 5_000;

async function lookupSocketInstances(config, cloudRun, clientIds, sinceIso) {
  const deadline = Date.now() + LOG_LOOKUP_TIMEOUT_MS;
  let latest = new Map();

  while (Date.now() < deadline) {
    await sleep(LOG_LOOKUP_INTERVAL_MS);
    latest = readSocketInstanceLogs(config, cloudRun, clientIds, sinceIso);

    if (clientIds.every((clientId) => latest.has(clientId))) {
      return latest;
    }
  }

  return latest;
}
```

기존 `gcloud logging read` 로직은 `readSocketInstanceLogs()`로 분리하고, 모든 client id가 확인될 때까지 deadline 기반으로 재시도해야 한다.

---

_Reviewed: 2026-05-04T09:46:40Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
