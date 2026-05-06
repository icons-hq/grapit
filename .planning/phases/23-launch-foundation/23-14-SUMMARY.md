---
phase: 23-launch-foundation
plan: 14
subsystem: i18n
tags: [kst, krw, intl, next-intl, performance-detail]

requires:
  - phase: 23-launch-foundation
    provides: Shared five-locale constants from 23-01
  - phase: 23-launch-foundation
    provides: next-intl active locale wiring from 23-04
provides:
  - KST anchored event-critical time formatting helper
  - KRW source price plus estimated local currency formatting helper
  - Reusable KstTime and CurrencyDisplay components
  - Public performance detail page date and price wiring
affects: [phase-23, public-performance-detail, i18n, pricing-display]

tech-stack:
  added: []
  patterns:
    - Native Intl formatting for event time and estimated local currency display
    - Canonical KST/KRW anchors stay visible while locale-specific secondary copy remains advisory

key-files:
  created:
    - apps/web/lib/i18n/format.ts
    - apps/web/lib/i18n/format.test.ts
    - apps/web/components/i18n/kst-time.tsx
    - apps/web/components/i18n/currency-display.tsx
    - apps/web/components/i18n/__tests__/format-components.test.tsx
    - apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx
  modified:
    - apps/web/app/performance/[id]/page.tsx

key-decisions:
  - "KST and KRW remain canonical anchors; localized time and currency are secondary advisory output."
  - "Currency conversion uses deterministic display estimates with an explicit exchange-rate disclaimer because live FX is later payment/ops scope."
  - "The public performance detail page resolves locale through next-intl useLocale and falls back to ko when unavailable."

patterns-established:
  - "Event-critical display components call formatEventTimeWithKstAnchor so visible UI cannot omit KST."
  - "Price display components call formatKrwWithEstimate so visible UI cannot replace canonical KRW with an estimate."

requirements-completed:
  - I18N-02

duration: 5m25s
completed: 2026-05-06
---

# Phase 23 Plan 14: KST/KRW Formatting Summary

**Reusable KST time and KRW price formatting now drives the public performance detail date and price display with estimated local conversion disclaimers.**

## Performance

- **Duration:** 5m25s
- **Started:** 2026-05-06T05:37:10Z
- **Completed:** 2026-05-06T05:42:35Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments

- Added `formatEventTimeWithKstAnchor` with explicit `KST` output and locale-aware secondary local time.
- Added `formatKrwWithEstimate` with canonical `KRW` source amount, estimated local amount, and exchange-rate disclaimer.
- Added `KstTime` and `CurrencyDisplay` components for reusable visible UI.
- Replaced the public performance detail page's inline date and price formatting with the new components.
- Added helper, component, and page tests covering all five launch locales and the visible public detail surface.

## Task Commits

1. **Task 1 RED: Add failing KST/KRW formatting tests** - `cbbae9e` (test)
2. **Task 1 GREEN: Implement KST/KRW formatting and detail wiring** - `67381d2` (feat)

## Files Created/Modified

- `apps/web/lib/i18n/format.ts` - KST/local time and KRW/estimated currency formatting helpers.
- `apps/web/lib/i18n/format.test.ts` - Locale coverage for KST anchor, local time, KRW source, estimate, and disclaimer behavior.
- `apps/web/components/i18n/kst-time.tsx` - Presentational KST anchored time component.
- `apps/web/components/i18n/currency-display.tsx` - Presentational KRW source and estimated local currency component.
- `apps/web/components/i18n/__tests__/format-components.test.tsx` - Component rendering tests.
- `apps/web/app/performance/[id]/page.tsx` - Public performance detail date and price output now uses `KstTime` and `CurrencyDisplay`.
- `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx` - Public detail page fixture proving visible KST/KRW/estimate/disclaimer output.

## Decisions Made

- Used native `Intl` only; no `date-fns` dependency was added.
- Kept live FX out of scope and made default conversions deterministic display estimates with an explicit disclaimer.
- Used `next-intl` `useLocale()` in the client detail page and guarded it with shared `isSupportedLocale()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] Wrapped the page test around fulfilled App Router params**
- **Found during:** Task 1 GREEN verification
- **Issue:** The RED page test rendered `PerformanceDetailPage` with a fresh unresolved `params` Promise, so React stayed on the Suspense fallback and never reached the detail UI.
- **Fix:** Wrapped the page in `Suspense` and provided a fulfilled params thenable matching the App Router test pattern.
- **Files modified:** `apps/web/app/performance/[id]/__tests__/performance-detail-formatting.test.tsx`
- **Verification:** `pnpm --filter @grabit/web test -- format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx` passed.
- **Committed in:** `67381d2`

---

**Total deviations:** 1 auto-fixed (Rule 1: 1)  
**Impact on plan:** The deviation corrected the test harness only. Product scope remained exactly KST/KRW formatting helpers, components, and public detail wiring.

## Issues Encountered

- The web test script still runs the full Vitest suite when filenames are passed after `--`; targeted tests passed, with pre-existing jsdom warnings from unrelated pagination, API client, and seat-map tests.

## Known Stubs

None.

## Threat Flags

None - no new network endpoint, auth path, file access pattern, schema change, or trust boundary was introduced beyond the plan's locale/currency formatting boundary.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm --filter @grabit/web test -- format.test.ts format-components.test.tsx performance-detail-formatting.test.tsx` - PASS, 212 tests.
- `grep -R "KST" apps/web/lib/i18n apps/web/components/i18n apps/web/app/performance` - PASS.
- `grep -R "exchange rate may change\\|환율" apps/web/lib/i18n apps/web/components/i18n apps/web/app/performance` - PASS.
- `grep -R "KstTime\\|CurrencyDisplay" 'apps/web/app/performance/[id]/page.tsx'` - PASS.
- `pnpm --filter @grabit/web typecheck` - PASS.

## TDD Gate Compliance

- RED commit exists: `cbbae9e`
- GREEN commit exists after RED: `67381d2`
- Refactor commit: Not needed

## Next Phase Readiness

Ready for downstream Phase 23 i18n UI work. Future pages can reuse `KstTime` and `CurrencyDisplay` instead of duplicating local date/price formatting.

## Self-Check: PASSED

- Summary and all key files exist on disk.
- Task commits `cbbae9e` and `67381d2` exist in git history.
- No unexpected tracked file deletions were found in task commits.

---
*Phase: 23-launch-foundation*
*Completed: 2026-05-06*
