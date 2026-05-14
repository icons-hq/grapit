---
phase: 25-admin-operations-console
plan: "18"
subsystem: api
tags: [locale, consent, user-profile, translation, deepl, zh-TW]

requires:
  - phase: 23-launch-foundation
    provides: "Translation workflow, consent audit, user preferred-locale, and five-locale launch foundations"
  - phase: 25-admin-operations-console
    provides: "Phase 25 UI/CONTEXT contract requiring ko/en/th/zh-CN/zh-TW"
provides:
  - "User/profile validation and service tests lock zh-TW as the active Traditional Chinese locale"
  - "Consent audit language typing, translation target locales, and DeepL provider mapping use zh-TW"
  - "DeepL Traditional Chinese target mapping uses ZH-HANT with no active JA target"
affects: [25-01, 25-02, 25-19, admin-translation, consent-audit, locale-contract]

tech-stack:
  added: []
  patterns:
    - "TDD RED/GREEN locale contract update"
    - "DeepL locale adapter maps app locale identifiers to provider target languages"

key-files:
  created:
    - ".planning/phases/25-admin-operations-console/25-18-SUMMARY.md"
  modified:
    - "apps/api/src/modules/consent/consent.service.ts"
    - "apps/api/src/modules/user/user.controller.spec.ts"
    - "apps/api/src/modules/user/user.service.spec.ts"
    - "apps/api/src/modules/translation/translation.service.ts"
    - "apps/api/src/modules/translation/translation.service.spec.ts"
    - "apps/api/src/modules/translation/deepl.client.ts"
    - "apps/api/src/modules/translation/deepl.client.spec.ts"
    - "packages/shared/src/constants/locales.ts"
    - "apps/api/src/database/schema/users.ts"
    - "apps/api/src/database/schema/launch-foundation.schema.spec.ts"

key-decisions:
  - "Map zh-TW to DeepL ZH-HANT because DeepL exposes Traditional Chinese as a dedicated target language."
  - "Update shared locale constants and API locale enum in this isolated worktree so 25-18 user/profile verification proves runtime behavior, not only test expectations."

patterns-established:
  - "Locale drift tests avoid active Japanese literals in owned files while still proving legacy input is rejected."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03]

duration: 6 min
completed: 2026-05-14
---

# Phase 25 Plan 18: User, Consent, Translation Locale Summary

**User/profile, consent audit, translation drafts, and DeepL target mapping now use `zh-TW` with no active Japanese translation target.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-14T00:23:58Z
- **Completed:** 2026-05-14T00:30:15Z
- **Tasks:** 1
- **Files modified:** 10

## Accomplishments

- Added failing locale contract tests first, then made user/profile schema and service behavior accept `zh-TW` and reject legacy Japanese locale input.
- Replaced translation target locales with `en`, `th`, `zh-CN`, and `zh-TW`.
- Replaced the DeepL Japanese target with `ZH-HANT` for Traditional Chinese.
- Updated consent audit language typing and API/shared locale sources needed for isolated verification.

## Task Commits

1. **Task 1 RED: Reconcile user, consent, translation, and DeepL locale contracts** - `39ac02a` (test)
2. **Task 1 GREEN: Reconcile user, consent, translation, and DeepL locale contracts** - `eced052` (feat)

**Plan metadata:** committed separately in the final docs commit.

## Files Created/Modified

- `apps/api/src/modules/consent/consent.service.ts` - Consent audit filters now type `zh-TW` instead of active Japanese.
- `apps/api/src/modules/user/user.controller.spec.ts` - Profile DTO validation expects `zh-TW` and rejects legacy Japanese locale input.
- `apps/api/src/modules/user/user.service.spec.ts` - UserService persistence behavior expects `zh-TW` support and rejects legacy Japanese locale input.
- `apps/api/src/modules/translation/translation.service.ts` - Translation target locale contract now generates `zh-TW`.
- `apps/api/src/modules/translation/translation.service.spec.ts` - Translation draft tests lock the four target locales to `en/th/zh-CN/zh-TW`.
- `apps/api/src/modules/translation/deepl.client.ts` - DeepL provider mapping now maps `zh-TW` to `ZH-HANT`.
- `apps/api/src/modules/translation/deepl.client.spec.ts` - DeepL target language tests cover `ZH-HANT`.
- `packages/shared/src/constants/locales.ts` - Shared `SUPPORTED_LOCALES`, prefixes, and labels use `zh-TW`.
- `apps/api/src/database/schema/users.ts` - API `locale` enum uses `zh-TW`.
- `apps/api/src/database/schema/launch-foundation.schema.spec.ts` - Existing schema expectation was updated to match the new enum.

## Decisions Made

- DeepL mapping uses `ZH-HANT`, not a Simplified Chinese fallback, because DeepL's supported-language documentation lists `ZH-HANT` for Traditional Chinese targets.
- The isolated worktree updates shared/API locale sources even though sibling plans also own those files, because the 25-18 verification command imports them and must prove actual runtime behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing workspace dependencies**
- **Found during:** Task 1 RED verification
- **Issue:** `pnpm --filter @grabit/api test -- ...` failed before running Vitest because `node_modules` was missing in the worktree.
- **Fix:** Ran `pnpm install --offline` in the worktree.
- **Files modified:** none tracked
- **Verification:** RED verification then ran and failed for the expected locale-contract reasons.
- **Committed in:** not applicable

**2. [Rule 3 - Blocking] Aligned shared/API locale sources required by isolated verification**
- **Found during:** Task 1 GREEN verification
- **Issue:** User/profile tests depend on `packages/shared/src/constants/locales.ts`, and translation/consent schema behavior depends on the API `localeEnum`; those files were owned by sibling Wave 0 plans but absent in this isolated worktree.
- **Fix:** Updated `packages/shared/src/constants/locales.ts`, `apps/api/src/database/schema/users.ts`, and the affected schema spec to the same `zh-TW` contract.
- **Files modified:** `packages/shared/src/constants/locales.ts`, `apps/api/src/database/schema/users.ts`, `apps/api/src/database/schema/launch-foundation.schema.spec.ts`
- **Verification:** `pnpm --filter @grabit/api test -- src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts` passed.
- **Committed in:** `eced052`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both were required to prove the locale contract in this isolated worktree. No new user-facing feature scope was added.

## Issues Encountered

- The API test command runs the broader API Vitest suite from the package config, not only the four requested files. After changing `localeEnum`, the existing launch-foundation schema spec needed the same expected locale update.

## Known Stubs

None. The stub scan only matched legitimate initialized arrays in query builders and in-memory test stores.

## Threat Flags

None. The only trust-boundary change is the planned translation provider target mapping covered by `T-25-18-01`.

## Verification

- PASS: `pnpm --filter @grabit/api test -- src/modules/translation/deepl.client.spec.ts src/modules/translation/translation.service.spec.ts src/modules/user/user.controller.spec.ts src/modules/user/user.service.spec.ts`
- PASS: `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約|\bJA\b" apps/api/src/modules/consent/consent.service.ts apps/api/src/modules/user/user.controller.spec.ts apps/api/src/modules/user/user.service.spec.ts apps/api/src/modules/translation/translation.service.ts apps/api/src/modules/translation/translation.service.spec.ts apps/api/src/modules/translation/deepl.client.ts apps/api/src/modules/translation/deepl.client.spec.ts)`

## TDD Gate Compliance

- RED commit exists: `39ac02a`
- GREEN commit exists after RED: `eced052`
- Refactor commit: not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Admin translation and consent UI plans can now consume `zh-TW` as the active Traditional Chinese locale. Sibling locale plans may touch the same shared/API source files; this summary documents the isolated-worktree adjustment so the orchestrator can reconcile identical Wave 0 locale changes during merge.

## Self-Check: PASSED

- Created/modified files verified on disk.
- Task commits verified in git history: `39ac02a`, `eced052`.
- No accidental file deletions detected.
- `STATE.md` and `ROADMAP.md` were not modified.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
