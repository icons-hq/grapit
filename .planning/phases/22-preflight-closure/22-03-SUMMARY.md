---
phase: 22-preflight-closure
plan: "03"
subsystem: infra
tags: [valkey, smoke-test, hardening, r2, sms, email, legal]

requires:
  - phase: 22-preflight-closure
    provides: Phase 22 context, validation, and hardening planning artifacts
provides:
  - Phase 22 default artifact path for production Valkey smoke evidence
  - Operational hardening register for PREF-03
  - Valkey/R2/SMS/email/legal fragility classifications as fix, accepted risk, or blocker
affects: [phase-22, preflight-closure, launch-readiness, hardening]

tech-stack:
  added: []
  patterns:
    - Phase-scoped production smoke evidence artifact path
    - Markdown hardening register with concrete fix / ACCEPTED_RISK / BLOCKER dispositions

key-files:
  created:
    - .planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md
  modified:
    - scripts/smoke-valkey-production.mjs

key-decisions:
  - "Valkey production smoke evidence now defaults to .planning/phases/22-preflight-closure/artifacts/valkey-smoke.md while preserving GRABIT_SMOKE_ARTIFACT overrides."
  - "PREF-03 fragility is tracked as concrete fix, ACCEPTED_RISK, or BLOCKER instead of informal prose."

patterns-established:
  - "Phase 22 hardening register rows require owner, evidence, disposition, and next action."
  - "Missing production/provider/operator evidence remains BLOCKER unless D-02 approvals convert it to ACCEPTED_RISK."

requirements-completed: [PREF-03]

duration: 4 min
completed: 2026-05-04
---

# Phase 22 Plan 03: Preflight Closure Hardening Register Summary

**Production Valkey smoke evidence now defaults into Phase 22 traceability, with PREF-03 hardening risks classified across Valkey, R2, SMS, email, and legal surfaces.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-04T08:50:23Z
- **Completed:** 2026-05-04T08:54:47Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Updated `scripts/smoke-valkey-production.mjs` so its default artifact path is `.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md`.
- Preserved `GRABIT_SMOKE_ARTIFACT` override behavior and smoke/redaction logic.
- Created `22-HARDENING-REGISTER.md` with Valkey, R2, SMS, Email, and Legal rows using `concrete fix`, `ACCEPTED_RISK`, and `BLOCKER` dispositions.
- Routed `signup-sms-otp-verify-wrong`, `password-reset-email-not-delivered-prod`, and `legal-pages-404-heygrabit` into Phase 22 closure paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix Valkey smoke default artifact path** - `562ee4e` (fix)
2. **Task 2: Create operational hardening register** - `ff15d28` (docs)

## Files Created/Modified

- `scripts/smoke-valkey-production.mjs` - default artifact URL and help text now point to the Phase 22 Valkey smoke artifact.
- `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` - operational fragility register for PREF-03.

## Decisions Made

- Keep the smoke script behavior unchanged except for its default artifact path and help text.
- Treat missing production/provider/operator evidence as `BLOCKER` unless D-02 maintainer/operator approvals explicitly convert it to `ACCEPTED_RISK`.

## Deviations from Plan

None - plan outputs were implemented as specified.

## Issues Encountered

- The requested plan directory and context files were absent from current `HEAD`, while the plan existed in git history. I read `22-03-PLAN.md`, `22-CONTEXT.md`, `22-RESEARCH.md`, `22-VALIDATION.md`, and `22-PATTERNS.md` from the relevant git commits and created only this plan's output files in the current worktree.
- Existing uncommitted `.planning/STATE.md` and `22-VALIDATION-BASELINE.md` changes were present or appeared during execution. They were left untouched and unstaged.

## Verification

- `rg -n "22-preflight-closure/artifacts/valkey-smoke.md|GRABIT_SMOKE_ARTIFACT" scripts/smoke-valkey-production.mjs` - PASS
- `node scripts/smoke-valkey-production.mjs --help | rg "22-preflight-closure/artifacts/valkey-smoke.md"` - PASS
- `rg -n "20-valkey-production-connectivity-contract/20-HUMAN-UAT.md" scripts/smoke-valkey-production.mjs && exit 1 || true` - PASS
- `test -f .planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` - PASS
- `rg -n "Valkey|R2|SMS|Email|Legal|concrete fix|ACCEPTED_RISK|BLOCKER" .planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` - PASS
- `pnpm test` - PASS (`@grabit/api`: 29 files / 386 tests, `@grabit/web`: 27 files / 191 tests)

## User Setup Required

None for this plan. Operator evidence remains tracked as `BLOCKER` rows in `22-HARDENING-REGISTER.md`.

## Next Phase Readiness

PREF-03 now has a concrete register and the Valkey smoke artifact no longer defaults to an archived Phase 20 path. Phase 23 launch work should not treat Valkey/R2/SMS/email/legal as ready until `BLOCKER` rows are resolved or explicitly accepted under D-02.

## Self-Check: PASSED

- Found `scripts/smoke-valkey-production.mjs`.
- Found `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md`.
- Found `.planning/phases/22-preflight-closure/22-03-SUMMARY.md`.
- Found task commits `562ee4e` and `ff15d28`.

---
*Phase: 22-preflight-closure*
*Completed: 2026-05-04*
