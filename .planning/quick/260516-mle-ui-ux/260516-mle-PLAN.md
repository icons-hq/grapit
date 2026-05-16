---
quick_id: 260516-mle
slug: mle-ui-ux
status: planned
date: 2026-05-16
mode: quick
---

# Quick Task 260516-mle: Mobile UI/UX Refresh and Mobile Language Selector

## Goal

모바일 홈부터 public UI/UX를 refined commerce 톤으로 정리하고, 모바일 header에서 globe 아이콘을 통해 다국어 선택 bottom sheet를 항상 열 수 있게 한다.

## Locked Decisions

- D-01 Refined commerce: 과장된 landing hero가 아니라, 티켓 발견과 전환 흐름이 빠르게 보이는 commerce UI로 개선한다.
- D-02 Mobile core surfaces: 범위는 public mobile home, header/navigation, locale selector, major home cards/sections로 제한한다.
- D-03 Header globe + bottom sheet: 모바일 header에 globe entry를 항상 노출하고, locale list는 bottom sheet로 제공한다.
- D-04 Existing i18n/routing: 기존 `getLocalizedPathname`, `resolveLocaleFromPathname`, `navigateToLocalizedPath`, prefixless Korean / foreign-prefixed routing을 유지한다.

## Source Audit

| Source | Item | Covered By |
|--------|------|------------|
| CONTEXT | Refined commerce tone | Task 2 |
| CONTEXT | Mobile core surfaces only | Task 1, Task 2 |
| CONTEXT | Mobile header globe + bottom sheet | Task 1 |
| CONTEXT | Existing component and i18n patterns | Task 1, Task 2 |
| RESEARCH | Mobile first viewport must expose search/category/product context | Task 2 |
| RESEARCH | Locale selection hidden on mobile | Task 1 |
| RESEARCH | Bottom sheet only for short language task | Task 1 |
| RESEARCH | Improve density/hierarchy without decorative clutter | Task 2 |

## Plan

### Task 1: Expose mobile header globe and locale bottom sheet

**Files**

- Modify: `apps/web/app/layout-shell.tsx`
- Modify: `apps/web/components/layout/gnb.tsx`
- Modify: `apps/web/components/i18n/locale-switcher.tsx`
- Modify: `apps/web/components/layout/__tests__/gnb-locale.test.tsx`

**Action**

- Render `GNB` for public mobile routes by removing the shell-level `hidden md:block` wrapper in `LayoutShell`; keep footer desktop-only and keep booking/admin shell hiding behavior unchanged.
- Update `GNB` per D-02/D-03 so the mobile header is a compact sticky commerce header: logo left, mobile action cluster right, globe icon button always visible on `md:hidden`, desktop genre/search/auth/locale behavior still gated behind existing desktop breakpoints.
- Extend `locale-switcher.tsx` with shared locale selection behavior and an exported mobile bottom-sheet selector. Use the existing `Sheet` primitives with `side="bottom"`, `SheetTitle`, `SheetDescription`, active `aria-current`, and a single-level list of `SUPPORTED_LOCALES`. Do not create a navigation drawer or route rewrite layer.
- Preserve D-04 exactly: locale selection must call `setLocalePreferenceCookie`, persist authenticated profile preference when available, close the sheet, and navigate via `navigateToLocalizedPath(appendSearchParams(getLocalizedPathname(pathname, locale), searchParams.toString()))`.
- Update `gnb-locale.test.tsx` to prove the mobile globe trigger renders through `GNB`, opens the language bottom sheet, marks the active locale, preserves query strings, and navigates to `/en?q=girl&page=2` when English is selected.

**Verify**

- `pnpm --filter @grabit/web test -- components/layout/__tests__/gnb-locale.test.tsx`
- `pnpm --filter @grabit/web typecheck`

**Done when**

- Public mobile pages show a header with a visible globe language control.
- Opening the globe shows a bottom sheet language list, not a desktop dropdown or full mobile menu.
- Selecting a locale preserves query strings and the existing Korean/foreign locale URL contract.

### Task 2: Refine mobile home, sections, and performance cards

**Files**

- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/home/banner-carousel.tsx`
- Modify: `apps/web/components/home/hot-section.tsx`
- Modify: `apps/web/components/home/new-section.tsx`
- Modify: `apps/web/components/home/genre-grid.tsx`
- Modify: `apps/web/components/performance/performance-card.tsx`
- Modify: `apps/web/app/__tests__/home-i18n.test.tsx`

**Action**

- Add a mobile-first discovery band near the top of `HomePage` per D-01/D-02: use existing localized copy and routes for a search entry linking to localized `/search`, genre shortcuts from `PUBLIC_GENRES`, and compact commerce spacing. Keep desktop coherent and avoid backend/API/routing changes.
- Tune `BannerCarousel` for refined mobile scanning: stable responsive height/aspect, polished mobile spacing, and no layout shift when banners are empty or loading.
- Tighten `HotSection`, `NewSection`, and `GenreGrid` mobile hierarchy: smaller mobile headings than desktop display type, clear section spacing, tactile horizontal/compact density, and no card-inside-card page sections.
- Update `PerformanceCard` mobile presentation so poster ratio stays stable, metadata fits without overlap, title/venue/date scan cleanly, and status badge remains visible without crowding the poster.
- Update `home-i18n.test.tsx` so the home test covers the discovery band, localized search/category surfaces, `HOT`, literal `New`, and category/card visibility without introducing new message keys unless the implementation truly needs them.

**Verify**

- `pnpm --filter @grabit/web test -- app/__tests__/home-i18n.test.tsx components/layout/__tests__/gnb-locale.test.tsx`
- `pnpm --filter @grabit/web exec eslint app/page.tsx components/home/banner-carousel.tsx components/home/hot-section.tsx components/home/new-section.tsx components/home/genre-grid.tsx components/performance/performance-card.tsx components/layout/gnb.tsx components/i18n/locale-switcher.tsx`
- `pnpm --filter @grabit/web typecheck`

**Done when**

- Mobile home first viewport exposes ticket discovery actions through search/category/product surfaces, not a marketing hero.
- Home sections and performance cards read as refined commerce: dense enough for scanning, stable in size, and visually coherent on mobile and desktop.
- Existing locale routing and public page behavior remain unchanged outside the planned public UI surfaces.

## Overall Verification

- Run the task-level automated checks above.
- Start the web app with `pnpm --filter @grabit/web dev`, then check mobile viewport around 390px width on `/`, `/en`, and `/zh-CN`.
- Confirm the mobile header globe opens a bottom sheet, locale selection changes to the correct localized URL, the bottom tab bar still sits below content, and no header/footer appears on admin or booking checkout pages.

## Success Criteria

- D-01/D-02/D-03/D-04 are all implemented in the public mobile UI surfaces.
- No backend, database, API route, or locale routing rewrite is introduced.
- Focused tests, lint, and typecheck pass.
