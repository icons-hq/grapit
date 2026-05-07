---
quick_id: 260507-r4s
slug: category-filter-chips
status: complete
date: 2026-05-07
commit: uncommitted
---

# Quick Task 260507-r4s Summary

## Goal

분류 페이지에 남아 있던 기존 공연 장르용 subcategory chip row를 현재 두 분류 체계에 맞게 제거한다.

## Changes

- `/genre/[genre]` page에서 `전체`, `요즘HOT`, `오리지널/내한`, `라이선스`, `창작`, `내한` chip row를 제거했다.
- `usePerformances()`가 더 이상 legacy `sub` query param을 API 요청/cache key에 포함하지 않도록 했다.
- five-locale message JSON에서 사용하지 않는 `genrePage.subcategories` copy를 제거했다.

## Verification

- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/web test -- app/__tests__/home-i18n.test.tsx app/search/__tests__/search-i18n.test.tsx components/layout/__tests__/gnb-locale.test.tsx components/layout/__tests__/mobile-tab-bar.test.tsx`
  - Vitest resolved to the full web unit suite: 51 files, 331 tests passed.
- PASS: `rg -n "SUBCATEGORIES|subcategories|요즘HOT|오리지널/내한|original/|Licensed|Touring|params.set\\('sub'\\)|searchParams.get\\('sub'\\)" apps/web packages/shared`
- PASS: Browser validation
  - `/genre/ip_popup`: 1 card, legacy chip buttons 0, fresh warn/error logs `[]`
  - `/genre/artist_celebrity?sub=license`: 4 cards, legacy chip buttons 0, fresh warn/error logs `[]`
