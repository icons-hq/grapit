---
phase: 23-launch-foundation
plan: 08
subsystem: ui
tags: [feature-flags, booking-disabled, i18n, react-query, payments]

requires:
  - phase: 23-launch-foundation
    provides: Shared BOOKING_ENABLED parser and locale constants from 23-01
  - phase: 23-launch-foundation
    provides: API booking-disabled hard gate from 23-03
  - phase: 23-launch-foundation
    provides: Performance detail locale wiring from 23-14
provides:
  - Web runtime booking flag route and client hook
  - Five-locale booking-disabled public copy
  - Disabled booking UI guards before seat lock, reservation prepare, and Toss requestPayment
  - Regression tests for disabled booking UI side-effect prevention
affects: [booking-disabled, public-performance-detail, booking-flow, payments]

tech-stack:
  added: []
  patterns:
    - Web runtime flags are fetched from a Next route backed by shared readFeatureFlags
    - Booking-disabled UI uses localized copy and blocks client handlers before mutation calls

key-files:
  created:
    - apps/web/app/api/runtime-flags/route.ts
    - apps/web/lib/runtime-flags.ts
    - apps/web/hooks/use-runtime-flags.ts
    - apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx
    - .planning/phases/23-launch-foundation/deferred-items.md
  modified:
    - apps/web/hooks/use-booking.ts
    - apps/web/hooks/__tests__/use-booking.test.tsx
    - apps/web/components/booking/booking-page.tsx
    - apps/web/components/booking/seat-selection-panel.tsx
    - apps/web/components/booking/seat-selection-sheet.tsx
    - apps/web/app/booking/[performanceId]/confirm/page.tsx
    - apps/web/app/performance/[id]/page.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx

key-decisions:
  - "Web reads BOOKING_ENABLED through /api/runtime-flags at runtime, not NEXT_PUBLIC_BOOKING_ENABLED."
  - "Disabled UI guards exist both in the visible booking/confirm surfaces and in useLockSeat/usePrepareReservation mutation hooks."
  - "The public performance detail CTA is replaced with localized opening copy while booking is disabled."

patterns-established:
  - "Runtime launch flags use shared flag names and false-safe client defaults."
  - "Booking-disabled client handlers return before scarce-resource or payment side effects."

requirements-completed:
  - FLAG-02
  - I18N-02

duration: 9m09s
completed: 2026-05-06
---

# Phase 23 Plan 08: Runtime Booking-Disabled UI Summary

**Runtime `BOOKING_ENABLED=false` now shows localized opening copy and blocks web seat lock, reservation prepare, and Toss payment request UI paths before side effects.**

## Performance

- **Duration:** 9m09s
- **Started:** 2026-05-06T06:38:51Z
- **Completed:** 2026-05-06T06:48:00Z
- **Tasks:** 1
- **Files modified:** 13

## Accomplishments

- Added `/api/runtime-flags` so web reads `BOOKING_ENABLED` at request/runtime through the shared flag parser.
- Added `useRuntimeFlags()` and exact disabled booking copy for `ko`, `en`, `th`, `zh-CN`, and `zh-TW`.
- Wired disabled public detail CTA replacement and booking page disabled status copy.
- Guarded seat click lock calls, confirm-page reservation prepare, and Toss `requestPayment` initiation while booking is disabled.
- Added regression tests proving disabled UI does not call lock, prepare, or payment request handlers.

## Task Commits

1. **Task 1 RED: Booking-disabled runtime UI tests** - `7590c9c` (test)
2. **Task 1 GREEN: Runtime booking-disabled UI guards** - `5c73c80` (feat)

## Files Created/Modified

- `apps/web/app/api/runtime-flags/route.ts` - Runtime Next route exposing shared web flags.
- `apps/web/lib/runtime-flags.ts` - Runtime flag fetcher, disabled copy map, and booking-disabled error.
- `apps/web/hooks/use-runtime-flags.ts` - React Query hook with false-safe initial runtime flag state.
- `apps/web/hooks/use-booking.ts` - Blocks lock and prepare mutations before API calls when booking is disabled.
- `apps/web/hooks/__tests__/booking-disabled-runtime.test.tsx` - UI regression tests for five-locale copy and disabled side-effect prevention.
- `apps/web/hooks/__tests__/use-booking.test.tsx` - Mutation-level disabled guard coverage.
- `apps/web/components/booking/booking-page.tsx` - Shows disabled status and prevents disabled seat lock/proceed handlers.
- `apps/web/components/booking/seat-selection-panel.tsx` - Displays disabled reason in desktop booking summary CTA.
- `apps/web/components/booking/seat-selection-sheet.tsx` - Displays disabled reason in mobile booking CTA.
- `apps/web/app/booking/[performanceId]/confirm/page.tsx` - Disables payment CTA before prepare/requestPayment.
- `apps/web/app/performance/[id]/page.tsx` - Replaces desktop/mobile booking CTA with localized opening copy.
- `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx` - Keeps existing page formatting test isolated from runtime flag hook.
- `.planning/phases/23-launch-foundation/deferred-items.md` - Records pre-existing typecheck blocker outside 23-08 scope.

## Decisions Made

- Used a local Next runtime route instead of any `NEXT_PUBLIC_*` booking flag so Cloud Run runtime env changes can affect the web surface without a rebuild.
- Kept the client default as `bookingEnabled: false` so runtime flag fetch failures fail closed for scarce booking/payment actions.
- Kept hook-level mutation guards in addition to component event guards because UI wiring can drift over time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a concrete runtime flag route**
- **Found during:** Task 1 GREEN implementation
- **Issue:** The plan asked for runtime API/SSR exposure but listed only client library/hook artifacts. Without a web runtime endpoint, the hook would have no runtime source and would risk falling back to build-time/public env behavior.
- **Fix:** Added `apps/web/app/api/runtime-flags/route.ts` backed by `readRuntimeFlagsFromEnv(process.env)` and shared `FLAG_NAMES.BOOKING_ENABLED`.
- **Files modified:** `apps/web/app/api/runtime-flags/route.ts`, `apps/web/lib/runtime-flags.ts`, `apps/web/hooks/use-runtime-flags.ts`
- **Verification:** `grep -R "NEXT_PUBLIC_BOOKING_ENABLED" apps/web` returned no matches; disabled runtime UI tests passed.
- **Committed in:** `5c73c80`

---

**Total deviations:** 1 auto-fixed (Rule 2: 1)  
**Impact on plan:** The deviation completed the intended runtime flag contract and avoided build-time flag freezing.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` is blocked by a pre-existing `apps/web/components/auth/signup-step2.tsx:66` consent payload type mismatch. The affected lines are from `8213dfbb` and were not touched by 23-08. This is recorded in `deferred-items.md` per scope boundary.

## Known Stubs

None. Stub scan found only nullable optional defaults used for UI disabled reason and touch tracking state.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: public-runtime-flags | `apps/web/app/api/runtime-flags/route.ts` | New public web route exposes only boolean launch-safe runtime flags and does not expose raw env values. |

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web test -- booking-disabled-runtime.test.tsx` - PASS, 254 tests.
- `pnpm --filter @grabit/web test -- booking-disabled-runtime.test.tsx use-booking.test.tsx performance-detail-formatting.test.tsx` - PASS, 254 tests.
- `grep -R "NEXT_PUBLIC_BOOKING_ENABLED" apps/web` - PASS, no matches.
- `grep -R "requestPayment" apps/web/hooks/__tests__ apps/web/components/booking` - PASS, confirms regression test and Toss widget references are present.
- Five-locale disabled copy grep across touched web runtime/UI files - PASS.
- `pnpm --filter @grabit/web typecheck` - FAIL, blocked by pre-existing `signup-step2.tsx` consent payload type mismatch documented above.

## TDD Gate Compliance

- RED commit exists: `7590c9c`
- GREEN commit exists after RED: `5c73c80`
- Refactor commit: Not needed

## Next Phase Readiness

Runtime booking-disabled UI is ready for downstream launch surfaces. Full web typecheck remains blocked by the unrelated signup consent payload mismatch and should be resolved in the owning consent/auth scope before treating web typecheck as green.

## Self-Check: PASSED

- Summary and key runtime booking-disabled files exist on disk.
- Task commits `7590c9c` and `5c73c80` exist in git history.
- No unexpected tracked file deletions were found in task commits.
- Verification caveat is explicitly recorded: web typecheck remains blocked by the pre-existing signup consent payload issue.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
