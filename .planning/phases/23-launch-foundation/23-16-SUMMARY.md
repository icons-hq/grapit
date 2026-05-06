---
phase: 23-launch-foundation
plan: 16
subsystem: i18n
tags: [locale-switcher, locale-suggestion, preferred-locale, next-intl, nestjs]

requires:
  - phase: 23-launch-foundation
    provides: Shared locale constants and D-06 precedence from 23-01
  - phase: 23-launch-foundation
    provides: users.preferred_locale schema support from 23-02
  - phase: 23-launch-foundation
    provides: suggest-never-redirect locale routing from 23-04
provides:
  - Explicit locale switcher rendered in desktop GNB and mobile menu
  - Suggest-never-redirect locale suggestion rendered from the public layout shell
  - Logged-in preferredLocale validation, profile mapping, and persistence
affects: [phase-23, web-i18n, auth-profile, locale-routing]

tech-stack:
  added: []
  patterns:
    - Locale choice is explicit and uses router.push only after user action
    - Logged-in locale updates validate against shared supported locale constants
    - Anonymous locale choice writes cookie state without profile API persistence

key-files:
  created:
    - apps/web/components/i18n/locale-switcher.tsx
    - apps/web/components/i18n/locale-suggestion.tsx
    - apps/web/components/layout/__tests__/gnb-locale.test.tsx
    - apps/web/components/layout/__tests__/layout-shell-locale.test.tsx
    - apps/api/src/modules/user/user.controller.spec.ts
    - apps/api/src/modules/user/user.service.spec.ts
  modified:
    - apps/web/app/layout-shell.tsx
    - apps/web/components/layout/gnb.tsx
    - apps/web/components/layout/mobile-menu.tsx
    - packages/shared/src/schemas/user.schema.ts
    - packages/shared/src/types/user.types.ts
    - apps/api/src/modules/user/user.service.ts
    - apps/api/src/modules/user/user.repository.ts
    - apps/api/src/modules/auth/auth.service.ts

key-decisions:
  - "LocaleSuggestion keeps suggest-never-redirect semantics: it renders a prompt and only navigates after explicit user choice."
  - "LocaleSwitcher writes anonymous preference to a cookie, and persists to /users/me only when accessToken and user state are present."
  - "User preferredLocale validation reuses shared supported locale constants and preserves D-06 precedence documentation."

patterns-established:
  - "Visible shell locale tests assert GNB, mobile menu, and LayoutShell wiring instead of only component-level rendering."
  - "User profile DTO/service tests cover supported and unsupported preferredLocale inputs before repository writes."

requirements-completed:
  - I18N-01
  - I18N-02

duration: 8m16s
completed: 2026-05-06
---

# Phase 23 Plan 16: Locale Preference UI Summary

**Explicit locale choice and suggest-never-redirect prompts now appear in the real shell, with logged-in locale preference persisted through the user profile API.**

## Performance

- **Duration:** 8m16s
- **Started:** 2026-05-06T05:57:49Z
- **Completed:** 2026-05-06T06:06:05Z
- **Tasks:** 1
- **Files modified:** 14

## Accomplishments

- Added `LocaleSwitcher` with active locale `aria-current="true"` and explicit click navigation.
- Wired locale selection into desktop `GNB` and the mobile menu surface.
- Added `LocaleSuggestion` to `LayoutShell`, hidden under the existing admin and booking checkout shell rules.
- Added session dismissal for the suggestion prompt and no automatic redirect/navigation on display.
- Added `preferredLocale` to shared profile DTO/types and API service/repository persistence.
- Added RED/GREEN coverage for visible shell wiring, no auto-navigation, supported locale persistence, and unsupported locale rejection.

## Task Commits

1. **Task 1 RED: Add failing locale preference tests** - `9fad7d2` (test)
2. **Task 1 GREEN: Implement locale switch and profile preference** - `29e5dd9` (feat)

**Plan metadata:** pending final metadata commit

## Files Created/Modified

- `apps/web/components/i18n/locale-switcher.tsx` - Explicit locale menu, cookie persistence, logged-in profile persistence, and localized path construction.
- `apps/web/components/i18n/locale-suggestion.tsx` - Suggest-never-redirect prompt with session dismissal and explicit user-choice navigation.
- `apps/web/app/layout-shell.tsx` - Renders `LocaleSuggestion` only when the normal public shell is visible.
- `apps/web/components/layout/gnb.tsx` - Renders `LocaleSwitcher` near existing desktop auth/search controls.
- `apps/web/components/layout/mobile-menu.tsx` - Renders `LocaleSwitcher` as a mobile menu language row.
- `apps/web/components/layout/__tests__/gnb-locale.test.tsx` - Verifies desktop and mobile locale switcher shell rendering.
- `apps/web/components/layout/__tests__/layout-shell-locale.test.tsx` - Verifies suggestion shell placement, hidden paths, and no auto-navigation APIs.
- `packages/shared/src/schemas/user.schema.ts` - Adds supported `preferredLocale` validation to profile update DTOs.
- `packages/shared/src/types/user.types.ts` - Adds `preferredLocale` to `UserProfile`.
- `apps/api/src/modules/user/user.service.ts` - Validates, maps, and returns `preferredLocale`.
- `apps/api/src/modules/user/user.repository.ts` - Persists `preferredLocale` in profile updates.
- `apps/api/src/modules/user/user.controller.spec.ts` - Verifies DTO accept/reject behavior for supported locales.
- `apps/api/src/modules/user/user.service.spec.ts` - Verifies read/write/reject behavior for user preferred locale.
- `apps/api/src/modules/auth/auth.service.ts` - Includes `preferredLocale` in auth profile mapping so shared `UserProfile` remains complete.

## Decisions Made

- Kept suggestion behavior as a banner-style shell prompt instead of a toast so it can be tested through `LayoutShell` without introducing global side effects.
- Used direct locale constants for validation and profile typing; no new locale list was introduced.
- Kept route resolution and precedence ownership in existing i18n routing; this plan only documents and respects `url > explicit-switch > user-profile > cookie > ko`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Built shared declarations before API typecheck**
- **Found during:** Task 1 GREEN verification
- **Issue:** API typecheck resolves `@grabit/shared` through package `dist` declarations, so source-only shared type changes were not visible until the shared package was rebuilt locally.
- **Fix:** Ran `pnpm --filter @grabit/shared build` before rerunning API typecheck.
- **Files modified:** None committed; generated `dist` output remains ignored.
- **Verification:** `pnpm --filter @grabit/api typecheck` passed.
- **Committed in:** N/A

**2. [Rule 3 - Blocking] Fixed shared subpath imports for web typecheck**
- **Found during:** Task 1 GREEN verification
- **Issue:** Web typecheck could not resolve extensionless `@grabit/shared/constants/locales` and `@grabit/shared/types/i18n.types` subpath imports.
- **Fix:** Switched frontend locale components to the existing package-export pattern with `.js` subpath imports.
- **Files modified:** `apps/web/components/i18n/locale-switcher.tsx`, `apps/web/components/i18n/locale-suggestion.tsx`
- **Verification:** `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** `29e5dd9`

---

**Total deviations:** 2 auto-fixed (Rule 3: 2)  
**Impact on plan:** Both fixes were required for verification and did not add scope beyond the planned locale UI/profile persistence work.

## Issues Encountered

- The web and API `vitest run -- <files>` commands execute the full package test suites in this repo. The targeted files passed within those suites.

## Known Stubs

None. Stub scan only found existing input `placeholder` attributes and `passwordHash === null` comments, not UI/data stubs.

## Threat Flags

None - the new user profile locale write and locale preference behavior were covered by the plan threat model (`T-23-16-01`, `T-23-16-02`).

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/api test -- user.service.spec.ts user.controller.spec.ts` - PASS, 37 files / 461 tests.
- `pnpm --filter @grabit/web test -- gnb-locale.test.tsx layout-shell-locale.test.tsx` - PASS, 36 files / 233 tests.
- `pnpm --filter @grabit/api typecheck` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- Grep gates for `preferredLocale`, `aria-current`, Korean suggestion copy, shell wiring, D-06 precedence, and no banned auto-navigation APIs - PASS.

## TDD Gate Compliance

- RED commit exists: `9fad7d2`
- GREEN commit exists after RED: `29e5dd9`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for `23-17-PLAN.md` and downstream launch surfaces that need a visible explicit locale control or `users.preferred_locale` profile value.

## Self-Check: PASSED

- Created summary and locale implementation/test files exist.
- Task commits verified in git history: `9fad7d2`, `29e5dd9`.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
