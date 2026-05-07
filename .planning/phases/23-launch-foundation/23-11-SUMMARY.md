---
phase: 23-launch-foundation
plan: 11
subsystem: i18n-admin-ui
tags: [nextjs, react-query, vitest, translation, admin, i18n]
requires:
  - phase: 23-05
    provides: Admin translation API endpoints, DeepL draft generation, and legal-sensitive translation guard
  - phase: 23-08
    provides: Current public performance detail booking-disabled surface
  - phase: 23-12
    provides: Admin sidebar and hook patterns for admin audit pages
  - phase: 23-14
    provides: KST/KRW public performance detail i18n helpers
provides:
  - Admin translation source-to-generate-to-review-to-publish UI workflow
  - React Query hooks for admin translation queue and mutations
  - Reusable AutomaticTranslationLabel public component
  - Public performance detail label rendering for AI-assisted translated metadata
  - Review endpoint persistence for operator-edited translated text
affects: [translation-review, public-performance-detail, admin-sidebar, translation-api]
tech-stack:
  added: []
  patterns:
    - Admin table-first review queue with keyboard row activation
    - React Query admin mutation hooks invalidating admin translation queue
    - Metadata-driven public automatic translation label display
key-files:
  created:
    - apps/web/app/admin/translations/page.tsx
    - apps/web/components/admin/translation-review-table.tsx
    - apps/web/components/admin/translation-source-form.tsx
    - apps/web/components/admin/translation-review-detail-panel.tsx
    - apps/web/components/i18n/automatic-translation-label.tsx
    - apps/web/components/admin/__tests__/translation-review.test.tsx
    - apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx
  modified:
    - apps/web/hooks/use-admin.ts
    - apps/web/components/admin/admin-sidebar.tsx
    - apps/web/app/performance/[id]/page.tsx
    - apps/api/src/modules/translation/translation.controller.ts
    - apps/api/src/modules/translation/translation.service.ts
    - apps/api/src/modules/translation/translation.service.spec.ts
key-decisions:
  - "Review endpoint now persists optional translatedText so admin edited review copy is the text that later publishes."
  - "Public performance detail renders one AutomaticTranslationLabel near the title whenever title, description, salesInfo, or top-level translation metadata indicates AI assistance."
patterns-established:
  - "Admin translation hooks live in use-admin.ts and use /api/v1/admin/translations route keys with queue invalidation after every mutation."
  - "AutomaticTranslationLabel always includes Korean copy plus English fallback copy for all launch locales."
requirements-completed: [TRANS-01, TRANS-02, I18N-02]
duration: 7m32s
completed: 2026-05-06
---

# Phase 23 Plan 11: Admin Translation Review Workflow Summary

**Admin source-to-publish translation review with reusable reviewed machine-translation labeling on public performance detail**

## Performance

- **Duration:** 7m32s
- **Started:** 2026-05-06T07:47:06Z
- **Completed:** 2026-05-06T07:54:38Z
- **Tasks:** 1
- **Files modified:** 14

## Accomplishments

- Added `/admin/translations` with source creation, draft generation, queue filters, review table, and detail panel.
- Added `useTranslationQueue`, `useCreateTranslationSource`, `useGenerateTranslationDrafts`, `useReviewTranslationDraft`, and `usePublishTranslationDraft`.
- Added reusable `AutomaticTranslationLabel` and wired it into the current public performance detail page when translated/AI-assisted metadata is present.
- Added TDD coverage for admin workflow, label copy, and public performance detail label behavior.
- Persisted operator-edited translated text in the existing admin translation review endpoint before publish.

## Task Commits

1. **Task 1 RED: Translation workflow tests** - `542bb37` (`test`)
2. **Task 1 GREEN: Translation review workflow implementation** - `8c69979` (`feat`)

**Plan metadata:** final docs commit records this summary and state updates.

## Files Created/Modified

- `apps/web/app/admin/translations/page.tsx` - Admin translation workflow page with filters, source form, review queue, and detail panel.
- `apps/web/components/admin/translation-source-form.tsx` - Korean source input and launch-locale draft generation controls.
- `apps/web/components/admin/translation-review-table.tsx` - Queue table with loading, empty, status, reviewer, and keyboard activation states.
- `apps/web/components/admin/translation-review-detail-panel.tsx` - Source/target review panel with edit, review, publish, stale, legal-blocked, and label preview states.
- `apps/web/components/i18n/automatic-translation-label.tsx` - Reusable public label for reviewed machine translation.
- `apps/web/hooks/use-admin.ts` - React Query hooks and types for `/api/v1/admin/translations`.
- `apps/web/components/admin/admin-sidebar.tsx` - Added `번역 검수` admin navigation item.
- `apps/web/app/performance/[id]/page.tsx` - Renders `AutomaticTranslationLabel` for translated/AI-assisted metadata.
- `apps/api/src/modules/translation/translation.controller.ts` - Accepts optional reviewed `translatedText`.
- `apps/api/src/modules/translation/translation.service.ts` - Persists reviewed translated text before publish.
- `apps/api/src/modules/translation/translation.service.spec.ts` - Covers edited translated text persistence.
- `apps/web/components/admin/__tests__/translation-review.test.tsx` - Admin workflow and hook coverage.
- `apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx` - Label copy coverage.
- `apps/web/app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx` - Public detail label coverage.

## Decisions Made

- Persist edited review text server-side in the existing review mutation instead of adding a new route. This keeps the 23-05 API shape intact while making the UI workflow truthful.
- Render the public automatic-translation label once near the performance title when any relevant metadata is present. This avoids duplicate labels across tabs while satisfying title/description/salesInfo metadata coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Persist reviewed translated text in the API**
- **Found during:** Task 1 (admin review/detail implementation)
- **Issue:** The existing 23-05 review endpoint marked drafts reviewed but did not accept or save edited translated text, so the UI could appear to edit copy while publish still used the original draft.
- **Fix:** Added optional `translatedText` to the review DTO and `TranslationService.markReviewed`, updating memory and Drizzle paths before publish.
- **Files modified:** `apps/api/src/modules/translation/translation.controller.ts`, `apps/api/src/modules/translation/translation.service.ts`, `apps/api/src/modules/translation/translation.service.spec.ts`
- **Verification:** `pnpm --filter @grabit/api test -- translation.service.spec.ts`; `pnpm --filter @grabit/api typecheck`
- **Committed in:** `8c69979`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required for correctness of the planned review/edit/publish workflow. No new route, table, dependency, or auth boundary was added.

## Issues Encountered

- The project Vitest commands with filename arguments still collected the full package suites. The required web verification passed with 45 files / 303 tests, including the three requested new test files.
- Existing unrelated jsdom warnings remain from prior tests (`act(...)`, `window.scrollTo`, and navigation stubs); all affected suites passed.

## Verification

- `pnpm --filter @grabit/web test -- translation-review.test.tsx automatic-translation-label.test.tsx performance-detail-translation-label.test.tsx` - PASS, 45 files / 303 tests.
- Required greps for `번역 검수`, translation mutation hooks, `자동 번역 검수본`, and `AutomaticTranslationLabel` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api test -- translation.service.spec.ts` - PASS, 40 files / 477 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.

## Known Stubs

None.

## Threat Flags

None. The only API adjustment is within the existing admin-guarded translation review endpoint covered by the plan threat model.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

TRANS-01/TRANS-02 admin review workflow is available from the admin sidebar, and public performance detail can now disclose reviewed AI-assisted translation status when backend payloads expose Phase 23 translation metadata.

## Self-Check: PASSED

- Created files exist on disk.
- Task commits found: `542bb37`, `8c69979`.
- Required plan verification passed after implementation.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
