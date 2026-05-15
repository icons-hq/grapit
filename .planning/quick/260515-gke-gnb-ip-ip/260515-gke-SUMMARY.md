---
quick_id: 260515-gke
slug: gnb-ip-ip
status: complete
date: 2026-05-15
commit: c2ab217
---

# Quick Task 260515-gke Summary

## Result

Completed. Public GNB, mobile category menu, and home genre shortcuts now render only the artist category. The `ip_popup` category remains in the data model and search/admin surfaces for compatibility, but it is hidden from the requested public navigation surfaces.

## Changes

- Added `PUBLIC_GENRES` for public navigation/shortcut rendering.
- Changed `artist_celebrity` visible copy from artist/celebrity wording to artist-only wording across supported locale message files.
- Updated shared Korean fallback label and slug aliases so `아티스트` resolves to `artist_celebrity`.
- Updated focused UI expectations for GNB, home, and search visible copy.

## Verification

- `pnpm --filter @grabit/web test -- app/__tests__/home-i18n.test.tsx app/search/__tests__/search-i18n.test.tsx components/layout/__tests__/gnb-locale.test.tsx` passed. Current Vitest config ran the full web unit suite: 65 files, 404 tests passed.
- `pnpm --filter @grabit/web typecheck` passed.
- `pnpm --filter @grabit/web lint` passed with 33 pre-existing warnings and 0 errors.
