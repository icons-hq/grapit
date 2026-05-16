import { expect, test, type Page, type Route } from '@playwright/test';

function createReservationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phase24-qr-reservation',
    reservationNumber: 'GRP-QR-0001',
    status: 'CONFIRMED',
    performanceTitle: 'Phase 24 QR Performance',
    posterUrl: null,
    showDateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    venue: 'Phase 24 QR Venue',
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
    paymentMethod: 'CARD',
    paidAt: new Date().toISOString(),
    cancelDeadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    cancelledAt: null,
    cancelReason: null,
    paymentKey: 'phase24-qr-payment-key',
    queueAdmission: {
      queueSessionId: 'queue-phase24-qr',
      admissionToken: 'admission-phase24-qr',
      refreshFamilyId: 'family-phase24-qr',
      deviceSlotKey: 'device-phase24-qr',
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
      currentState: 'COMPLETED',
      requestedAt: new Date().toISOString(),
      customerServiceCtaVisible: false,
    },
    cancelledSeatHold: null,
    qrTicket: {
      token: 'qr-token-phase24',
      jti: 'qr-jti-phase24',
      status: 'ACTIVE',
      issuedAt: new Date().toISOString(),
      emailScheduledAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
      emailedAt: null,
    },
    ...overrides,
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
      body: JSON.stringify({ accessToken: 'phase24-qr-access-token' }),
    });
  });

  await page.route('**/api/v1/users/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'phase24-user-id',
        email: 'admin@grabit.test',
        name: 'Phase24 QR Tester',
        role: 'user',
        phone: '010-1234-5678',
        isEmailVerified: true,
        isPhoneVerified: true,
      }),
    });
  });
}

test.describe('booking complete QR visibility', () => {
  test('booking complete exposes QR follow-up CTA and D-1 email notice', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createReservationDetail()),
      });
    });

    await page.goto(
      '/booking/phase24-qr-performance/complete?paymentKey=phase24-payment-key&orderId=phase24-order-id&amount=50000',
    );

    await expect(page.getByRole('button', { name: 'QR 티켓 보기' })).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText('QR 티켓 안내 메일은 공연 24시간 전에 다시 발송됩니다.'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('QR ticket is visible immediately from reservation detail', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);

    await page.route('**/api/v1/reservations/phase24-qr-reservation', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createReservationDetail()),
      });
    });

    await page.goto('/mypage/reservations/phase24-qr-reservation');

    await expect(page.getByRole('heading', { name: 'QR 티켓' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('qr-jti-phase24')).toBeVisible({ timeout: 10000 });
  });
});
