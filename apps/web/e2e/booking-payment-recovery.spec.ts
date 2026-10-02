import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Payment recovery after the queue access window closed (audit #4, #32): the
 * route offers only the order awaiting payment, and checkout pays that order
 * without a new prepare (which AdmissionGuard refuses once activeUntilAt has
 * passed). The Toss SDK script is replaced by a stand-in that records the
 * provider request; no provider is contacted.
 *
 * Each scenario also renders the confirm screen at desktop and 375px with the
 * combinations of resume notices: (a) a resume after the queue window (pay button
 * open), (b) a resume refused with a queue 403 (no rejoin while the handoff is in
 * flight), (c) the showtime starting during a resume, (d) an unpayable method
 * (virtual account, PAYCO) chosen on a resumed order.
 */

const PERFORMANCE_ID = '00000000-0000-4000-8000-000000000032';
const SHOWTIME_ID = '00000000-0000-4000-8000-000000000132';
const ORDER_ID = 'GRP-e2e-recovery';
const CARD = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

const FAKE_TOSS_SDK = `
window.__tossAgreementHandlers = [];
window.__tossMethodHandlers = [];
window.__tossSelectedCode = 'CARD';
window.__tossSelect = function (code) {
  window.__tossSelectedCode = code;
  window.__tossMethodHandlers.forEach(function (handler) { handler({ code: code }); });
};
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
            on: function (event, handler) {
              if (event === 'paymentMethodSelect') window.__tossMethodHandlers.push(handler);
            },
            getSelectedPaymentMethod: async function () { return { code: window.__tossSelectedCode }; },
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
      await expect(checkoutNotices(page)).toHaveCount(0);
      await pay.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`resume-after-queue-window-${viewport.name}.png`) });
      await pay.click();

      await expect.poll(() => page.evaluate(() => (
        window as unknown as { __tossRequested?: { orderId?: string } }
      ).__tossRequested?.orderId ?? null)).toBe(ORDER_ID);
      expect(calls.prepare).toBe(0);
      expect(calls.branch).toHaveLength(1);
      expect(calls.branch[0]).toMatchObject({ orderId: ORDER_ID, paymentMethod: CARD });
      expect(calls.enter).toBe(1);
    });

    test('continue payment in another browser session is refused at the handoff before the provider checkout', async ({
      page,
    }) => {
      const now = Date.now();
      const calls = { prepare: 0, cancel: 0, branch: 0 };

      await mockAuthenticatedSession(page);
      await page.route('**/api/runtime-flags', (route) => fulfillJson(route, 200, { bookingEnabled: true }));
      await page.route('https://js.tosspayments.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_TOSS_SDK }),
      );
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
      await page.route('**/api/v1/reservations/*/cancel-pending', async (route) => {
        calls.cancel += 1;
        await fulfillJson(route, 200, {});
      });
      // The order is bound to the browser session that prepared it (AdmissionGuard).
      // The answer is held until the in-flight screen has been checked.
      let answerBranch!: () => void;
      const branchAnswered = new Promise<void>((resolve) => { answerBranch = resolve; });
      await page.route('**/api/v1/payments/branch', async (route) => {
        calls.branch += 1;
        await branchAnswered;
        await fulfillJson(route, 403, { statusCode: 403, message: '대기열 입장 인증이 필요합니다' });
      });

      // The reservation list's "continue payment" link on another device.
      await page.goto(`/booking/${PERFORMANCE_ID}/confirm?resumeOrderId=${ORDER_ID}`);
      await expect(page.getByText('E2E Recovery Show').first()).toBeVisible();
      await page.getByLabel('전체 동의').click();
      await expect.poll(() => page.evaluate(() => (
        window as unknown as { __tossAgreementHandlers?: unknown[] }
      ).__tossAgreementHandlers?.length ?? 0)).toBeGreaterThan(0);
      await page.evaluate(() => (window as unknown as { __tossAgree: () => void }).__tossAgree());

      const pay = page.getByRole('button', { name: '결제하기' }).first();
      await expect(pay).toBeEnabled();
      await pay.click();

      // While the handoff is in flight nothing can cancel the order: the pay button is
      // busy and no rejoin (which cancels the order and releases its seats) is offered.
      await expect.poll(() => calls.branch).toBe(1);
      await expect(page.getByRole('button', { name: '결제 처리 중...' }).first()).toBeDisabled();
      await expect(page.getByRole('button', { name: '대기열 다시 입장하기' })).toHaveCount(0);
      answerBranch();

      const notice = page.getByRole('alert').filter({ hasText: '이 화면에서는 결제를 이어갈 수 없습니다' });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('button', { name: '대기열 다시 입장하기' })).toBeEnabled();
      await expect(page.getByRole('button', { name: '이 화면에서는 결제를 이어갈 수 없습니다' }).first()).toBeDisabled();
      await notice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`resume-refused-${viewport.name}.png`) });
      expect(await page.evaluate(() => (
        window as unknown as { __tossRequested?: unknown }
      ).__tossRequested ?? null)).toBeNull();
      expect(calls).toEqual({ prepare: 0, cancel: 0, branch: 1 });
    });

    test('closes a resumed order at the showtime start and offers seat reselection instead', async ({ page }) => {
      const now = Date.now();
      const calls = { prepare: 0, branch: 0 };
      await page.clock.install({ time: now });
      await mockResumedOrder(page, preparedOrder(now, { showDateTime: new Date(now + 60_000).toISOString() }), calls);

      await page.goto(`/booking/${PERFORMANCE_ID}/confirm?resumeOrderId=${ORDER_ID}`);
      await expect(page.getByText('E2E Recovery Show').first()).toBeVisible();
      await agreeToAllTerms(page);
      await expect(page.getByRole('button', { name: '결제하기' }).first()).toBeEnabled();

      await page.clock.fastForward(61_000);

      const notice = page.getByRole('alert').filter({ hasText: SHOWTIME_CLOSED });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('button', { name: '좌석 다시 선택하기' })).toBeEnabled();
      const closed = page.getByRole('button', { name: SHOWTIME_CLOSED }).first();
      await expect(closed).toBeDisabled();
      // One notice only: the resume suppresses the queue window notice, and the
      // payment deadline is still ahead.
      await expect(checkoutNotices(page)).toHaveCount(1);
      await expect(page.getByText('대기열 입장 시간이 끝났습니다')).toHaveCount(0);
      await notice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath(`resume-showtime-started-${viewport.name}.png`) });
      expect(calls).toEqual({ prepare: 0, branch: 0 });
    });

    test('refuses a virtual account or PAYCO chosen on a resumed order before prepare or handoff', async ({ page }) => {
      const now = Date.now();
      const calls = { prepare: 0, branch: 0 };
      await mockResumedOrder(page, preparedOrder(now), calls);

      await page.goto(`/booking/${PERFORMANCE_ID}/confirm?resumeOrderId=${ORDER_ID}`);
      await expect(page.getByText('E2E Recovery Show').first()).toBeVisible();
      await agreeToAllTerms(page);
      // The saved method of the order stays on screen.
      await expect(page.getByRole('status').filter({ hasText: '이 예매의 결제수단' })).toContainText('국내 카드');

      for (const code of ['VIRTUAL_ACCOUNT', 'PAYCO']) {
        await page.evaluate((selected) => (
          window as unknown as { __tossSelect: (value: string) => void }
        ).__tossSelect(selected), code);
        const notice = page.getByRole('alert').filter({ hasText: METHOD_NOT_ALLOWED });
        await expect(notice).toBeVisible();
        await expect(checkoutNotices(page)).toHaveCount(1);
        const blocked = page.getByRole('button', { name: '다른 결제수단을 선택해 주세요' }).first();
        await expect(blocked).toBeDisabled();
        // A ready order has no Provider Handoff, so its method is not locked yet: the
        // methodLocked line belongs to a handed-off order, which checkout never shows.
        await expect(page.getByText('이 예매의 결제수단이 고정되었습니다', { exact: false })).toHaveCount(0);
        await notice.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: test.info().outputPath(`resume-${code.toLowerCase()}-${viewport.name}.png`),
        });
      }

      await page.evaluate(() => (
        window as unknown as { __tossSelect: (value: string) => void }
      ).__tossSelect('CARD'));
      await expect(checkoutNotices(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '결제하기' }).first()).toBeEnabled();
      expect(calls).toEqual({ prepare: 0, branch: 0 });
    });
  });
}

const SHOWTIME_CLOSED = '이미 시작된 회차는 예매할 수 없습니다.';
const METHOD_NOT_ALLOWED = '이 공연에서 사용할 수 없는 결제수단입니다. 다른 결제수단을 선택해 주세요.';

function preparedOrder(now: number, overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

/** A resumed Prepared Checkout whose prepare and handoff only count calls. */
async function mockResumedOrder(
  page: Page,
  order: ReturnType<typeof preparedOrder>,
  calls: { prepare: number; branch: number },
) {
  // Anything not answered below fails here instead of reaching a local API.
  await page.route('**/api/v1/**', (route) => fulfillJson(route, 404, { statusCode: 404, message: 'not mocked' }));
  await mockAuthenticatedSession(page);
  await page.route('**/api/runtime-flags', (route) => fulfillJson(route, 200, { bookingEnabled: true }));
  await page.route('https://js.tosspayments.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_TOSS_SDK }),
  );
  await page.route('**/api/v1/reservations?orderId=**', (route) => fulfillJson(route, 200, order));
  await page.route('**/api/v1/reservations/prepare', async (route) => {
    calls.prepare += 1;
    await fulfillJson(route, 403, { statusCode: 403, message: '대기열 입장 시간이 만료되었습니다' });
  });
  await page.route('**/api/v1/payments/branch', async (route) => {
    calls.branch += 1;
    await fulfillJson(route, 403, { statusCode: 403, message: '대기열 입장 인증이 필요합니다' });
  });
}

/** Checkout notices only: Next.js' route announcer is an `alert` outside the page content. */
function checkoutNotices(page: Page) {
  return page.getByRole('main').getByRole('alert');
}

async function agreeToAllTerms(page: Page) {
  await page.getByLabel('전체 동의').click();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __tossAgreementHandlers?: unknown[] }
  ).__tossAgreementHandlers?.length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __tossAgree: () => void }).__tossAgree());
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
