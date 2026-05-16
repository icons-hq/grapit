# Quick Task 260516-mle: Mobile UI/UX refresh and mobile language selector - Research

**Date:** 2026-05-16
**Mode:** quick-task targeted research

## Research Inputs

- User locked direction: Refined commerce, mobile core surfaces, mobile header globe + bottom sheet.
- Existing code inspection:
  - Home is composed from `apps/web/app/page.tsx`, `components/home/banner-carousel.tsx`, `hot-section.tsx`, `new-section.tsx`, `genre-grid.tsx`.
  - Public shell currently hides `GNB` on mobile and renders only `MobileTabBar`, which makes the existing `LocaleSwitcher` effectively desktop/menu-only.
  - Locale routing is already implemented through `getLocalizedPathname`, `resolveLocaleFromPathname`, `navigateToLocalizedPath`, and the launch locale constants.
- External UX references:
  - Baymard 2025 homepage/category navigation benchmark: mobile homepage/category navigation remains weak across commerce sites; home must support quick scanning and avoid unclear scope.
  - Baymard mobile UX findings: mobile navigation should expose current scope and broad category access, while search/category paths need strong signposting.
  - Wise Design bottom sheet guidance: bottom sheets are appropriate for short, supplementary mobile tasks and should keep the task concise.

## Findings

1. Mobile first viewport should clarify "what this service is" and "what can I do next" without becoming a landing page.
   - Grapit currently starts with only the banner carousel on mobile. If banners are generic or missing, users do not get enough product context.
   - Add a compact discovery strip/search entry and category shortcuts near the top so the first scroll gives immediate ticketing actions.

2. Language selection is structurally hidden on mobile.
   - `LayoutShell` wraps `GNB` in `hidden md:block`; `LocaleSwitcher` lives in `GNB` desktop space and `MobileMenu`, but `MobileMenu` is not wired into the public mobile shell.
   - The lowest-risk fix is to render `GNB` on mobile and add a compact mobile action cluster with a globe button that opens a locale bottom sheet.

3. Use a bottom sheet only for the language list, not for navigation.
   - Locale switching is a short, supplementary task.
   - Keep the list single-level, show active locale clearly, preserve query strings, and close before navigation.

4. Refined commerce direction should improve density and hierarchy, not add decorative clutter.
   - Prefer a sticky compact mobile header, clear search affordance, polished section headers, larger tactile genre chips, and card details that help scanning.
   - Avoid broad API/routing changes in this quick task.

## Implementation Guidance

- Extend `LocaleSwitcher` with a mobile bottom-sheet variant or a dedicated `MobileLocaleSwitcher` that reuses the same locale selection logic.
- Render `GNB` for mobile in `LayoutShell`; keep desktop behavior intact through internal responsive classes.
- Add a mobile-only discovery bar on `HomePage` with search/category/date-style shortcuts using existing localized copy.
- Tune home sections and cards with mobile-first spacing, section header hierarchy, and stable dimensions.
- Add/update focused component tests around mobile header locale discoverability and bottom sheet behavior.

## Sources

- https://baymard.com/blog/ecommerce-navigation-best-practice
- https://baymard.com/blog/mobile-ux-ecommerce
- https://baymard.com/mcommerce-usability/benchmark/mobile-page-types/homepage
- https://wise.design/components/bottom-sheet
