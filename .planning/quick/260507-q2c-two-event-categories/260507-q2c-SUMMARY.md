---
quick_id: 260507-q2c
slug: two-event-categories
status: complete
date: 2026-05-07
commit: uncommitted
---

# Quick Task 260507-q2c Summary

## Goal

기존 8개 장르 중심 catalog surface를 `아티스트·셀럽`과 `IP 팝업` 두 분류만 사용하도록 전환한다.

## Changes

- Shared category source now exposes only `artist_celebrity` and `ip_popup` through `GENRES`, while preserving legacy genre values in `PERFORMANCE_GENRES` for existing rows.
- Added an expand-only migration that appends `artist_celebrity` and `ip_popup` to the existing PostgreSQL `genre` enum.
- Rewired public/admin category surfaces to the two launch categories:
  - desktop GNB
  - mobile menu
  - mobile tab bar
  - home category grid
  - search category chips
  - admin performance create/edit form
- Updated five-locale visible copy and tests to describe categories/events instead of 8 broad performance genres.
- Updated seed and relevant fixtures to use the new default category.

## Verification

- PASS: `pnpm --filter @grabit/shared typecheck`
- PASS: `pnpm --filter @grabit/web test -- app/__tests__/home-i18n.test.tsx app/search/__tests__/search-i18n.test.tsx components/layout/__tests__/gnb-locale.test.tsx components/layout/__tests__/mobile-tab-bar.test.tsx lib/i18n/visible-copy.test.ts`
  - Vitest resolved to the full web unit suite: 51 files, 331 tests passed.
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/api typecheck`
- PASS: `pnpm --filter @grabit/api test -- src/modules/performance/performance.service.spec.ts src/modules/search/search.service.spec.ts src/modules/admin/admin.service.spec.ts src/modules/admin/__tests__/admin-dashboard.service.spec.ts`
  - Vitest resolved to the full API unit suite: 41 files, 498 tests passed.

## Notes

- Legacy enum values are intentionally not removed. Removing PostgreSQL enum values would be a contract-breaking migration for existing production rows and should only happen in a later contract phase after data backfill.
