import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { injectBookingFixture } from './fixtures/booking-store';

const PHASE26_M1_PERFORMANCE_ID =
  process.env['PHASE26_M1_SMOKE_PERFORMANCE_ID'] ??
  '00000000-0000-4000-8000-000000000026';
const PHASE26_M1_SHOWTIME_ID =
  process.env['PHASE26_M1_SMOKE_SHOWTIME_ID'] ??
  '00000000-0000-4000-8000-000000026001';
const BOOKING_DISABLED_COPY = '예매는 추후 오픈 예정입니다';
const QUEUE_SESSION_ID = 'phase26-m1-queue-session';
const EXPECTED_ACTIVE_LOCALES = ['ko', 'en', 'th', 'zh-CN'];

const sharedLocalesSource = readFileSync(
  new URL('../../../packages/shared/src/constants/locales.ts', import.meta.url),
  'utf8',
);
const runtimeFlagsSource = readFileSync(
  new URL('../lib/runtime-flags.ts', import.meta.url),
  'utf8',
);
const healthControllerSource = readFileSync(
  new URL('../../../apps/api/src/health/health.controller.ts', import.meta.url),
  'utf8',
);
const gateLedger = JSON.parse(
  readFileSync(
    new URL(
      '../../../.planning/phases/26-m1-canary-cutover-gates/26-GATE-LEDGER.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  gates: Array<{
    gateId: string;
    state: string;
    failureReason?: string;
    sourceDecisions?: string[];
    rollbackOrCloseTrigger?: string;
  }>;
};

test.describe('Phase 26 M1 direct deploy smoke', () => {
  test('asserts source-of-truth health and M1_LOCALE_SCOPE gate state', () => {
    const activeLocales = extractArrayLiteral(
      sharedLocalesSource,
      'SUPPORTED_LOCALES',
    );
    const runtimeLocales = extractArrayLiteral(
      runtimeFlagsSource,
      'RUNTIME_LOCALES',
    );
    const localeGate = findGate('M1_LOCALE_SCOPE');

    expect(activeLocales).toEqual(EXPECTED_ACTIVE_LOCALES);
    expect(runtimeLocales).toEqual(EXPECTED_ACTIVE_LOCALES);
    expect(localeGate.state, 'M1_LOCALE_SCOPE cannot be silently PASS').not.toBe(
      'PASS',
    );
    expect(localeGate.failureReason).toMatch(/locale|five-locale|code/i);
    expect(localeGate.sourceDecisions).toEqual(
      expect.arrayContaining(['D-05', 'D-06']),
    );

    expect(healthControllerSource).toContain('@Public()');
    expect(healthControllerSource).toContain('@SkipThrottle()');
    expect(healthControllerSource).toContain('@HealthCheck()');
    expect(healthControllerSource).toContain('@Get()');
  });

  test('covers auth/session, public detail, booking-disabled, and payment-safe blocked path', async ({
    page,
  }) => {
    const browserProblems = collectBrowserProblems(page);
    const authSession = await mockAuthenticatedSession(page);
    const forbiddenSideEffects = collectForbiddenSideEffects(page);
    await mockPerformanceDetail(page);
    await blockDisabledBookingMutations(page);

    const flagsResponse = await page.request.get('/api/runtime-flags');
    expect(flagsResponse.ok()).toBe(true);
    expect(await flagsResponse.json()).toEqual(
      expect.objectContaining({ bookingEnabled: false }),
    );

    const detailResponse = await gotoSmokeRoute(
      page,
      `/performance/${PHASE26_M1_PERFORMANCE_ID}`,
    );
    expect(detailResponse?.status()).toBeLessThan(500);
    await expect(
      page.getByRole('heading', { name: 'Phase 26 M1 Smoke Event' }),
    ).toBeVisible();
    await expect(page.getByText('상세정보').first()).toBeVisible();
    await expect(page.getByText(BOOKING_DISABLED_COPY).first()).toBeVisible();
    await expect(page.getByRole('link', { name: '예매하기' })).toHaveCount(0);
    expect(authSession.refreshSeen).toBe(true);
    expect(authSession.usersMeSeen).toBe(true);

    await injectBookingFixture(page, {
      performanceId: PHASE26_M1_PERFORMANCE_ID,
      showtimeId: PHASE26_M1_SHOWTIME_ID,
      seats: [
        {
          seatId: 'A-1',
          tierName: 'VIP',
          price: 50000,
          row: 'A',
          number: '1',
          floorKey: '1F',
          floorLabel: '1층',
          seatKey: '1F:A-1',
        },
      ],
      performanceTitle: 'Phase 26 M1 Smoke Event',
      showDateTime: new Date(Date.now() + 86_400_000).toISOString(),
      venue: 'Phase 26 Smoke Venue',
    });
    await gotoSmokeRoute(
      page,
      `/booking/${PHASE26_M1_PERFORMANCE_ID}/confirm`,
    );
    await expect(
      page.getByRole('button', { name: BOOKING_DISABLED_COPY }).first(),
    ).toBeDisabled();

    await page.waitForTimeout(250);
    expect(forbiddenSideEffects).toEqual([]);
    expect(browserProblems).toEqual([]);
  });

  test('covers queue entry smoke without exercising payment side effects', async ({
    page,
  }) => {
    const browserProblems = collectBrowserProblems(page);
    await mockRuntimeFlags(page, true);
    await mockAnonymousSession(page);
    await mockQueueEntry(page);

    await gotoSmokeRoute(page, `/booking/${PHASE26_M1_PERFORMANCE_ID}`);

    await expect(
      page.getByRole('heading', {
        name: '예매 대기열에서 입장 순서를 기다리고 있습니다',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('queue-metric-position')).toContainText('7');
    await expect(page.getByTestId('queue-metric-remaining-seats')).toContainText(
      '120',
    );

    await page.waitForTimeout(250);
    expect(browserProblems).toEqual([]);
  });
});

function extractArrayLiteral(source: string, name: string): string[] {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[(?<items>[^\\]]+)\\]`));
  expect(match?.groups?.items, `${name} source literal`).toBeTruthy();
  return match!.groups!.items
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function findGate(gateId: string) {
  const gate = gateLedger.gates.find((entry) => entry.gateId === gateId);
  expect(gate, `${gateId} gate`).toBeTruthy();
  return gate!;
}

async function gotoSmokeRoute(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response, `No response for ${path}`).not.toBeNull();
  expect(response?.status(), path).toBeLessThan(500);
  expect(new URL(page.url()).pathname).toBe(path);
  await expect(
    page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' }),
  ).toHaveCount(0);
  return response;
}

async function mockAuthenticatedSession(page: Page) {
  const state = {
    refreshSeen: false,
    usersMeSeen: false,
  };

  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    state.refreshSeen = true;
    await fulfillJson(route, 200, { accessToken: 'phase26-m1-access-token' });
  });
  await page.route('**/api/v1/users/me', async (route: Route) => {
    state.usersMeSeen = true;
    await fulfillJson(route, 200, {
      id: 'phase26-m1-user',
      email: 'phase26-m1-user@example.test',
      name: 'Phase26 M1 User',
      phone: '+821012345678',
      gender: 'unspecified',
      country: 'KR',
      birthDate: '1990-01-01',
      preferredLocale: 'ko',
      isEmailVerified: true,
      isPhoneVerified: true,
      marketingConsent: false,
      role: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    });
  });

  return state;
}

async function mockAnonymousSession(page: Page) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
  });
}

async function mockRuntimeFlags(page: Page, bookingEnabled: boolean) {
  await page.route('**/api/runtime-flags', async (route: Route) => {
    await fulfillJson(route, 200, { bookingEnabled });
  });
}

async function mockPerformanceDetail(page: Page) {
  await page.route(
    `**/api/v1/performances/${PHASE26_M1_PERFORMANCE_ID}?**`,
    async (route: Route) => {
      await fulfillJson(route, 200, createPerformanceDetail());
    },
  );
}

async function mockQueueEntry(page: Page) {
  await page.route(
    `**/api/v1/queue/performances/${PHASE26_M1_PERFORMANCE_ID}/enter`,
    async (route: Route) => {
      await fulfillJson(route, 200, {
        queueSessionId: QUEUE_SESSION_ID,
      });
    },
  );
  await page.route(
    `**/api/v1/queue/sessions/${QUEUE_SESSION_ID}`,
    async (route: Route) => {
      await fulfillJson(route, 200, {
        queueSessionId: QUEUE_SESSION_ID,
        state: 'WAITING',
        position: 7,
        waitingCount: 49,
        etaSeconds: 185,
        remainingSeats: 120,
        autoEnter: false,
        admittedAt: null,
        activeUntilAt: null,
        reentryGraceUntilAt: null,
      });
    },
  );
}

async function blockDisabledBookingMutations(page: Page) {
  const blockedPatterns = [
    '**/api/v1/queue/performances/**/enter',
    '**/api/v1/booking/seats/lock',
    '**/api/v1/reservations/prepare',
    '**/api/v1/payments/branch',
    '**/api/v1/payments/confirm',
  ];
  for (const pattern of blockedPatterns) {
    await page.route(pattern, async (route: Route) => {
      await fulfillJson(route, 500, {
        message: `Unexpected disabled-booking side effect: ${route.request().method()} ${route.request().url()}`,
      });
    });
  }
}

function collectForbiddenSideEffects(page: Page) {
  const requests: string[] = [];
  page.on('request', (request: Request) => {
    const method = request.method();
    const url = request.url();
    const isForbidden =
      (method !== 'GET' && /\/api\/v1\/queue\/performances\/.+\/enter/.test(url)) ||
      (method !== 'GET' && /\/api\/v1\/booking\/seats\/lock/.test(url)) ||
      (method !== 'GET' && /\/api\/v1\/reservations\/prepare/.test(url)) ||
      (method !== 'GET' && /\/api\/v1\/payments\/branch/.test(url)) ||
      (method !== 'GET' && /\/api\/v1\/payments\/confirm/.test(url)) ||
      /tosspayments/i.test(url);

    if (isForbidden) {
      requests.push(`${method} ${url}`);
    }
  });
  return requests;
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

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function createPerformanceDetail() {
  const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 8 * 86_400_000).toISOString();

  return {
    id: PHASE26_M1_PERFORMANCE_ID,
    title: 'Phase 26 M1 Smoke Event',
    genre: 'artist_celebrity',
    subcategory: null,
    venueId: 'phase26-m1-venue',
    posterUrl: null,
    description: 'Phase 26 M1 direct deploy smoke fixture.',
    descriptionVisible: true,
    startDate: startsAt,
    endDate: endsAt,
    runtime: '90분',
    ageRating: '전체 관람가',
    status: 'selling',
    publishState: 'published',
    publishReviewRequestedAt: null,
    publishReadyAt: null,
    publishedAt: '2026-05-20T00:00:00.000Z',
    publishedByUserId: null,
    salesInfo: 'Phase 26 M1 smoke sales info.',
    salesInfoVisible: true,
    detailImages: [],
    viewCount: 1,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    automaticTranslationLabel: false,
    translatedBy: null,
    venue: {
      id: 'phase26-m1-venue',
      name: 'Phase 26 Smoke Venue',
      address: 'Seoul',
      accessNotes: null,
      transportSummary: null,
    },
    priceTiers: [
      {
        id: 'phase26-m1-vip',
        performanceId: PHASE26_M1_PERFORMANCE_ID,
        tierName: 'VIP',
        price: 50000,
        currency: 'KRW',
        color: '#6C3CE0',
        sortOrder: 1,
      },
    ],
    showtimes: [
      {
        id: PHASE26_M1_SHOWTIME_ID,
        performanceId: PHASE26_M1_PERFORMANCE_ID,
        startsAt,
        endsAt,
        sortOrder: 1,
        isActive: true,
      },
    ],
    castings: [],
    seatMaps: [],
    seatMap: null,
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
    },
  };
}
