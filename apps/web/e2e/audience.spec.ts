import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

const memberId = '00000000-0000-4000-8000-000000009002';
const artistId = '00000000-0000-4000-8000-000000008001';
const activityId = '00000000-0000-4000-8000-000000008002';
const performanceId = '00000000-0000-4000-8000-000000009001';
const api = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:8184';
const tags = [
  { id: artistId, slug: 'namtanfilm', kind: 'artist', labels: { ko: 'NAMTANFILM', en: 'NAMTANFILM' }, active: true },
  { id: activityId, slug: 'collecting-merch', kind: 'activity', labels: { ko: '굿즈·포토카드 수집', en: 'Merch collecting' }, active: true },
];
async function capture(page: Page, name: string) {
  const dir = process.env['ANALYTICS_QA_DIR']; if (!dir) return;
  await mkdir(dir, { recursive: true }); await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}
async function memberAuth(page: Page) {
  await page.route('**/api/v1/auth/refresh', (route) => fulfillJson(route, { accessToken: 'customer-e2e-token' }));
  await page.route('**/api/v1/users/me', (route) => fulfillJson(route, { id: memberId, email: 'member@test.invalid', name: '검증 회원', role: 'user', phone: '+821000000002', gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko', isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, createdAt: new Date().toISOString() }));
}
async function unrelatedConfig(page: Page) {
  await page.route('**/api/runtime-flags', (route) => fulfillJson(route, { bookingEnabled: true, serverTime: Date.now() }));
  await page.route('**/api/v1/analytics/config', (route) => fulfillJson(route, { enabled: false, aggregateEnabled: false, environmentEnabled: false, noticeVersion: 'analytics-v2-replay', rawRetentionDays: 90 }));
  await page.route('**/api/v1/admin/performances?**', (route) => fulfillJson(route, { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }));
}

test('member saves and withdraws preferences through real local API/DB and administrator sees the profile', async ({ page, request, browser }) => {
  test.setTimeout(90000);
  test.skip(process.env['ANALYTICS_LIVE_API'] !== 'true', 'Requires the isolated PostgreSQL/Valkey test harness.');
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await memberAuth(page); await unrelatedConfig(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/mypage/interests');
  await expect(page.getByText('나의 관심 취향', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '동의하고 저장', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'NAMTANFILM', exact: true }).click();
  await page.getByRole('button', { name: '굿즈·포토카드 수집', exact: true }).click();
  await page.getByRole('checkbox', { name: '선택한 취향의 수집·이용에 동의합니다. (선택)', exact: true }).check();
  await page.getByRole('checkbox', { name: '동의 이후의 공연 조회·찜·예매 기록으로 관심 분석을 보완합니다. (선택)', exact: true }).check();
  await page.getByRole('button', { name: '동의하고 저장', exact: true }).click();
  await expect(page.getByText('취향을 저장했어요.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0)); await capture(page, 'audience-preferences-mobile');
  const profile = await request.get(`${api}/api/v1/admin/analytics/audience/profiles/${memberId}`, { headers: { Authorization: 'Bearer admin-e2e-access-token' } });
  expect(profile.ok()).toBe(true); const body = await profile.json(); expect(body.tagIds).toHaveLength(2); expect(body.behaviorSince).toBeTruthy(); expect(body.marketingConsent).toBe(false);
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await mockAdminAuth(admin); await unrelatedConfig(admin); await admin.goto(new URL('/admin/audience', page.url()).href);
  await expect(admin.getByRole('heading', { name: '관심 고객·마케팅', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: '검증 회원', exact: true }).click();
  await expect(admin.getByText('검증 회원님의 관심 근거', { exact: true })).toBeVisible();
  await expect(admin.getByText('행동으로 판단할 근거가 없습니다', { exact: true })).toBeVisible();
  await capture(admin, 'audience-real-profile-desktop');
  await page.getByRole('button', { name: '취향 동의 철회·삭제', exact: true }).click();
  await expect(page.getByText('취향과 관심 프로필을 삭제했어요.', { exact: true })).toBeVisible();
  expect((await request.get(`${api}/api/v1/admin/analytics/audience/profiles/${memberId}`, { headers: { Authorization: 'Bearer admin-e2e-access-token' } })).status()).toBe(404);
  await admin.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(admin.getByText('조건에 맞는 프로필이 없습니다', { exact: true })).toBeVisible();
  expect(errors).toEqual([]); await admin.close();
});

test('admin compares creatives, creates a tag and renders GA4 threshold metadata on desktop/mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await mockAdminAuth(page); await unrelatedConfig(page);
  let localTags = [...tags]; let savedTag: unknown = null;
  const updatedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString();
  const person = { userId: memberId, name: '검증 회원', email: 'member@test.invalid', tagIds: [artistId, activityId], marketingConsent: true, updatedAt, expiresAt, behaviorSince: updatedAt };
  await page.route('**/api/v1/analytics/audience/ga4-config', (route) => fulfillJson(route, { enabled: false, measurementId: null, noticeVersion: 'google-interests-v2', transferCountries: [] }));
  await page.route('**/api/v1/admin/analytics/audience/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tags')) {
      if (route.request().method() === 'POST') { savedTag = route.request().postDataJSON(); localTags = [...localTags, { ...route.request().postDataJSON(), id: '00000000-0000-4000-8000-000000008003' }]; }
      return fulfillJson(route, localTags);
    }
    if (path.endsWith('/overview')) return fulfillJson(route, { activeProfiles: 28, behaviorProfiles: 18, marketingProfiles: 21, segments: [{ tagId: artistId, members: 24, marketingMembers: 19 }, { tagId: activityId, members: 12, marketingMembers: 9 }] });
    if (path.endsWith(`/profiles/${memberId}`)) return fulfillJson(route, { ...person, purchaseStage: 'saved', observedSince: updatedAt, inferred: [{ tagId: artistId, level: 'high', viewDays: 3, favorites: 1, checkouts: 0, purchases: 0, lastAt: updatedAt }] });
    if (path.endsWith('/profiles')) return fulfillJson(route, { rows: [person], total: 1, pageSize: 25 });
    if (path.endsWith('/performances')) return fulfillJson(route, [{ id: performanceId, title: 'NAMTANFILM Fan Meeting in Seoul', publishState: 'published', genre: 'artist_celebrity', tagIds: [artistId] }]);
    if (path.endsWith('/creatives')) return fulfillJson(route, { since: updatedAt, until: updatedAt, generatedAt: updatedAt, totalGroups: 2, rows: [
      { source: 'instagram', medium: 'social', campaign: 'namtanfilm', content: 'artist-photo', sessions: 100, visitors: 80, signupSessions: 18, favoriteSessions: 21, checkoutSessions: 10, paidSessions: 8, paidOrders: 9, signupRate: 18, favoriteRate: 21, paymentRate: 8 },
      { source: 'instagram', medium: 'social', campaign: 'namtanfilm', content: 'photo-benefit', sessions: 90, visitors: 74, signupSessions: 20, favoriteSessions: 25, checkoutSessions: 14, paidSessions: 11, paidOrders: 11, signupRate: 22.2, favoriteRate: 27.8, paymentRate: 12.2 },
    ] });
    if (path.endsWith('/ga4')) return fulfillJson(route, { state: 'ready', propertyId: '123456', startDate: '2026-11-06', endDate: '2026-11-12', fetchedAt: updatedAt, cached: true, subjectToThresholding: true, dataLossFromOtherRow: false, sampled: false, emptyReason: null, timeZone: 'Asia/Seoul', rowCount: 2, rows: [{ interest: 'Arts & Entertainment', activeUsers: 100 }, { interest: 'Travel', activeUsers: 60 }] });
    return fulfillJson(route, { tagIds: [artistId] });
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/admin/audience');
  await expect(page.getByRole('heading', { name: '관심 고객·마케팅' })).toBeVisible();
  await expect(page.getByRole('group', { name: '활성 관심 프로필', exact: true })).toContainText('28명');
  await page.getByRole('button', { name: '검증 회원', exact: true }).click(); await expect(page.getByText('조회 3일 · 현재 찜 1건', { exact: false })).toBeVisible(); await capture(page, 'audience-dashboard-desktop');
  await page.getByRole('tab', { name: '홍보 소재 성과' }).click();
  await page.getByLabel('소재 코드 (content)').fill('new-poster'); await page.getByRole('button', { name: '홍보 링크 만들기' }).click();
  await expect(page.getByLabel('완성된 홍보 링크')).toHaveValue(/utm_content=new-poster/);
  await expect(page.getByRole('cell', { name: '11 · 12.2%', exact: true })).toBeVisible();
  await page.getByText('소재별 방문 → 전환', { exact: true }).scrollIntoViewIfNeeded(); await capture(page, 'audience-creatives-desktop');
  await page.getByRole('tab', { name: '관심 태그 관리' }).click();
  await page.getByLabel('태그 코드', { exact: true }).fill('test-artist'); await page.getByLabel('한국어 이름').fill('검증 아티스트'); await page.getByLabel('영어 이름').fill('Test artist'); await page.getByRole('button', { name: '태그 추가', exact: true }).click();
  await expect.poll(() => savedTag).toMatchObject({ slug: 'test-artist', kind: 'artist', labels: { ko: '검증 아티스트' } }); await expect(page.getByRole('cell', { name: '검증 아티스트', exact: true })).toBeVisible();
  await expect(page.getByText('태그를 저장했습니다.', { exact: true })).not.toBeVisible({ timeout: 10000 });
  await page.getByRole('tab', { name: 'GA4 관심사', exact: true }).click(); await expect(page.getByText('개인정보 보호 임계값 적용 대상', { exact: true })).toBeVisible(); await expect(page.getByRole('cell', { name: 'Arts & Entertainment', exact: true })).toBeVisible(); await capture(page, 'audience-ga4-desktop');
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, 'audience-mobile-overview');
  await page.getByText('Google이 제공한 집계 관심사', { exact: true }).scrollIntoViewIfNeeded(); await capture(page, 'audience-ga4-mobile');
  await page.getByRole('tab', { name: '홍보 소재 성과' }).click(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, 'audience-creatives-mobile');
  expect(errors).toEqual([]);
});

test('Google tag stays blocked before consent and after withdrawal; vendor transport is intercepted', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const vendorPath = process.env['GA4_VENDOR_SCRIPT'];
  const measurementId = process.env['GA4_VENDOR_MEASUREMENT_ID'] ?? 'G-TESTABCD';
  const vendorScript = vendorPath ? await readFile(vendorPath, 'utf8') : '/* local QA stub: no Google requests */';
  const googlePayloads: string[] = [];
  await unrelatedConfig(page); await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/analytics/audience/ga4-config', (route) => fulfillJson(route, { enabled: true, measurementId, noticeVersion: 'google-interests-v2', transferCountries: ['US'] }));
  let scripts = 0;
  await page.route('https://www.googletagmanager.com/**', (route) => { scripts++; return route.fulfill({ contentType: 'application/javascript', body: vendorScript }); });
  // Includes the current primary analytics.google.com collector and signal joins.
  // Never send QA page data to Google, even when running the actual vendor code.
  await page.route(/^https:\/\/(?:[a-z0-9-]+\.)*(?:google-analytics\.com|doubleclick\.net|google\.(?:com|co\.kr)|googleadservices\.com|googlesyndication\.com|gstatic\.com)\//, (route) => {
    googlePayloads.push(`${route.request().url()}\n${route.request().postData() ?? ''}`);
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': new URL(page.url()).origin, 'access-control-allow-credentials': 'true' } });
  });
  await page.route('**/api/v1/performances?**', (route) => fulfillJson(route, { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }));
  await page.route('**/api/v1/venues', (route) => fulfillJson(route, []));
  await page.goto('/legal/analytics'); const google = page.locator('#google');
  await expect(google.getByRole('button', { name: '선택 항목 동의' })).toBeDisabled(); expect(scripts).toBe(0);
  await google.getByRole('checkbox', { name: 'Google 관심사 분석 수집·이용 동의 (선택)', exact: true }).check();
  await google.getByRole('checkbox', { name: 'Google 국외 이전 동의 (선택)', exact: true }).check();
  await google.getByRole('checkbox', { name: '만 18세 이상입니다.', exact: true }).check();
  await google.getByRole('button', { name: '선택 항목 동의' }).click(); expect(scripts).toBe(0);
  await page.goto('/categories?utm_source=instagram&token=should-not-send'); await expect.poll(() => scripts).toBe(1);
  const layer = await page.evaluate(() => JSON.stringify((window as Window & { dataLayer?: unknown[] }).dataLayer)); expect(layer).not.toContain('should-not-send');
  if (vendorPath) {
    await expect.poll(() => googlePayloads.some((payload) => payload.includes('/g/collect') && payload.includes('en=page_view'))).toBe(true);
    expect(googlePayloads.join('\n')).not.toContain('should-not-send');
  }
  await page.goto('/legal/analytics'); await page.locator('#google').getByRole('button', { name: '철회·수집 중단' }).click();
  const afterWithdrawal = googlePayloads.length;
  await page.goto('/categories'); await expect(page.getByRole('main')).toBeVisible(); expect(scripts).toBe(1);
  expect(googlePayloads).toHaveLength(afterWithdrawal);
  expect(errors).toEqual([]);
});
