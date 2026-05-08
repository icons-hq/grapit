---
phase: 24-traffic-booking-payment-core
plan: "08"
subsystem: ui
tags: [queue, booking, i18n, socket.io, playwright, react-query]
requires:
  - phase: 24-traffic-booking-payment-core
    provides: Queue session HTTP/socket contract and cookie-only admission runtime from 24-04
  - phase: 24-traffic-booking-payment-core
    provides: Traffic retry/challenge/block decision codes from 24-05
  - phase: 23-launch-foundation
    provides: Runtime BOOKING_ENABLED gate and locale routing foundations from 23-08 and 23-19
provides:
  - Route-level queue gate before the booking UI
  - Queue waiting surface with waiting/admitted/expired/retry/challenge/blocked states
  - Five-locale queue copy for booking entry states
  - Browser queue coverage for waiting and traffic-defense distinctions
affects: [24-09, booking, queue, i18n, browser-verification]
tech-stack:
  added: []
  patterns:
    - Resolve runtime flags before deciding whether `/booking` should show the disabled fallback or queue entry gate
    - Use queue snapshot polling plus `/queue` socket events to drive a route-level waiting surface
    - Source user-facing queue copy from `messages/*.json` with a Korean fallback constant kept in the component
key-files:
  created:
    - apps/web/hooks/use-queue.ts
    - apps/web/components/booking/queue-waiting.tsx
    - apps/web/e2e/booking-queue.spec.ts
    - .planning/phases/24-traffic-booking-payment-core/24-08-SUMMARY.md
  modified:
    - apps/web/app/booking/[performanceId]/page.tsx
    - apps/web/hooks/__tests__/use-queue.test.tsx
    - apps/web/messages/ko.json
    - apps/web/messages/en.json
    - apps/web/messages/th.json
    - apps/web/messages/zh-CN.json
    - apps/web/messages/zh-TW.json
key-decisions:
  - "Queue gating stays in `app/booking/[performanceId]/page.tsx` so `BookingPage` remains unchanged until admission is ready."
  - "Queue failure states map from backend message contracts (`TRAFFIC_RATE_LIMITED`, `SECURITY_CHALLENGE_REQUIRED`, `SECURITY_BLOCKED`) instead of showing raw provider text."
  - "Browser queue verification stays on the prefixless booking route; five-locale coverage is enforced through message bundles and grep because the local Playwright command can reuse an unrelated port-3000 server."
patterns-established:
  - "Route wrappers can fail closed on unresolved runtime flags and show a dedicated surface before expensive booking queries mount."
  - "Queue UX renders only safe queue metadata (position, ETA, remaining seats) and never exposes raw admission tokens."
  - "Queue E2E can neutralize auth refresh and intercept queue endpoints without depending on the API dev server."
requirements-completed:
  - TRAF-01
  - TRAF-02
duration: 24m 29s
completed: 2026-05-08
---

# Phase 24 Plan 08: Queue-Aware Booking Route Summary

**`/booking` now waits behind a transparent queue surface with five-locale retry/challenge/block copy before the seat-selection UI mounts.**

## Performance

- **Duration:** 24m 29s
- **Started:** 2026-05-08T16:20:17+09:00
- **Completed:** 2026-05-08T16:44:46+09:00
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `useQueue()` to enter the queue, read `GET /api/v1/queue/sessions/:queueSessionId`, and react to `queue:position`, `queue:admitted`, and `queue:expired`.
- Wrapped the booking route so queue waiting/admitted/expired/retry/challenge/blocked states render before `BookingPage`.
- Added five-locale queue copy and browser coverage for waiting plus retry/challenge/block distinctions.

## Task Commits

1. **Task 1 RED: queue hook contract** - `a869be4` (`test`)
2. **Task 1 GREEN: queue gate and waiting surface** - `c161107` (`feat`)
3. **Task 2 RED: queue locale E2E contract** - `ea20540` (`test`)
4. **Task 2 GREEN: localized queue route states** - `438055e` (`feat`)

## Files Created/Modified

- `apps/web/hooks/use-queue.ts` - Queue session entry, snapshot fetch, socket listeners, and route-ready state.
- `apps/web/app/booking/[performanceId]/page.tsx` - Runtime-flag-aware queue gate before `BookingPage`.
- `apps/web/components/booking/queue-waiting.tsx` - Full-page queue waiting/failure surface with safe metadata only.
- `apps/web/hooks/__tests__/use-queue.test.tsx` - Auto-enter and expiry transition coverage for the queue hook contract.
- `apps/web/e2e/booking-queue.spec.ts` - Browser queue waiting and retry/challenge/block route coverage.
- `apps/web/messages/{ko,en,th,zh-CN,zh-TW}.json` - Exact queue waiting/admitted/expired/retry/challenge/blocked copy for all five launch locales.

## Decisions Made

- Kept queue gating at the route wrapper level so the existing booking page still owns seat-map and booking-disabled behavior once admission is ready.
- Mapped retry/challenge/block from explicit backend traffic codes/messages instead of treating every queue failure as one generic error.
- Kept the E2E spec on the prefixless booking route because local Playwright reuses an unrelated 3000-port server; locale correctness is still enforced through the message bundles.

## Deviations from Plan

None - the owned scope was implemented without Rule 1-4 auto-fixes.

## Issues Encountered

- `pnpm --filter @grabit/web typecheck` is still blocked by pre-existing floor-aware typing errors outside 24-08 ownership:
  - `app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`
  - `app/performance/[id]/__tests__/performance-detail-translation-label.test.tsx`
  - `hooks/__tests__/use-booking.test.tsx`
- `pnpm --filter @grabit/web test:e2e --grep "queue"` reuses an unrelated Next dev server on port `3000` from `/Users/sangwopark19/workspace/fso/notes-app` because `playwright.config.ts` uses `reuseExistingServer: true`.
- Equivalent browser verification was executed manually against a fresh `localhost:3001` server with Playwright MCP and confirmed waiting, retry, challenge, and blocked surfaces.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web exec vitest run hooks/__tests__/use-queue.test.tsx` - PASS
- `pnpm --filter @grabit/web test -- hooks/__tests__/use-queue.test.tsx` - PASS (full web Vitest run, 339 tests)
- `rg -n "queue|expired|retry|challenge|blocked" apps/web/messages/ko.json apps/web/messages/en.json apps/web/messages/th.json apps/web/messages/zh-CN.json apps/web/messages/zh-TW.json apps/web/e2e/booking-queue.spec.ts` - PASS
- `pnpm --filter @grabit/web typecheck` - FAIL, blocked by the unrelated pre-existing files listed above
- `pnpm --filter @grabit/web test:e2e --grep "queue"` - FAIL in this environment because Playwright reuses an unrelated `notes-app` server on port `3000`
- Manual Playwright MCP verification against `http://localhost:3001/booking/00000000-0000-4000-8000-000000000023` - PASS for waiting (`position=12`, `ETA=2m 45s`, `remainingSeats=24`) and for `TRAFFIC_RATE_LIMITED`, `SECURITY_CHALLENGE_REQUIRED`, `SECURITY_BLOCKED`

## Next Phase Readiness

- Downstream booking work can assume `/booking` is queue-aware and already exposes distinct user-facing traffic-defense states.
- Full web typecheck still needs the unrelated floor-aware typing fixes before Phase 24 web verification can be considered globally green.

## Self-Check: PASSED

- Summary file exists at `.planning/phases/24-traffic-booking-payment-core/24-08-SUMMARY.md`.
- Task commits `a869be4`, `c161107`, `ea20540`, and `438055e` exist in git history.

---
*Phase: 24-traffic-booking-payment-core*
*Completed: 2026-05-08*
