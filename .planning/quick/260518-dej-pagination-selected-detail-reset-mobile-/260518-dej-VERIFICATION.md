---
quick_id: 260518-dej
slug: pagination-selected-detail-reset-mobile
status: pass
date: 2026-05-18
---

# Quick Task 260518-dej Verification

## Status

PASS

## Automated Verification

- PASS: `pnpm --filter @grabit/web exec vitest run components/admin/__tests__/admin-user-management.test.tsx components/performance/__tests__/pagination-nav.test.tsx`
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/web exec playwright test e2e/admin-users.spec.ts`

## Browser Verification

- PASS: Codex in-app Browser opened `http://localhost:3000/admin/users` with local Next dev and mock API.
- PASS: Desktop view showed `총 80명 · 1/4 페이지`, `1-25명 표시`, and one `페이지 네비게이션` nav.
- PASS: Clicking page `2` showed `총 80명 · 2/4 페이지`, `26-50명 표시`, and detail context `secondfan@example.com`.
- PASS: Mobile 390x844 showed search controls and pagination with no horizontal overflow (`clientWidth=375`, `scrollWidth=375`).
- PASS: Searching from page 2 reset the list to page 1 and removed stale `secondfan@example.com` detail context.
- PASS: Browser console errors/warnings were `0`.

## Evidence Files

- `/tmp/grapit-browser-desktop-page1.png`
- `/tmp/grapit-browser-mobile-page1.png`
- `/tmp/grapit-browser-mobile-page2-detail.png`
- `/tmp/grapit-browser-mobile-search-reset.png`
