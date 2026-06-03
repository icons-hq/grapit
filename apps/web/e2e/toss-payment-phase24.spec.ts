import { expect, test, type Route } from '@playwright/test';
import { injectBookingFixture } from './fixtures/booking-store';

function createReservationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phase24-recovery-reservation',
    reservationNumber: 'GRP-PHASE24-0001',
    status: 'PENDING_PAYMENT',
    performanceTitle: 'Phase 24 Recovery Performance',
    posterUrl: null,
    showDateTime: new Date(Date.now() + 86400000).toISOString(),
    venue: 'Phase 24 Venue',
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
    totalAmount: 50000,
    createdAt: new Date().toISOString(),
    paymentMethod: 'FOREIGN_EASY_PAY',
    paidAt: '',
    cancelDeadline: new Date(Date.now() + 86400000).toISOString(),
    cancelledAt: null,
    cancelReason: null,
    paymentKey: 'phase24-pending-payment-key',
    queueAdmission: {
      queueSessionId: 'queue-phase24',
      admissionToken: 'cookie-bound',
      refreshFamilyId: 'family-phase24',
      deviceSlotKey: 'device-phase24',
      admittedAt: new Date().toISOString(),
      activeUntilAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      reentryGraceUntilAt: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    },
    paymentDeadlineAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
    },
    refundTimeline: {
      currentState: 'REQUESTED',
      requestedAt: new Date().toISOString(),
      customerServiceCtaVisible: false,
    },
    cancelledSeatHold: null,
    qrTicket: {
      token: '',
      jti: '',
      status: 'REVOKED',
      issuedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

async function enableBooking(page: import('@playwright/test').Page) {
  await page.route('**/api/runtime-flags', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bookingEnabled: true }),
    });
  });
}

async function mockAuthenticatedSession(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);

      if (url.includes('/api/v1/auth/refresh')) {
        return new Response(
          JSON.stringify({ accessToken: 'phase24-access-token' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.includes('/api/v1/users/me')) {
        return new Response(
          JSON.stringify({
            id: 'phase24-user-id',
            email: 'admin@grabit.test',
            name: 'Phase24 Tester',
            role: 'user',
            phone: '+821012345678',
            isEmailVerified: true,
            isPhoneVerified: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return originalFetch(input, init);
    };
  });
}

test.describe('toss-payment phase24 recovery states', () => {
  test('pending return shows inline wait UI without re-confirming payment', async ({ page }) => {
    let confirmIntercepted = false;

    await enableBooking(page);
    await mockAuthenticatedSession(page);
    await injectBookingFixture(page, {
      performanceId: 'phase24-test-performance',
      showtimeId: 'phase24-test-showtime',
      seats: [{ seatId: 'A-1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      performanceTitle: 'Phase 24 Recovery Performance',
      showDateTime: new Date(Date.now() + 86400000).toISOString(),
      venue: 'Phase 24 Venue',
    });

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      confirmIntercepted = true;
      await route.fulfill({ status: 500, body: 'unexpected confirm call' });
    });
    await page.route('**/api/v1/reservations?orderId=**', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 404,
          message: '예매 정보를 찾을 수 없습니다.',
          error: 'Not Found',
        }),
      });
    });

    await page.goto(
      '/booking/phase24-test-performance/complete?pending=true&orderId=phase24-order-pending&amount=50000',
    );

    await expect(page.getByText('해외 결제 인증을 기다리고 있습니다')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/같은 주문으로 예매 상태를 다시 확인/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '상태 다시 확인' })).toBeVisible();
    await expect(page.getByText(/예매가 완료|완료되었습니다/)).not.toBeVisible();
    await expect.poll(() => confirmIntercepted).toBe(false);
  });

  test('failed return renders recoverable failure actions on the complete route', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);

    await page.route('**/api/v1/reservations?orderId=**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createReservationDetail({
            status: 'FAILED',
            cancelReason: '지갑사 인증에 실패했습니다. 다시 시도해주세요.',
            paymentDeadlineAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
          }),
        ),
      });
    });

    await page.goto(
      '/booking/phase24-test-performance/complete?pending=true&orderId=phase24-order-failed&amount=50000',
    );

    await expect(page.getByText('결제 확인에 실패했습니다')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('지갑사 인증에 실패했습니다. 다시 시도해주세요.')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: '좌석 다시 선택하기' })).toBeVisible();
    await expect(page.getByRole('button', { name: '예매 내역 확인' })).toBeVisible();
  });

  test('expired return renders the payment-expired recovery state', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);

    await page.route('**/api/v1/reservations?orderId=**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createReservationDetail({
            paymentDeadlineAt: '2026-05-08T00:00:00.000Z',
          }),
        ),
      });
    });

    await page.goto(
      '/booking/phase24-test-performance/complete?pending=true&orderId=phase24-order-expired&amount=50000',
    );

    await expect(page.getByText('결제 가능 시간이 만료되었습니다')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('좌석을 다시 선택한 뒤 새 결제를 시작해주세요.')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: '좌석 다시 선택하기' })).toBeVisible();
    await expect(page.getByText(/예매가 완료|완료되었습니다/)).not.toBeVisible();
  });
});
