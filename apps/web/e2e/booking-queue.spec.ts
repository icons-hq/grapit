import { expect, test, type Route } from '@playwright/test';

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

const failureCases = [
  {
    name: 'retry',
    status: 429,
    message: 'TRAFFIC_RATE_LIMITED',
    expectedHeading: 'Too many requests. Please try again shortly',
  },
  {
    name: 'challenge',
    status: 403,
    message: 'SECURITY_CHALLENGE_REQUIRED',
    expectedHeading: 'Complete the security check and try again',
  },
  {
    name: 'blocked',
    status: 403,
    message: 'SECURITY_BLOCKED',
    expectedHeading: 'Your request was blocked because of unusual activity',
  },
] as const;

test.describe('booking queue route', () => {
  test.beforeEach(async ({ page }) => {
    await stubAnonymousAuth(page);
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

    await page.goto('/en/booking/e2e-queue-performance');

    await expect(
      page.getByRole('heading', {
        name: 'You are waiting in the booking queue',
      }),
    ).toBeVisible();
    await expect(page.getByText('Current position')).toBeVisible();
    await expect(page.getByText('Estimated wait')).toBeVisible();
    await expect(page.getByText('Remaining seats')).toBeVisible();
    await expect(page.getByText('12')).toBeVisible();
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

      await page.goto('/en/booking/e2e-queue-performance');

      await expect(
        page.getByRole('heading', {
          name: failureCase.expectedHeading,
        }),
      ).toBeVisible();
    });
  }
});

async function stubAnonymousAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 401,
        message: 'Unauthorized',
      }),
    });
  });
}

async function enableBooking(page: import('@playwright/test').Page) {
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
