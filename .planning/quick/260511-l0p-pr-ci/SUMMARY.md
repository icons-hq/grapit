---
status: complete
quick_id: 260511-l0p
slug: pr-ci
completed_at: 2026-05-11T06:27:18Z
pr: 34
failed_run: 25651130883
---

# PR #34 CI E2E Recovery

## Root Cause

- `booking-floor-selection.spec.ts` failed only in CI because booking showtime labels used the runner timezone. CI rendered the KST showtime `2026-07-18T19:00+09:00` as `10:00`, so the test waited for a missing `19:00` button.
- `i18n-smoke.spec.ts` remained on the queue loading surface because the booking route read runtime flag resolution through non-reactive `queryClient.getQueryState()`. The disabled-booking UI did not become reachable reliably.
- `BookingPage` also gated the disabled-booking copy behind performance loading, so the expected launch copy could be delayed or hidden when the detail query was still pending.

## Changes

- Added shared KST booking datetime helpers in `apps/web/lib/booking-datetime.ts`.
- Updated `BookingPage`, `ShowtimeChips`, and `SeatSelectionPanel` to group and render booking dates/times in KST.
- Exposed `isResolved` from `useRuntimeFlags()` and made the booking route use that reactive value instead of `getQueryState()`.
- Moved the disabled-booking render path before performance loading in `BookingPage`.
- Added regression coverage for KST showtime rendering and disabled-booking copy while performance detail is still loading.

## Verification

- `TZ=UTC pnpm --filter @grabit/web exec vitest run components/booking/__tests__/showtime-chips.test.tsx components/booking/__tests__/booking-page-timezone.test.tsx hooks/__tests__/booking-disabled-runtime.test.tsx`
- `TZ=UTC pnpm --filter @grabit/web exec playwright test e2e/booking-floor-selection.spec.ts --project=chromium --workers=1 --reporter=line`
- `CI=1 pnpm --filter @grabit/web exec playwright test e2e/i18n-smoke.spec.ts --project=chromium --workers=1 --reporter=line`
- `pnpm --filter @grabit/web typecheck`
- `CI=1 TZ=UTC pnpm --filter @grabit/web test:e2e`
- `git diff --check`
- `pnpm --filter @grabit/web lint`
