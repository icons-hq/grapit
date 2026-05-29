import { expect, test, devices, type Browser, type Page, type Route } from '@playwright/test';

const FLOOR_BROWSER_PERFORMANCE_ID = 'floor-browser';
const FLOOR_BROWSER_SHOWTIME_ID = 'showtime-floor-browser';
const SHOWTIME_ISO = '2026-07-18T19:00:00.000+09:00';
const SHOWTIME_DATE_LABEL = '2026년 7월 18일 토요일';
const LOCK_EXPIRES_AT = Date.now() + 8 * 60 * 1000;
const ADMITTED_QUEUE_SNAPSHOT = {
  queueSessionId: 'queue-floor-browser',
  state: 'ADMITTED',
  position: 0,
  waitingCount: 0,
  etaSeconds: 0,
  remainingSeats: 12,
  autoEnter: true,
  admittedAt: new Date().toISOString(),
  activeUntilAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  reentryGraceUntilAt: new Date(Date.now() + 7 * 60 * 1000).toISOString(),
};

const FIRST_FLOOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
  <text class="floor-title" x="200" y="28" text-anchor="middle">1층 맵</text>
  <g class="seat-cell">
    <rect data-seat-id="A-1" data-seat-key="2F:A-1" x="174" y="124" width="52" height="36" rx="4" fill="#E5E7EB" stroke="#CBD5E1" />
    <text class="seat-number" x="200" y="146" text-anchor="middle">1</text>
  </g>
  <rect class="seat seat-excluded" data-seat-id="A-99" x="290" y="124" width="52" height="36" rx="4" fill="#F4D03F" />
</svg>
`;

const SECOND_FLOOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 280">
  <text class="floor-title" x="200" y="28" text-anchor="middle">2층 맵</text>
  <g class="seat-cell">
    <rect data-seat-id="A-1" data-seat-key="3F:A-1" x="214" y="124" width="52" height="36" rx="4" fill="#E5E7EB" stroke="#CBD5E1" />
    <text class="seat-number" x="240" y="146" text-anchor="middle">1</text>
  </g>
  <rect data-seat-id="B-2" data-category="EXCLUDED" x="110" y="124" width="52" height="36" rx="4" fill="#F4D03F" />
</svg>
`;

function createFloorBrowserPerformanceDetail() {
  const firstFloorSeatMap = {
    id: 'seat-map-1f',
    performanceId: FLOOR_BROWSER_PERFORMANCE_ID,
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: '/seed/floor-browser-1f.svg',
    seatConfig: {
      tiers: [
        {
          tierName: 'VIP',
          color: '#6C3CE0',
          seatIds: ['A-1'],
        },
        {
          tierName: 'R',
          color: '#3B82F6',
          seatIds: ['B-1'],
        },
      ],
    },
    totalSeats: 2,
  };

  return {
    id: FLOOR_BROWSER_PERFORMANCE_ID,
    title: 'Floor Browser Fanmeet',
    genre: 'artist_celebrity' as const,
    subcategory: null,
    venueId: 'venue-floor-browser',
    posterUrl: null,
    description: 'seat hit target browser regression fixture',
    startDate: '2026-07-18T00:00:00.000+09:00',
    endDate: '2026-07-18T23:59:59.000+09:00',
    runtime: '120분',
    ageRating: '전체관람가',
    status: 'selling' as const,
    salesInfo: null,
    viewCount: 0,
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    venue: { id: 'venue-floor-browser', name: 'Floor Browser Hall', address: null },
    castings: [],
    showtimes: [
      {
        id: FLOOR_BROWSER_SHOWTIME_ID,
        performanceId: FLOOR_BROWSER_PERFORMANCE_ID,
        dateTime: SHOWTIME_ISO,
      },
    ],
    priceTiers: [
      {
        id: 'tier-vip',
        performanceId: FLOOR_BROWSER_PERFORMANCE_ID,
        tierName: 'VIP',
        price: 110000,
        sortOrder: 0,
      },
    ],
    seatMaps: [
      firstFloorSeatMap,
      {
        ...firstFloorSeatMap,
        id: 'seat-map-2f',
        floorKey: '2F',
        floorLabel: '2층',
        sortOrder: 1,
        svgUrl: '/seed/floor-browser-2f.svg',
      },
    ],
    bookingPolicy: {
      maxTicketsPerUser: 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap: firstFloorSeatMap,
  };
}

async function enableBooking(page: Page) {
  await page.route('**/api/runtime-flags', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bookingEnabled: true }),
    });
  });
}

async function mockAuthenticatedSession(page: Page) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'floor-browser-access-token' }),
    });
  });

  await page.route('**/api/v1/users/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'floor-browser-user',
        email: 'admin@grabit.test',
        name: 'Floor Browser Tester',
        role: 'user',
        phone: '010-1234-5678',
        isEmailVerified: true,
        isPhoneVerified: true,
      }),
    });
  });
}

async function stubFloorBrowserRoutes(
  page: Page,
  lockRequests: Array<{ seatId?: string }> = [],
  unlockRequests: Array<{ seatId?: string }> = [],
) {
  await enableBooking(page);
  await mockAuthenticatedSession(page);

  const performanceDetail = createFloorBrowserPerformanceDetail();
  const lockedSeatKeys = new Set<string>();

  await page.route(
    `**/api/v1/queue/performances/${FLOOR_BROWSER_PERFORMANCE_ID}/enter`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ADMITTED_QUEUE_SNAPSHOT),
      });
    },
  );

  await page.route('**/api/v1/queue/sessions/queue-floor-browser', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ADMITTED_QUEUE_SNAPSHOT),
    });
  });

  await page.route(
    `**/api/v1/performances/${FLOOR_BROWSER_PERFORMANCE_ID}?locale=*`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(performanceDetail),
      });
    },
  );

  await page.route(
    `**/api/v1/booking/schedules/${FLOOR_BROWSER_SHOWTIME_ID}/seats`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          showtimeId: FLOOR_BROWSER_SHOWTIME_ID,
          seats: {
            '1F:A-1': lockedSeatKeys.has('1F:A-1') ? 'locked' : 'available',
            '2F:A-1': lockedSeatKeys.has('2F:A-1') ? 'locked' : 'available',
          },
        }),
      });
    },
  );

  await page.route(
    `**/api/v1/booking/my-locks/${FLOOR_BROWSER_SHOWTIME_ID}`,
    async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ seatIds: [], expiresAt: null }),
      });
    },
  );

  await page.route('**/api/v1/booking/seats/lock', async (route: Route) => {
    const payload = JSON.parse(route.request().postData() ?? '{}') as {
      seatId?: string;
    };
    lockRequests.push(payload);
    const runtimeSeatId = payload.seatId ?? '1F:A-1';
    lockedSeatKeys.add(runtimeSeatId);
    const separatorIndex = runtimeSeatId.indexOf(':');
    const floorKey = separatorIndex > 0 ? runtimeSeatId.slice(0, separatorIndex) : '1F';
    const seatId = separatorIndex > 0 ? runtimeSeatId.slice(separatorIndex + 1) : runtimeSeatId;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        lockId: `lock-${runtimeSeatId}`,
        seatId,
        seatKey: runtimeSeatId,
        floorKey,
        floorLabel: floorKey === '2F' ? '2층' : '1층',
        expiresAt: LOCK_EXPIRES_AT,
      }),
    });
  });

  await page.route('**/api/v1/booking/seats/lock-all/**', async (route: Route) => {
    lockedSeatKeys.clear();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unlockedSeats: [] }),
    });
  });

  await page.route('**/api/v1/booking/seats/lock/**', async (route: Route) => {
    const pathSegments = new URL(route.request().url()).pathname.split('/');
    const seatId = decodeURIComponent(pathSegments.at(-1) ?? '');
    unlockRequests.push({ seatId });
    lockedSeatKeys.delete(seatId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route('**/seed/floor-browser-1f.svg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: FIRST_FLOOR_SVG,
    });
  });

  await page.route('**/seed/floor-browser-2f.svg', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: SECOND_FLOOR_SVG,
    });
  });
}

async function selectDateAndShowtime(page: Page) {
  const dateButton = page.getByRole('button', { name: SHOWTIME_DATE_LABEL });
  await expect(dateButton).toBeVisible({
    timeout: 10000,
  });
  await dateButton.click();
  await page.getByRole('button', { name: '19:00' }).click();
  await expect(page.getByRole('radio', { name: '1층' })).toBeVisible();
  await expect(
    page.getByRole('grid', { name: '좌석 배치도' }).getByText('1층 맵'),
  ).toBeVisible();
}

async function clickSeatLabelCenter(page: Page) {
  const seatMapGrid = page.getByRole('grid', { name: '좌석 배치도' });
  const seatLabel = page
    .getByRole('grid', { name: '좌석 배치도' })
    .locator('text.seat-number')
    .filter({ hasText: /^1$/ })
    .first();
  await expect(seatLabel).toBeVisible();
  const box = await seatLabel.boundingBox();
  const gridBox = await seatMapGrid.boundingBox();
  if (!box) {
    throw new Error('Seat label bounding box was not available');
  }
  if (!gridBox) {
    throw new Error('Seat map grid bounding box was not available');
  }

  await seatMapGrid.click({
    force: true,
    position: {
      x: box.x - gridBox.x + box.width / 2,
      y: box.y - gridBox.y + box.height / 2,
    },
  });
}

async function tapSeatLabelCenter(page: Page) {
  const seatMapGrid = page.getByRole('grid', { name: '좌석 배치도' });
  const seatLabel = page
    .getByRole('grid', { name: '좌석 배치도' })
    .locator('text.seat-number')
    .filter({ hasText: /^1$/ })
    .first();
  await expect(seatLabel).toBeVisible();
  const box = await seatLabel.boundingBox();
  const gridBox = await seatMapGrid.boundingBox();
  if (!box) {
    throw new Error('Seat label bounding box was not available');
  }
  if (!gridBox) {
    throw new Error('Seat map grid bounding box was not available');
  }

  const tapPosition = {
    x: box.x - gridBox.x + box.width / 2,
    y: box.y - gridBox.y + box.height / 2,
  };
  await seatMapGrid.click({
    force: true,
    position: tapPosition,
  });
}

function getNextButton(page: Page) {
  return page
    .locator('button')
    .filter({ hasText: /^(다음|좌석을 선택해주세요)$/ })
    .last();
}

async function assertTimerAndNextCta(page: Page) {
  await expect(page.getByLabel(/남은 시간 \d+분 \d+초/)).toBeVisible();
  await expect(getNextButton(page)).toBeEnabled();
}

async function assertPostSelectionState(page: Page) {
  const summary = page.getByRole('complementary');
  await expect(summary.getByText('VIP')).toBeVisible();
  await expect(summary.getByText('총 1석')).toBeVisible();
  await expect(summary.getByText('총 결제 금액')).toBeVisible();
  await expect(summary.getByText('112,000원')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '1층 A열 1번 선택 해제' }),
  ).toBeVisible();
  await assertTimerAndNextCta(page);
}

async function assertMobilePostSelectionState(page: Page) {
  const mobileSummary = page.getByRole('complementary', { name: '선택 좌석 요약' });
  await expect(mobileSummary.getByText('VIP')).toBeVisible();
  await expect(mobileSummary.getByText('총 1석')).toBeVisible();
  await expect(mobileSummary.getByText('총 결제 금액')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '1층 A열 1번 선택 해제' }),
  ).toBeVisible();
  await assertTimerAndNextCta(page);
}

async function clickExcludedSeat(page: Page, seatId: string) {
  const seatMapGrid = page.getByRole('grid', { name: '좌석 배치도' });
  const excludedSeat = seatMapGrid.locator(`[data-seat-id="${seatId}"]`);
  await expect(excludedSeat).toBeVisible();
  const box = await excludedSeat.boundingBox();
  const gridBox = await seatMapGrid.boundingBox();
  if (!box || !gridBox) {
    throw new Error('Excluded seat bounding box was not available');
  }

  await seatMapGrid.click({
    force: true,
    position: {
      x: box.x - gridBox.x + box.width / 2,
      y: box.y - gridBox.y + box.height / 2,
    },
  });
}

async function createMobilePage(browser: Browser) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
  });
  const page = await context.newPage();
  return { context, page };
}

test.describe('booking floor-browser seat selection', () => {
  test('desktop center click updates summary, timer, CTA, and preserves 1F selection across floor switches', async ({ page }) => {
    const lockRequests: Array<{ seatId?: string }> = [];
    const unlockRequests: Array<{ seatId?: string }> = [];
    await stubFloorBrowserRoutes(page, lockRequests, unlockRequests);

    await page.goto(`/booking/${FLOOR_BROWSER_PERFORMANCE_ID}`);
    await selectDateAndShowtime(page);
    await expect(getNextButton(page)).toBeDisabled();
    await clickExcludedSeat(page, 'A-99');
    await expect(getNextButton(page)).toBeDisabled();
    await clickSeatLabelCenter(page);
    expect(lockRequests[0]?.seatId).toBe('1F:A-1');
    await assertPostSelectionState(page);
    await clickSeatLabelCenter(page);
    await expect(page.getByRole('button', { name: '1층 A열 1번 선택 해제' })).toHaveCount(0);
    await expect(getNextButton(page)).toBeDisabled();
    expect(unlockRequests.at(-1)?.seatId).toBe('1F:A-1');

    await clickSeatLabelCenter(page);
    expect(lockRequests.at(-1)?.seatId).toBe('1F:A-1');
    await assertPostSelectionState(page);

    await page.getByRole('radio', { name: '2층' }).click();
    await expect(
      page.getByRole('grid', { name: '좌석 배치도' }).getByText('2층 맵'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '1층 A열 1번 선택 해제' })).toBeVisible();

    await page.getByRole('radio', { name: '1층' }).click();
    await expect(
      page.getByRole('grid', { name: '좌석 배치도' }).getByText('1층 맵'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '1층 A열 1번 선택 해제' })).toBeVisible();
    await expect(getNextButton(page)).toBeEnabled();
    await page.getByRole('button', { name: '전체 해제' }).click();
    await expect(page.getByRole('button', { name: '1층 A열 1번 선택 해제' })).toHaveCount(0);
    await expect(getNextButton(page)).toBeDisabled();

    await page.reload();
    await selectDateAndShowtime(page);
    await clickSeatLabelCenter(page);
    expect(lockRequests.at(-1)?.seatId).toBe('1F:A-1');
    await assertPostSelectionState(page);
    await page.getByRole('button', { name: '1층 A열 1번 선택 해제' }).click();
    await expect(page.getByRole('button', { name: '1층 A열 1번 선택 해제' })).toHaveCount(0);
    await expect(getNextButton(page)).toBeDisabled();
  });

  test('mobile-sized tap on the visible seat label center follows the same booking flow', async ({ browser }) => {
    const { context, page } = await createMobilePage(browser);

    try {
      await stubFloorBrowserRoutes(page);

      await page.goto(`/booking/${FLOOR_BROWSER_PERFORMANCE_ID}`);
      await selectDateAndShowtime(page);
      await tapSeatLabelCenter(page);
      await assertMobilePostSelectionState(page);
    } finally {
      await context.close().catch(() => {});
    }
  });
});
