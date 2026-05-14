---
phase: 25-admin-operations-console
plan: "19"
subsystem: ui
tags: [admin, i18n, translation, consent-audit, react, vitest]

requires:
  - phase: 23-launch-foundation
    provides: "Five-locale launch contract and consent/translation foundations"
  - phase: 25-admin-operations-console
    provides: "Approved Phase 25 UI-SPEC requiring ko/en/th/zh-CN/zh-TW admin surfaces"
provides:
  - "Admin translation target UI reconciled to zh-TW Traditional Chinese"
  - "Consent audit language filter reconciled to zh-TW Traditional Chinese"
  - "Component regression tests locking out active Japanese admin locale options"
affects: [phase-25-admin-operations-console, admin-translation, consent-audit, i18n]

tech-stack:
  added: []
  patterns: ["TDD RED/GREEN component-test lock for locale drift", "Admin locale labels use zh-TW as Traditional Chinese"]

key-files:
  created:
    - .planning/phases/25-admin-operations-console/25-19-SUMMARY.md
  modified:
    - apps/web/hooks/use-admin.ts
    - apps/web/app/admin/translations/page.tsx
    - apps/web/components/admin/translation-source-form.tsx
    - apps/web/components/admin/translation-review-table.tsx
    - apps/web/components/admin/__tests__/translation-review.test.tsx
    - apps/web/components/admin/consent-audit-table.tsx
    - apps/web/components/admin/__tests__/consent-audit-table.test.tsx

key-decisions:
  - "Use zh-TW / 繁體中文 as the admin Traditional Chinese launch locale; do not expose Japanese as an active admin option in this plan."
  - "Keep the plan scoped to UI types/options/copy and tests; no legal markdown, sixth locale, API schema, or shared locale contract changes were added here."

patterns-established:
  - "Locale drift guard: targeted admin tests assert zh-TW is visible and the legacy Japanese label is absent without storing the legacy literal in source."

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03]

duration: 6m11s
completed: 2026-05-14
---

# Phase 25 Plan 19: Admin Translation And Consent Locale Drift Summary

**Admin translation and consent audit UI now expose zh-TW Traditional Chinese instead of Japanese for Phase 25 launch operations.**

## Performance

- **Duration:** 6m11s
- **Started:** 2026-05-14T00:38:05Z
- **Completed:** 2026-05-14T00:44:16Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Replaced the admin translation target locale type, filter option, review-table label, and draft-generation CTA from the legacy Japanese launch option to `zh-TW`.
- Replaced the consent audit language filter type and option with `zh-TW` / `繁體中文`.
- Added component tests proving the admin translation and consent audit surfaces expose Traditional Chinese and do not expose the legacy Japanese label as an active option.

## Task Commits

1. **Task 1 RED: Reconcile admin translation and consent locale surfaces** - `5850ced` (test)
2. **Task 1 GREEN: Reconcile admin translation and consent locale surfaces** - `540d81a` (feat)

_Note: This was a TDD task, so the task has separate RED and GREEN commits._

## Files Created/Modified

- `apps/web/hooks/use-admin.ts` - Changes `TranslationTargetLocale` from `ja` to `zh-TW`.
- `apps/web/app/admin/translations/page.tsx` - Changes the translation queue locale filter option to Traditional Chinese.
- `apps/web/components/admin/translation-source-form.tsx` - Changes draft-generation CTA copy to `en/th/zh-CN/zh-TW`.
- `apps/web/components/admin/translation-review-table.tsx` - Changes review table locale label mapping to `zh-TW` / `繁體中文`.
- `apps/web/components/admin/__tests__/translation-review.test.tsx` - Adds/updates RED coverage for `zh-TW` draft CTA and review table labels with no active legacy Japanese option.
- `apps/web/components/admin/consent-audit-table.tsx` - Changes consent audit language type and select option to `zh-TW` / `繁體中文`.
- `apps/web/components/admin/__tests__/consent-audit-table.test.tsx` - Adds RED coverage for Traditional Chinese consent filtering and absence of the legacy Japanese option.
- `.planning/phases/25-admin-operations-console/25-19-SUMMARY.md` - Plan execution summary.

## Decisions Made

- Followed the Phase 25 UI-SPEC launch-locale correction exactly: admin translation and consent surfaces now use `ko/en/th/zh-CN/zh-TW`, not `ko/en/th/zh-CN/ja`.
- Kept this plan to its seven-file UI/test scope. API schema, shared locale constants, legal fallback content, and broader public route locale drift remain owned by sibling Wave 0 plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing workspace dependencies for verification**
- **Found during:** Task 1 RED verification
- **Issue:** `pnpm --filter @grabit/web test -- ...` failed before executing tests because `vitest` was unavailable and `node_modules` was missing in the worktree.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the plan worktree. It restored ignored local dependencies without changing tracked package files.
- **Files modified:** None tracked
- **Verification:** RED tests then failed for the intended locale assertions; GREEN verification later passed.
- **Committed in:** Not applicable; environment setup only

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** Required to run the plan's verification commands. No product scope changed.

## Issues Encountered

- A relative patch attempt initially targeted the parent checkout because `apply_patch` does not inherit shell `workdir`. The affected parent test-file diff was inspected and reverted before implementation continued. Subsequent edits used worktree-contained absolute paths.
- The plan's test command executes the full web Vitest suite in this workspace shape, not only the two named files. The full suite still passed.

## Verification

- `pnpm --filter @grabit/web test -- components/admin/__tests__/translation-review.test.tsx components/admin/__tests__/consent-audit-table.test.tsx` - PASS, 56 files / 362 tests.
- `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" apps/web/hooks/use-admin.ts apps/web/app/admin/translations/page.tsx apps/web/components/admin/translation-source-form.tsx apps/web/components/admin/translation-review-table.tsx apps/web/components/admin/__tests__/translation-review.test.tsx apps/web/components/admin/consent-audit-table.tsx apps/web/components/admin/__tests__/consent-audit-table.test.tsx)` - PASS, no active Japanese locale tokens in owned files.

## Known Stubs

None. Stub scan only found existing form placeholder attributes and an empty default filter object; none are mock data or goal-blocking placeholders.

## Threat Flags

None. The plan changed UI locale types/options/copy only and introduced no new endpoint, auth path, file access, schema, or trust-boundary surface.

## TDD Gate Compliance

- RED commit present: `5850ced`
- GREEN commit present after RED: `540d81a`
- REFACTOR commit: not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 0 sibling plans can rely on the admin translation and consent UI no longer exposing Japanese as an active launch option. Broader shared/API/public locale reconciliation remains owned by the other Phase 25 Wave 0 plans.

## Self-Check: PASSED

- Found summary file: `.planning/phases/25-admin-operations-console/25-19-SUMMARY.md`
- Found RED commit: `5850ced`
- Found GREEN commit: `540d81a`

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
