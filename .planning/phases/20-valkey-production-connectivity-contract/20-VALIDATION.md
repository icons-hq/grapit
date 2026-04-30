---
phase: 20
slug: valkey-production-connectivity-contract
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-30
---

# Phase 20 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.4 for unit and integration tests |
| **Config file** | `apps/api/vitest.config.ts`; `apps/api/vitest.integration.config.ts` |
| **Quick run command** | `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts --run` |
| **Full suite command** | `pnpm --filter @grabit/api test && pnpm --filter @grabit/api test:integration` |
| **Estimated runtime** | ~90s quick; Docker-backed integration runtime depends on host |

---

## Sampling Rate

- **After every task commit:** Run the quick command above, plus any new unit test touched by the task.
- **After every plan wave:** Run `pnpm --filter @grabit/api test`.
- **After cluster/Lua integration changes:** Run `pnpm --filter @grabit/api test:integration`.
- **Before `$gsd-verify-work`:** Full suite must be green and production smoke evidence must exist.
- **Max feedback latency:** 120 seconds for quick checks; integration and production smoke are explicit wave/release gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | VALK-02, VALK-05 | T-20-01 | `NODE_ENV=production` never falls back to `InMemoryRedis`; mode/url errors redact secrets. | unit | `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts --run` | yes | pending |
| 20-01-02 | 01 | 1 | VALK-02, VALK-05 | T-20-02 | `VALKEY_MODE=cluster` creates an `ioredis.Cluster` client from sanitized `REDIS_URL`; invalid mode fails closed. | unit | `pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts --run` | yes | pending |
| 20-02-01 | 02 | 1 | VALK-05, SC-4 | T-20-03 | `/api/v1/health` exposes mode/client metadata without `redis://`, host credentials, JWT, or cookies. | unit | `pnpm --filter @grabit/api exec vitest run src/health/__tests__/redis.health.indicator.spec.ts --run` | yes | pending |
| 20-02-02 | 02 | 1 | VALK-04 | T-20-04 | Production Socket.IO adapter failure is visible and does not silently use in-process pub/sub when Redis is configured. | unit | `pnpm --filter @grabit/api exec vitest run src/modules/booking/__tests__/redis-io.adapter.spec.ts --run` | yes | pending |
| 20-03-01 | 03 | 2 | VALK-03, SC-2 | T-20-05 | Booking Lua lock/status/unlock and ownership helpers use same-slot hash-tag keys under Valkey Cluster. | integration | `pnpm --filter @grabit/api test:integration -- booking-cluster-lua` | no, Wave 0 | pending |
| 20-04-01 | 04 | 3 | VALK-02, VALK-04, VALK-05, SC-1, SC-4 | T-20-06 | Production smoke artifacts redact secrets and prove health, Lua, Socket.IO, idle reconnect, rollback, and clean logs. | smoke/UAT | `node scripts/smoke-valkey-production.mjs --artifact .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` or documented equivalent | no, Wave 0 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] Extend `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` for `VALKEY_MODE`, invalid mode, cluster construction, production missing URL, and redaction.
- [ ] Extend `apps/api/src/health/__tests__/redis.health.indicator.spec.ts` for sanitized Valkey mode/client metadata.
- [ ] Extend `apps/api/src/modules/booking/__tests__/redis-io.adapter.spec.ts` for cluster-like duplicate behavior and production adapter failure visibility.
- [ ] Add `apps/api/test/booking-cluster-lua.integration.spec.ts` for booking lock/status/unlock and ownership helpers on single-shard Valkey Cluster.
- [ ] Add `scripts/smoke-valkey-production.mjs` or an equivalent documented runbook for production evidence capture.
- [ ] Add `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` or `20-VERIFICATION.md` with concrete smoke evidence fields.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloud Run -> Memorystore mode/VPC contract | VALK-02, VALK-05 | PSC/private endpoint and Cloud Run runtime state are production-bound. | Record `gcloud memorystore instances list`, `gcloud run services describe grabit-api`, deployed revision, `REDIS_URL` secret binding, VPC network/subnet/egress, and `/api/v1/health` redis up output. |
| Two-instance Socket.IO propagation | VALK-04 | Requires at least two Cloud Run API instances or equivalent production observation. | Record pre-scale state, temporary scaling command if used, two-client/instance correlation evidence for `seat-update`, and restoration to previous scale settings. |
| Idle reconnect | VALK-05, SC-1 | Requires elapsed idle/cold-start interval against deployed Cloud Run. | After realistic idle interval, rerun health, Lua lock/status/unlock, and Socket.IO smoke; record timestamp and revision. |
| Production log/Sentry cleanliness | SC-1, SC-4 | Requires production logging window and Sentry project access. | Query the smoke window for `CROSSSLOT`, `MOVED`, `ASK`, `ECONNRESET`, `ETIMEDOUT`, subscription failure, and adapter fallback; record zero-count or incident IDs. |

---

## Threat Model Requirements

Each `PLAN.md` for Phase 20 must include a `<threat_model>` block covering:

- **T-20-01 Secret leakage:** `REDIS_URL`, auth headers, cookies, JWTs, phone numbers, payment data, and private customer data must not appear in logs or artifacts.
- **T-20-02 Silent production fallback:** production must not use `InMemoryRedis` or default in-process Socket.IO pub/sub when `REDIS_URL` is configured.
- **T-20-03 Cluster mode mismatch:** `VALKEY_MODE` or live mode mismatch must fail a test, startup path, or smoke gate instead of being informational only.
- **T-20-04 Lua key slot drift:** every multi-key Lua path must use explicit `KEYS` and shared hash tags, with cluster-mode integration coverage.
- **T-20-05 Real inventory mutation:** production smoke must use an operator-approved safe fixture and must unlock or prove TTL expiry.
- **T-20-06 Temporary scale not restored:** any scaling or traffic change for multi-instance proof must record pre-state and restore it.

---

## Validation Sign-Off

- [x] All planned task categories have automated verify or manual smoke dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 lists all missing test/smoke artifacts.
- [x] No watch-mode flags.
- [x] Feedback latency target is explicit.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
