---
phase: 24-traffic-booking-payment-core
plan: "21"
subsystem: infra
tags: [cloud-run, cloud-scheduler, oidc, prewarm, ci, nestjs]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Phase 24-05 protected prewarm routes, dual-factor OIDC contract, and initial runbook
provides:
  - Durable `PREWARM_*` deploy wiring for future API revisions
  - Live-verified Cloud Scheduler scale-up and step-down jobs against `grabit-api`
  - Resolved Human UAT evidence for TRAF-03 with exact URL, IAM, and audit traces
affects: [24-HUMAN-UAT, launch-ops, cloud-run, cloud-scheduler, traffic-defense]
tech-stack:
  added: []
  patterns:
    - Cloud Run Admin v2 prewarm updates must patch `template.scaling.minInstanceCount`, not the stale service-level mask previously assumed locally
    - Self-updating Cloud Run services need both `run.services.update` and `iam.serviceAccounts.actAs` on the preserved runtime service account
    - Scheduler prewarm verification should use valid JSON anonymous smoke for 401/403 route checks, then run scale-up and step-down sequentially
key-files:
  created:
    - .planning/phases/24-traffic-booking-payment-core/24-21-SUMMARY.md
  modified:
    - .github/workflows/deploy.yml
    - docs/runbooks/phase24-queue-waf-prewarm.md
    - apps/api/src/modules/ops/prewarm.service.ts
    - apps/api/src/modules/ops/prewarm.service.spec.ts
    - .planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md
key-decisions:
  - "Keep the Phase 24-05 app-layer route and dual-factor guard unchanged, and repair the live rollout through deploy/runtime/IAM alignment instead of redesigning the endpoint surface."
  - "Pin the shared Scheduler audience to the scale-up endpoint URL for both jobs because the app validates one `PREWARM_ALLOWED_AUDIENCE` value."
  - "Use `minInstances=100` and `--max-instances=100` for live prewarm because this Cloud Run service carries `run.googleapis.com/network-interfaces`, which caps max scale at 100."
patterns-established:
  - "Operational prewarm fixes belong in three layers together: deploy contract, runtime Cloud Run PATCH contract, and live IAM verification."
  - "When manually replaying both Scheduler jobs, wait for the scale-up service update to settle before firing step-down to avoid resource-version conflicts."
requirements-completed: [TRAF-03]
duration: 38m
completed: 2026-05-10
---

# Phase 24 Plan 21: Prewarm Deploy Contract Closure Summary

**Durable `PREWARM_*` deploy wiring, Cloud Run v2 `template.scaling.minInstanceCount` patching, and live Scheduler OIDC prewarm verification now close the Phase 24 TRAF-03 operational gap.**

## Performance

- **Duration:** 38m
- **Started:** 2026-05-10T20:54:39+09:00
- **Completed:** 2026-05-10T21:32:24+09:00
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Preserved the Phase 24-05 prewarm contract in CI by keeping the five `PREWARM_*` secrets in `.github/workflows/deploy.yml` and raising the API deploy max-instances guard to `100`.
- Fixed `PrewarmService` so live Cloud Run Admin v2 updates now use `template.scaling.minInstanceCount`, then verified the change locally with targeted Vitest and typecheck.
- Deployed `grabit-api-00034-x9x`, reconciled runtime IAM, and proved both `grabit-prewarm-scale-up` and `grabit-prewarm-step-down` reach the protected endpoint with auditable 202 request logs plus Cloud Audit `UpdateService` traces.
- Updated Human UAT test 2 from blocker to resolved with the final live audience URL, runtime service account, Scheduler service account, job names, and replayable commands.

## Task Commits

1. **Task 1: Make the prewarm deploy contract durable in CI and the runbook** - `30703eb` (`chore`)
2. **Task 2: Roll out and verify the live GCP prewarm path for `grabit-api`** - `d61b38a` (`fix`)
3. **Task 3: Resolve Human UAT test 2 and summarize the operational rollout** - committed with this summary/UAT update

## Files Created/Modified

- `.github/workflows/deploy.yml` - Keeps the live prewarm secrets injected on every API deploy and raises the deploy-time max-instances ceiling to the live-safe value of `100`.
- `docs/runbooks/phase24-queue-waf-prewarm.md` - Records the shared audience contract, maxScale/minInstances alignment, runtime IAM fallback, and the manual rerun conflict note.
- `apps/api/src/modules/ops/prewarm.service.ts` - Switches the Cloud Run Admin v2 PATCH call to `template.scaling.minInstanceCount`.
- `apps/api/src/modules/ops/prewarm.service.spec.ts` - Verifies the new PATCH mask/body and the live-safe scale-up target of `100`.
- `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md` - Closes test 2 with exact commands, timestamps, service accounts, job names, and audit evidence.
- `.planning/phases/24-traffic-booking-payment-core/24-21-SUMMARY.md` - Captures the final operational rollout and deviations for future continuation.

## Decisions Made

- Preserved the existing `/api/v1/internal/prewarm/services/:serviceName` and `/step-down` route contract rather than widening Scheduler’s responsibility to direct control-plane API calls.
- Standardized live audience, secret value, and Scheduler OIDC audience on `https://grabit-api-d3c6wrfdbq-du.a.run.app/api/v1/internal/prewarm/services/grabit-api`.
- Treated the runtime service account self `roles/iam.serviceAccountUser` binding as the minimum live fix after `roles/run.admin` alone proved insufficient for `UpdateService`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added runtime service-account self `actAs` binding for live prewarm**
- **Found during:** Task 2 (live Scheduler verification)
- **Issue:** After the code/deploy fix, Cloud Run still returned `503` because `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` could update the service but could not preserve its own service account in the `UpdateService` template request.
- **Fix:** Added `roles/iam.serviceAccountUser` on `grapit-cloudrun@grapit-491806.iam.gserviceaccount.com` for `serviceAccount:grapit-cloudrun@grapit-491806.iam.gserviceaccount.com`, then documented the binding in the runbook and UAT evidence.
- **Files modified:** `docs/runbooks/phase24-queue-waf-prewarm.md`, `.planning/phases/24-traffic-booking-payment-core/24-HUMAN-UAT.md`
- **Verification:** Cloud Run request logs returned 202 for scale-up and final step-down, and Cloud Audit `google.cloud.run.v2.Services.UpdateService` succeeded with `minInstanceCount=100` then `0`.
- **Committed in:** `d61b38a` (documentation for the live fix) and this summary/UAT commit

---

**Total deviations:** 1 auto-fixed (Rule 3: 1)
**Impact on plan:** The deviation stayed inside the prewarm rollout scope and was required to turn the repaired code path into a working live Scheduler flow.

## Issues Encountered

- The local shell environment did not expose `curl`, so anonymous route smoke checks were run with Node’s built-in `fetch` and valid JSON bodies instead.
- The first immediate `step-down` replay after successful `scale-up` failed with a Cloud Run resource-version conflict because both updates targeted the same service revision concurrently; a delayed sequential rerun succeeded and is now documented in the runbook.

## Known Stubs

None.

## Threat Flags

None - the work stayed within the plan threat model and only tightened the existing protected prewarm surface.

## User Setup Required

None - the required Cloud Scheduler jobs, Secret Manager values, deploy contract, and runtime IAM bindings were applied live. Future operators should reuse the commands in `docs/runbooks/phase24-queue-waf-prewarm.md`.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/ops/prewarm.service.spec.ts` - PASS
- `pnpm --filter @grabit/api typecheck` - PASS
- Anonymous valid-JSON `POST` smoke against both prewarm routes - PASS (`401` / `401`)
- `gcloud scheduler jobs describe grabit-prewarm-scale-up --location=asia-northeast3` - PASS (`status: {}` after rerun)
- `gcloud scheduler jobs describe grabit-prewarm-step-down --location=asia-northeast3` - PASS (`status: {}` after delayed rerun)
- Cloud Run request logs - PASS (`2026-05-10T12:27:42.740801Z` scale-up 202, `2026-05-10T12:28:42.779Z` step-down 202)
- Cloud Audit `UpdateService` logs - PASS (`template.scaling.minInstanceCount=100` then `0`)
- `gcloud run services describe grabit-api --region=asia-northeast3 --format='export' | rg 'autoscaling.knative.dev/minScale'` - PASS (`100` after scale-up, `0` after final step-down)

## Next Phase Readiness

- TRAF-03 is no longer blocked on missing live Scheduler/prewarm operations; downstream launch work can treat the prewarm contract as deployed and verified.
- Remaining Phase 24 Human UAT work is isolated to test 4 (seat-label hit target), not to Cloud Scheduler, Cloud Run, or deploy-time prewarm configuration.
- Future API deploys should keep using the existing `PREWARM_*` Secret Manager contract and max-instances `100` guard until the networking model changes.

## Self-Check: PENDING

- Summary file existence and commit references will be verified after the Task 3 commit is created.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-10*
