---
phase: 24-traffic-booking-payment-core
plan: 17
subsystem: ui
tags: [nextjs, booking, toss-payments, recovery-ui, playwright]
requires:
  - phase: 24-09
    provides: "server-owned paymentDeadlineAt and async payment recovery rules"
  - phase: 24-10
    provides: "paymentRecovery copy namespace and pendingUrl complete-route contract"
provides:
  - "Complete route inline recovery UI for pending, failed, and expired payment returns"
  - "orderId-based payment recovery status hook contract for completion flow"
  - "Phase 24 Toss payment recovery browser coverage"
affects: [booking, payment, complete-page, e2e]
tech-stack:
  added: []
  patterns:
    - "Complete route derives pending/failed/expired states from orderId recovery plus paymentDeadlineAt fallback"
    - "Playwright recovery specs mock auth bootstrap in-page so complete-route branches stay deterministic"
key-files:
  created:
    - apps/web/e2e/toss-payment-phase24.spec.ts
  modified:
    - apps/web/app/booking/[performanceId]/complete/page.tsx
    - apps/web/hooks/use-booking.ts
key-decisions:
  - "pending=true returns never re-call Toss confirm; the complete route recovers by orderId and polls until the reservation leaves pending."
  - "Expired recovery is derived from persisted paymentDeadlineAt when available, with booking-store deadline fallback for early async returns."
patterns-established:
  - "Complete-page recovery surfaces are inline status cards, not toast-only branches."
  - "Phase 24 recovery E2E can run against an isolated localhost web server without relying on the shared 3000 dev port."
requirements-completed: [BOOK-02, PAY-02]
duration: 22min
completed: 2026-05-08
---

# Phase 24 Plan 17: Payment Recovery Summary

**Complete-route payment recovery UI with orderId polling, pending/failed/expired branches, and dedicated Toss recovery E2E coverage**

## Performance

- **Duration:** 22 min
- **Started:** 2026-05-08T08:41:00Z
- **Completed:** 2026-05-08T09:03:28Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `complete/page.tsx` now handles `pending=true` async returns without treating them as invalid access or immediate success.
- `use-booking.ts` now exposes an orderId-based `paymentStatus` recovery contract that distinguishes `confirmed`, `pending`, `failed`, and `expired`.
- `toss-payment-phase24.spec.ts` now covers pending async return, recoverable failure, and expired return behavior on the complete route.

## Task Commits

Each task was committed atomically:

1. **Task 1: Render pending, failed, and expired payment recovery states on the complete page** - `ef97cf0` (`feat`)
2. **Task 2: Extend Toss payment E2E coverage for recovery states** - `ee9846f` (`test`)

## Files Created/Modified
- `apps/web/app/booking/[performanceId]/complete/page.tsx` - complete route에 pending/failure/expired inline recovery surface와 orderId recovery wiring을 추가
- `apps/web/hooks/use-booking.ts` - `paymentStatus` recovery contract와 pending polling hook을 추가
- `apps/web/e2e/toss-payment-phase24.spec.ts` - pending, failed, expired complete-route browser coverage를 추가
- `.planning/phases/24-traffic-booking-payment-core/24-17-SUMMARY.md` - 본 실행 요약

## Decisions Made

- `pending=true` complete returns는 `paymentKey`가 없어도 유효한 recovery entrypoint로 취급한다.
- `FAILED`/`CANCELLED` reservation recovery와 past-deadline `PENDING_PAYMENT` recovery는 success surface를 우회하고 inline recovery card로 직접 렌더링한다.
- Page-level integration은 기존 `BookingComplete` props를 그대로 유지하고, success branch에서만 해당 컴포넌트를 렌더링한다.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Default Playwright port reused an unrelated Next dev server**
- **Found during:** Task 2 verification
- **Issue:** repository 기본 `test:e2e` 설정은 local port `3000`을 재사용하는데, 실제로는 `/Users/sangwopark19/workspace/fso/notes-app` Next dev server가 해당 포트를 점유 중이라 `booking` routes가 전부 다른 앱으로 해석되었다.
- **Fix:** current repo web app을 `localhost:3100`에 isolated로 기동하고, temp Playwright config로 same `toss-payment` grep slice를 다시 검증했다.
- **Files modified:** none (verification environment only)
- **Verification:** isolated `localhost:3100` run에서 `toss-payment phase24` 3 tests passed, `--grep "toss-payment"` slice는 7 skipped / 3 passed
- **Committed in:** not committed (verification-only environment adjustment)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Verification path만 조정했고, shipped code scope는 plan과 동일하다.

## Issues Encountered

- Default `pnpm --filter @grabit/web test:e2e --grep "toss-payment"` runs initially reused an unrelated port-3000 Next dev server, so direct results were invalid until verification moved to isolated `localhost:3100`.
- Isolated recovery verification also required `localhost` instead of `127.0.0.1`; using the IP address broke Next dev HMR/client hydration and left `AuthGuard` in loading state.

## User Setup Required

None - no external service configuration changed in this plan.

## Next Phase Readiness

- Complete route now exposes explicit async wait, failure, and expired recovery surfaces for Phase 24 payment flows.
- Existing `BookingComplete` component ownership remained untouched; QR visibility changes from the separate Wave 8 agent stay compatible with the page-level success branch.
- ROADMAP/STATE updates were intentionally skipped per wave orchestration instructions.

## Self-Check: PASSED

- `24-17-SUMMARY.md` exists on disk.
- Task commits `ef97cf0` and `ee9846f` are present in git history.
