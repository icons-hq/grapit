import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

const report = {
  since: '2026-11-10T15:00:00.000Z', until: '2026-11-11T06:00:00.000Z', previousSince: '2026-11-10T00:00:00.000Z', generatedAt: '2026-11-11T06:00:00.000Z',
  summary: { signups: 42, previousSignups: 14, change: 28, changeRate: 200, emailVerified: 36, phoneVerified: 31, marketingConsented: 24, firstPaidMembers: 3, firstPaidRate: 7.1 },
  hourly: Array.from({ length: 15 }, (_, h) => ({ hour: `2026-11-11 ${String(h).padStart(2, '0')}:00`, signups: h < 9 ? 0 : [2, 4, 5, 7, 11, 13][h - 9] })),
  providers: [{ value: 'kakao', count: 24, rate: 57.1 }, { value: 'email', count: 12, rate: 28.6 }, { value: 'naver', count: 6, rate: 14.3 }],
  countries: [{ value: 'KR', count: 30, rate: 71.4 }, { value: 'TH', count: 12, rate: 28.6 }],
  locales: [{ value: 'ko', count: 30, rate: 71.4 }, { value: 'th', count: 12, rate: 28.6 }],
};
async function baseMocks(page: Page) {
  await mockAdminAuth(page);
  await page.route('**/api/v1/admin/users?**', (route) => fulfillJson(route, { items: [], total: 0, totalPages: 0, page: 1, limit: 20 }));
  await page.route('**/api/v1/admin/users/stats', (route) => fulfillJson(route, {
    total: 42, active: 42, withdrawn: 0, merged: 0, verification: { emailVerified: 36, phoneVerified: 31, fullyVerified: 30 },
    marketing: { consented: 24, notConsented: 18 }, countries: [], locales: [], signupTrend: [], generatedAt: report.generatedAt,
  }));
  await page.route('**/api/v1/feature-flags', (route) => fulfillJson(route, { bookingEnabled: true }));
}
async function screenshot(page: Page, name: string) {
  const dir = process.env['ANALYTICS_QA_DIR'];
  if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false }); }
}
test('signup monitoring renders, switches periods and applies an announcement on desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 }); await baseMocks(page);
  const searches: string[] = [];
  await page.route('**/api/v1/admin/users/signup-monitoring?**', (route) => { searches.push(new URL(route.request().url()).search); return fulfillJson(route, report); });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: '공지 이후 가입 모니터링' })).toBeVisible();
  await expect(page.getByRole('group', { name: '신규 가입', exact: true })).toContainText('42건');
  await expect(page.getByText('마지막 갱신: 2026-11-11 15:00:00')).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await screenshot(page, 'signup-desktop');
  await page.getByRole('radio', { name: '최근 7일' }).click(); await expect.poll(() => searches.at(-1)).toContain('period=7d');
  const at = new Date(Date.now() - 3600000); const local = new Date(at.getTime() + 9 * 3600000).toISOString().slice(0, 16);
  await page.getByLabel('공지 시각 (KST)').fill(local); await page.getByRole('button', { name: '기준 시각 적용' }).click();
  await expect.poll(() => searches.at(-1)).toContain('period=announcement');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '공지 이후 가입 모니터링' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await screenshot(page, 'signup-mobile'); expect(errors).toEqual([]);
});
test('signup monitoring distinguishes loading, empty and error states', async ({ page }) => {
  await baseMocks(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let mode: 'empty' | 'error' = 'empty';
  await page.route('**/api/v1/admin/users/signup-monitoring?**', async (route) => {
    await gate;
    if (mode === 'error') return fulfillJson(route, { message: 'Temporary test failure' }, 503);
    return fulfillJson(route, { ...report, summary: { ...report.summary, signups: 0, previousSignups: 0, firstPaidMembers: 0, firstPaidRate: 0, change: 0, changeRate: null }, hourly: report.hourly.map((h) => ({ ...h, signups: 0 })), providers: [], countries: [], locales: [] });
  });
  await page.goto('/admin/users');
  await expect(page.getByRole('status', { name: '가입 통계 불러오는 중' })).toBeVisible(); await screenshot(page, 'signup-loading');
  release(); await expect(page.getByText('선택한 기간에 신규 가입이 없습니다.')).toBeVisible(); await screenshot(page, 'signup-empty');
  mode = 'error'; await page.getByRole('radio', { name: '최근 24시간' }).click();
  await expect(page.getByText(/가입 통계를 불러오지 못했습니다/)).toBeVisible(); await screenshot(page, 'signup-error');
  mode = 'empty'; await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('선택한 기간에 신규 가입이 없습니다.')).toBeVisible();
});
