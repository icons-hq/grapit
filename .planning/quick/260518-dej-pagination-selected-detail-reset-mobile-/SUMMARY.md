---
quick_id: 260518-dej
slug: pagination-selected-detail-reset-mobile
status: complete
date: 2026-05-18
commit: uncommitted
---

# Quick Task 260518-dej Summary

## Result

Admin member management now supports explicit pagination for large member lists, resets stale selected detail state when page/search/filter changes, and keeps the mobile admin users page within the viewport without clipping the search controls.

## Changes

- Added `totalPages` support and defensive `page`/`limit` normalization in `useAdminUsers`.
- Reused `PaginationNav` in `AdminUserManagement`, including page count/range copy and page-change state wiring.
- Prevented stale detail queries by ignoring selected users that are no longer present in the current list and suppressing detail lookup while placeholder list data is shown.
- Bounded the member list rows in an internal scroll area so pagination stays reachable on large lists.
- Fixed mobile horizontal overflow in the admin shell/users page by adding `min-w-0`, `overflow-x-hidden`, and a base `minmax(0,1fr)` grid column.
- Added unit and E2E regressions for page 2 navigation, stale detail reset, and mobile pagination behavior.

## Verification

- PASS: `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/admin-user-management.test.tsx components/performance/__tests__/pagination-nav.test.tsx`
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/web exec playwright test e2e/admin-users.spec.ts`
- PASS: mocked visual QA at 1440x900 and 390x844. Pagination rendered, page 2 requested `/api/v1/admin/users?page=2&limit=25`, detail switched to `secondfan@example.com`, and no console errors were observed.
- PASS: Codex in-app Browser QA against local Next dev + mock API. Desktop and 390x844 mobile both rendered `/admin/users`, page 2 navigation switched the list/detail context to `secondfan@example.com`, search reset returned to page 1, stale page-2 detail disappeared, and browser console errors/warnings were `0`.

## Notes

- Browser QA used a local mock API for admin auth/list/detail responses so the protected admin route could be exercised end-to-end without touching production user data.
