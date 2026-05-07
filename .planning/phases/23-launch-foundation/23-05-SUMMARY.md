---
phase: 23-launch-foundation
plan: 05
subsystem: api
tags: [translation, deepl, legal-lock, admin, nestjs, vitest]

requires:
  - phase: 23-launch-foundation
    provides: Translation/legal schema tables from 23-02
  - phase: 23-launch-foundation
    provides: Admin guard and API module patterns from existing codebase
provides:
  - Admin-protected translation workflow API
  - Korean source to en/th/zh-CN/zh-TW draft generation
  - Review-before-publish and stale-on-source-edit state transitions
  - DeepL adapter with missing-key manual-review draft behavior
  - Legal-sensitive content guard before translation provider calls
affects: [phase-23, translations, legal-content, admin-api, i18n]

tech-stack:
  added: []
  patterns:
    - TranslationService owns draft/review/publish/stale workflow state
    - DeepLClient is a narrow provider adapter modeled after existing API clients
    - Legal-sensitive content is blocked before external provider calls

key-files:
  created:
    - apps/api/src/modules/translation/translation.module.ts
    - apps/api/src/modules/translation/translation.controller.ts
    - apps/api/src/modules/translation/translation.service.ts
    - apps/api/src/modules/translation/translation.service.spec.ts
    - apps/api/src/modules/translation/deepl.client.ts
    - apps/api/src/modules/translation/deepl.client.spec.ts
  modified:
    - .env.example
    - apps/api/src/app.module.ts

key-decisions:
  - "DeepL missing-key behavior creates deterministic manual-review drafts and never publishes content."
  - "Legal-sensitive content types are blocked in TranslationService before any provider call."
  - "DeepL integration uses a small direct-fetch adapter instead of adding a new dependency."

patterns-established:
  - "Admin translation endpoints use `@UseGuards(RolesGuard)` with `@Roles('admin')` under `/api/v1/admin/translations`."
  - "Published AI-assisted translation rows always return `automaticTranslationLabel: true`."
  - "DeepL locale mapping is centralized in `mapDeepLTargetLocale`."

requirements-completed:
  - TRANS-01
  - TRANS-02
  - I18N-02

duration: 10 min
completed: 2026-05-06
---

# Phase 23 Plan 05: Translation Workflow and Legal Lock Summary

**Admin translation workflow now creates reviewed multilingual drafts through DeepL-compatible generation while structurally blocking legal-sensitive copy from provider calls.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-06T05:05:19Z
- **Completed:** 2026-05-06T05:14:51Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added `TranslationModule`, `TranslationController`, and `TranslationService` to the NestJS API.
- Created admin-only `/api/v1/admin/translations` endpoints for source creation, draft generation, queue listing, review, publish, and source edit stale handling.
- Implemented Korean source to `en`, `th`, `zh-CN`, and `zh-TW` draft generation with review-before-publish enforcement.
- Added stale-on-source-edit behavior so old drafts cannot be published after canonical Korean source changes.
- Added `DeepLClient` with `DEEPL_AUTH_KEY` config, `EN-US`/`TH`/`ZH-HANS`/`ZH-HANT` locale mapping, and deterministic missing-key manual-review output.
- Added legal-sensitive content guard for `legal`, `notice`, `refund`, and `booking_guide` before any translation provider call.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Translation workflow service tests** - `e38e3a6` (test)
2. **Task 1 GREEN: Translation workflow service and API** - `bf427ce` (feat)
3. **Task 2 RED: DeepL legal exclusion tests** - `f25ee26` (test)
4. **Task 2 GREEN: DeepL adapter and legal guard** - `4caee90` (feat)

## Files Created/Modified

- `apps/api/src/modules/translation/translation.module.ts` - Registers translation service, controller, and DeepL provider.
- `apps/api/src/modules/translation/translation.controller.ts` - Admin-protected translation workflow endpoints.
- `apps/api/src/modules/translation/translation.service.ts` - Source/draft workflow, review/publish/stale transitions, legal guard, and provider integration.
- `apps/api/src/modules/translation/translation.service.spec.ts` - TDD coverage for draft generation, review-before-publish, stale edits, labels, legal blocking, and missing-key drafts.
- `apps/api/src/modules/translation/deepl.client.ts` - DeepL API adapter and launch locale target mapping.
- `apps/api/src/modules/translation/deepl.client.spec.ts` - DeepL locale mapping, missing-key, and request-shape tests.
- `apps/api/src/app.module.ts` - Imports `TranslationModule`.
- `.env.example` - Documents `DEEPL_AUTH_KEY=` with no secret value.

## Decisions Made

- Used direct `fetch` for DeepL to match the existing `TossPaymentsClient` adapter style and avoid adding a dependency for one endpoint.
- Kept `DEEPL_AUTH_KEY` absence non-fatal in dev/test: generated drafts remain in `draft` status with a manual-review marker and cannot bypass review/publish gates.
- Blocked legal-sensitive content in `TranslationService.generateDrafts` before `DeepLClient.translateText`, satisfying the provider trust-boundary mitigation.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None. The `[manual-review:deepl-unavailable]` text is an intentional deterministic unavailable state required by the plan, not a placeholder implementation.

## Threat Flags

None - the new admin endpoints, external DeepL provider boundary, and legal-sensitive guard were already covered by the plan threat model.

## User Setup Required

DeepL configuration is required before real machine translation can run outside dev/test fallback:

- Add `DEEPL_AUTH_KEY` from a DeepL API account to the API runtime environment.
- Keep `.env.example` as `DEEPL_AUTH_KEY=` with no secret value.

## Verification

- `pnpm --filter @grabit/api test -- translation.service.spec.ts` - PASS, 412 tests during Task 1 verification.
- `pnpm --filter @grabit/api test -- deepl.client.spec.ts translation.service.spec.ts` - PASS, 417 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `grep -R "automaticTranslationLabel" apps/api/src/modules/translation` - PASS.
- `grep -R "법적 고지는 자동 번역할 수 없습니다" apps/api/src/modules/translation` - PASS.
- `grep -R "ZH-HANS" apps/api/src/modules/translation && grep -R "ZH-HANT" apps/api/src/modules/translation` - PASS.
- `grep -q "^DEEPL_AUTH_KEY=$" .env.example` - PASS.

## TDD Gate Compliance

- Task 1 RED commit exists: `e38e3a6`
- Task 1 GREEN commit exists after RED: `bf427ce`
- Task 2 RED commit exists: `f25ee26`
- Task 2 GREEN commit exists after RED: `4caee90`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for downstream admin UI/public rendering plans. The API now exposes queue/review/publish workflow data with `automaticTranslationLabel`, and legal-sensitive content cannot enter machine translation jobs.

## Self-Check: PASSED

- Summary and key translation/DeepL files exist on disk.
- Task commits `e38e3a6`, `bf427ce`, `f25ee26`, and `4caee90` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
