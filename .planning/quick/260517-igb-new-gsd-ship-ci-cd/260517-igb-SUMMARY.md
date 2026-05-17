---
quick_id: 260517-igb
slug: new-gsd-ship-ci-cd
status: complete
date: 2026-05-17
branch: quick/new-section-card-center
ship_ready: true
---

# Quick Task 260517-igb Summary

## Status

Complete. Homepage `New` section now centers a single performance card horizontally while preserving the existing 2-column mobile / 4-column desktop grid for multiple cards.

## Files Changed

- `apps/web/components/home/new-section.tsx`
- `apps/web/components/home/__tests__/new-section-layout.test.tsx`
- `.planning/quick/260517-igb-new-gsd-ship-ci-cd/260517-igb-PLAN.md`
- `.planning/quick/260517-igb-new-gsd-ship-ci-cd/260517-igb-SUMMARY.md`

## Implementation

- Added `isSinglePerformance = performances.length === 1` after the loading/empty guards.
- Single-card branch uses `flex justify-center` and a card wrapper width equivalent to the normal grid column width:
  - mobile: `w-[calc((100%_-_0.75rem)/2)]`
  - desktop: `md:w-[calc((100%_-_4.5rem)/4)]`
- Multi-card branch keeps the existing `grid grid-cols-2 md:grid-cols-4` layout.
- `PerformanceCard`, heading text, more link, locale-aware href, loading state, and empty state were not changed.

## Verification

| Command | Result | Notes |
|---------|--------|-------|
| `pnpm --filter @grabit/web test -- components/home/__tests__/new-section-layout.test.tsx` | PASS | RED first failed on the new single-card assertion; after implementation, `72` files / `440` tests passed. This command currently runs the web unit suite under the package Vitest config. |
| `pnpm --filter @grabit/web typecheck` | PASS | `tsc --noEmit` completed successfully. |
| `pnpm --filter @grabit/web lint` | PASS with warnings | Exit code `0`. Warnings are pre-existing in unrelated admin/booking/auth/performance files; no warnings/errors were reported for this quick task's changed source/test files. |
| `git diff --check -- apps/web/components/home/new-section.tsx apps/web/components/home/__tests__/new-section-layout.test.tsx` | PASS | No whitespace errors. |
| `git status --short` | PASS | Diff scope is limited to `new-section.tsx`, the new layout test, and this quick task directory. |

## Browser Smoke

Not run for this quick task. The regression requires forcing `useNewPerformances()` to return exactly one item; the public/local home route data may contain multiple cards. The component regression test is the canonical proof because it controls the `NewSection` fixture and checks both single-card desktop/mobile class contract and multi-card grid preservation.

## Deviations

None.

## Known Stubs

None. The test fixture is local regression data only and does not flow to production UI.

## Threat Flags

None. The change adds no network endpoint, auth path, file access pattern, schema change, or new trust boundary. The existing API-data-to-layout boundary remains constrained to `performances.length`.

## Ship Readiness

Ready for `$gsd-ship 현재 브랜치` after this commit. Do not push from this quick execution step; ship workflow owns PR creation, CI watch, merge, deploy watch, and production smoke.
