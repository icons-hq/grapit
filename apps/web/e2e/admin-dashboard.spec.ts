import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

/**
 * Admin Dashboard E2E — RED Wave 1 spec (Plan 11-01).
 *
 * 3 scenarios:
 *  - landing-smoke: /admin renders dashboard heading + 4 KPI cards + 3 chart sections + Top10
 *  - period-filter: 30일 → 7일 클릭 시 revenue/genre/payment 3개 API 동시 refetch (period=7d)
 *  - sidebar-nav: 운영 현황 NAV 항목이 active 하이라이트 (text-primary 클래스)
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
    await expect(page.getByRole('heading', { name: '운영 현황', level: 1 })).toBeVisible();

    // KPI 5장 per UI-SPEC Copywriting
    await expect(page.getByText('오늘 예매')).toBeVisible();
    await expect(page.getByText('오늘 취소 처리')).toBeVisible();
    await expect(page.getByText('오늘 결제 금액')).toBeVisible();
    await expect(page.getByText('오늘 취소 차감액')).toBeVisible();
    await expect(page.getByText('오늘 순매출')).toBeVisible();

    await page.getByText('상세 통계 · 장르, 결제수단, 공연별 실적', { exact: true }).click();

    // 펼친 상세 통계
    await expect(page.getByRole('heading', { name: '매출 추이' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '장르별 예매' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '결제수단별 이용' })).toBeVisible();

    // Top 10
    await expect(page.getByRole('heading', { name: '공연별 예매 실적 · 상위 10개' })).toBeVisible();
  });

  test('period-filter: 30일 → 7일 클릭 시 revenue/genre/payment 3개 chart 동시 refetch', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');

    await page.getByText('상세 통계 · 장르, 결제수단, 공연별 실적', { exact: true }).click();
    await expect(page.getByRole('heading', { name: '장르별 예매' })).toBeVisible();

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

  test('sidebar-nav: 운영 현황 NAV 항목이 active 하이라이트', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');

    // sidebar NAV — first '운영 현황' link (우선순위 최상단) — D-03
    const dashboardLink = page.getByRole('link', { name: /운영 현황/ }).first();
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
  });

  test('chart-blank-guard: SVG child count > 0 for all 3 charts (recharts regression)', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await page.goto('/admin');
    await page.getByRole('heading', { name: '매출 추이' }).waitFor();
    await page.getByText('상세 통계 · 장르, 결제수단, 공연별 실적', { exact: true }).click();
    await expect(page.getByRole('heading', { name: '장르별 예매' })).toBeVisible();

    const sections = [
      { heading: '매출 추이' },
      { heading: '장르별 예매' },
      { heading: '결제수단별 이용' },
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
