---
phase: 23-launch-foundation
plan: 15
subsystem: i18n
tags: [phone-input, sms-otp, auth, i18n, vitest]

requires:
  - phase: 23-launch-foundation
    provides: Shared five-locale constants from 23-01
  - phase: 23-launch-foundation
    provides: next-intl active locale context from 23-04
  - phase: 23-launch-foundation
    provides: auth/SMS launch copy scope from 23-06
provides:
  - Five-locale PhoneInput country labels for ko/en/th/zh-CN/zh-TW
  - Auth/SMS OTP PhoneVerification locale wiring into PhoneInput
  - Shared launch copy key manifest for auth/email/OTP/SMS namespaces
affects: [phase-23, web-auth, phone-input, shared-i18n, sms-otp]

tech-stack:
  added: []
  patterns:
    - PhoneInput locale labels are selected from shared launch locale constants
    - Auth PhoneVerification resolves next-intl locale with Korean fallback and test override
    - Shared i18n manifests are exported through the @grabit/shared barrel

key-files:
  created:
    - apps/web/components/ui/__tests__/phone-input-i18n.test.tsx
    - apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx
    - packages/shared/src/i18n/launch-copy-keys.ts
    - packages/shared/src/i18n/launch-copy-keys.test.ts
  modified:
    - apps/web/components/ui/phone-input.tsx
    - apps/web/components/auth/phone-verification.tsx
    - apps/web/components/auth/__tests__/phone-verification.test.tsx
    - packages/shared/src/index.ts
    - packages/shared/package.json

key-decisions:
  - "PhoneInput keeps unsupported countries searchable/selectable while localizing the country labels for the five launch locales."
  - "PhoneVerification reads the active next-intl locale and falls back to ko when the locale is unsupported."
  - "Auth/email/OTP/SMS launch copy keys are centralized in @grabit/shared for exact five-locale coverage."

patterns-established:
  - "Use optional locale props for auth component tests while production components resolve next-intl active locale."
  - "Use shared manifest tests to enforce exact launch locale and namespace coverage."

requirements-completed: [I18N-02]

duration: 7m59s
completed: 2026-05-06
---

# Phase 23 Plan 15: PhoneInput Localization and Launch Copy Manifest Summary

**PhoneInput now renders five launch-market country labels, auth/SMS OTP passes the active locale into it, and shared copy keys lock auth/email/OTP/SMS localization coverage.**

## Performance

- **Duration:** 7m59s
- **Started:** 2026-05-06T05:45:48Z
- **Completed:** 2026-05-06T05:53:47Z
- **Tasks:** 1 TDD task
- **Files modified:** 9

## Accomplishments

- Added `locale` support to `PhoneInput` for `ko`, `en`, `th`, `zh-CN`, and `zh-TW` while preserving Korean fallback behavior when omitted.
- Preserved the existing shadcn/Radix popover and country search/select behavior, including unsupported countries such as Iceland.
- Wired `PhoneVerification` to resolve the active next-intl locale and pass `locale={activeLocale}` into `PhoneInput`.
- Added shared `LAUNCH_COPY_LOCALES`, `LAUNCH_COPY_NAMESPACES`, and `LAUNCH_COPY_KEYS` for `auth.emailVerification`, `auth.otp`, `auth.errors`, and `sms.otp`.

## Task Commits

1. **Task 1 RED: launch phone i18n tests** - `bcb438e` (test)
2. **Task 1 GREEN: launch phone i18n contract** - `c192970` (feat)

## Files Created/Modified

- `apps/web/components/ui/phone-input.tsx` - Adds locale-aware labels/copy and keeps country selector behavior intact.
- `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx` - Covers five locale labels, unsupported country search/select, Thai trigger dimensions, and omitted-locale Korean fallback.
- `apps/web/components/auth/phone-verification.tsx` - Resolves active locale from next-intl with Korean fallback and passes it to `PhoneInput`.
- `apps/web/components/auth/__tests__/phone-verification-i18n.test.tsx` - Mocks `PhoneInput` and proves active locale propagation for all five launch locales.
- `apps/web/components/auth/__tests__/phone-verification.test.tsx` - Adds `next-intl` locale mock for existing component tests.
- `packages/shared/src/i18n/launch-copy-keys.ts` - Defines the shared launch copy locale/namespace/key manifest.
- `packages/shared/src/i18n/launch-copy-keys.test.ts` - Enforces exact locale and namespace coverage.
- `packages/shared/src/index.ts` - Exports the launch copy manifest through the shared package barrel.
- `packages/shared/package.json` - Adds the `test` script required by the plan verification command.

## Decisions Made

- Used `react-phone-number-input` locale files for ko/en/th/zh-CN and a small local Traditional Chinese label overlay for `zh-TW`, because the package does not ship a separate `zh-Hant` locale file.
- Kept the selector trigger icon-only, preserving existing dimensions and avoiding long localized label overflow in the compact control.
- Added a `locale` prop override to `PhoneVerification` for tests, while production resolution uses `next-intl` `useLocale()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] Aligned locale label expectations and jsdom harness**
- **Found during:** Task 1 GREEN verification
- **Issue:** The initial RED test over-specified Thai/Chinese accessible labels and jsdom lacked `ResizeObserver`/`scrollIntoView` for the actual Radix/cmdk popover path.
- **Fix:** Aligned expected labels to the locale source used by `PhoneInput` and added minimal test-only browser API shims.
- **Files modified:** `apps/web/components/ui/__tests__/phone-input-i18n.test.tsx`, `packages/shared/src/i18n/launch-copy-keys.test.ts`
- **Verification:** `pnpm --filter @grabit/web test -- phone-input-i18n.test.tsx phone-verification-i18n.test.tsx` passed.
- **Committed in:** `c192970`

**2. [Rule 3 - Blocking] Added shared package test script**
- **Found during:** Task 1 acceptance verification
- **Issue:** The plan verification command used `pnpm --filter @grabit/shared test`, but `@grabit/shared` did not expose a `test` script.
- **Fix:** Added `"test": "vitest run"` to `packages/shared/package.json`.
- **Files modified:** `packages/shared/package.json`
- **Verification:** `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts` passed.
- **Committed in:** `c192970`

---

**Total deviations:** 2 auto-fixed (Rule 1: 1, Rule 3: 1)  
**Impact on plan:** Both deviations were required to make the planned behavior verifiable. Product scope stayed within PhoneInput localization, auth/OTP wiring, and shared copy manifest coverage.

## Issues Encountered

- `@grabit/web` test script runs the full web Vitest suite even when file names are passed after `--`; the full suite passed with existing jsdom warning output from unrelated tests.
- `@grabit/web` lint completed with 0 errors and 23 pre-existing warnings outside this plan's changed behavior.

## Known Stubs

None. Stub scan found only intentional input placeholders, null timer cleanup, and test empty values.

## Threat Flags

None. The locale-to-label trust boundary and manifest tampering controls were already covered by the plan threat model; no network endpoint, auth path, file access pattern, or schema trust boundary was added.

## Verification

- `pnpm --filter @grabit/web test -- phone-input-i18n.test.tsx phone-verification-i18n.test.tsx` - PASS, 227 tests.
- `pnpm --filter @grabit/shared test -- launch-copy-keys.test.ts` - PASS, 26 tests.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/web lint` - PASS with 23 pre-existing warnings and 0 errors.
- `grep -R "locale.*PhoneInput\\|PhoneInput.*locale" apps/web/components/ui/phone-input.tsx apps/web/components/auth/phone-verification.tsx` - PASS.
- `grep -R "locale={activeLocale}" apps/web/components/auth/phone-verification.tsx` - PASS.
- `grep -R "zh-TW" packages/shared/src/i18n/launch-copy-keys.ts` - PASS.

## TDD Gate Compliance

- RED commit present: `bcb438e`
- GREEN commit present after RED: `c192970`
- Refactor commit: Not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for downstream Phase 23 locale-switch/auth copy work. Later web/API message implementations can import the shared launch copy manifest and rely on `PhoneInput` locale support without narrowing country selection.

## Self-Check: PASSED

- Verified summary, PhoneInput, PhoneVerification, launch copy manifest, and related test/export files exist on disk.
- Verified task commits `bcb438e` and `c192970` exist in git history.
- Verified no unexpected tracked file deletions were introduced by the GREEN commit.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
