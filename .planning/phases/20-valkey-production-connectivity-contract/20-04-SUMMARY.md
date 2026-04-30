---
phase: 20-valkey-production-connectivity-contract
plan: 04
subsystem: infra-smoke
tags: [valkey, redis, cloud-run, socket-io, production-smoke, uat]

requires:
  - phase: 20-valkey-production-connectivity-contract
    provides: Plans 20-01 through 20-03 production Valkey mode, health metadata, adapter fail-closed behavior, and cluster Lua coverage
provides:
  - Repeatable redacted production Valkey smoke script
  - Human/operator production UAT artifact for Cloud Run to Valkey evidence
  - Verification report that separates automated code checks from production smoke evidence
  - Review hardening for smoke cleanup, redaction, strict idle parsing, and failed-check artifact capture
affects: [phase-20, valkey-production-smoke, cloud-run-uat, booking-locks, socket-io]

tech-stack:
  added: []
  patterns:
    - "Root smoke scripts resolve package-local dependencies with createRequire from the owning package"
    - "Production runtime evidence is recorded as redacted markdown and remains human_needed until operator approval"
    - "Smoke checks record FAIL evidence instead of exiting before artifact append once required setup is valid"

key-files:
  created:
    - scripts/smoke-valkey-production.mjs
    - .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
    - .planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md
    - .planning/phases/20-valkey-production-connectivity-contract/20-04-SUMMARY.md
  modified:
    - scripts/smoke-valkey-production.mjs
    - .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md
    - .planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md
    - apps/api/src/modules/booking/providers/redis.provider.ts
    - apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts
    - apps/api/src/health/redis.health.indicator.ts
    - apps/api/src/health/__tests__/redis.health.indicator.spec.ts
    - apps/api/src/main.ts
    - .planning/phases/20-valkey-production-connectivity-contract/20-REVIEW-FIX.md

key-decisions:
  - "Production smoke remains the only valid evidence for closing Cloud Run to Valkey runtime connectivity."
  - "User requested skipping the human production smoke in this run; verification therefore remains pending-production-smoke/human_needed."
  - "Do not add root or API dependencies for socket.io-client; resolve through apps/web/package.json."

patterns-established:
  - "Production smoke artifacts keep command shape, revision, host-only target, PASS/FAIL, and sanitized summaries."
  - "Lock smoke must verify post-unlock seat state, not only DELETE transport success."
  - "Provider, health, and smoke redaction should remove values, not only sensitive labels."

requirements-completed: [VALK-02, VALK-03, VALK-04, VALK-05, SC-1, SC-2, SC-3, SC-4]

duration: checkpoint-resume
completed: 2026-04-30
---

# Phase 20 Plan 04: Valkey Production Smoke Evidence Gate Summary

**A repeatable production Valkey smoke script and UAT evidence gate now exist, but production approval was skipped by user request and remains unresolved.**

## Performance

- **Duration:** checkpoint-resume
- **Started:** 2026-04-30T06:50:36Z
- **Completed:** 2026-04-30T08:01:38Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Created `scripts/smoke-valkey-production.mjs` with `--help`, `--check health`, `--check lua`, `--check socketio`, `--check idle`, `--check logs`, and `--check all`.
- Created `20-HUMAN-UAT.md` with the operator evidence fields for Cloud Run revision, Valkey mode, VPC egress, safe fixture approval, health, Lua, Socket.IO, idle reconnect, log/Sentry cleanliness, scale restore, rollback, and redaction.
- Created `20-VERIFICATION.md` with `status: pending-production-smoke` and `human_needed: true` so local/code verification stays separate from production runtime evidence.
- Hardened the smoke and runtime redaction surface after code review: auth/cookie/JWT values are redacted, unlock is verified through post-delete seat state, malformed idle seconds are rejected, and failed smoke checks append FAIL evidence after setup validation.
- Hardened the final review findings: production bootstrap now requires Redis `PING`, log smoke requires Sentry observation for PASS, bearer redaction covers opaque token characters, Socket.IO smoke fails preflight before mutation when `min-instances < 2`, and health handles non-Error Redis rejections.

## Task Commits

1. **Task 1: Create redacted production smoke script** - `4b2bb6d` (feat)
2. **Task 2: Create verification and operator UAT artifacts** - `dba7fb2` (docs)
3. **Task 3: Run production smoke with operator-approved fixture** - skipped by user request; no production PASS evidence recorded
4. **Review hardening: close production smoke review findings** - `dc445c5` (fix)
5. **Review fix report: smoke hardening** - `c74c784` (docs)
6. **Final code review report** - `b2cc20e` (docs)
7. **Final review hardening: startup and smoke gates** - `3170858` (fix)

## Files Created/Modified

- `scripts/smoke-valkey-production.mjs` - Production smoke runner with redaction, Cloud Run/Memorystore evidence, booking Lua lock/status/unlock smoke, Socket.IO two-instance proof, idle reconnect, log keyword scan, and artifact append.
- `.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md` - Human/operator smoke runbook and evidence artifact.
- `.planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md` - Verification status that remains pending production smoke.
- `apps/api/src/modules/booking/providers/redis.provider.ts` - Redacts auth/cookie/JWT values in Redis error messages.
- `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts` - Covers auth/cookie/JWT redaction in Redis provider logs.
- `apps/api/src/health/redis.health.indicator.ts` - Redacts auth/cookie/JWT values in public health down messages.
- `apps/api/src/health/__tests__/redis.health.indicator.spec.ts` - Covers auth/cookie/JWT redaction in health output.
- `apps/api/src/main.ts` - Requires production Redis `PING` before serving.
- `.planning/phases/20-valkey-production-connectivity-contract/20-REVIEW-FIX.md` - Records the final review-fix passes.

## Decisions Made

- User explicitly requested skipping the human production smoke and proceeding. This summary records that skip instead of fabricating approval.
- `20-VERIFICATION.md` intentionally remains `pending-production-smoke` with `human_needed: true`.
- Phase 20 should not be treated as runtime-verified until `20-HUMAN-UAT.md` contains real revision-scoped PASS evidence.

## Deviations from Plan

### User-Directed Deviations

**1. [Checkpoint bypass] Production smoke skipped**
- **Found during:** Task 3 (Run production smoke with operator-approved fixture)
- **Issue:** The plan required operator `approved` only after real `20-HUMAN-UAT.md` evidence. The user requested skipping the human test and finishing the remaining workflow.
- **Handling:** Did not mark production smoke PASS and did not change `20-VERIFICATION.md` to `passed`. Recorded the skip in this summary.
- **Files modified:** `.planning/phases/20-valkey-production-connectivity-contract/20-04-SUMMARY.md`
- **Verification:** `20-VERIFICATION.md` still contains `status: pending-production-smoke` and `human_needed: true`.

### Auto-fixed Issues

**1. [Rule 2 - Security] Redact credential values, not labels only**
- **Found during:** Code review after Task 2
- **Issue:** Redis provider and health sanitizers could leave bearer, cookie, or JWT-like values in output.
- **Fix:** Added explicit auth/cookie/JWT redaction patterns and regression tests.
- **Files modified:** `apps/api/src/modules/booking/providers/redis.provider.ts`, `apps/api/src/modules/booking/providers/__tests__/redis.provider.spec.ts`, `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`
- **Verification:** Targeted Vitest suite and API typecheck passed.
- **Committed in:** `dc445c5`

**2. [Rule 2 - Correctness] Verify unlock cleanup through seat state**
- **Found during:** Code review after Task 2
- **Issue:** The smoke could pass unlock based only on HTTP status even if the seat remained locked.
- **Fix:** Added `unlockAndVerifySeat()` and post-delete seat state checks in Lua and Socket.IO paths.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** `node --check` and static grep gates passed.
- **Committed in:** `dc445c5`

**3. [Rule 3 - Blocking] Reject malformed idle wait values**
- **Found during:** Code review after Task 2
- **Issue:** `parseInt()` accepted values such as `30m`.
- **Fix:** Replaced with a strict positive-integer parser.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** malformed `GRABIT_SMOKE_IDLE_SECONDS=30m` fails before production contact.
- **Committed in:** `dc445c5`

**4. [Rule 3 - Evidence reliability] Capture failed check artifacts**
- **Found during:** Code review after Task 2
- **Issue:** Per-check failures could abort before appending FAIL evidence.
- **Fix:** Added `captureCheck()` and fallback Cloud Run/Memorystore evidence objects so failed checks become redacted artifact rows after setup validation.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** `node --check` and static grep gates passed.
- **Committed in:** `dc445c5`

**5. [Rule 3 - Startup safety] Fail production bootstrap when Redis is unreachable**
- **Found during:** Final code review
- **Issue:** Cloud Run could start serving after provider connect failures were swallowed.
- **Fix:** Added production-only `redisClient.ping()` before Socket.IO adapter setup and `app.listen()`.
- **Files modified:** `apps/api/src/main.ts`
- **Verification:** API typecheck passed.
- **Committed in:** `3170858`

**6. [Rule 2 - Evidence correctness] Require Sentry observation for log smoke PASS**
- **Found during:** Final code review
- **Issue:** `checkLogs()` could return PASS with only Cloud Logging evidence and no Sentry observation.
- **Fix:** Missing `GRABIT_SMOKE_SENTRY_OBSERVATION` now records `missing` and returns `ok: false`.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** `node --check` and static grep gates passed.
- **Committed in:** `3170858`

**7. [Rule 2 - Secret redaction] Cover opaque bearer token characters**
- **Found during:** Final code review
- **Issue:** Smoke redaction could leave bearer suffixes containing characters outside `[A-Za-z0-9._-]`.
- **Fix:** Expanded the bearer pattern to redact any non-whitespace token value.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** static grep gate passed.
- **Committed in:** `3170858`

**8. [Rule 3 - Smoke precondition] Fail Socket.IO smoke before mutation when min-instances < 2**
- **Found during:** Final code review
- **Issue:** Default `--min-instances=0` conflicted with the two-instance proof requirement.
- **Fix:** Added a preflight FAIL before socket connection or seat mutation, instructing the operator to temporarily set `min-instances=2` and restore pre-state.
- **Files modified:** `scripts/smoke-valkey-production.mjs`
- **Verification:** `node --check` and static grep gates passed.
- **Committed in:** `3170858`

**9. [Rule 3 - Health robustness] Handle non-Error Redis ping rejections**
- **Found during:** Final code review
- **Issue:** A string rejection could throw inside `sanitizeHealthMessage()` instead of returning a down health result.
- **Fix:** Convert non-Error rejections with `String(err)` and added a string `ECONNRESET` regression test.
- **Files modified:** `apps/api/src/health/redis.health.indicator.ts`, `apps/api/src/health/__tests__/redis.health.indicator.spec.ts`
- **Verification:** targeted Vitest suite passed.
- **Committed in:** `3170858`

---

**Total deviations:** 9 auto-fixed, 1 user-directed checkpoint bypass.
**Impact on plan:** Automated code and artifact contracts are stronger than the original implementation, but production runtime approval remains open.

## Issues Encountered

- Production smoke was not run in this session by explicit user request.
- `20-HUMAN-UAT.md` still has unchecked PASS boxes and must not be considered production evidence yet.
- `docs/v2.0-fanmeet-milestone-spec.md` was untracked before this work and was left untouched.

## Verification

```bash
node --check scripts/smoke-valkey-production.mjs
```

Result: PASS.

```bash
pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --help
```

Result: PASS; `socket.io-client` resolves through `apps/web`.

```bash
pnpm --filter @grabit/api exec vitest run src/modules/booking/providers/__tests__/redis.provider.spec.ts src/health/__tests__/redis.health.indicator.spec.ts src/modules/booking/__tests__/redis-io.adapter.spec.ts
```

Result: PASS, 39 tests passed.

```bash
pnpm --filter @grabit/api exec tsc --noEmit --pretty false
```

Result: PASS.

```bash
rg -n "status: pending-production-smoke|human_needed: true|Observable Truths|20-HUMAN-UAT.md" .planning/phases/20-valkey-production-connectivity-contract/20-VERIFICATION.md
```

Result: PASS.

```bash
rg -n 'redis://[^`[:space:]]+|Authorization: Bearer [A-Za-z0-9._-]{16,}|Cookie: [^`[:space:]]+=|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|(paymentKey|orderId)[[:space:]]*[:=][[:space:]]*"?[A-Za-z0-9_-]{12,}|\+82[0-9]{8,}' .planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md && exit 1 || exit 0
```

Result: PASS; no value-sensitive evidence is present.

## User Setup Required

Production approval remains required before this phase can be called runtime-verified:

- Fill `GRABIT_SMOKE_AUTH_HEADER_FILE`, `GRABIT_SMOKE_SHOWTIME_ID`, and `GRABIT_SMOKE_SEAT_ID` with operator-approved smoke-only values.
- Run `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all`.
- Record real revision-scoped PASS evidence in `20-HUMAN-UAT.md`.
- Only then update `20-VERIFICATION.md` from `pending-production-smoke` to `passed`.

## Next Phase Readiness

Code-level contracts are ready for review and future execution. Runtime approval is intentionally not ready: Cloud Run to Valkey production connectivity, Socket.IO two-instance propagation, idle reconnect, and log/Sentry cleanliness still need real operator evidence.

## Self-Check: PASSED_WITH_HUMAN_NEEDED

- Summary file exists at `.planning/phases/20-valkey-production-connectivity-contract/20-04-SUMMARY.md`.
- Source smoke script and UAT/verification artifacts exist.
- Automated code-level checks passed.
- Production smoke was skipped by user request and remains unresolved in `20-VERIFICATION.md`.

---
*Phase: 20-valkey-production-connectivity-contract*
*Completed: 2026-04-30*
