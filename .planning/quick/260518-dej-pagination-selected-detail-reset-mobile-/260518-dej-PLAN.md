---
quick_id: 260518-dej
slug: pagination-selected-detail-reset-mobile
status: planned
date: 2026-05-18
mode: quick
files_modified:
  - apps/web/app/admin/layout.tsx
  - apps/web/app/admin/users/page.tsx
  - apps/web/components/admin/admin-user-management.tsx
  - apps/web/hooks/use-admin-users.ts
  - apps/web/components/admin/__tests__/admin-user-management.test.tsx
  - apps/web/components/performance/__tests__/pagination-nav.test.tsx
  - apps/web/e2e/admin-users.spec.ts
---

# Quick Task 260518-dej: Admin Users Pagination and Mobile List Usability

## Goal

어드민 회원관리 화면에 기존 `PaginationNav` 패턴을 적용하고, page/filter/search 변경 시 이전 선택 상세가 남지 않게 reset하며, 모바일에서 큰 회원 목록을 더 안전하게 탐색할 수 있게 만든다.

## Current Findings

- `AdminUserManagement`는 `filters.page`와 `filters.limit`를 `useAdminUsers`에 넘기지만, 화면에는 page 이동 UI가 없다.
- `activeUserId = selectedUserId ?? users[0]?.id ?? null` 구조라 page/filter/search 변경 직후 이전 `selectedUserId`가 새 목록 밖의 상세 조회를 계속 유발할 수 있다.
- `useAdminUsers`는 `total`, `page`, `limit`까지만 정규화하므로 UI가 매번 `totalPages`를 직접 계산해야 한다.
- `PaginationNav`는 이미 `apps/web/components/performance/pagination-nav.tsx`에서 search/genre/admin performances가 쓰는 접근성 label과 page button 패턴을 제공한다.
- 모바일에서는 25명 단위 리스트가 길어질 수 있는데, 현재 list/detail stack에서는 회원 목록 탐색과 pagination context가 list 내부에 고정되어 있지 않다.

## Source Audit

| Source | Item | Covered By | Status |
|--------|------|------------|--------|
| GOAL | 어드민 회원관리 pagination, selected detail reset, mobile large-list usability improvement | Tasks 1-3 | COVERED |
| REQ | Pagination UI를 추가하고 기존 reusable `PaginationNav` pattern을 따른다 | Task 1 | COVERED |
| REQ | page/filter/search 변경 시 이전 selected detail이 남지 않게 reset한다 | Task 1, Task 3 | COVERED |
| REQ | 모바일 large-list 탐색성을 개선한다 | Task 2, Task 3 | COVERED |
| REQ | Unit/E2E regression tests를 추가/갱신한다 | Task 3 | COVERED |
| CONTEXT | 기존 admin UI, Tailwind, TanStack Query hook style, masked detail surface를 유지한다 | Tasks 1-3 | COVERED |
| CONTEXT | `PaginationNav`를 수정하지 않고 재사용한다 | Task 1 | COVERED |

## Interfaces

- `useAdminUsers(params: AdminUserListParams)` returns `AdminUserListResponse` from `apps/web/hooks/use-admin-users.ts`.
- `AdminUserListResponse` currently has `items`, `total`, `page`, and `limit`; this quick task should add `totalPages` in the hook mapping so the component does not duplicate pagination math.
- `PaginationNav` props are `currentPage`, `totalPages`, and `onPageChange(page)`. It already renders `aria-label="페이지 네비게이션"` and calls `window.scrollTo` after page changes.
- `AdminUserManagement` owns `filters`, `searchText`, and `selectedUserId`; stale-detail prevention belongs in this component state boundary, not in the API client.

## Plan

### Task 1: Add pagination state wiring and stale selected detail reset

**Files**

- Modify: `apps/web/components/admin/admin-user-management.tsx`
- Modify: `apps/web/app/admin/layout.tsx`
- Modify: `apps/web/app/admin/users/page.tsx`
- Modify: `apps/web/hooks/use-admin-users.ts`

**Action**

- Add `totalPages: number` to `AdminUserListResponse` and compute it in `mapListResponse` from normalized `total` and `limit` with a minimum of 1.
- Normalize `page` and `limit` defensively in `useAdminUsers`: keep default `page: 1`, `limit: 25`, and avoid sending page values below 1.
- Import and render `PaginationNav` in `AdminUserManagement` through `UserList` when `totalPages > 1`, matching the `apps/web/app/admin/performances/page.tsx` pattern.
- Add a `handlePageChange(page)` callback that updates `filters.page` and clears `selectedUserId` before the next page query.
- Update `handleSearch` and `handleVerificationChange` so they trim/set the new query state, force `page: 1`, and clear `selectedUserId`.
- Prevent stale detail queries by deriving `activeUserId` only from a selected user that exists in the current `users` array, otherwise fall back to the first visible user. This preserves the current auto-select-first-list-item behavior while ensuring old page/filter/search selections cannot drive detail fetches.

**Done when**

- The user list shows pagination controls for multi-page responses.
- Clicking a page updates `/api/v1/admin/users?page=N&limit=25`.
- Search/filter/page changes never fetch or display a detail panel for a user absent from the current list.

### Task 2: Improve mobile large-list usability inside the admin user list

**Files**

- Modify: `apps/web/components/admin/admin-user-management.tsx`

**Action**

- Keep the existing two-pane desktop and stacked mobile layout, but make the list section easier to use with large result sets: a stable header showing total count plus current page context, a bounded scroll area for list rows on narrow viewports, and a footer area for `PaginationNav`.
- Prevent mobile horizontal overflow on the admin users page so the search controls and pagination remain fully visible in a 390px viewport.
- Keep the admin shell flex container `min-w-0`/`overflow-x-hidden` so narrow admin pages cannot be widened by child intrinsic widths.
- Use restrained admin UI styling already present in the file: white panel, `rounded-lg`, `shadow-sm`, gray text hierarchy, compact `Badge`/metric rows, and no new decorative cards.
- Ensure touch targets stay at least the current row/button size, selected row styling remains visible, and pagination remains reachable without requiring the operator to scroll through every row.
- Do not add infinite scroll, virtualized list dependencies, URL query routing, or a new admin shell.

**Done when**

- On mobile-width layouts, a large list remains scrollable within the list panel and pagination is visible as part of the list controls.
- The detail panel still renders below the list and uses the same selected/first-visible user behavior from Task 1.
- Desktop admin layout remains visually aligned with the existing admin performance pagination pattern.

### Task 3: Add unit and E2E regressions for pagination/reset/mobile behavior

**Files**

- Modify: `apps/web/components/admin/__tests__/admin-user-management.test.tsx`
- Modify: `apps/web/e2e/admin-users.spec.ts`

**Action**

- Extend the unit mock data with at least two pages and two user details. Make the list endpoint return `total > limit`, page-aware `items`, `page`, and `limit`.
- Add a unit test that clicks page `2` through `PaginationNav`, asserts the list request contains `page=2&limit=25`, and asserts the detail panel switches to the page-2 user without showing the old page-1 detail.
- Add a unit test that selects a user, submits a new search or changes the verification filter, and proves `selectedUserId` reset behavior by expecting the next detail request to target the first visible result from the new list rather than the previously selected user.
- Because `PaginationNav` calls `window.scrollTo`, stub `window.scrollTo` in the test setup if jsdom does not already provide it.
- Extend `apps/web/e2e/admin-users.spec.ts` with page-aware route mocks, a second user/detail fixture, and a mobile viewport check around `/admin/users`. Assert the pagination nav is visible, page `2` can be selected, and the visible detail context changes to the page-2 user.

**Done when**

- Component tests fail if pagination UI disappears, `page` is not sent to the list endpoint, or stale selected detail survives page/filter/search changes.
- Playwright catches the admin route behavior with mobile viewport constraints and page-aware mocked API responses.

## Threat Model

| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|------------|
| T-260518-DEJ-01 | Information Disclosure | `AdminUserManagement` detail query | mitigate | Reset `selectedUserId` and ignore selections absent from the current list so old user detail is not shown after page/filter/search changes. |
| T-260518-DEJ-02 | Tampering | pagination params | mitigate | Clamp/normalize page and limit in the hook before constructing query params. |
| T-260518-DEJ-03 | Denial of Service | mobile large lists | accept | No new API load pattern is introduced; keep fixed `limit: 25` and explicit pagination instead of infinite scroll. |

## Verification

- `pnpm --filter @grabit/web test -- components/admin/__tests__/admin-user-management.test.tsx components/performance/__tests__/pagination-nav.test.tsx`
- `pnpm --filter @grabit/web test:e2e -- admin-users.spec.ts`
- `pnpm --filter @grabit/web typecheck`

## Success Criteria

- `AdminUserManagement` renders `PaginationNav` for multi-page member results and keeps the reusable pagination component unchanged.
- Page/filter/search changes reset stale selection and never show detail for a user outside the current list.
- Mobile operators can navigate large member lists without scrolling through every row to reach pagination.
- Focused unit, E2E, and typecheck verification pass.
