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
      };
      status: {
        waiting: { title: string };
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
  position: 12,
  waitingCount: 48,
  etaSeconds: 165,
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
      formatQueueEta(waitingSnapshot.etaSeconds),
    );
    await expect(remainingSeatsMetric).toContainText(
      koMessages.booking.queue.metrics.remainingSeats,
    );
    await expect(remainingSeatsMetric).toContainText(
      waitingSnapshot.remainingSeats.toString(),
    );
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

function formatQueueEta(etaSeconds: number): string {
  if (etaSeconds <= 0) {
    return '곧 입장';
  }

  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
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
