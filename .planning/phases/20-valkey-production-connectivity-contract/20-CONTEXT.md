# Phase 20: valkey-production-connectivity-contract - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 20 closes the v1.1 audit gap where Cloud Run -> Google Memorystore for Valkey production behavior is implemented at the code/config level but not proven under real runtime conditions.

This phase delivers a production connectivity contract and evidence trail for:

- Valkey standalone/cluster mode detection and connection configuration.
- Cloud Run Direct VPC Egress and Secret Manager `REDIS_URL` wiring.
- `/api/v1/health` Valkey ping behavior on a deployed Cloud Run revision.
- The real Lua seat lock path on production Valkey: lock -> status -> unlock or expiry.
- Socket.IO Redis adapter pub/sub propagation across multiple Cloud Run API instances.
- Idle reconnect and rollback/checklist coverage for the failure modes that cannot be reproduced in local unit tests.

In scope:

- Add or tighten the smallest code/config surface needed to make the production Valkey mode contract explicit and observable.
- Add focused tests for new mode detection, client factory, health, or adapter behavior.
- Produce production smoke/UAT artifacts with concrete commands, timestamps, Cloud Run revision IDs, sanitized outputs, and PASS/FAIL criteria.
- Preserve the existing ioredis single-provider architecture unless live evidence proves a cluster-client change is required.

Out of scope:

- Rewriting the booking or reservation ownership model. Phase 19 owns lock ownership enforcement.
- Re-provisioning the Memorystore instance, recreating the `redis-url` secret, or changing Cloud Run networking unless the smoke proves a mismatch and the operator explicitly approves.
- Queueing/waiting-room work, ranking, high-traffic admission control, or permanent `min-instances` changes for load testing.
- Cleaning up unrelated Valkey tech debt such as cache `KEYS` invalidation or `getMyLocks()` TTL edge cases unless those directly block the Phase 20 smoke.

</domain>

<decisions>
## Implementation Decisions

### Production Mode Contract

- **D-01:** Production Valkey mode must be explicit and observable. The current implicit contract of `new IORedis(url)` is not enough for Phase 20 because the audit gap is specifically about whether production cluster-mode behavior is equivalent to local/testcontainer evidence.
- **D-02:** The planner should implement a deployment/runtime contract that declares or detects the expected mode (`standalone` vs `cluster`) and validates it against the live server. The exact shape is flexible (`REDIS_MODE`, `VALKEY_MODE`, startup probe, health detail, or smoke command), but a mismatch must fail the smoke and block release.
- **D-03:** Keep the Phase 7/17 production safety invariant: `NODE_ENV=production` with missing `REDIS_URL` must hard-fail. Production must never fall back to `InMemoryRedis`.
- **D-04:** Until Phase 20 evidence proves otherwise, treat Google Memorystore for Valkey as potentially cluster-mode even with `shard-count=1`. Multi-key Lua must continue to use explicit `KEYS` and shared hash tags.
- **D-05:** If the live probe shows the standalone ioredis client is not sufficient, scope the client change narrowly to the `REDIS_CLIENT` provider and tests. Do not require service-layer rewrites.

### Production Smoke Evidence

- **D-06:** Phase 20 must produce a repeatable production smoke procedure, not just code-level tests. Evidence should include command, timestamp, Cloud Run service/revision, target URL, sanitized output, and PASS/FAIL result.
- **D-07:** Required smoke truths are:
  1. `/api/v1/health` reports `redis` up on the deployed API revision.
  2. The production seat lock Lua path can lock, read status, and unlock or observe TTL expiry against the live Valkey backend.
  3. Socket.IO `seat-update` propagates through the Redis adapter across two API instances, not only within one process.
  4. A realistic idle/cold-start interval still reconnects successfully for health, lock, and pub/sub.
  5. Cloud Run and Sentry logs show no `CROSSSLOT`, `MOVED`, `ASK`, persistent `ECONNRESET`, or subscription failure during the smoke window.
- **D-08:** If private PSC networking prevents CI from performing the smoke, a human/operator artifact is acceptable and expected. The artifact must be concrete enough to close the audit's `human_needed` status.
- **D-09:** Do not write secrets, full `REDIS_URL`, phone numbers, payment data, JWTs, or private customer data into planning artifacts. Redact connection strings and any PII-like payloads.

### Socket.IO Multi-Instance Proof

- **D-10:** Multi-instance Socket.IO pub/sub propagation is a Phase 20 requirement. Existing unit tests for `RedisIoAdapter` are necessary but not sufficient.
- **D-11:** The smoke should force or observe at least two Cloud Run API instances for the propagation check. A temporary scale/traffic setup is acceptable if the runbook also restores the previous state.
- **D-12:** Do not permanently raise `min-instances` solely to make the test easier. The project constraint remains cost-minimized Cloud Run with scale-to-zero where possible.
- **D-13:** Production adapter failure must be visible. Local fallback to the default in-process adapter can remain for `InMemoryRedis`, but production should not silently run without Redis pub/sub when `REDIS_URL` is configured.

### Idle Reconnect And Rollback

- **D-14:** Idle reconnect validation should cover the path users actually depend on after Cloud Run idles or cold-starts: health ping, Lua lock path, and Socket.IO subscription path.
- **D-15:** The rollback checklist must cover revision rollback, `REDIS_URL`/mode contract rollback, `/health` verification, lock-path verification, Socket.IO smoke, and post-rollback log/Sentry checks.
- **D-16:** Failure modes to name explicitly in the checklist: startup hard-fail, health red, cluster mode mismatch, `CROSSSLOT`, `MOVED`/`ASK`, `ECONNRESET`, `ETIMEDOUT`, duplicate/subscriber connection loss, and persistent adapter fallback.

### Test Contract

- **D-17:** Preserve the Phase 14 cluster-mode testcontainers guard pattern for multi-key Lua/hash-tag behavior. Standalone Valkey containers alone do not prove cluster-mode safety.
- **D-18:** Add focused automated tests only for code introduced in this phase: mode parsing/probing, `REDIS_CLIENT` factory behavior, health metadata, adapter visibility, and smoke script formatting if applicable.
- **D-19:** Split verification cleanly: local/CI tests prove code contracts; production smoke proves Cloud Run -> Valkey runtime contracts.

### Scope Guardrails

- **D-20:** Do not change Phase 19's lock ownership decisions. Active per-seat Valkey ownership remains the source of truth for reservation/payment boundaries.
- **D-21:** Do not re-open Phase 7 migration scope unless production evidence shows the current client contract is wrong.
- **D-22:** Do not fold Phase 24 tech-debt items into Phase 20 unless they block the connectivity smoke. Cache `KEYS` invalidation and `getMyLocks()` TTL edge cases remain separate follow-ups.

### the agent's Discretion

- Exact environment variable names, probe endpoint shape, smoke command implementation, and artifact file names are flexible if they satisfy D-01 through D-19.
- The planner may choose whether the smoke is a Node script, documented CLI sequence, Playwright/socket harness, or a combination.
- The planner may decide whether to write `20-HUMAN-UAT.md`, extend `20-VERIFICATION.md`, or use both, as long as downstream audit evidence is concrete.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Definition And Audit Gap

- `.planning/ROADMAP.md` — Phase 20 goal, requirements, dependency on Phase 19, and success criteria.
- `.planning/REQUIREMENTS.md` — Requirement traceability for `VALK-02`, `VALK-03`, `VALK-04`, and `VALK-05`.
- `.planning/v1.1-MILESTONE-AUDIT.md` — Authoritative gap statement: Cloud Run -> Google Memorystore for Valkey runtime/cluster behavior remains `human_needed`.
- `.planning/PROJECT.md` — Core value and production safety constraints; seat locking must remain reliable.

### Relevant Prior Decisions

- `.planning/phases/07-valkey/07-VERIFICATION.md` — Original human verification items for Valkey ping, standalone-vs-cluster client compatibility, idle reconnect, and Socket.IO pub/sub propagation.
- `.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-CONTEXT.md` — Cluster-mode hash-tag and testcontainers guard pattern for Valkey CROSSSLOT regressions.
- `.planning/phases/14-sms-otp-crossslot-fix-sms-valkey-cluster-hash-tag/14-VERIFICATION.md` — Existing cluster-mode test and remaining production human verification pattern.
- `.planning/phases/17-local-dev-health-indicator-fix-inmemoryredis-ping-capability/17-CONTEXT.md` — Production `REDIS_URL` hard-fail, local-only fallback, and health capability-probe boundaries.
- `.planning/phases/19-seat-lock-ownership-enforcement/19-CONTEXT.md` — Reservation/payment lock ownership contract that Phase 20 must not weaken.

### Affected Code And Config

- `apps/api/src/modules/booking/providers/redis.provider.ts` — `REDIS_CLIENT` factory, production `REDIS_URL` hard-fail, ioredis options, `InMemoryRedis` fallback.
- `apps/api/src/config/redis.config.ts` — Current Redis configuration namespace.
- `apps/api/src/health/redis.health.indicator.ts` — `/health` Valkey ping behavior and local fallback capability probe.
- `apps/api/src/health/health.controller.ts` — Public health endpoint consumed by Cloud Run and smoke checks.
- `apps/api/src/modules/booking/providers/redis-io.adapter.ts` — Socket.IO Redis adapter wiring, duplicate sub-client options, local fallback behavior.
- `apps/api/src/modules/booking/booking.service.ts` — Seat lock Lua scripts, hash-tag key scheme, assert/consume helpers, and production lock smoke surface.
- `apps/api/src/modules/booking/booking.gateway.ts` — Booking namespace rooms and `seat-update` broadcast path for pub/sub smoke.
- `scripts/provision-valkey.sh` — Memorystore for Valkey provisioning assumptions, PSC, `shard-count=1`, Secret Manager setup, and VPC note.
- `.github/workflows/deploy.yml` — Cloud Run VPC flags, `REDIS_URL` secret binding, and production environment wiring.
- `.github/workflows/ci.yml` — Existing `test:integration` step with cluster-mode Valkey testcontainers coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `REDIS_CLIENT` provider already centralizes all Valkey access through ioredis. This is the right place to add explicit mode parsing, live mode probing, or stricter production checks.
- `RedisHealthIndicator` already exposes `redis` status via `/api/v1/health`, and Phase 17 made local `InMemoryRedis` behavior explicit. Phase 20 can extend this without weakening production failures.
- `RedisIoAdapter` already duplicates the ioredis client with `maxRetriesPerRequest: null` and `enableReadyCheck: false` for Socket.IO subscriptions. The missing piece is runtime evidence, not a new adapter concept.
- `BookingService.lockSeat()`, `getSeatStatus()`, and `unlockSeat()` provide a real Lua path suitable for a production lock smoke, using the established `{showtimeId}` hash-tag scheme.
- Phase 14's `sms-cluster-crossslot.integration.spec.ts` pattern provides a proven way to guard cluster-mode CROSSSLOT regressions in CI.

### Established Patterns

- Production config should fail closed instead of silently using local mocks.
- Local/test fallback should be capability-probed and explicitly labeled; it must not mask real production Valkey failures.
- Multi-key Lua scripts must pass every accessed key through `KEYS` and share a hash tag.
- Runtime-only gaps are tracked through human/UAT artifacts with concrete expected outputs, not vague "verify later" notes.
- Expensive or environment-bound checks belong in `test:integration` or operator smoke paths, not in the default fast test loop.

### Integration Points

- Cloud Run deploy currently sets `--network=default`, `--subnet=default`, `--vpc-egress=private-ranges-only`, and injects `REDIS_URL=redis-url:latest`.
- `/api/v1/health` is the public health surface that can prove Redis ping from the deployed service.
- Socket.IO booking traffic uses namespace `/booking` and rooms `showtime:${showtimeId}`; multi-instance propagation must observe this path.
- Seat lock smoke will need valid auth and a usable showtime/seat fixture or a dedicated safe fixture path. It must not leave seats locked or sold after the smoke.
- Cloud Run logs and Sentry are part of evidence for reconnect and adapter/pubsub failures.

</code_context>

<specifics>
## Specific Ideas

- Default discussion choices were selected automatically because Codex Default mode cannot call `request_user_input`; the user explicitly asked to start Phase 20 discussion after branch separation.
- The preferred direction is a narrow production contract/evidence phase: make mode assumptions visible, prove the deployed path, and preserve current architecture unless the evidence disproves it.
- The audit gap is not "Valkey code does not exist"; it is "production Cloud Run -> Valkey behavior is not proven." Planning should therefore prioritize observable runtime evidence over broad refactors.
- A strong smoke result should read like: revision X, API URL Y, `/health` redis up, lock/status/unlock passed for fixture Z, two-instance Socket.IO propagation passed, idle reconnect passed, logs clean for listed failure keywords.

</specifics>

<deferred>
## Deferred Ideas

- Cache invalidation `KEYS` -> `SCAN` or indexed invalidation for large keyspaces. This is already tracked as tech debt and should not be pulled into Phase 20 unless it blocks the smoke.
- `getMyLocks()` TTL/null edge hardening if not directly needed for the production smoke.
- Permanent Cloud Run `min-instances` changes for traffic readiness.
- Queueing/waiting-room or high-traffic admission control.
- Re-provisioning or renaming the existing Memorystore Valkey instance for brand cleanup.

</deferred>

---

*Phase: 20-valkey-production-connectivity-contract*
*Context gathered: 2026-04-30*
