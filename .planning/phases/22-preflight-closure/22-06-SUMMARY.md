---
phase: 22-preflight-closure
plan: "06"
subsystem: api
tags: [sms, validation, nestjs, uat-gap]
requires:
  - phase: 22-preflight-closure
    provides: Phase 22 production UAT gap report
provides:
  - Invalid SMS phone inputs now map to user-facing HTTP 400 before side effects
  - Regression tests for send-code and verify-code invalid phone handling
affects: [sms, auth, production-uat]
tech-stack:
  added: []
  patterns:
    - Service-layer normalization boundary around shared phone parsing
key-files:
  created:
    - .planning/phases/22-preflight-closure/22-06-PLAN.md
    - .planning/phases/22-preflight-closure/22-06-SUMMARY.md
  modified:
    - apps/api/src/modules/sms/sms.controller.ts
    - apps/api/src/modules/sms/sms.service.ts
    - apps/api/src/modules/sms/sms.service.spec.ts
    - .planning/phases/22-preflight-closure/22-UAT.md
key-decisions:
  - "Keep broad controller schema compatibility and normalize libphonenumber failures at the SMS service boundary."
  - "Do not claim production UAT pass until deployment and rerun; close the gap as locally fixed with production rerun pending."
patterns-established:
  - "parseE164OrBadRequest(): converts the public phone validation message to BadRequestException before provider/Valkey side effects."
requirements-completed: [PREF-01]
duration: 18min
completed: 2026-05-05
---

# Phase 22-06: SMS Invalid Phone Gap Closure Summary

**Invalid-but-regex-valid SMS phone input now fails as a user-facing validation error before Redis, OTP, cooldown, or Infobip work.**

## Performance

- **Duration:** 18min
- **Started:** 2026-05-05T18:33:12+09:00
- **Completed:** 2026-05-05T18:51:15+09:00
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added regression tests proving `+9991234567` is rejected as `BadRequestException` for both `sendVerificationCode()` and `verifyCode()`.
- Added a service-layer `parseE164OrBadRequest()` boundary so `parseE164()` validation failures no longer escape as HTTP 500.
- Updated the Phase 22 production UAT gap record as locally resolved, with production rerun still required after deploy.

## Task Commits

1. **Task 1: Add SMS invalid international phone regression tests** - `325bc89` (`test(22-06): cover invalid SMS phone normalization`)
2. **Task 2: Normalize phone parsing failures at the service boundary** - `70f5c58` (`fix(22-06): normalize invalid SMS phone errors`)
3. **Task 3: Close UAT gap and summarize execution** - committed with this summary

## Files Created/Modified

- `.planning/phases/22-preflight-closure/22-06-PLAN.md` - Gap closure execution plan.
- `.planning/phases/22-preflight-closure/22-06-SUMMARY.md` - Gap closure summary.
- `apps/api/src/modules/sms/sms.controller.ts` - Aligns the verify endpoint security comment with the current no-short-circuit service behavior.
- `apps/api/src/modules/sms/sms.service.ts` - Converts public phone parsing failures to `BadRequestException`.
- `apps/api/src/modules/sms/sms.service.spec.ts` - Covers invalid international phone handling before side effects.
- `.planning/phases/22-preflight-closure/22-UAT.md` - Marks the diagnosed SMS invalid-phone gap as locally resolved with deployment rerun pending.

## Decisions Made

Kept validation normalization in the service layer. The controller's broad E.164 regex remains compatible with existing international input behavior, while `SmsService` owns the final libphonenumber validity boundary before any side effect.

## Deviations from Plan

None - the documented UAT gap was closed directly.

## Issues Encountered

The first targeted command used the package script form and Vitest discovered the full API unit suite. That RED run still produced the expected two failures in `sms.service.spec.ts`, both caused by receiving plain `Error` instead of `BadRequestException`.

## Verification

- `pnpm --filter @grabit/api test -- src/modules/sms/sms.service.spec.ts` - RED confirmed: 2 expected failures before the fix.
- `pnpm --filter @grabit/api exec vitest run src/modules/sms/sms.service.spec.ts` - passed, 69/69.
- `pnpm --filter @grabit/api typecheck` - passed.

## User Setup Required

Production deployment and rerun of Phase 22 UAT test 9 are still required before changing the live production observation from issue to pass.

## Next Phase Readiness

Phase 23 can continue with the SMS invalid-phone code gap closed locally. The remaining operational step is deployment and production rerun of the affected SMS checks.

---
*Phase: 22-preflight-closure*
*Completed: 2026-05-05*
