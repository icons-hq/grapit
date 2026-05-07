---
status: resolved
trigger: "pnpm dev에서 새로 생긴 아티스트·셀럽, IP 팝업 메뉴 선택 시 CLI 로그와 브라우저 로그에 오류가 많이 발생한다."
created: 2026-05-07
updated: 2026-05-07
---

# Debug Session: two-event-category-menu-errors

## Symptoms

- expected_behavior: 새 분류 메뉴(아티스트·셀럽, IP 팝업)를 선택하면 해당 분류 페이지가 정상 렌더링되고 dev server/browser console에 관련 오류가 없어야 한다.
- actual_behavior: 메뉴 선택 후 CLI 로그와 브라우저 로그에 오류가 다량 발생한다.
- error_messages: 조사 중.
- timeline: 두 분류 전환 작업 직후 발견.
- reproduction: `pnpm dev` 실행 상태에서 GNB의 새 분류 메뉴를 클릭한다.

## Current Focus

- hypothesis: 새 taxonomy enum 값이 DB에 적용되지 않았고, 기존 performance row/cache가 legacy genre 상태라 새 분류 route가 500 또는 empty/error state로 보인다.
- test: apply enum/data migrations, bypass stale taxonomy caches, then reproduce both category routes in browser.
- expecting: `/genre/artist_celebrity` and `/genre/ip_popup` render cards with no app error state and no fresh browser warn/error logs.
- next_action: complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- 2026-05-07: Before fix, `GET /api/v1/performances?genre=artist_celebrity...` and `genre=ip_popup...` returned HTTP 500.
- 2026-05-07: After applying `0009_two_event_categories`, API returned 200 but cached empty results and legacy DB rows still prevented useful category pages.
- 2026-05-07: Local DB had legacy genre distribution: `concert=2`, `exhibition=1`, `musical=2`, `play=1`.
- 2026-05-07: After `0010_collapse_legacy_genres`, DB distribution became `artist_celebrity=5`, `ip_popup=1`; visible non-ended API totals became `artist_celebrity=4`, `ip_popup=1`.
- 2026-05-07: Fresh Drizzle migration replay passed on a temporary database after adding 0009/0010 snapshots and making the initial genre enum include the new values for fresh DB transaction safety.
- 2026-05-07: Browser reproduction passed: `artistCount=4`, `popupCount=1`, error copy count `0`, fresh browser warn/error logs `[]`.

## Eliminated

- Browser framework overlay: not present; the initial visible failure was the app's query error state.
- Frontend route validation: `GENRES` accepted both new slugs and rendered the intended page headings.

## Resolution

- root_cause: The category navigation moved to new enum values before the active local DB and existing rows/cache were migrated to those values.
- fix: Applied local migration; added data migration to collapse legacy genres into the two event categories; added Drizzle snapshots/fresh DB safety; versioned performance list/home cache keys; prioritized first grid image to remove Next LCP warnings during category QA.
- verification: API 200 responses with category data, fresh DB migration replay passed, typecheck/test suites passed, browser reproduction passed with no fresh warn/error logs.
- files_changed: apps/api/src/database/migrations/0001_motionless_miek.sql, apps/api/src/database/migrations/0009_two_event_categories.sql, apps/api/src/database/migrations/0010_collapse_legacy_genres.sql, apps/api/src/database/migrations/meta/*.json, apps/api/src/modules/performance/performance.service.ts, apps/web/components/performance/performance-grid.tsx
