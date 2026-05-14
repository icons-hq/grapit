---
phase: 25-admin-operations-console
plan: "16"
subsystem: web-i18n
tags: [nextjs, i18n, routing, runtime-flags, toss-payments, vitest]

requires:
  - phase: 23-launch-foundation
    provides: five-locale public routing, runtime booking-disabled UI, and translation-label foundations
provides:
  - Public routing and Accept-Language normalization for zh-TW
  - Public formatting, booking-disabled copy, locale suggestion, translation label, and Toss widget locale handling without active Japanese route/copy
affects: [phase-25-admin-operations-console, phase-26-canary, public-i18n]

tech-stack:
  added: []
  patterns:
    - Public web locale drift can be corrected locally while shared locale constants are reconciled by sibling Wave 0 plans.

key-files:
  created:
    - .planning/phases/25-admin-operations-console/25-16-SUMMARY.md
  modified:
    - apps/web/i18n/routing.ts
    - apps/web/i18n/routing.test.ts
    - apps/web/lib/i18n/format.ts
    - apps/web/lib/i18n/format.test.ts
    - apps/web/lib/runtime-flags.ts
    - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
    - apps/web/components/i18n/locale-suggestion.tsx
    - apps/web/components/i18n/automatic-translation-label.tsx
    - apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx
    - apps/web/components/booking/toss-payment-widget.tsx

key-decisions:
  - "Keep zh-CN as Simplified Chinese and route Traditional Chinese signals to zh-TW."
  - "Do not add a sixth public locale; active Japanese public route/copy was removed from this plan's owned files."

patterns-established:
  - "Public i18n surfaces use local five-locale guards in owned web files until shared locale constants merge from sibling Wave 0 plans."

requirements-completed: [ADMIN-01, ADMIN-02]

duration: 11 min
completed: 2026-05-14
---

# Phase 25 Plan 16: Public Locale Drift Summary

**Public routing, formatting, runtime booking-disabled, i18n labels, and Toss widget locale behavior now use zh-TW instead of Japanese launch surfaces.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-14T00:23:43Z
- **Completed:** 2026-05-14T00:34:28Z
- **Tasks:** 1
- **Files modified:** 10

## Accomplishments

- Public route normalization now recognizes `/zh-TW/*` and maps Traditional Chinese Accept-Language tags to `zh-TW`.
- KST/KRW formatting helpers, booking-disabled runtime copy, locale suggestion UI, and automatic translation labels include `zh-TW` and remove active Japanese copy from owned files.
- Toss payment widget locale-to-country mapping now uses `TW` for `zh-TW` and falls back safely for unsupported locales.

## Task Commits

1. **Task 1 RED:** `2b9a182` (`test`) - failing tests for `zh-TW` routing, formatting, booking-disabled copy, and translation labels.
2. **Task 1 GREEN:** `6937f97` (`feat`) - implementation and adjusted tests for public `zh-TW` locale drift removal.

**Plan metadata:** committed separately in the docs commit for this summary.

## Files Created/Modified

- `apps/web/i18n/routing.ts` - Public locale list, pathname resolution, and Accept-Language normalization now use `zh-TW`.
- `apps/web/i18n/routing.test.ts` - Locks `zh-TW` route prefix and Traditional Chinese suggestion behavior.
- `apps/web/lib/i18n/format.ts` - Adds `TWD` estimate support and normalizes unsupported locale input to Korean.
- `apps/web/lib/i18n/format.test.ts` - Covers `zh-TW` local time behavior.
- `apps/web/lib/runtime-flags.ts` - Replaces Japanese booking-disabled copy with Traditional Chinese copy.
- `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx` - Locks runtime disabled copy for `zh-TW`.
- `apps/web/components/i18n/locale-suggestion.tsx` - Suggestion copy and visible locale label now include `zh-TW`.
- `apps/web/components/i18n/automatic-translation-label.tsx` - Translation label fallback map includes `zh-TW`.
- `apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx` - Covers `zh-TW` fallback label rendering.
- `apps/web/components/booking/toss-payment-widget.tsx` - Maps `zh-TW` to Toss foreign easy-pay country `TW`.

## Decisions Made

- `zh-CN` remains Simplified Chinese; `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant*` signals resolve to Traditional Chinese.
- Shared locale constants were not edited in this plan because that ownership belongs to sibling Wave 0 locale plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed workspace dependencies in the worktree**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/web test ...` initially failed because this worktree had no `node_modules` and `vitest` was unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile`; no lockfile or tracked dependency files changed.
- **Files modified:** None
- **Verification:** RED tests then executed and failed on the intended `zh-TW` expectations.
- **Committed in:** Not applicable; install output is ignored runtime state.

**2. [Rule 1 - Bug] Preserved locale suggestion source-contract test compatibility**
- **Found during:** Task 1 GREEN verification
- **Issue:** The exact plan command runs the full web Vitest suite in this repo, and an existing `layout-shell-locale` source-contract test expected the `LocaleSuggestion` state type name to remain `SupportedLocale`.
- **Fix:** Kept the new public locale type but aliased it locally as `SupportedLocale` in `locale-suggestion.tsx`.
- **Files modified:** `apps/web/components/i18n/locale-suggestion.tsx`
- **Verification:** Exact plan test command passed after the adjustment.
- **Committed in:** `6937f97`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 3: 1)
**Impact on plan:** No scope expansion to shared tracking files or sibling locale ownership. All fixes were needed to complete and verify this plan.

## Issues Encountered

- Extra non-plan `pnpm --filter @grabit/web typecheck` still fails on pre-existing `components/i18n/locale-switcher.tsx` `.js` import type resolution and an implicit `locale` parameter. The plan-required test and grep verification passed.
- The full web test run emits existing jsdom/React warnings (`window.scrollTo`, navigation, act wrapping, key warning), but all tests passed.

## Verification

- `pnpm --filter @grabit/web test -- i18n/routing.test.ts lib/i18n/format.test.ts hooks/__tests__/booking-disabled-runtime.test.tsx components/i18n/__tests__/automatic-translation-label.test.tsx` — PASS (`56` files, `361` tests; the repo script executed the full web suite).
- `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" apps/web/i18n/routing.ts apps/web/i18n/routing.test.ts apps/web/lib/i18n/format.ts apps/web/lib/i18n/format.test.ts apps/web/lib/runtime-flags.ts apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx apps/web/components/i18n/locale-suggestion.tsx apps/web/components/i18n/automatic-translation-label.tsx apps/web/components/i18n/__tests__/automatic-translation-label.test.tsx apps/web/components/booking/toss-payment-widget.tsx)` — PASS.

## Known Stubs

None.

## Threat Flags

None. This plan changed browser-visible locale routing/copy/format behavior and did not add network endpoints, auth paths, file access, or schema trust-boundary changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for sibling Wave 0 locale reconciliation plans and later Phase 25 admin operations work. Shared locale constants and message bundles are intentionally handled outside this plan.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/25-admin-operations-console/25-16-SUMMARY.md`.
- Key modified files exist in the worktree.
- Task commits `2b9a182` and `6937f97` are present in git history.
- `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` were not modified.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
