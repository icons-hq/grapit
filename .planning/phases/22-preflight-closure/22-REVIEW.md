---
phase: 22-preflight-closure
reviewed: 2026-05-05T05:58:28Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - scripts/smoke-valkey-production.mjs
findings:
  critical: 1
  warning: 5
  info: 0
  total: 6
status: issues_found
---

# Phase 22: Code Review Report

**Reviewed:** 2026-05-05T05:58:28Z
**Depth:** standard
**Files Reviewed:** 1
**Status:** issues_found

## Summary

`scripts/smoke-valkey-production.mjs`를 표준 깊이로 검토했다. 스크립트는 production Valkey/Socket.IO smoke gate 역할을 하지만, 현재 상태에서는 존재하지 않는 showtime/seat fixture로도 PASS를 만들 수 있고, 네트워크/Cloud Logging/Cloud Run instance 배치 조건 때문에 거짓 실패 또는 장시간 대기가 발생할 수 있다.

## Critical Issues

### CR-01: 존재하지 않는 showtime/seat fixture로도 smoke가 PASS할 수 있음

**Classification:** BLOCKER
**File:** `scripts/smoke-valkey-production.mjs:157-159`
**Issue:** `loadConfig()`는 `GRABIT_SMOKE_SHOWTIME_ID`와 `GRABIT_SMOKE_SEAT_ID`를 문자열로 읽기만 하고 production DB/seat map에 실제 fixture가 있는지 검증하지 않는다. 이후 `readSeatState()`는 응답에 seat ID가 없으면 `available`로 취급한다(`scripts/smoke-valkey-production.mjs:385-388`). 현재 booking lock API도 sold 여부만 확인하므로, 임의 UUID와 임의 seat ID를 넣어도 Redis lock/status/unlock/socket 이벤트가 성공해서 production preflight가 실제 판매 가능한 좌석을 검증하지 못한 채 승인될 수 있다.
**Fix:**
```js
// Add required env:
//   GRABIT_SMOKE_PERFORMANCE_ID

function seatExistsInConfig(seatConfig, seatId) {
  return Array.isArray(seatConfig?.tiers)
    && seatConfig.tiers.some((tier) => Array.isArray(tier.seatIds) && tier.seatIds.includes(seatId));
}

async function validateFixture(config) {
  const performanceId = getEnv('GRABIT_SMOKE_PERFORMANCE_ID');
  const response = await requestJson(config, `/api/v1/performances/${encodeURIComponent(performanceId)}`);
  const performance = response.body;

  const showtimeOk = Array.isArray(performance?.showtimes)
    && performance.showtimes.some((showtime) => showtime.id === config.showtimeId);
  const seatOk = seatExistsInConfig(performance?.seatMap?.seatConfig, config.seatId);

  if (!showtimeOk || !seatOk) {
    throw new Error(`Smoke fixture is invalid: showtime=${showtimeOk ? 'ok' : 'missing'}, seat=${seatOk ? 'ok' : 'missing'}`);
  }
}

async function runChecks(config) {
  await validateFixture(config);
  // existing checks...
}
```

## Warnings

### WR-01: gcloud 호출이 timeout과 spawn 오류 처리를 하지 않아 smoke가 무기한 멈출 수 있음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:199`
**Issue:** `runCli()`가 `spawnSync()`를 timeout 없이 실행하고 `result.error`도 별도로 반영하지 않는다. `gcloud` 인증 프롬프트, 네트워크 정지, SDK hang이 발생하면 smoke process가 종료되지 않아 검증 artifact가 생성되지 않는다. `gcloud` binary가 없을 때도 실제 원인 대신 빈 stderr 기반 실패가 기록되어 운영자가 원인을 바로 알기 어렵다.
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

### WR-03: 두 번째 Socket.IO 연결 실패 시 첫 번째 socket이 정리되지 않음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:638-640`
**Issue:** `checkSocketIo()`는 `socketA`와 `socketB`를 만든 뒤에야 `try/finally`에 진입한다. `socketA` 연결은 성공하고 `socketB` 연결이 실패하면 `finally`가 실행되지 않아 `socketA`가 열린 상태로 남는다. `--check all`에서는 이후 idle/log checks 동안 불필요한 production socket 연결이 유지되고, 추가 로그/이벤트가 smoke 결과를 오염시킬 수 있다.
**Fix:**
```js
async function checkSocketIo(config, cloudRun) {
  let socketA;
  let socketB;
  let lockDone = false;

  try {
    socketA = await connectSocket(config, 'a');
    socketB = await connectSocket(config, 'b');
    // existing join, lock, propagation checks...
  } finally {
    if (lockDone) {
      await unlockAndVerifySeat(config).catch(() => undefined);
    }
    socketA?.close();
    socketB?.close();
  }
}
```

### WR-04: min-instances=2만으로 cross-instance Socket.IO 증명이 보장되지 않음

**Classification:** WARNING
**File:** `scripts/smoke-valkey-production.mjs:628-666`
**Issue:** `checkSocketIo()`는 `min-instances >= 2`만 확인한 뒤 socket 두 개를 열고 서로 다른 Cloud Run instance에 배치됐다고 기대한다. 하지만 Cloud Run load balancing과 현재 deploy의 `--session-affinity` 설정에서는 같은 client/auth/cookie 조건의 두 연결이 같은 instance로 갈 수 있다. 그 경우 Redis adapter가 정상이어도 `instances.length < 2`로 D-10/D-13이 FAIL 처리된다.
**Fix:** socket을 2개로 고정하지 말고 deadline 동안 여러 client를 열어 Cloud Logging에서 서로 다른 instance ID가 확인된 client pair를 고른 뒤 lock/broadcast 검증을 수행한다. 또는 smoke 실행 중 session affinity를 비활성화하는 별도 preflight 절차를 명시해야 한다.
```js
const INSTANCE_PROOF_TIMEOUT_MS = 90_000;
const MAX_SOCKET_CLIENTS = 8;

// Connect/join clients until lookupSocketInstances() proves at least two
// distinct instance IDs, then wait for seat-update on one client from each
// instance before declaring D-10/D-13 PASS.
```

### WR-05: Cloud Logging instance proof가 단일 5초 sleep에 의존해 거짓 실패할 수 있음

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

_Reviewed: 2026-05-05T05:58:28Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
