---
phase: 25-admin-operations-console
plan: "02"
subsystem: api
tags: [locale, auth, email, sms, drizzle, vitest]

requires:
  - phase: 23-launch-foundation
    provides: five-locale launch auth, email, SMS, and locale foundations
  - phase: 25-admin-operations-console
    provides: Phase 25 zh-TW locale contract from CONTEXT/UI-SPEC
provides:
  - API preferred locale enum aligned to ko/en/th/zh-CN/zh-TW
  - Auth email-verification locale validation aligned to zh-TW
  - Email and SMS transactional copy maps for zh-TW with active ja removed
  - Seed translation fixture target locale switched from ja to zh-TW
affects: [admin-operations-console, launch-locales, auth, sms, email, seed-data]

tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN locale drift guard with source grep verification
    - Historical ja migration evidence remains isolated from active runtime locale support

key-files:
  created: []
  modified:
    - apps/api/src/database/schema/users.ts
    - apps/api/src/database/schema/launch-foundation.schema.spec.ts
    - apps/api/src/modules/auth/auth.controller.ts
    - apps/api/src/modules/auth/email/templates/email-verification.copy.ts
    - apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts
    - apps/api/src/modules/auth/email/email.service.spec.ts
    - apps/api/src/modules/sms/sms-copy.ts
    - apps/api/src/modules/sms/sms-copy.spec.ts
    - apps/api/src/database/seed.mjs

key-decisions:
  - "Active API launch locale support is ko/en/th/zh-CN/zh-TW; ja remains only as historical migration evidence."
  - "Traditional Chinese transactional copy is owned in API email/SMS maps, not synthesized by fallback to ko."

patterns-established:
  - "Locale drift tests assert both positive zh-TW support and absence of active ja literals in owned API files."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03]

duration: 9 min
completed: 2026-05-14
---

# Phase 25 Plan 02: API Locale Drift Reconciliation Summary

**API schema, auth validation, transactional email/SMS copy, and seed fixtures now use `zh-TW` instead of active `ja` for the fifth launch locale.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-14T00:23:43Z
- **Completed:** 2026-05-14T00:32:16Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Replaced active API locale enum and email-verification request validation from `ja` to `zh-TW`.
- Added Traditional Chinese email verification, SMS OTP, and auth status copy while preserving existing `ko`, `en`, `th`, and `zh-CN` behavior.
- Updated seed translation target locales and fanmeet fixture copy to produce `zh-TW` reviewed translation rows.
- Added TDD regression coverage for schema/auth/seed/email/SMS locale drift and active Japanese launch-copy removal.

## Task Commits

1. **Task 1 RED: Reconcile API schema, auth, email, and SMS locale contract** - `e920a30` (`test`)
2. **Task 1 GREEN: Reconcile API schema, auth, email, and SMS locale contract** - `d57bc0c` (`feat`)

## Files Created/Modified

- `apps/api/src/database/schema/users.ts` - Preferred locale enum now includes `zh-TW` instead of active `ja`.
- `apps/api/src/database/schema/launch-foundation.schema.spec.ts` - Schema/auth/seed assertions now guard `zh-TW` and isolate historical migration evidence.
- `apps/api/src/modules/auth/auth.controller.ts` - Email verification locale validation accepts `zh-TW`.
- `apps/api/src/modules/auth/email/templates/email-verification.copy.ts` - Email verification copy map now includes `zh-TW`.
- `apps/api/src/modules/auth/email/templates/email-verification.copy.spec.ts` - Email copy tests assert exact five-locale contract.
- `apps/api/src/modules/auth/email/email.service.spec.ts` - Email service test proves `zh-TW` copy is selected, not `ko` fallback.
- `apps/api/src/modules/sms/sms-copy.ts` - SMS OTP and auth status copy maps now include `zh-TW`.
- `apps/api/src/modules/sms/sms-copy.spec.ts` - SMS/auth copy tests assert exact five-locale contract.
- `apps/api/src/database/seed.mjs` - Reviewed fanmeet translation seed targets `zh-TW` instead of `ja`.

## Decisions Made

- Active runtime locale support follows Phase 25 UI-SPEC: `ko`, `en`, `th`, `zh-CN`, `zh-TW`.
- Historical migration `0014_locale_ja_drop_zh_tw` remains testable evidence, but active runtime files may not expose `ja`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed dependencies in the isolated worktree**
- **Found during:** Task 1 RED verification
- **Issue:** `pnpm --filter @grabit/api test ...` failed before reaching tests because `vitest` was unavailable and `node_modules` was missing in the worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile --offline` inside `/Users/sangwopark19/icons/grapit/.codex/worktrees/agent-25-02`.
- **Files modified:** None tracked; `node_modules` remains ignored.
- **Verification:** RED test command then failed for expected `zh-TW` assertions; final verification passed.
- **Committed in:** Not applicable, environment-only fix.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** No product scope change. The environment fix was required to run the mandated Vitest verification.

## Verification

- `pnpm --filter @grabit/api exec vitest run database/schema/launch-foundation.schema.spec.ts modules/auth/email/templates/email-verification.copy.spec.ts modules/auth/email/email.service.spec.ts modules/sms/sms-copy.spec.ts` - PASS, 4 files / 45 tests.
- `pnpm --filter @grabit/api test -- src/modules/auth/email/templates/email-verification.copy.spec.ts src/modules/sms/sms-copy.spec.ts` - PASS, 54 files / 579 tests. The current Vitest root config expands this command to the API test suite.
- `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" ... | rg -v "0014_locale_ja_drop_zh_tw|historical.*ja|DELETE FROM.*locale.*ja")` - PASS, no active Japanese launch locale/copy hits in owned files.

## Known Stubs

None. Stub scan found only existing seed accumulator arrays (`perfIds`, `showtimeInserts`, `tierInserts`, `castInserts`), not UI/data placeholders.

## Threat Flags

None. This plan modified the existing locale validation trust boundary covered by `T-25-02-01` and transactional copy surface covered by `T-25-02-02`; it did not add new endpoints, file access, auth paths, or trust boundaries.

## Issues Encountered

- The first RED command was blocked by missing worktree dependencies and was resolved with an offline install.
- The initial patch tool cwd targeted the parent checkout; those unintended parent diffs were immediately reverted, verified clean, and the actual edits were reapplied only under `.codex/worktrees/agent-25-02`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 25 downstream admin content/schema plans can rely on API-owned locale surfaces using `zh-TW` as the Traditional Chinese launch locale. `STATE.md` and `ROADMAP.md` were intentionally not updated because the orchestrator owns shared tracking after wave merge.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/25-admin-operations-console/25-02-SUMMARY.md`.
- Task commits exist: `e920a30`, `d57bc0c`.
- Shared tracking files were not modified: `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`.
- Parent checkout task files were verified clean after correcting the patch target.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
