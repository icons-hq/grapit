---
phase: 25-admin-operations-console
plan: "20"
subsystem: ui
tags: [nextjs, react, i18n, legal, vitest, tdd]

requires:
  - phase: 23-launch-foundation
    provides: Legal-sensitive Korean/English canonical markdown and English fallback policy
  - phase: 25-admin-operations-console
    provides: Launch locale contract requiring ko, en, th, zh-CN, zh-TW
provides:
  - Legal pages use zh-TW for Chinese legal-sensitive English fallback
  - Legal fallback label exposes zh-TW copy and no active Japanese legal copy
  - Legal content tests reject native Traditional Chinese legal markdown
affects: [admin-operations-console, launch-locale, legal-fallback, public-legal-pages]

tech-stack:
  added: []
  patterns:
    - TDD RED/GREEN split for locale fallback reconciliation
    - Legal-sensitive locales use English canonical markdown rather than unreviewed native legal copy

key-files:
  created:
    - .planning/phases/25-admin-operations-console/25-20-SUMMARY.md
  modified:
    - apps/web/app/legal/terms/page.tsx
    - apps/web/app/legal/privacy/page.tsx
    - apps/web/app/legal/marketing/page.tsx
    - apps/web/app/legal/__tests__/legal-fallback.test.tsx
    - apps/web/components/legal/legal-fallback-label.tsx
    - apps/web/content/legal/__tests__/legal-content.test.ts

key-decisions:
  - "Do not add native zh-TW legal markdown in Phase 25; zh-TW uses the approved English canonical fallback."
  - "Keep this plan scoped to legal fallback surfaces; shared/API/admin locale contracts remain owned by adjacent Wave 0 plans."

patterns-established:
  - "Legal fallback labels are keyed to ko, en, th, zh-CN, and zh-TW with no active ja entry."
  - "Legal markdown tests treat Korean and English as the only canonical legal copy locales."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03]

duration: 5min
completed: 2026-05-14
---

# Phase 25 Plan 20: Legal Fallback Locale Drift Summary

**zh-TW legal-sensitive pages now use the approved English canonical fallback with regression tests preventing active Japanese legal copy.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-14T00:38:37Z
- **Completed:** 2026-05-14T00:43:32Z
- **Tasks:** 1 TDD task
- **Files modified:** 6

## Accomplishments

- Replaced active `ja` legal fallback behavior with `zh-TW` across terms, privacy, and marketing legal pages.
- Updated the fallback label map so Traditional Chinese legal users see the English legal notice label without introducing Japanese launch copy.
- Added regression coverage proving `zh-TW` legal routes render English canonical markdown and no native Traditional Chinese legal markdown is added.

## Task Commits

1. **Task 1 RED:** `05d216c` (`test`) - added failing `zh-TW` legal fallback and legal content tests.
2. **Task 1 GREEN:** `a3a6079` (`feat`) - implemented `zh-TW` legal fallback behavior and removed active Japanese fallback copy.

_Note: This was a TDD task, so the single planned task intentionally produced separate RED and GREEN commits._

## Files Created/Modified

- `apps/web/app/legal/terms/page.tsx` - resolves `zh-TW` to English canonical terms markdown.
- `apps/web/app/legal/privacy/page.tsx` - resolves `zh-TW` to English canonical privacy markdown.
- `apps/web/app/legal/marketing/page.tsx` - resolves `zh-TW` to English canonical marketing consent markdown.
- `apps/web/app/legal/__tests__/legal-fallback.test.tsx` - covers `zh-TW` fallback rendering and absence of Japanese legal copy.
- `apps/web/components/legal/legal-fallback-label.tsx` - replaces the active Japanese label entry with `zh-TW`.
- `apps/web/content/legal/__tests__/legal-content.test.ts` - rejects `zh-TW` native legal markdown while preserving Korean/English canonical-only rules.

## Decisions Made

- `zh-TW` legal pages continue to use English canonical fallback rather than adding unreviewed Traditional Chinese legal markdown.
- The implementation avoids importing the shared `SupportedLocale` type in the legal label because adjacent Wave 0 locale plans own the shared locale source-of-truth update.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored missing local test dependencies**
- **Found during:** Task 1 RED test execution
- **Issue:** `pnpm --filter @grabit/web test -- ...` failed with `vitest: command not found` because this isolated worktree had no installed `node_modules`.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the worktree; no tracked dependency files changed.
- **Files modified:** None tracked
- **Verification:** Re-ran the RED test command and observed the intended failing `zh-TW` legal fallback assertions.
- **Committed in:** Not committed; environment-only fix.

---

**Total deviations:** 1 auto-fixed (1 blocking environment issue).
**Impact on plan:** Verification environment was restored without scope expansion or tracked dependency changes.

## Issues Encountered

- Initial patch application targeted the parent checkout because `apply_patch` had no workdir parameter. The two accidental parent test edits were immediately reverted with a file-scoped checkout, and parent status for the touched files was confirmed clean before continuing with absolute worktree paths.
- The plan-provided Vitest command runs the broader web test set in this workspace, not only the two named files. It still passed and included the owned legal tests.

## Verification

- `pnpm --filter @grabit/web test -- app/legal/__tests__/legal-fallback.test.tsx content/legal/__tests__/legal-content.test.ts` - PASS, 56 test files / 362 tests passed.
- `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" apps/web/app/legal/terms/page.tsx apps/web/app/legal/privacy/page.tsx apps/web/app/legal/marketing/page.tsx apps/web/app/legal/__tests__/legal-fallback.test.tsx apps/web/components/legal/legal-fallback-label.tsx apps/web/content/legal/__tests__/legal-content.test.ts)` - PASS, no active Japanese legal route/copy in owned files.
- `find apps/web/content/legal -name '*zh-TW*.md' -print` - PASS, no native Traditional Chinese legal markdown files were added.

## Known Stubs

None. The stub-pattern scan only matched the existing legal placeholder regression test names/patterns and Phase 16 comments describing placeholder prevention.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Legal fallback behavior is aligned with the Phase 25 launch locale contract for `zh-TW`. Adjacent Wave 0 plans can merge shared/API/admin locale source-of-truth changes without this legal surface retaining active `ja` copy.

## Self-Check: PASSED

- SUMMARY exists at `.planning/phases/25-admin-operations-console/25-20-SUMMARY.md`.
- Task commits exist: `05d216c`, `a3a6079`.
- All six owned legal fallback files exist in the worktree.
- Parent checkout has no remaining changes for the files touched by this plan.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
