import { test, expect, type Page } from '@playwright/test';
import type { DashboardGenreDto, DashboardPaymentDto, DashboardRevenueDto } from '@grabit/shared';
import { loginAsTestUser } from './helpers/auth';
import { fulfillJson } from './helpers/mock-admin';

/**
 * Navigation and period changes use the real test API. Chart rendering uses
 * explicit data/empty responses so it does not depend on dated seed bookings.
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

  test('chart-blank-guard: renders all three data charts, excluding decorative icons', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await mockChartData(page, {
      revenue: [
        { bucket: '09-21', revenue: 104000, count: 1 },
        { bucket: '09-22', revenue: 208000, count: 2 },
      ],
      genre: [{ genre: 'CONCERT', count: 3 }],
      payment: [{ method: 'CARD', count: 3 }],
    });
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
      const svg = section.locator('svg.recharts-surface');
      await expect(svg).toBeVisible();
      await expect.poll(
        () => svg.locator(':scope > *').count(),
        { message: `${s.heading} 차트가 비어 있으면 안 됩니다` },
      ).toBeGreaterThan(0);
    }
  });

  test('empty charts: explains zero revenue and missing booking/payment data', async ({ page }) => {
    await loginAsTestUser(page);
    await mockChartData(page, {
      revenue: [{ bucket: '09-22', revenue: 0, count: 0 }],
      genre: [],
      payment: [],
    });
    await page.goto('/admin');
    await page.getByText('상세 통계 · 장르, 결제수단, 공연별 실적', { exact: true }).click();
    await expect(page.getByText('이 기간에는 매출이 없습니다. 기간을 바꾸거나 예매 목록을 확인해주세요.')).toBeVisible();
    await expect(page.getByText('이 기간의 예매 내역이 없습니다.')).toBeVisible();
    await expect(page.getByText('이 기간의 결제 내역이 없습니다.')).toBeVisible();
    await expect(page.locator('svg.recharts-surface')).toHaveCount(0);
  });
});

async function mockChartData(page: Page, data: {
  revenue: DashboardRevenueDto;
  genre: DashboardGenreDto;
  payment: DashboardPaymentDto;
}) {
  for (const resource of ['revenue', 'genre', 'payment'] as const) {
    await page.route(`**/api/v1/admin/dashboard/${resource}?*`, (route) => fulfillJson(route, data[resource]));
  }
}
