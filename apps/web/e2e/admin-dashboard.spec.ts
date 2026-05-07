import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

/**
 * Admin Dashboard E2E — RED Wave 1 spec (Plan 11-01).
 *
 * 3 scenarios:
 *  - landing-smoke: /admin renders dashboard heading + 4 KPI cards + 3 chart sections + Top10
 *  - period-filter: 30일 → 7일 클릭 시 revenue/genre/payment 3개 API 동시 refetch (period=7d)
 *  - sidebar-nav: 대시보드 NAV 항목이 active 하이라이트 (text-primary 클래스)
 *
 * Wave 1(Plan 01): 페이지/컴포넌트 아직 없음 → 모든 테스트 FAIL. RED.
 * Wave 2(Plan 03): `/admin` page + dashboard components 구현 → GREEN.
 *
 * Login: `loginAsTestUser` defaults to `admin@grabit.test` / `TestAdmin2026!`
 * (helpers/auth.ts:42 — seed.mjs에 이미 존재, STATE.md 260413-jw1 참조).
 */
test.describe('Admin Dashboard E2E', () => {
  test('landing-smoke: /admin renders dashboard with KPI + charts + Top10', async ({ page }) => {
    await loginAsTestUser(page); // admin@grabit.test
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);

    // h1 copy per UI-SPEC D-01
    await expect(page.getByRole('heading', { name: '대시보드', level: 1 })).toBeVisible();

    // KPI 4장 per UI-SPEC Copywriting
    await expect(page.getByText('오늘 예매수')).toBeVisible();
    await expect(page.getByText('오늘 매출')).toBeVisible();
    await expect(page.getByText('오늘 취소')).toBeVisible();
    await expect(page.getByText('활성 공연')).toBeVisible();

    // 차트 섹션 3개
    await expect(page.getByRole('heading', { name: '매출 추이' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '분류별 예매 분포' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '결제수단 분포' })).toBeVisible();

    // Top 10
    await expect(page.getByRole('heading', { name: '인기 공연 Top 10' })).toBeVisible();
  });

  test('period-filter: 30일 → 7일 클릭 시 revenue/genre/payment 3개 chart 동시 refetch', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');

    // Register response waiters BEFORE clicking — racing otherwise.
    const responseWaits = [
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/admin/dashboard/revenue') && r.url().includes('period=7d'),
      ),
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/admin/dashboard/genre') && r.url().includes('period=7d'),
      ),
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/admin/dashboard/payment') && r.url().includes('period=7d'),
      ),
    ];
    await page
      .getByRole('group', { name: '기간 선택' })
      .getByRole('radio', { name: '7일' })
      .click();
    await Promise.all(responseWaits);
  });

  test('sidebar-nav: 대시보드 NAV 항목이 active 하이라이트', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');

    // sidebar NAV — first '대시보드' link (우선순위 최상단) — D-03
    const dashboardLink = page.getByRole('link', { name: /대시보드/ }).first();
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveClass(/text-primary/);
  });

  test('chart-blank-guard: SVG child count > 0 for all 3 charts (recharts regression)', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');
    await page.getByRole('heading', { name: '매출 추이' }).waitFor();
    await page.waitForTimeout(500);

    const sections = [
      { heading: '매출 추이' },
      { heading: '분류별 예매 분포' },
      { heading: '결제수단 분포' },
    ];
    for (const s of sections) {
      const section = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: s.heading }) });
      const svg = section.locator('svg').first();
      const childCount = await svg.locator(':scope > *').count();
      expect(
        childCount,
        `${s.heading} 차트 SVG에 자식 노드가 없음 (recharts blank 회귀 가능성)`,
      ).toBeGreaterThan(0);
    }
  });
});
