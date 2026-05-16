---
phase: quick-260516-o8e-mobile-search-ux-redesign-and-mobile-hom
status: complete
completed_at: "2026-05-16T08:53:53.000Z"
commit: uncommitted
---

# Quick Task 260516-o8e Summary

## Outcome

Completed the mobile search and banner UX quick task.

- `/search` now renders a compact search form before the empty-state prompt, so mobile users can search directly from the tab.
- Search submit trims the query, ignores empty input, preserves existing URL filters, removes stale `page`, and navigates to `/search?q=...`.
- Home banners now filter by viewport using the existing `deviceTarget` contract: mobile sees `mobile` and `all`, desktop sees `desktop` and `all`.
- Mobile home banner and skeleton slots now use the 1290 x 600 aspect ratio instead of the old fixed mobile height.
- Admin banner create/edit now preserves expanded banner metadata and gives device-aware upload guidance, including the mobile 1290 x 600 recommendation.

## Files Changed

- `apps/web/app/search/page.tsx`
- `apps/web/app/search/__tests__/search-i18n.test.tsx`
- `apps/web/hooks/use-performances.ts`
- `apps/web/hooks/__tests__/use-performances.test.tsx`
- `apps/web/components/home/banner-carousel.tsx`
- `apps/web/components/home/__tests__/banner-carousel.test.tsx`
- `apps/web/components/skeletons/banner-skeleton.tsx`
- `apps/web/components/__tests__/skeleton-variants.test.tsx`
- `apps/web/components/admin/banner-manager.tsx`
- `apps/web/app/admin/banners/page.tsx`
- `apps/web/components/admin/__tests__/banner-manager.test.tsx`

## Verification

- `pnpm --filter @grabit/web test -- app/search/__tests__/search-i18n.test.tsx hooks/__tests__/use-performances.test.tsx components/home/__tests__/banner-carousel.test.tsx components/__tests__/skeleton-variants.test.tsx components/admin/__tests__/banner-manager.test.tsx` passed. Repo test runner executed the full web test set: 68 files, 424 tests.
- `pnpm --filter @grabit/web typecheck` passed.
- `pnpm --filter @grabit/api test -- src/modules/admin/admin.service.spec.ts src/modules/performance/performance.service.spec.ts` passed. Repo test runner executed the full API test set: 65 files, 672 tests.
- `pnpm --filter @grabit/web lint` completed with 0 errors and existing repo-wide warnings.
- Local mobile screenshots confirmed `/search` displays the search input and home uses the updated mobile banner slot.

## Notes

- No database schema, backend route, or banner model change was needed because the existing `deviceTarget` field already supports `all`, `desktop`, and `mobile`.
- Existing admin upload limits and accepted image types were preserved.
