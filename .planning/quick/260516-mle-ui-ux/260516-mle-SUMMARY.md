---
quick_id: 260516-mle
slug: mle-ui-ux
status: complete
date: 2026-05-16
commit: 43ea313
---

# Quick Task 260516-mle Summary

## Result

Completed the mobile public UI/UX refresh for the home and shell surfaces.

- Added a mobile public header by rendering `GNB` on public mobile routes.
- Added a mobile globe language trigger that opens a bottom sheet locale selector.
- Reused the existing locale routing and preference persistence flow, including query-string preservation.
- Added a mobile-first home discovery band with localized search and category actions.
- Refined mobile banner, home sections, genre shortcut, skeleton, and performance card hierarchy for denser commerce scanning.
- Preserved desktop locale dropdown behavior and existing mobile bottom tab navigation.

## Verification

- `pnpm --filter @grabit/web test -- components/layout/__tests__/gnb-locale.test.tsx app/__tests__/home-i18n.test.tsx components/__tests__/skeleton-variants.test.tsx components/performance/__tests__/performance-card.test.tsx`
  - Passed. Repository test script executed the full web suite: 66 files / 418 tests passed.
- `pnpm --filter @grabit/web exec eslint app/page.tsx app/layout-shell.tsx app/__tests__/home-i18n.test.tsx components/home/banner-carousel.tsx components/home/hot-section.tsx components/home/new-section.tsx components/home/genre-grid.tsx components/performance/performance-card.tsx components/skeletons/banner-skeleton.tsx components/__tests__/skeleton-variants.test.tsx components/layout/gnb.tsx components/layout/__tests__/gnb-locale.test.tsx components/i18n/locale-switcher.tsx`
  - Passed.
- `pnpm --filter @grabit/web typecheck`
  - Passed.
- `git diff --check`
  - Passed.
- Browser verification at `http://localhost:3001/` with 390x844 viewport:
  - Mobile globe was visible in the header.
  - Bottom sheet opened with all launch locales and active locale marker.
  - Selecting English navigated to `/en`.
  - Home first viewport exposed search/category actions, banner, and refined performance sections with mocked home API data.

## Notes

- Local browser verification used mocked `/api/v1/home/*` responses because the local API was not running and the web proxy returned 500s for home data endpoints.
- The runtime code commit is `43ea313`.
