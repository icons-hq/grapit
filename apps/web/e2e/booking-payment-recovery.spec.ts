import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Payment recovery after the queue access window closed (audit #4, #32): the
 * route offers only the order awaiting payment, and checkout pays that order
 * without a new prepare (which AdmissionGuard refuses once activeUntilAt has
 * passed). The Toss SDK script is replaced by a stand-in that records the
 * provider request; no provider is contacted.
 */

const PERFORMANCE_ID = '00000000-0000-4000-8000-000000000032';
const SHOWTIME_ID = '00000000-0000-4000-8000-000000000132';
const ORDER_ID = 'GRP-e2e-recovery';
const CARD = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

const FAKE_TOSS_SDK = `
window.__tossAgreementHandlers = [];
window.__tossAgree = function () {
  window.__tossAgreementHandlers.forEach(function (handler) {
    handler({ agreedRequiredTerms: true, agreements: [] });
  });
};
window.TossPayments = function () {
  return {
    widgets: function () {
      return {
        setAmount: async function () {},
        renderPaymentMethods: async function () {
          return {
            on: function () {},
            getSelectedPaymentMethod: async function () { return { code: 'CARD' }; },
            destroy: async function () {},
          };
        },
        renderAgreement: async function () {
          return {
            on: function (event, handler) {
              if (event === 'agreementStatusChange') window.__tossAgreementHandlers.push(handler);
            },
            destroy: async function () {},
          };
        },
        requestPayment: function (payload) {
          window.__tossRequested = payload;
          return new Promise(function () {});
        },
      };
    },
  };
};
`;

const VIEWPORTS = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  { name: '375px', size: { width: 375, height: 812 } },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(`booking payment recovery (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test('continue payment pays the prepared order after the queue access window without a new prepare', async ({
      page,
    }) => {
      const now = Date.now();
      const calls = { enter: 0, prepare: 0, branch: [] as Array<Record<string, unknown>> };

      await mockAuthenticatedSession(page);
      await page.route('**/api/runtime-flags', (route) => fulfillJson(route, 200, { bookingEnabled: true }));
      await page.route('https://js.tosspayments.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_TOSS_SDK }),
      );
      await page.route('**/api/v1/queue/performances/**/enter', async (route) => {
        calls.enter += 1;
        await fulfillJson(route, 200, {
          queueSessionId: 'queue-session-recovery',
          state: 'PAYMENT_RECOVERY',
          position: 0,
          waitingCount: 0,
          etaSeconds: 0,
          remainingSeats: 10,
          autoEnter: false,
          admittedAt: new Date(now - 11 * 60_000).toISOString(),
          activeUntilAt: new Date(now - 60_000).toISOString(),
          reentryGraceUntilAt: new Date(now + 2 * 60_000).toISOString(),
          paymentRecoveryUntilAt: new Date(now + 2 * 60_000).toISOString(),
          recoveryOrderId: ORDER_ID,
        });
      });
      await page.route('**/api/v1/reservations?orderId=**', (route) =>
        fulfillJson(route, 200, {
          id: 'reservation-e2e-recovery',
          tossOrderId: ORDER_ID,
          performanceId: PERFORMANCE_ID,
          showtimeId: SHOWTIME_ID,
          status: 'PENDING_PAYMENT',
          performanceTitle: 'E2E Recovery Show',
          posterUrl: null,
          showDateTime: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
          venue: 'E2E Hall',
          seats: [{
            seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층',
            tierName: 'VIP', row: 'A', number: '1', price: 50000,
          }],
          totalAmount: 52000,
          paymentDeadlineAt: new Date(now + 5 * 60_000).toISOString(),
          paymentInfo: null,
          checkoutPaymentMethod: CARD,
          checkoutStartedAt: null,
        }),
      );
      await page.route('**/api/v1/reservations/prepare', async (route) => {
        calls.prepare += 1;
        await fulfillJson(route, 403, { statusCode: 403, message: '대기열 입장 시간이 만료되었습니다' });
      });
      await page.route('**/api/v1/payments/branch', async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        calls.branch.push(body);
        await fulfillJson(route, 200, {
          orderId: body.orderId,
          ...CARD,
          successUrl: body.successUrl,
          failUrl: body.failUrl,
          asyncStatus: 'sync',
          useInternationalCardOnly: false,
          paymentDeadlineAt: new Date(now + 10 * 60_000).toISOString(),
        });
      });

      await page.goto(`/booking/${PERFORMANCE_ID}`);
      await expect(page.getByRole('heading', { name: '결제 대기 중인 예매가 있습니다' })).toBeVisible();
      await page.getByRole('link', { name: '결제 이어하기' }).click();

      await expect(page).toHaveURL(new RegExp(`/booking/${PERFORMANCE_ID}/confirm\\?resumeOrderId=${ORDER_ID}`));
      await expect(page.getByText('E2E Recovery Show').first()).toBeVisible();
      await page.getByLabel('전체 동의').click();
      await expect.poll(() => page.evaluate(() => (
        window as unknown as { __tossAgreementHandlers?: unknown[] }
      ).__tossAgreementHandlers?.length ?? 0)).toBeGreaterThan(0);
      await page.evaluate(() => (window as unknown as { __tossAgree: () => void }).__tossAgree());

      const pay = page.getByRole('button', { name: '결제하기' }).first();
      await expect(pay).toBeEnabled();
      await expect(page.getByText('대기열 입장 시간이 끝났습니다')).toHaveCount(0);
      await pay.click();

      await expect.poll(() => page.evaluate(() => (
        window as unknown as { __tossRequested?: { orderId?: string } }
      ).__tossRequested?.orderId ?? null)).toBe(ORDER_ID);
      expect(calls.prepare).toBe(0);
      expect(calls.branch).toHaveLength(1);
      expect(calls.branch[0]).toMatchObject({ orderId: ORDER_ID, paymentMethod: CARD });
      expect(calls.enter).toBe(1);
    });
  });
}

async function mockAuthenticatedSession(page: Page) {
  await page.route('**/api/v1/auth/refresh', (route) =>
    fulfillJson(route, 200, { accessToken: 'booking-recovery-access-token' }),
  );
  await page.route('**/api/v1/users/me', (route) =>
    fulfillJson(route, 200, {
      id: 'booking-recovery-user',
      email: 'booking-recovery-user@example.test',
      name: 'Booking Recovery User',
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
    }),
  );
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
