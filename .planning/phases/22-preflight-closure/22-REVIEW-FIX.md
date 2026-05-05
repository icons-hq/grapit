---
phase: 22-preflight-closure
fixed_at: 2026-05-05T06:09:55Z
review_path: .planning/phases/22-preflight-closure/22-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 22: Code Review Fix Report

**Fixed at:** 2026-05-05T06:09:55Z
**Source review:** .planning/phases/22-preflight-closure/22-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: 존재하지 않는 showtime/seat fixture로도 smoke가 PASS할 수 있음

**Status:** fixed: requires human verification
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** e1f285a
**Applied fix:** Added required `GRABIT_SMOKE_PERFORMANCE_ID`, validated the configured showtime and seat against the production performance detail before smoke checks run, and failed closed when the fixture is missing.

### WR-01: gcloud 호출이 timeout과 spawn 오류 처리를 하지 않아 smoke가 무기한 멈출 수 있음

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 12a5523
**Applied fix:** Added a 60s `gcloud` timeout, disabled Cloud SDK prompts for smoke execution, and surfaced `spawnSync` errors in command failure output.

### WR-02: HTTP fetch에 timeout이 없어 API/TLS stall 시 검증이 끝나지 않음

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 27ee027
**Applied fix:** Added `fetchWithTimeout()` with a 30s abort deadline and routed both JSON requests and seat unlock requests through it.

### WR-03: 두 번째 Socket.IO 연결 실패 시 첫 번째 socket이 정리되지 않음

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 6579d31
**Applied fix:** Moved socket creation inside the `try` block with nullable socket references so partial connection failures still close any already-open client.

### WR-04: min-instances=2만으로 cross-instance Socket.IO 증명이 보장되지 않음

**Status:** fixed: requires human verification
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** 2bd8b9b
**Applied fix:** Replaced the fixed two-client assumption with a deadline-bound client pool that opens up to 8 Socket.IO clients, uses Cloud Logging to select a pair on distinct Cloud Run instances, and validates lock broadcast on that proven pair.

### WR-05: Cloud Logging instance proof가 단일 5초 sleep에 의존해 거짓 실패할 수 있음

**Status:** fixed
**Files modified:** `scripts/smoke-valkey-production.mjs`
**Commit:** aa17f20
**Applied fix:** Split one-shot Cloud Logging reads into `readSocketInstanceLogs()` and made `lookupSocketInstances()` retry every 5s for up to 60s until all expected client IDs are observed.

---

_Fixed: 2026-05-05T06:09:55Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
