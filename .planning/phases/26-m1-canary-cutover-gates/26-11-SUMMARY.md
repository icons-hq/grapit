---
phase: 26-m1-canary-cutover-gates
plan: 11
subsystem: api
tags: [admin, cutover, gate-ledger, cloud-run, docker]
requires:
  - phase: 26-m1-canary-cutover-gates
    provides: Plan 26-01 Gate Ledger artifact and validator
provides:
  - Read-only admin cutover Gate Ledger API
  - Safe no-go normalization for missing, invalid, or non-PASS ledger data
  - Cloud Run runtime Gate Ledger artifact path wiring
  - Production admin API smoke expectation artifact
affects: [phase-26, admin-cutover-ui, operations, booking-enabled-cutover]
tech-stack:
  added: []
  patterns: [read-only admin readiness model, sanitized runtime artifact fallback, blocker-first Gate Ledger sorting]
key-files:
  created:
    - apps/api/src/modules/admin/admin-cutover.controller.ts
    - apps/api/src/modules/admin/admin-cutover.service.ts
    - apps/api/src/modules/admin/admin-cutover.controller.spec.ts
    - apps/api/src/modules/admin/admin-cutover.service.spec.ts
    - .planning/phases/26-m1-canary-cutover-gates/evidence/26-11-admin-cutover-api.json
  modified:
    - apps/api/src/modules/admin/admin.module.ts
    - apps/api/Dockerfile
    - .github/workflows/deploy.yml
key-decisions:
  - "Missing, unreadable, or invalid Gate Ledger artifacts return sanitized BLOCKED/no-go data instead of PASS or raw errors."
  - "finalEnableAllowed requires evidence for every row and explicit owner approval metadata for ACCEPTED_RISK or CONFIG_READY_NOT_DRILLED rows."
  - "Production requires CUTOVER_GATE_LEDGER_PATH; repo-relative fallback is local/test only."
patterns-established:
  - "Admin cutover rows preserve exact Gate Ledger states and sort blockers first."
  - "The API exposes evidenceRefs and redacted metadata only, never raw evidence payloads."
requirements-completed: [M1-01, LOAD-01, DR-01, INFRA-01, OPS-01, PAY-01, OPS-02]
duration: 10min
completed: 2026-05-20
---

# Phase 26 Plan 11: Admin Cutover API Summary

**Authenticated admin Gate Ledger read API with no-go fallback semantics and packaged Cloud Run runtime artifact**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-20T05:43:58Z
- **Completed:** 2026-05-20T05:52:20Z
- **Tasks:** 3
- **Files modified:** 8 owned files

## Accomplishments

- Added `GET /admin/cutover/gates` behind `RolesGuard`, `AdminCapabilitiesGuard`, admin role, and `audit.read`.
- Implemented `AdminCutoverService` to read `CUTOVER_GATE_LEDGER_PATH`, preserve exact ledger states, synthesize missing required gates as `BLOCKED`, and keep `finalEnableAllowed=false` for missing evidence or unapproved non-PASS rows.
- Packaged the sanitized Phase 26 Gate Ledger into the API Docker image at `/app/phase26/26-GATE-LEDGER.json` and set Cloud Run `CUTOVER_GATE_LEDGER_PATH`.
- Added a redacted production smoke expectation artifact for the authenticated admin endpoint.

## Task Commits

1. **Task 1: Add admin cutover API contract tests** - `f6fdb32` (`test(26-11)`)
2. **Task 2: Implement read-only Gate Ledger service and controller** - `f98339d` (`feat(26-11)`)
3. **Task 3: Wire runtime Gate Ledger artifact path and production API smoke contract** - `d09d3e7` (`chore(26-11)`)

## Files Created/Modified

- `apps/api/src/modules/admin/admin-cutover.controller.ts` - Read-only admin cutover endpoint.
- `apps/api/src/modules/admin/admin-cutover.service.ts` - Gate Ledger read model, redaction, no-go fallback, blocker sorting, and final enablement rules.
- `apps/api/src/modules/admin/admin-cutover.controller.spec.ts` - Admin role plus `audit.read` access tests and response contract tests.
- `apps/api/src/modules/admin/admin-cutover.service.spec.ts` - Ledger normalization, missing artifact, missing gate, and redaction tests.
- `apps/api/src/modules/admin/admin.module.ts` - Wires the cutover controller/service into AdminModule.
- `apps/api/Dockerfile` - Copies only the sanitized Gate Ledger JSON into `/app/phase26/26-GATE-LEDGER.json`.
- `.github/workflows/deploy.yml` - Sets `CUTOVER_GATE_LEDGER_PATH` for the API Cloud Run service.
- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-11-admin-cutover-api.json` - Redacted production smoke expectation contract.

## Decisions Made

- Missing artifact and invalid JSON are treated as HTTP-safe no-go data, not process crashes.
- Approved non-PASS states stay visibly non-PASS and require approval state, approver, timestamp, compensating monitoring, rollback/close trigger, and evidence refs before they can stop blocking.
- The API response omits runtime paths and raw parse errors to avoid leaking filesystem layout or secret-like content.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicitly injected `AdminCutoverService`**
- **Found during:** Task 2
- **Issue:** The focused controller test showed `cutoverService` was undefined in the Nest test runtime, producing a 500 for the admin endpoint.
- **Fix:** Added explicit `@Inject(AdminCutoverService)` on the controller constructor.
- **Files modified:** `apps/api/src/modules/admin/admin-cutover.controller.ts`
- **Verification:** Focused controller/service Vitest and API `typecheck` passed.
- **Commit:** `f98339d`

**Total deviations:** 1 auto-fixed blocking issue. **Impact:** Correctness-only DI hardening; no API scope expansion.

## Issues Encountered

- Shared-branch concurrency: `f98339d` also contains `docs/runbooks/phase26-dr-infra-gate.md`, which was staged concurrently by another Phase 26 agent and is outside 26-11 ownership. I did not rewrite shared branch history or delete the file because another 26-08 commit later modified that runbook. Subsequent 26-11 commits used `git commit --only` to avoid additional cross-scope inclusion.
- Live authenticated production smoke was not executed in this executor. The required post-deploy expectation is recorded in `26-11-admin-cutover-api.json`; actual smoke still needs a deployed revision and admin auth.

## Known Stubs

- `.planning/phases/26-m1-canary-cutover-gates/evidence/26-11-admin-cutover-api.json` - This is an intentional smoke expectation stub requested by Task 3, not live provider/deploy evidence. It must be replaced or supplemented after Cloud Run deploy with authenticated admin API evidence.

## User Setup Required

None for local code verification. Post-deploy production smoke requires an authenticated admin session/token and the deployed API image.

## Verification

- `pnpm --filter @grabit/api exec vitest run src/modules/admin/admin-cutover.controller.spec.ts src/modules/admin/admin-cutover.service.spec.ts` - passed, 10 tests.
- `pnpm --filter @grabit/api typecheck` - passed.
- `rg -n "CUTOVER_GATE_LEDGER_PATH|/app/phase26/26-GATE-LEDGER.json|26-GATE-LEDGER.json" apps/api/Dockerfile .github/workflows/deploy.yml` - passed.
- `node -e "...26-11-admin-cutover-api.json token check..."` - passed.

## Next Phase Readiness

The web admin cutover UI can now call the authenticated read model and render blocker-first Gate Ledger state. Final live enablement remains blocked until later Phase 26 plans produce provider/load/DR evidence or explicit owner-approved non-PASS ledger rows.

## Self-Check: PASSED

- Created/modified owned files exist.
- Task commits found: `f6fdb32`, `f98339d`, `d09d3e7`.
- Verification commands passed after final task implementation.

---
*Phase: 26-m1-canary-cutover-gates*
*Completed: 2026-05-20*
