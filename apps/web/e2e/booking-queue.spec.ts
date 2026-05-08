import { expect, test, type Route } from '@playwright/test';
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

    await page.goto(`/booking/${queuePerformanceId}`);
    await page.waitForFunction(() => document.body.innerText.includes('12'));

    await expect(
      page.getByText(koMessages.booking.queue.status.waiting.title).first(),
    ).toBeVisible();
    await expect(
      page.getByText(koMessages.booking.queue.metrics.position),
    ).toBeVisible();
    await expect(
      page.getByText(koMessages.booking.queue.metrics.eta),
    ).toBeVisible();
    await expect(
      page.getByText(koMessages.booking.queue.metrics.remainingSeats),
    ).toBeVisible();
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

      await page.goto(`/booking/${queuePerformanceId}`);
      await page.waitForFunction(
        (expectedTitle) => document.body.innerText.includes(expectedTitle),
        failureCase.expectedHeading,
      );

      await expect(
        page.getByText(failureCase.expectedHeading).first(),
      ).toBeVisible();
    });
  }
});

async function stubAnonymousAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({ status: 204, body: '' });
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
