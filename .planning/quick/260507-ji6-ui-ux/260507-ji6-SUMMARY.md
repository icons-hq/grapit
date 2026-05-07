---
quick_id: 260507-ji6
slug: ui-ux
status: complete
date: 2026-05-07
commit: 652ea4c
---

# Quick Task 260507-ji6 Summary

## Goal

언어 선택 드롭다운에서 English/Thai/Chinese 등 다른 언어를 선택해도 URL과 switcher 표시만 바뀌고 실제 UI copy가 한국어로 남는 문제를 심층 분석하고 해결한다.

## Root Cause

- `LocaleSwitcher`가 `router.push('/en...')`로 client-side navigation만 수행했다.
- 이 프로젝트는 locale prefix route를 별도 `[locale]` segment가 아니라 `proxy.ts` rewrite + flat App Router route로 처리한다.
- 따라서 `/` -> `/en` client navigation 시 browser URL과 `usePathname()`은 바뀌지만, root `NextIntlClientProvider`는 기존 `ko` locale 상태로 유지됐다.
- 직접 `/en`을 새로 로드하면 영어 copy가 정상 표시되어 메시지 파일/API locale 자체 문제는 아니었다.
- 추가로 desktop GNB, genre grid, mobile menu/tab 일부 genre/tab label은 Korean hardcode라 provider가 갱신되어도 한국어가 남는 별도 잔여 문제가 있었다.

## Changes

- `LocaleSwitcher`의 언어 선택 동작을 document navigation으로 변경해 새 locale 요청이 proxy를 다시 통과하고 `NextIntlClientProvider`가 목표 locale로 remount되도록 했다.
- navigation side effect를 `apps/web/lib/i18n/locale-navigation.ts`로 분리해 회귀 테스트에서 검증 가능하게 했다.
- public shell의 hardcoded genre/tab labels를 locale message 기반으로 전환했다.
  - desktop GNB
  - home genre grid
  - mobile menu
  - mobile tab bar
  - search genre filter chips
  - genre listing page title/subcategory/sort/empty copy
- `ko/en/th/zh-CN/zh-TW` message namespace에 `genres`, `genrePage`, nav tab/search labels, search all-genres copy를 추가했다.

## Verification

- PASS: `pnpm --filter @grabit/web test -- app/__tests__/home-i18n.test.tsx app/search/__tests__/search-i18n.test.tsx components/layout/__tests__/gnb-locale.test.tsx components/layout/__tests__/mobile-tab-bar.test.tsx lib/i18n/visible-copy.test.ts`
  - Vitest pattern resolved to the full web unit suite: 51 files, 331 tests passed.
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/web lint`
  - 0 errors, 29 existing warnings outside this change.
- PASS: Browser desktop flow with Playwright MCP:
  - `/` -> language menu -> `English`
  - URL becomes `/en`
  - desktop GNB shows `Musical`, `Concert`, `More`, `Search shows`, `Login / Sign up`
  - home sections show `HOT`, `Newly opened`, `Browse by genre`
  - genre shortcuts show English labels.

## Notes

- Some performance titles/venues still display Korean when the backend has no published translation for that record. The language switch now sends locale correctly; missing content translations are data coverage, not the switcher/provider bug.
- The banner hero text is embedded inside banner images, so it cannot be translated by UI copy switching without localized banner assets.
