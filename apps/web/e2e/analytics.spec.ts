import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';
import type { AnalyticsReport } from '@grabit/shared';

const performanceId = '00000000-0000-4000-8000-000000009001';
const rows = ['방문', '공연 상세', '좌석 선택', '결제 시작', '결제 완료'].map((name, i) => ({ name, count: [120, 80, 24, 16, 10][i]!, rate: [100, 66.7, 20, 13.3, 8.3][i]!, dropoff: [0, 40, 56, 8, 6][i]! }));
const data: AnalyticsReport = {
  since: '2026-11-10T15:00:00.000Z', until: '2026-11-11T06:00:00.000Z', generatedAt: '2026-11-11T06:00:00.000Z',
  config: { enabled: true, environmentEnabled: true, noticeVersion: 'analytics-v1', rawRetentionDays: 90 }, lastCollectedAt: '2026-11-11T06:00:00.000Z', rollupThrough: '2026-11-11T05:55:00.000Z',
  summary: { visitors: 100, sessions: 120, pageViews: 360, returningVisitors: 20, previousVisitors: 42, activeVisitors: 7, signups: 24, paidOrders: 12, cancelledOrders: 1 },
  trend: Array.from({ length: 15 }, (_, i) => ({ hour: `2026-11-11 ${String(i).padStart(2, '0')}:00`, visitors: i * 2, sessions: i * 3, pageViews: i * 4 })),
  funnel: rows, signupFunnel: [rows[0]!, { name: '가입 완료', count: 20, rate: 16.7, dropoff: 100 }],
  sources: [{ source: 'instagram', medium: 'social', campaign: 'announcement', term: 'fanmeeting', content: 'poster_a', sessions: 80, signups: 12, paidMembers: 6 }],
  attribution: [{ model: 'first', source: 'instagram', campaign: 'announcement', signups: 12, paidMembers: 6 }, { model: 'last', source: 'instagram', campaign: 'announcement', signups: 12, paidMembers: 6 }],
  landingPages: [{ path: '/', sessions: 120, singlePageSessions: 22 }], performances: [{ id: performanceId, title: '분석 검증 공연', views: 80, bookingSessions: 30, checkoutSessions: 16 }],
  engagement: [{ path: '/', views: 120, averageSeconds: 32, deepScrolls: 60, exits: 22 }], dimensions: [{ dimension: 'device', value: 'mobile', sessions: 100 }, { dimension: 'browser', value: 'safari', sessions: 70 }, { dimension: 'os', value: 'ios', sessions: 70 }, { dimension: 'language', value: 'ko', sessions: 90 }, { dimension: 'screen', value: 'small', sessions: 100 }],
};
async function capture(page: Page, name: string) { const dir = process.env['ANALYTICS_QA_DIR']; if (dir) { await mkdir(dir, { recursive: true }); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false }); } }
test('analytics dashboard renders responsive data and handles filters, errors, empty results and the kill switch', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await mockAdminAuth(page); await page.setViewportSize({ width: 1440, height: 1000 });
  let mode: 'data' | 'empty' | 'error' = 'data'; let collecting = true; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); const queries: string[] = [];
  await page.route('**/api/v1/admin/analytics?**', async (route) => {
    queries.push(new URL(route.request().url()).search); await gate;
    if (mode === 'error') return fulfillJson(route, { message: 'Synthetic timeout' }, 503);
    return fulfillJson(route, mode === 'data' ? { ...data, config: { ...data.config, enabled: collecting } } : { ...data, config: { ...data.config, enabled: false }, summary: { visitors: 0, sessions: 0, pageViews: 0, returningVisitors: 0, previousVisitors: 0, activeVisitors: 0, signups: 0, paidOrders: 0, cancelledOrders: 0 }, trend: [], sources: [], attribution: [], landingPages: [], performances: [], engagement: [], dimensions: [], funnel: rows.map((r) => ({ ...r, count: 0, rate: 0, dropoff: 0 })), signupFunnel: [] });
  });
  await page.route('**/api/v1/admin/analytics/settings', async (route) => { collecting = (route.request().postDataJSON() as { enabled: boolean }).enabled; await fulfillJson(route, { ...data.config, enabled: collecting }); });
  await page.goto('/admin/analytics'); await expect(page.getByRole('status', { name: '방문 분석 불러오는 중' })).toBeVisible(); await capture(page, 'analytics-loading');
  release(); await expect(page.getByRole('group', { name: '방문자 (UV)', exact: true })).toContainText('100건'); await expect(page.locator('.recharts-surface')).toBeVisible(); await capture(page, 'analytics-desktop');
  await page.getByRole('heading', { name: '예매 퍼널', exact: true }).scrollIntoViewIfNeeded(); await capture(page, 'analytics-funnel');
  await page.getByRole('radio', { name: '7일', exact: true }).click(); await expect.poll(() => queries.at(-1)).toContain('granularity=day');
  await page.getByRole('button', { name: '수집 즉시 중단' }).click(); await expect(page.getByText('방문 분석 수집 중지', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await capture(page, 'analytics-mobile'); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await capture(page, 'analytics-mobile');
  mode = 'empty'; await page.getByRole('button', { name: '새로고침', exact: true }).click(); await expect(page.getByText(/선택한 기간에 수집된 방문 기록이 없습니다/)).toBeVisible(); await capture(page, 'analytics-empty');
  mode = 'error'; await page.getByRole('button', { name: '새로고침', exact: true }).click(); await expect(page.getByText(/방문 분석을 불러오지 못했습니다/)).toBeVisible(); await capture(page, 'analytics-error');
  mode = 'data'; await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await expect(page.getByRole('group', { name: '방문자 (UV)', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('real browser navigation persists sanitized events through the local analytics API and withdrawal erases them', async ({ page, request }) => {
  test.skip(process.env['ANALYTICS_LIVE_API'] !== 'true', 'Requires the isolated local PostgreSQL/Valkey analytics harness; no production access.');
  const api = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:8184';
  await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const posted: string[] = []; page.on('request', (r) => { if (r.url().endsWith('/analytics/events')) posted.push(r.postData() ?? ''); });
  const since = new Date(Date.now() - 3600000).toISOString();
  const report = async () => { const params = new URLSearchParams({ since, until: new Date(Date.now() + 1000).toISOString(), granularity: 'hour' }); const response = await request.get(`${api}/api/v1/admin/analytics?${params}`, { headers: { Authorization: 'Bearer admin-e2e-access-token' } }); expect(response.ok()).toBe(true); return response.json() as Promise<AnalyticsReport>; };
  await page.goto(`/performance/${performanceId}?utm_source=instagram&utm_campaign=launch_20261111&utm_content=poster_a&ticket=must-not-collect`);
  await expect(page.getByRole('heading', { name: '분석 검증 공연', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '분석 허용', exact: true })).toBeVisible(); expect(posted).toHaveLength(0); await capture(page, 'analytics-consent');
  await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await capture(page, 'analytics-consent-mobile');
  await page.getByRole('button', { name: '분석 허용', exact: true }).click();
  await page.goto('/auth'); await expect(page.getByRole('tab', { name: '회원가입', exact: true })).toBeVisible(); await page.waitForTimeout(300); await page.getByRole('tab', { name: '회원가입', exact: true }).click();
  await page.goto('/legal/analytics'); await expect(page.getByRole('heading', { name: '방문 분석 설정' })).toBeVisible();
  await expect.poll(async () => (await report()).summary.pageViews, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  const observed = await report(); expect(observed.performances[0]?.views).toBeGreaterThanOrEqual(1); expect(observed.sources.some((r) => r.source === 'instagram')).toBe(true);
  expect(posted.join('')).not.toContain('must-not-collect');
  const dir = process.env['ANALYTICS_QA_DIR']; if (dir) await writeFile(`${dir}/analytics-live-report.json`, JSON.stringify(observed, null, 2));
  const withdrawn = page.waitForResponse((r) => r.url().endsWith('/analytics/withdraw') && r.status() === 200);
  await page.getByRole('button', { name: '분석 거부', exact: true }).click(); await withdrawn;
  await expect.poll(async () => (await report()).summary.visitors).toBe(0);
  await expect(page.getByText('이 브라우저에서 분석을 거부했습니다')).toBeVisible(); await capture(page, 'analytics-withdrawn');
});

test('unavailable analytics never blocks signup input or exposes input text', async ({ page }) => {
  const errors: string[] = []; const sent: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (r) => { if (r.url().endsWith('/analytics/events')) sent.push(r.postData() ?? ''); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    localStorage.setItem('grabit-analytics-choice-v1', JSON.stringify({ version: 'analytics-v1', value: 'accepted', at: Date.now() }));
  });
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/analytics/config', (route) => fulfillJson(route, data.config));
  await page.route('**/api/v1/analytics/events', (route) => fulfillJson(route, { message: 'Synthetic outage' }, 503));
  const configured = page.waitForResponse((r) => r.url().endsWith('/analytics/config'));
  await page.goto('/auth'); await configured;
  await page.getByRole('tab', { name: '회원가입', exact: true }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const dispatchMs = await page.evaluate(() => {
    const anchor = document.createElement('a'); anchor.href = '/search'; anchor.addEventListener('click', (e) => e.preventDefault()); document.body.append(anchor);
    const started = performance.now(); for (let i = 0; i < 25; i++) anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const elapsed = performance.now() - started; anchor.remove(); return elapsed;
  });
  const email = page.getByRole('textbox').first(); await email.fill('analytics-qa@example.invalid'); await expect(email).toHaveValue('analytics-qa@example.invalid');
  expect(sent.length).toBeGreaterThan(0); expect(sent.join('')).not.toContain('analytics-qa@example.invalid'); expect(errors).toEqual([]);
  const dir = process.env['ANALYTICS_QA_DIR']; if (dir) await writeFile(`${dir}/analytics-failure-timing.json`, JSON.stringify({ syntheticLinkActions: 25, dispatchMs, inputResponsive: true, appErrors: errors.length }, null, 2));
});
