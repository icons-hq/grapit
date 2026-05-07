---
phase: 23-launch-foundation
plan: 10
subsystem: auth
tags: [signup, consent, compliance, social-auth, zod, vitest]

requires:
  - phase: 23-launch-foundation
    provides: 23-07 server-side ConsentService capture and audit contract
  - phase: 23-launch-foundation
    provides: 23-09 auth UI copy and signup flow wiring
provides:
  - Itemized signup consent UI with required/optional rows
  - Signup submit payload carrying item/version/language/accepted/sourceFlow consent rows
  - Shared/API auth schemas enforcing required signup and social completion consent rows
  - Under-14 local signup block and no-LINE auth surface regression coverage
affects: [phase-23, auth, consent-audit, compliance, web-signup]

tech-stack:
  added: []
  patterns:
    - Auth consent rows are validated through shared zod schemas before API capture
    - Signup consent UI keeps legacy booleans plus itemized rows during transition

key-files:
  created:
    - apps/web/components/auth/__tests__/signup-consent.test.tsx
    - apps/web/components/auth/__tests__/signup-submit-consent.test.tsx
    - packages/shared/src/schemas/auth.schema.test.ts
    - apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts
  modified:
    - apps/web/components/auth/signup-step2.tsx
    - apps/web/components/auth/signup-form.tsx
    - packages/shared/src/schemas/auth.schema.ts
    - packages/shared/src/schemas/consent.schema.ts
    - apps/api/src/modules/auth/dto/register.dto.ts
    - apps/api/src/modules/auth/dto/social-register.dto.ts
    - apps/api/src/modules/auth/auth.service.ts
    - apps/api/src/modules/auth/auth.service.spec.ts

key-decisions:
  - "Signup Step 2 returns legacy consent booleans plus itemized consent rows so the current API transition stays backward-compatible while ConsentService receives immutable row evidence."
  - "Social completion consent uses sourceFlow=social_completion while normal email signup remains sourceFlow=signup."
  - "LINE remains absent from auth UI and tests assert Kakao, Naver, Google, and email only."

patterns-established:
  - "Use `signupConsentRowsSchema` and `socialCompletionConsentRowsSchema` for auth DTO consent validation."
  - "Consent UI rows expose key, version, language, required status, accepted/refused state, and sourceFlow."

requirements-completed:
  - AUTH-01
  - COMP-01

duration: 10 min
completed: 2026-05-06
---

# Phase 23 Plan 10: Signup Consent Contract Summary

**Signup now captures versioned itemized consent rows and submits them through shared/API contracts for immutable ConsentService evidence.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-06T07:22:14Z
- **Completed:** 2026-05-06T07:32:18Z
- **Tasks:** 1 TDD task
- **Files modified:** 12

## Accomplishments

- Replaced the boolean-only signup consent step with seven itemized rows: terms, privacy, PIPA required, cross-border transfer, PDPA notice, PIPL notice, and optional marketing.
- Fixed the `SignupStep2` `consentItems` typecheck blocker by returning structured consent rows from Step 2 and including them in `/api/v1/auth/register` payloads.
- Added shared/API zod validation so signup requires `sourceFlow=signup` rows and social completion requires `sourceFlow=social_completion` rows.
- Preserved no-LINE launch scope with auth UI tests for Kakao, Naver, Google, and email only.
- Added local under-14 blocking copy and submit guard without adding a guardian flow.

## Task Commits

1. **Task 1 RED: Signup consent contract tests** - `8dcff7b` (test)
2. **Task 1 GREEN: Itemized signup consent implementation** - `3c690c2` (feat)

## Files Created/Modified

- `apps/web/components/auth/signup-step2.tsx` - Itemized consent rows, legal dialog actions, cross-border refusal warning, under-14 block copy, and structured row output.
- `apps/web/components/auth/signup-form.tsx` - Sends `consentItems` rows in register payload and blocks under-14 signup locally.
- `apps/web/components/auth/__tests__/signup-consent.test.tsx` - Consent row, legal dialog, refusal, under-14, and no-LINE UI coverage.
- `apps/web/components/auth/__tests__/signup-submit-consent.test.tsx` - Register payload and under-14 submit guard coverage.
- `packages/shared/src/schemas/auth.schema.ts` - Signup/social completion consent row schemas and required-row enforcement.
- `packages/shared/src/schemas/auth.schema.test.ts` - Shared parse assertions for required consent rows and optional marketing refusal.
- `packages/shared/src/schemas/consent.schema.ts` - Adds `social_completion` as a valid consent source flow.
- `apps/api/src/modules/auth/dto/register.dto.ts` - Uses signup consent row schema.
- `apps/api/src/modules/auth/dto/social-register.dto.ts` - Uses social completion consent row schema.
- `apps/api/src/modules/auth/dto/auth-consent.dto.spec.ts` - API DTO parse coverage for signup/social completion consent contracts.
- `apps/api/src/modules/auth/auth.service.ts` - Captures social completion consent with `sourceFlow=social_completion`.
- `apps/api/src/modules/auth/auth.service.spec.ts` - Service regression coverage for social completion consent capture.

## Decisions Made

- Kept legacy `termsOfService`, `privacyPolicy`, and `marketingConsent` booleans in auth payloads while adding `consentItems`, because the current API still persists `terms_agreements` during the transition.
- Used static version `2026-04-28` and language `ko` for the current signup legal markdown surface.
- Used the existing legal markdown dialog contract for all itemized rows; PIPA/cross-border/PDPA/PIPL rows currently open the privacy legal content with row-specific dialog titles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Typecheck Bug] Tightened consent row literal typing after schema expansion**
- **Found during:** Task 1 GREEN verification
- **Issue:** The new schema correctly required literal locale/sourceFlow/key values, but the UI/test row construction widened them to `string`, causing `pnpm --filter @grabit/web typecheck` to fail.
- **Fix:** Added literal typing for `CONSENT_LANGUAGE` and test consent row fixtures.
- **Files modified:** `apps/web/components/auth/signup-step2.tsx`, `apps/web/components/auth/__tests__/signup-submit-consent.test.tsx`
- **Verification:** `pnpm --filter @grabit/web typecheck` passed.
- **Committed in:** `3c690c2`

---

**Total deviations:** 1 auto-fixed (Rule 1: 1)  
**Impact on plan:** The fix was required for the planned typed consent contract and did not expand scope.

## Issues Encountered

- `@grabit/web` test script still runs the full Vitest suite even when filenames are passed after `--`; the full suite passed with existing jsdom warning output.
- Existing jsdom warnings for `window.scrollTo`, navigation, and React `act(...)` remain unrelated pre-existing test-environment warnings.

## Known Stubs

None. Stub scan found only existing null/override handling and passwordHash null comments in auth tests/service; no placeholder data blocks this plan.

## Threat Flags

None. The modified auth/consent surfaces are covered by the plan threat model: consent evidence mapping, no-LINE provider UI, and under-14/cross-border gating.

## Verification

- `pnpm --filter @grabit/web test -- signup-consent.test.tsx signup-submit-consent.test.tsx` - PASS, 41 files / 280 tests due existing web script behavior.
- `pnpm --filter @grabit/shared test -- auth.schema.test.ts` - PASS, 4 files / 28 tests due shared script behavior.
- `pnpm --filter @grabit/api test -- auth-consent.dto.spec.ts auth.service.spec.ts` - PASS, 40 files / 476 tests due API script behavior.
- `pnpm --filter @grabit/shared typecheck` - PASS.
- `pnpm --filter @grabit/shared build` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.
- `pnpm --filter @grabit/api typecheck` - PASS.
- Consent/no-LINE grep gate from plan - PASS.

## TDD Gate Compliance

- RED commit present: `8dcff7b`
- GREEN commit present after RED: `3c690c2`
- Refactor commit: Not needed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Plan 23-11. Downstream auth/social completion work should use the shared consent row schemas and preserve D-13 LINE exclusion.

## Self-Check: PASSED

- Verified the SUMMARY and key modified source files exist on disk.
- Verified task commits `8dcff7b` and `3c690c2` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
