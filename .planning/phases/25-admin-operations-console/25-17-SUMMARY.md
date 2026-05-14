---
phase: 25-admin-operations-console
plan: "17"
subsystem: i18n
tags: [nextjs, vitest, playwright, sitemap, phone-input, locale]

requires:
  - phase: 23-launch-foundation
    provides: "Five-locale routing and auth/phone i18n foundations"
  - phase: 25-admin-operations-console
    provides: "Wave 0 locale contract: ko/en/th/zh-CN/zh-TW"
provides:
  - "Auth phone verification and PhoneInput tests now cover zh-TW instead of ja"
  - "Sitemap hreflang generation and tests now expose zh-TW alternates and no active /ja launch route"
  - "i18n smoke expectations now target /zh-TW Traditional Chinese copy"
affects: [i18n, auth, sitemap, phone-input, phase-25-wave-0]

tech-stack:
  added: []
  patterns:
    - "Local five-locale launch lists in plan-owned web surfaces while shared locale constants are reconciled by adjacent Wave 0 plans"

key-files:
  created:
    - ".planning/phases/25-admin-operations-console/25-17-SUMMARY.md"
  modified:
    - "apps/web/components/ui/phone-input.tsx"
    - "apps/web/components/ui/__tests__/phone-input-i18n.test.tsx"
    - "apps/web/components/auth/phone-verification.tsx"
    - "apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx"
    - "apps/web/app/sitemap.ts"
    - "apps/web/app/__tests__/sitemap.test.ts"
    - "apps/web/e2e/i18n-smoke.spec.ts"

key-decisions:
  - "Keep Korean prefixless and foreign locales prefixed, replacing the Japanese launch route with zh-TW for this plan-owned surface."
  - "Use Traditional Chinese PhoneInput labels directly in the web component until shared locale constants are reconciled by adjacent Wave 0 plans."

patterns-established:
  - "TDD RED/GREEN split for locale drift: tests first, runtime/sitemap implementation second."

requirements-completed: [ADMIN-01, ADMIN-02]

duration: 8m33s
completed: 2026-05-14
---

# Phase 25 Plan 17: Auth/Phone/Sitemap Locale Drift Summary

**Auth phone input, sitemap hreflang, and i18n smoke coverage now target `zh-TW` instead of the stale Japanese launch locale.**

## Performance

- **Duration:** 8m33s
- **Started:** 2026-05-14T00:23:53Z
- **Completed:** 2026-05-14T00:32:26Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Replaced phone input, phone verification, sitemap, and i18n smoke expectations from `ja` to `zh-TW`.
- Added Traditional Chinese PhoneInput labels and active-locale wiring for phone verification.
- Updated sitemap hreflang generation so Korean stays prefixless and foreign routes include `/en`, `/th`, `/zh-CN`, and `/zh-TW`.
- Preserved the plan gate that rejects active `/ja` launch routes in owned files.

## Task Commits

1. **Task 1 RED:** `465cf5e` (test) - added failing `zh-TW` regression expectations.
2. **Task 1 GREEN:** `d58a6c0` (feat) - implemented `zh-TW` phone/auth/sitemap runtime behavior.

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `apps/web/components/ui/phone-input.tsx` - Adds `zh-TW` PhoneInput labels, copy, and default country mapping.
- `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx` - Expects Traditional Chinese selector copy.
- `apps/web/components/auth/phone-verification.tsx` - Lets active `zh-TW` locale pass through to PhoneInput.
- `apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx` - Covers active `zh-TW` locale wiring.
- `apps/web/app/sitemap.ts` - Emits `zh-TW` hreflang alternates and no `/ja` launch alternate.
- `apps/web/app/__tests__/sitemap.test.ts` - Locks sitemap expectations to the five launch locales.
- `apps/web/e2e/i18n-smoke.spec.ts` - Points the smoke matrix at `/zh-TW` Traditional Chinese visible copy.

## Decisions Made

- Kept this plan independent from parallel shared-locale work by using local five-locale launch lists in the plan-owned web surfaces.
- Updated phone verification source even though the plan file list only named its test; otherwise active `next-intl` `zh-TW` would still fall back to `ko`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing workspace dependencies for verification**
- **Found during:** Task 1 RED
- **Issue:** `pnpm --filter @grabit/web test ...` failed before test execution because `vitest` was unavailable and `node_modules` was missing.
- **Fix:** Ran `pnpm install --frozen-lockfile`.
- **Files modified:** None committed; generated dependencies are ignored.
- **Verification:** RED test command then executed and failed for the expected `zh-TW` drift.
- **Committed in:** Not applicable.

**2. [Rule 3 - Blocking] Built shared package before typecheck**
- **Found during:** Extra GREEN verification
- **Issue:** `pnpm --filter @grabit/web typecheck` could not resolve shared subpath declarations until `@grabit/shared` dist files existed.
- **Fix:** Ran `pnpm --filter @grabit/shared build`, then reran web typecheck.
- **Files modified:** None committed; build output is ignored.
- **Verification:** `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** Not applicable.

**3. [Rule 2 - Missing Critical] Added phone verification runtime locale resolver support**
- **Found during:** Task 1 RED
- **Issue:** The plan listed the phone verification test but not `phone-verification.tsx`; without updating the resolver, active `zh-TW` from `next-intl` fell back to `ko`.
- **Fix:** Added the same five-locale `zh-TW` contract to phone verification locale resolution.
- **Files modified:** `apps/web/components/auth/phone-verification.tsx`
- **Verification:** Phone verification i18n test passed in the final verification run.
- **Committed in:** `d58a6c0`

---

**Total deviations:** 3 auto-fixed (2 Rule 3, 1 Rule 2).  
**Impact on plan:** No scope creep beyond correctness requirements; all changes support the requested `zh-TW` locale drift removal.

## Issues Encountered

- Initial RED command surfaced missing dependencies rather than the expected test failure; dependencies were installed and RED was rerun.
- An initial patch attempt targeted the parent checkout. The four accidental file changes were reverted immediately before any commit; the parent checkout was left with only pre-existing untracked files unrelated to this plan.

## Verification

- `pnpm --filter @grabit/web test -- components/ui/__tests__/phone-input-i18n.test.tsx components/auth/__tests__/phone-verification-i18n.test.tsx app/__tests__/sitemap.test.ts` - PASS (Vitest ran 56 files / 361 tests)
- `! (rg -n "'ja'|\"ja\"|/ja|日本語|チケット予約" apps/web/components/ui/phone-input.tsx apps/web/components/ui/__tests__/phone-input-i18n.test.tsx apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx apps/web/app/sitemap.ts apps/web/app/__tests__/sitemap.test.ts apps/web/e2e/i18n-smoke.spec.ts)` - PASS
- `pnpm --filter @grabit/web typecheck` - PASS

## Known Stubs

None. Stub scan hits were legitimate test empty arrays, ref null resets, and input placeholders; no placeholder data source blocks this plan.

## Threat Flags

None. This plan only updates the sitemap/i18n route set already covered by `T-25-17-01`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Wave 0 merge. The orchestrator should own shared `STATE.md`, `ROADMAP.md`, and requirement tracking after merging worktrees.

## Self-Check: PASSED

- Created summary exists at `.planning/phases/25-admin-operations-console/25-17-SUMMARY.md`.
- Task commits exist: `465cf5e`, `d58a6c0`.
- Key modified files exist and final verification commands passed.

---
*Phase: 25-admin-operations-console*
*Completed: 2026-05-14*
