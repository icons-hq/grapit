---
phase: 24-traffic-booking-payment-core
plan: "05"
subsystem: api
tags: [traffic-defense, throttler, cloudflare, cloud-scheduler, oidc, cloud-run]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Phase 24 booking-core schema and booking-policy groundwork from 24-03
provides:
  - Named booking-critical throttler policies with richer identity trackers
  - Explicit traffic retry/challenge/block decision codes for queue and booking mutations
  - Protected internal prewarm and step-down POST control path for Cloud Scheduler
  - Operator runbook for Cloudflare WAF groups and Scheduler OIDC job setup
affects: [24-04, 24-06, traffic-defense, booking-ops, launch-ops]
tech-stack:
  added: []
  patterns:
    - AppModule throttler wiring can be assembled from a dedicated service with route-scoped named policies
    - Queue-entry fairness uses authenticated user ID first and otherwise hashes session cookie plus IP instead of IP-only fallback
    - Internal Cloud Run scaling control paths require Google-signed OIDC validation plus a separate shared app token
key-files:
  created:
    - apps/api/src/modules/traffic/traffic.module.ts
    - apps/api/src/modules/traffic/traffic-defense.service.ts
    - apps/api/src/modules/traffic/traffic-defense.service.spec.ts
    - apps/api/src/modules/ops/prewarm.module.ts
    - apps/api/src/modules/ops/prewarm.controller.ts
    - apps/api/src/modules/ops/prewarm.service.ts
    - apps/api/src/modules/ops/prewarm.service.spec.ts
    - docs/runbooks/phase24-queue-waf-prewarm.md
  modified:
    - apps/api/src/app.module.ts
key-decisions:
  - "Named throttler policies are defined centrally in TrafficDefenseService and activated with route-scoped `skipIf` matchers so current booking routes gain policy-specific protection without waiting for future controller decorators."
  - "Anonymous `queue-entry` tracking uses hashed session cookie plus IP before falling back to plain IP, which preserves fairer admission on shared networks."
  - "The prewarm control path validates a Google-signed OIDC token signature and claims (`iss`, `aud`, `email`) before checking `x-prewarm-control-token` as a second factor."
  - "Cloud Scheduler stays on `POST` jobs and the app translates them into the Cloud Run Admin API `PATCH ...?update_mask=scaling.minInstanceCount` call."
patterns-established:
  - "Booking-critical throttling can share one global ThrottlerModule while still using per-route policy names, custom trackers, and a single explicit `TRAFFIC_RATE_LIMITED` error code."
  - "Scheduler-driven infrastructure actions should terminate at an internal app control path instead of exposing direct control-plane mutation semantics to Scheduler."
requirements-completed: [TRAF-02, TRAF-03]
duration: 12m
completed: 2026-05-08
---

# Phase 24 Plan 05: Traffic Defense and Protected Prewarm Summary

**Named booking throttlers, explicit retry/challenge/block decision codes, and a dual-factor Scheduler prewarm control path now cover Phase 24 traffic defense and protected warmup operations.**

## Performance

- **Duration:** 12m
- **Started:** 2026-05-08T15:24:24+09:00
- **Completed:** 2026-05-08T15:35:56+09:00
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added `TrafficModule` and `TrafficDefenseService` with named `queue-entry`, `lock-seat`, `prepare-reservation`, `confirm-payment`, `signup`, and `sms` throttler policies.
- Centralized tracker resolution so booking-critical routes prefer `userId`, then session cookie, then admission token, then IP; `queue-entry` now uses session cookie + IP for anonymous fallback instead of IP-only.
- Added explicit `TRAFFIC_RATE_LIMITED`, `SECURITY_CHALLENGE_REQUIRED`, and `SECURITY_BLOCKED` decision codes for retry/challenge/block handling.
- Added `PrewarmModule`, `PrewarmController`, and `PrewarmService` with `POST /api/v1/internal/prewarm/services/:serviceName` and `/step-down`.
- Implemented Google-signed OIDC verification with JWKS discovery, claim validation (`iss`, `aud`, `email`), and `x-prewarm-control-token` second-factor enforcement before Cloud Run min-instance PATCH calls.
- Wrote `docs/runbooks/phase24-queue-waf-prewarm.md` covering Cloudflare rule groups, non-Enterprise fallback, and exact Cloud Scheduler `POST` + `OIDC` job setup.

## Task Commits

1. **Task 1 RED: traffic defense tests** - `703ff1b` (`test`)
2. **Task 1 GREEN: traffic defense implementation** - `c3b309e` (`feat`)
3. **Task 2 RED: prewarm control-path tests** - `da8a5e7` (`test`)
4. **Task 2 GREEN: protected prewarm implementation** - `e45ce37` (`feat`)

## Files Created/Modified

- `apps/api/src/modules/traffic/traffic-defense.service.ts` - Named throttler policies, richer tracker resolution, and retry/challenge/block decision engine.
- `apps/api/src/modules/traffic/traffic.module.ts` - Exports the traffic-defense provider to `AppModule`.
- `apps/api/src/modules/traffic/traffic-defense.service.spec.ts` - TDD coverage for named policies, queue-entry fallback, and decision codes.
- `apps/api/src/modules/ops/prewarm.service.ts` - OIDC signature/claim verification, app-token enforcement, metadata access-token retrieval, and Cloud Run min-instance PATCH orchestration.
- `apps/api/src/modules/ops/prewarm.controller.ts` - Public internal `POST` scale-up and `step-down` routes with Zod request validation.
- `apps/api/src/modules/ops/prewarm.module.ts` - Registers the protected prewarm controller/service.
- `apps/api/src/modules/ops/prewarm.service.spec.ts` - TDD coverage for dual-factor authorization and Cloud Run PATCH payloads.
- `docs/runbooks/phase24-queue-waf-prewarm.md` - Cloudflare WAF groups, non-Enterprise fallback, and Cloud Scheduler OIDC job instructions.
- `apps/api/src/app.module.ts` - Wires `TrafficModule` throttlers and `PrewarmModule` into the API runtime.

## Decisions Made

- Kept throttler policy names in the app layer instead of hardcoding Cloudflare Enterprise-only bot variables into runtime logic.
- Used hashed session cookie values in trackers to avoid storing raw cookie material in throttler keys while still improving identity quality.
- Verified Scheduler OIDC tokens against Google JWKS in-process, avoiding a new dependency while still enforcing signed-token validation.
- Used `x-prewarm-control-token` as the second factor because `Authorization: Bearer` is already consumed by the Scheduler OIDC token.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired `PrewarmModule` into `AppModule`**
- **Found during:** Task 2
- **Issue:** The plan file list for Task 2 did not include `app.module.ts`, but without module registration the new internal prewarm routes would never be reachable at runtime.
- **Fix:** Added `PrewarmModule` to `AppModule` imports alongside the existing traffic-defense wiring.
- **Files modified:** `apps/api/src/app.module.ts`
- **Verification:** `pnpm --filter @grabit/api exec vitest run src/modules/ops/prewarm.service.spec.ts`, `pnpm --filter @grabit/api typecheck`
- **Committed in:** `e45ce37`

---

**Total deviations:** 1 auto-fixed (Rule 2: 1)
**Impact on plan:** The deviation was required for route reachability and kept the implementation within the intended prewarm scope.

## Issues Encountered

- `pnpm --filter @grabit/api test -- <file>` expands to the full API Vitest suite in this repo, not a single-file run.
- The exact plan verification commands therefore failed on unrelated `modules/admin/admin.service.spec.ts` failures from concurrent floor-aware admin work (`updatePerformance`/`saveSeatMap` expectations), not on the 24-05 traffic or prewarm code.

## Known Stubs

None.

## Threat Flags

None - the new security-sensitive surfaces (`traffic-defense.service.ts`, `prewarm.controller.ts`, `prewarm.service.ts`) stay inside the plan threat model and were implemented with the required mitigations.

## User Setup Required

- Cloudflare Dashboard: create the `queue-entry`, `lock-seat`, `prepare-reservation`, `confirm-payment`, `signup`, and `sms` rule groups described in [phase24-queue-waf-prewarm.md](/Users/sangwopark19/icons/grapit/docs/runbooks/phase24-queue-waf-prewarm.md:1).
- Cloud Run / Secret Manager: set `PREWARM_CONTROL_TOKEN`, `PREWARM_PROJECT_ID`, `PREWARM_REGION`, `PREWARM_ALLOWED_SCHEDULER_EMAIL`, and `PREWARM_ALLOWED_AUDIENCE`.
- Cloud Scheduler: create the scale-up and `step-down` `POST` jobs with `--oidc-service-account-email`, `--oidc-token-audience`, and the `x-prewarm-control-token` header from the runbook.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/traffic/traffic-defense.service.spec.ts` - PASS
- `pnpm --filter @grabit/api exec vitest run src/modules/ops/prewarm.service.spec.ts` - PASS
- `pnpm --filter @grabit/api typecheck` - PASS
- `rg -n "Managed Challenge|OIDC|queue-entry|lock-seat|confirm-payment|step-down" docs/runbooks/phase24-queue-waf-prewarm.md` - PASS
- `pnpm --filter @grabit/api test -- src/modules/traffic/traffic-defense.service.spec.ts` - FAIL, because the repo script expanded to the full API suite and hit unrelated `modules/admin/admin.service.spec.ts` failures.
- `pnpm --filter @grabit/api test -- src/modules/ops/prewarm.service.spec.ts` - FAIL for the same unrelated full-suite `modules/admin/admin.service.spec.ts` failures.

## TDD Gate Compliance

- RED commit exists for Task 1: `703ff1b`
- GREEN commit exists after Task 1 RED: `c3b309e`
- RED commit exists for Task 2: `da8a5e7`
- GREEN commit exists after Task 2 RED: `e45ce37`
- Refactor commit: Not needed

## Next Phase Readiness

- Downstream queue and booking flows can reuse the named throttler policies and explicit challenge/block decision codes without redesigning tracker identity.
- Operations work can now attach real Cloudflare rules and Cloud Scheduler jobs directly from the runbook and env contract.
- Exact `pnpm --filter @grabit/api test -- ...` verification should be rerun after the unrelated `modules/admin/admin.service.spec.ts` failures from concurrent admin floor-aware work are resolved.

## Self-Check: PASSED

- Verified summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-05-SUMMARY.md`.
- Verified task commits `703ff1b`, `c3b309e`, `da8a5e7`, and `e45ce37` exist in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
