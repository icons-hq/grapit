import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

const koMessages = JSON.parse(
  readFileSync(new URL('../messages/ko.json', import.meta.url), 'utf8'),
) as {
  booking: {
    queue: {
      metrics: {
        position: string;
        eta: string;
        remainingSeats: string;
        soon: string;
        etaRange: string;
        etaWithin: string;
        opensIn: string;
      };
      notFound: { title: string };
      openTimeUnknownInfo: string;
      backAction: string;
      status: {
        notOpen: { title: string };
        waiting: { title: string };
        closed: { title: string };
        retry: { title: string };
        challenge: { title: string };
        blocked: { title: string };
      };
    };
  };
};

const waitingSnapshot = {
  queueSessionId: 'queue-session-waiting',
  state: 'WAITING',
  // Second admission cycle for 24 seats: at most 2 x 800s at the current
  // remaining seats. A slot has no minimum hold, so the lower bound is 0.
  position: 30,
  waitingCount: 48,
  etaSeconds: 1_600,
  etaMinSeconds: 0,
  etaUnavailable: false,
  remainingSeats: 24,
  autoEnter: false,
  admittedAt: null,
  activeUntilAt: null,
  reentryGraceUntilAt: null,
};

const queuePerformanceId = '00000000-0000-4000-8000-000000000023';
const queueMetricTestIds = {
  position: 'queue-metric-position',
  eta: 'queue-metric-eta',
  remainingSeats: 'queue-metric-remaining-seats',
} as const;

const failureCases = [
  {
    name: 'retry',
    status: 429,
    message: 'TRAFFIC_RATE_LIMITED',
    expectedHeading: koMessages.booking.queue.status.retry.title,
  },
  {
    name: 'challenge',
    status: 403,
    message: 'SECURITY_CHALLENGE_REQUIRED',
    expectedHeading: koMessages.booking.queue.status.challenge.title,
  },
  {
    name: 'blocked',
    status: 403,
    message: 'SECURITY_BLOCKED',
    expectedHeading: koMessages.booking.queue.status.blocked.title,
  },
] as const;

test.describe('booking queue route', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedSession(page);
    await enableBooking(page);
  });

  test('queue waiting shows localized position and ETA before entering the booking screen', async ({
    page,
  }) => {
    await page.route(
      '**/api/v1/queue/performances/**/enter',
      async (route: Route) => {
        await fulfillJson(route, 200, {
          queueSessionId: waitingSnapshot.queueSessionId,
        });
      },
    );
    await page.route(
      `**/api/v1/queue/sessions/${waitingSnapshot.queueSessionId}`,
      async (route: Route) => {
        await fulfillJson(route, 200, waitingSnapshot);
      },
    );

    await page.goto(`/booking/${queuePerformanceId}`);
    const positionMetric = page.getByTestId(queueMetricTestIds.position);
    const etaMetric = page.getByTestId(queueMetricTestIds.eta);
    const remainingSeatsMetric = page.getByTestId(
      queueMetricTestIds.remainingSeats,
    );

    await expect(
      page.getByRole('heading', {
        name: koMessages.booking.queue.status.waiting.title,
      }),
    ).toBeVisible();
    await expect(positionMetric).toContainText(
      koMessages.booking.queue.metrics.position,
    );
    await expect(positionMetric).toContainText(
      waitingSnapshot.position.toString(),
    );
    await expect(etaMetric).toContainText(koMessages.booking.queue.metrics.eta);
    await expect(etaMetric).toContainText(
      formatQueueEta(waitingSnapshot.etaMinSeconds, waitingSnapshot.etaSeconds),
    );
    await expect(remainingSeatsMetric).toContainText(
      koMessages.booking.queue.metrics.remainingSeats,
    );
    await expect(remainingSeatsMetric).toContainText(
      waitingSnapshot.remainingSeats.toString(),
    );
  });

  test('queue entry before the booking opens shows a countdown and enters automatically at the open time', async ({
    page,
  }) => {
    let enterCalls = 0;
    await page.route(
      '**/api/v1/queue/performances/**/enter',
      async (route: Route) => {
        enterCalls += 1;
        if (enterCalls === 1) {
          const serverNow = Date.now();
          await fulfillJson(route, 403, {
            statusCode: 403,
            message: '예매는 추후 오픈 예정입니다',
            errorCode: 'BOOKING_NOT_OPEN',
            bookingStartsAt: new Date(serverNow + 3_000).toISOString(),
            serverNow: new Date(serverNow).toISOString(),
            timestamp: new Date(serverNow).toISOString(),
          });
          return;
        }

        await fulfillJson(route, 200, waitingSnapshot);
      },
    );

    await page.goto(`/booking/${queuePerformanceId}`);

    await expect(
      page.getByRole('heading', {
        name: koMessages.booking.queue.status.notOpen.title,
      }),
    ).toBeVisible();
    await expect(page.getByTestId('queue-opens-in')).toContainText(
      koMessages.booking.queue.metrics.opensIn,
    );
    await expect(
      page.getByRole('heading', { name: koMessages.booking.queue.status.retry.title }),
    ).toHaveCount(0);

    // Booking open (3s) + up to 3s jitter: the hook re-enters without a click.
    await expect(
      page.getByRole('heading', {
        name: koMessages.booking.queue.status.waiting.title,
      }),
    ).toBeVisible({ timeout: 15_000 });
    expect(enterCalls).toBe(2);
  });

  test('queue entry with an unannounced open time explains the periodic check', async ({
    page,
  }) => {
    let detailReads = 0;
    await page.route(
      '**/api/v1/queue/performances/**/enter',
      async (route: Route) => {
        const serverNow = new Date().toISOString();
        await fulfillJson(route, 403, {
          statusCode: 403,
          message: '예매는 추후 오픈 예정입니다',
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: null,
          serverNow,
          timestamp: serverNow,
        });
      },
    );
    await page.route(
      `**/api/v1/performances/${queuePerformanceId}`,
      async (route: Route) => {
        detailReads += 1;
        await fulfillJson(route, 200, {
          id: queuePerformanceId,
          bookingPolicy: { bookingStartsAt: null },
        });
      },
    );

    await page.goto(`/booking/${queuePerformanceId}`);

    await expect(
      page.getByRole('heading', {
        name: koMessages.booking.queue.status.notOpen.title,
      }),
    ).toBeVisible();
    await expect(page.getByTestId('queue-open-time-unknown')).toContainText(
      koMessages.booking.queue.openTimeUnknownInfo.replace('{seconds}', '15'),
    );
    // The 403 body already says the open time is not scheduled.
    expect(detailReads).toBe(0);
    // In-app browsers may have no back button: the surface offers one.
    await expect(
      page.getByRole('button', { name: koMessages.booking.queue.backAction }),
    ).toBeVisible();
  });

  test('queue entry for a performance without sellable showtimes shows the closed surface', async ({
    page,
  }) => {
    await page.route(
      '**/api/v1/queue/performances/**/enter',
      async (route: Route) => {
        await fulfillJson(route, 403, {
          statusCode: 403,
          message: '이미 시작된 회차는 예매할 수 없습니다.',
          errorCode: 'NO_BOOKABLE_SHOWTIME',
        });
      },
    );

    await page.goto(`/booking/${queuePerformanceId}`);
    await expect(
      page.getByRole('heading', {
        name: koMessages.booking.queue.status.closed.title,
      }),
    ).toBeVisible();
  });

  test('queue entry for a missing performance says it was not found', async ({ page }) => {
    await page.route(
      '**/api/v1/queue/performances/**/enter',
      async (route: Route) => {
        await fulfillJson(route, 404, {
          statusCode: 404,
          message: '공연을 찾을 수 없습니다',
          errorCode: 'PERFORMANCE_NOT_FOUND',
        });
      },
    );

    await page.goto(`/booking/${queuePerformanceId}`);
    await expect(
      page.getByRole('heading', { name: koMessages.booking.queue.notFound.title }),
    ).toBeVisible();
  });

  for (const failureCase of failureCases) {
    test(`queue ${failureCase.name} state stays distinct from generic waiting errors`, async ({
      page,
    }) => {
      await page.route(
        '**/api/v1/queue/performances/**/enter',
        async (route: Route) => {
          await fulfillJson(route, failureCase.status, {
            statusCode: failureCase.status,
            message: failureCase.message,
          });
        },
      );

      await page.goto(`/booking/${queuePerformanceId}`);
      await expect(
        page.getByRole('heading', { name: failureCase.expectedHeading }),
      ).toBeVisible();
    });
  }
});

function formatQueueEta(etaMinSeconds: number, etaSeconds: number): string {
  if (etaSeconds <= 0) {
    return koMessages.booking.queue.metrics.soon;
  }

  // The server sends the admission-cycle range: lower and upper bound.
  const lower = Math.floor(etaMinSeconds / 60);
  const upper = Math.max(1, Math.ceil(etaSeconds / 60));
  if (lower <= 0) {
    return koMessages.booking.queue.metrics.etaWithin.replace('{minutes}', String(upper));
  }

  return koMessages.booking.queue.metrics.etaRange
    .replace('{min}', String(lower))
    .replace('{max}', String(upper));
}

async function mockAuthenticatedSession(page: Page) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await fulfillJson(route, 200, { accessToken: 'booking-queue-access-token' });
  });
  await page.route('**/api/v1/users/me', async (route: Route) => {
    await fulfillJson(route, 200, {
      id: 'booking-queue-user',
      email: 'booking-queue-user@example.test',
      name: 'Booking Queue User',
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
}

async function enableBooking(page: Page) {
  await page.route('**/api/runtime-flags', async (route: Route) => {
    await fulfillJson(route, 200, { bookingEnabled: true });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
