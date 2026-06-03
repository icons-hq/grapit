import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Response } from '@playwright/test';

const koMessages = JSON.parse(
  readFileSync(new URL('../messages/ko.json', import.meta.url), 'utf8'),
) as {
  home: {
    hot: string;
  };
};

const PHASE23_I18N_SMOKE_PERFORMANCE_ID =
  process.env['PHASE23_I18N_SMOKE_PERFORMANCE_ID'] ??
  '00000000-0000-4000-8000-000000000023';

const localeCases = [
  {
    locale: 'ko',
    prefix: '',
    nativeName: '한국어',
    searchQuery: '걸룰스',
    homeCopy: koMessages.home.hot,
    searchCopy: "'걸룰스' 검색 결과",
    resultTitle: '2026 걸룰스 팬미팅',
    authCopy: '로그인',
    detailCopy: '상세정보',
    supportCopy: '고객센터',
    bookingDisabledCopy: '예매는 추후 오픈 예정입니다',
    expectsTranslationLabel: false,
  },
  {
    locale: 'en',
    prefix: '/en',
    nativeName: 'English',
    searchQuery: 'girl',
    homeCopy: 'HOT',
    searchCopy: "Results for 'girl'",
    resultTitle: '2026 Girl Rules Fanmeeting',
    authCopy: 'Login',
    detailCopy: 'Details',
    supportCopy: 'Support',
    bookingDisabledCopy: 'Ticket booking will open later',
    expectsTranslationLabel: true,
  },
  {
    locale: 'th',
    prefix: '/th',
    nativeName: 'ไทย',
    searchQuery: 'girl',
    homeCopy: 'การแสดงยอดนิยม',
    searchCopy: "ผลการค้นหา 'girl'",
    resultTitle: 'แฟนมีตติ้ง Girl Rules 2026',
    authCopy: 'เข้าสู่ระบบ',
    detailCopy: 'รายละเอียด',
    supportCopy: 'ศูนย์ช่วยเหลือ',
    bookingDisabledCopy: 'การจองบัตรจะเปิดให้บริการในภายหลัง',
    expectsTranslationLabel: true,
  },
  {
    locale: 'zh-CN',
    prefix: '/zh-CN',
    nativeName: '简体中文',
    searchQuery: 'girl',
    homeCopy: '热门演出',
    searchCopy: "'girl' 的搜索结果",
    resultTitle: '2026 Girl Rules 粉丝见面会',
    authCopy: '登录',
    detailCopy: '详细信息',
    supportCopy: '客户支持',
    bookingDisabledCopy: '门票预订将于稍后开放',
    expectsTranslationLabel: true,
  },
] as const;

test.describe('Phase 23 i18n canary smoke', () => {
  test('covers launch locale routes, translated performance detail, and booking-disabled guard', async ({
    page,
  }) => {
    await neutralizeSessionRefresh(page);
    const browserProblems = collectBrowserProblems(page);
    const forbiddenSideEffects = collectForbiddenBookingSideEffects(page);

    const flagsResponse = await page.request.get('/api/runtime-flags');
    expect(flagsResponse.ok()).toBe(true);
    expect(await flagsResponse.json()).toEqual(
      expect.objectContaining({ bookingEnabled: false }),
    );

    for (const localeCase of localeCases) {
      const homeResponse = await gotoSmokeRoute(page, localeCase.prefix || '/');
      assertKoreanRewriteHeader(localeCase.prefix, homeResponse);
      await expect(
        page.getByRole('heading', { name: localeCase.homeCopy }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: new RegExp(localeCase.nativeName),
        }),
      ).toBeVisible();

      const authResponse = await gotoSmokeRoute(
        page,
        withLocalePrefix(localeCase.prefix, '/auth'),
      );
      assertKoreanRewriteHeader(localeCase.prefix, authResponse);
      await expect(
        page.getByRole('tab', { name: localeCase.authCopy }),
      ).toBeVisible();

      const searchResponse = await gotoSmokeRoute(
        page,
        withLocalePrefix(
          localeCase.prefix,
          `/search?q=${encodeURIComponent(localeCase.searchQuery)}`,
        ),
      );
      assertKoreanRewriteHeader(localeCase.prefix, searchResponse);
      await expect(page.getByText(localeCase.searchCopy)).toBeVisible();
      await expect(page.getByText(localeCase.resultTitle).first()).toBeVisible();

      const supportResponse = await gotoSmokeRoute(
        page,
        withLocalePrefix(localeCase.prefix, '/support'),
      );
      assertKoreanRewriteHeader(localeCase.prefix, supportResponse);
      await expect(
        page.getByRole('heading', { level: 1, name: localeCase.supportCopy }),
      ).toBeVisible();

      const performanceResponse = await gotoSmokeRoute(
        page,
        withLocalePrefix(
          localeCase.prefix,
          `/performance/${PHASE23_I18N_SMOKE_PERFORMANCE_ID}`,
        ),
      );
      assertKoreanRewriteHeader(localeCase.prefix, performanceResponse);
      await expect(page.getByText(localeCase.detailCopy)).toBeVisible();
      if (localeCase.expectsTranslationLabel) {
        await expect(
          page.getByText('Reviewed machine translation').first(),
        ).toBeVisible();
      } else {
        await expect(
          page.getByText('Reviewed machine translation'),
        ).toHaveCount(0);
      }

      const bookingResponse = await gotoSmokeRoute(
        page,
        withLocalePrefix(
          localeCase.prefix,
          `/booking/${PHASE23_I18N_SMOKE_PERFORMANCE_ID}`,
        ),
      );
      assertKoreanRewriteHeader(localeCase.prefix, bookingResponse);
      await expect(
        page.getByText(localeCase.bookingDisabledCopy).first(),
      ).toBeVisible();
      await expect(page).toHaveURL(
        new RegExp(`${localeCase.prefix || ''}/booking/`),
      );
    }

    await page.waitForTimeout(250);
    expect(forbiddenSideEffects).toEqual([]);
    expect(browserProblems).toEqual([]);
  });
});

async function gotoSmokeRoute(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `No response for ${path}`).not.toBeNull();
  expect(response?.status(), path).toBeLessThan(500);
  expect(new URL(page.url()).pathname).toBe(path.split('?')[0] || '/');
  await expect(
    page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' }),
  ).toHaveCount(0);
  return response;
}

function withLocalePrefix(prefix: string, path: string) {
  if (!prefix) return path;
  return `${prefix}${path}`;
}

function assertKoreanRewriteHeader(prefix: string, response: Response | null) {
  const rewriteHeader =
    response?.headers()['x-middleware-rewrite'] ??
    response?.headers()['x-nextjs-rewrite'] ??
    '';
  if (!prefix) {
    expect(rewriteHeader).not.toMatch(/\/ko(?:\/|$)/);
  }
}

function collectBrowserProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      message.type() === 'error' ||
      /hydration|hydration failed|did not match/i.test(text)
    ) {
      problems.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

async function neutralizeSessionRefresh(page: Page) {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
}

function collectForbiddenBookingSideEffects(page: Page) {
  const requests: string[] = [];
  page.on('request', (request) => {
    const method = request.method();
    const url = request.url();
    const isForbidden =
      /\/api\/v1\/bookings?\//.test(url) ||
      (method !== 'GET' && /\/api\/v1\/booking\/seats\/lock/.test(url)) ||
      (method !== 'GET' && /\/api\/v1\/reservations\//.test(url)) ||
      /\/api\/v1\/reservations\/prepare/.test(url) ||
      /\/api\/v1\/payments\/confirm/.test(url) ||
      /tosspayments/i.test(url);

    if (isForbidden) {
      requests.push(`${method} ${url}`);
    }
  });
  return requests;
}
