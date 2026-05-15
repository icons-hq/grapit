---
phase: 25-admin-operations-console
plan: "01"
subsystem: i18n
tags: [locale, zh-TW, visible-copy, launch-copy, vitest]

requires:
  - phase: 23-launch-foundation
    provides: five-locale routing and launch visible-copy foundation
  - phase: 25-admin-operations-console
    provides: UI-SPEC launch locale correction from ja drift to zh-TW
provides:
  - Canonical shared launch locale set: ko, en, th, zh-CN, zh-TW
  - Traditional Chinese visible-copy message bundle for auth and public copy loaders
  - Regression tests for shared locale keys, auth email copy, and status badge zh-TW labels
affects: [25-16, 25-17, 25-18, 25-19, 25-20, admin multilingual content]

tech-stack:
  added: []
  patterns:
    - Shared locale constants drive visible-copy bundle imports.
    - Launch copy manifests stay exact-key locked by locale and namespace tests.

key-files:
  created:
    - apps/web/messages/zh-TW.json
  modified:
    - packages/shared/src/constants/locales.ts
    - packages/shared/src/constants/locales.test.ts
    - packages/shared/src/i18n/launch-copy-keys.ts
    - packages/shared/src/i18n/launch-copy-keys.test.ts
    - apps/web/lib/i18n/visible-copy.ts
    - apps/web/components/auth/auth-launch-copy.ts
    - apps/web/components/auth/__tests__/auth-email-verification.test.tsx
    - apps/web/components/performance/status-badge.tsx
    - apps/web/components/performance/__tests__/status-badge.test.tsx
    - .planning/phases/25-admin-operations-console/deferred-items.md
  deleted:
    - apps/web/messages/ja.json

key-decisions:
  - "Phase 25 launch visible copy uses zh-TW, not ja, as the Traditional Chinese locale."
  - "apps/web/messages/ja.json was removed after 25-01-owned imports moved to zh-TW."

patterns-established:
  - "Locale drift checks use exact locale arrays plus grep for active Japanese launch copy in owned files."
  - "Traditional Chinese message copy is loaded through the same static bundle map as ko/en/th/zh-CN."

requirements-completed: [ADMIN-01, ADMIN-02]

duration: 10m
completed: 2026-05-14
---

# Phase 25 Plan 01: Shared Launch Locale Summary

**Shared locale constants and visible-copy bundles now use `zh-TW` as the fifth launch locale, with Japanese launch copy removed from this plan's owned message surface.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-14T00:23:34Z
- **Completed:** 2026-05-14T00:33:35Z
- **Tasks:** 1
- **Files modified:** 12

## Accomplishments

- Replaced the shared launch locale contract from `ko/en/th/zh-CN/ja` to `ko/en/th/zh-CN/zh-TW`.
- Added `apps/web/messages/zh-TW.json` and rewired visible-copy/auth bundle resolution to it.
- Removed `apps/web/messages/ja.json` from the active launch message bundle surface.
- Added TDD coverage for shared locale keys, auth email visible copy, and `StatusBadge` Traditional Chinese labels.

## Task Commits

1. **Task 1 RED: zh-TW locale contract tests** - `f8e56fb` (`test`)
2. **Task 1 GREEN: zh-TW launch visible-copy implementation** - `46ae9fa` (`feat`)

_Note: This was a TDD task, so the task produced separate RED and GREEN commits._

## Files Created/Modified

- `packages/shared/src/constants/locales.ts` - Canonical launch locale set and prefixes now include `zh-TW`.
- `packages/shared/src/constants/locales.test.ts` - Exact shared locale/prefix/runtime checks now lock `zh-TW`.
- `packages/shared/src/i18n/launch-copy-keys.ts` - Launch copy manifest locales now include `zh-TW`.
- `packages/shared/src/i18n/launch-copy-keys.test.ts` - Namespace/key coverage now runs against `zh-TW`.
- `apps/web/messages/zh-TW.json` - Traditional Chinese visible-copy bundle generated from the launch message shape.
- `apps/web/messages/ja.json` - Deleted intentionally; no 25-01-owned import remains.
- `apps/web/lib/i18n/visible-copy.ts` - Static visible-copy loader now maps `zh-TW`.
- `apps/web/components/auth/auth-launch-copy.ts` - Auth visible-copy loader now maps `zh-TW`.
- `apps/web/components/auth/__tests__/auth-email-verification.test.tsx` - Auth launch-copy test covers `zh-TW`.
- `apps/web/components/performance/status-badge.tsx` - Status labels now include Traditional Chinese copy.
- `apps/web/components/performance/__tests__/status-badge.test.tsx` - Added `zh-TW` status label regression coverage.
- `.planning/phases/25-admin-operations-console/deferred-items.md` - Records out-of-scope split-plan verification failures surfaced by the web test script.

## Decisions Made

- `zh-TW` is the only Traditional Chinese launch locale in shared constants and owned visible-copy message loading.
- The Japanese message bundle was removed in this plan because the plan-owned imports were fully migrated to `zh-TW`.

## Verification

- **RED:** `pnpm --filter @grabit/shared test -- src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts` failed as expected before implementation, proving the shared locale contract still exposed `ja`.
- **PASS:** `pnpm --filter @grabit/shared exec vitest run src/constants/locales.test.ts src/i18n/launch-copy-keys.test.ts` - 2 files / 9 tests passed.
- **PASS:** `pnpm --filter @grabit/web exec vitest run components/auth/__tests__/auth-email-verification.test.tsx components/performance/__tests__/status-badge.test.tsx` - 2 files / 15 tests passed.
- **PASS:** `pnpm --filter @grabit/web test components/auth/__tests__/auth-email-verification.test.tsx` - 1 file / 9 tests passed.
- **PASS:** `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" ...owned files... apps/web/messages --glob 'zh-TW.json' --glob 'ja.json')`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies for the isolated worktree**
- **Found during:** Task 1 RED verification
- **Issue:** `vitest: command not found` because the fresh worktree had no `node_modules`.
- **Fix:** Ran `pnpm install --frozen-lockfile` in the worktree.
- **Files modified:** None tracked.
- **Verification:** Vitest commands ran after dependency installation.
- **Committed in:** Not committed; install output is ignored runtime state.

**2. [Rule 2 - Missing Critical] Added `StatusBadge` zh-TW regression coverage**
- **Found during:** Task 1 test design
- **Issue:** The plan behavior required performance status visible copy to resolve Traditional Chinese, but the plan's file list omitted the existing `StatusBadge` test file.
- **Fix:** Added a focused `zh-TW` label/aria regression in `apps/web/components/performance/__tests__/status-badge.test.tsx`.
- **Files modified:** `apps/web/components/performance/__tests__/status-badge.test.tsx`
- **Verification:** `pnpm --filter @grabit/web exec vitest run components/performance/__tests__/status-badge.test.tsx` passed as part of the targeted web verification.
- **Committed in:** `f8e56fb`

---

**Total deviations:** 2 auto-handled (1 Rule 3, 1 Rule 2)  
**Impact on plan:** Both were required to complete the plan safely. No product scope was expanded beyond the launch locale contract.

## Issues Encountered

- The exact web verification command from the plan, `pnpm --filter @grabit/web test -- components/auth/__tests__/auth-email-verification.test.tsx`, passes the extra `--` through to Vitest and runs the full web suite. After 25-01 changed the shared locale set, that full suite exposed stale `ja` failures in files owned by split plans `25-16` and `25-17`. Those files were not modified here; the observation is recorded in `deferred-items.md`.
- During editing, the first patch target was corrected after noticing `apply_patch` defaults to the parent checkout. The unintended parent diffs in the four test files were reverted immediately, and a parent diff check for those files passed before continuing in the worktree.

## Known Stubs

None.

## Threat Flags

None - this plan only changes static locale constants and public visible-copy bundle wiring covered by `T-25-01-01`.

## User Setup Required

None.

## Next Phase Readiness

The shared/message-bundle side of the Phase 25 locale drift is ready for downstream Wave 0 locale plans. Split plans `25-16` through `25-20` still need to remove active `ja` drift from their owned routing, auth-phone, sitemap, API, consent, translation, admin, and legal surfaces before full-suite web verification can pass.

## Self-Check: PASSED

- Found `apps/web/messages/zh-TW.json`.
- Confirmed `apps/web/messages/ja.json` is absent as intended.
- Found task commits `f8e56fb` and `46ae9fa` in git history.
- Found `25-01-SUMMARY.md` and `deferred-items.md`.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
