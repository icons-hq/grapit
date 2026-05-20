import { expect, test, type Page, type Route } from '@playwright/test';

const rawPaymentKey = 'phase26-raw-payment-key-should-not-render';
const rawQrToken = 'phase26-raw-qr-token-should-not-render';
const rawQrJti = 'phase26-qr-jti-1234567890';
const maskedQrJti = 'phase26...7890';

function createReservationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phase26-qr-reservation',
    reservationNumber: 'GRP-26-QR-0001',
    status: 'CONFIRMED',
    performanceTitle: 'Phase 26 QR Visibility Performance',
    posterUrl: null,
    showDateTime: '2026-07-18T10:00:00.000Z',
    venue: 'Phase 26 QR Venue',
    seats: [
      {
        seatId: 'A-1',
        tierName: 'VIP',
        price: 77000,
        row: 'A',
        number: '1',
        floorKey: '1F',
        floorLabel: '1층',
        seatKey: '1F:A-1',
      },
    ],
    totalAmount: 77000,
    createdAt: '2026-05-20T06:00:00.000Z',
    paymentMethod: 'CARD',
    paidAt: '2026-05-20T06:01:00.000Z',
    cancelDeadline: '2026-07-15T14:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    paymentKey: rawPaymentKey,
    queueAdmission: {
      queueSessionId: 'queue-phase26-qr',
      admissionToken: 'admission-phase26-qr',
      refreshFamilyId: 'family-phase26-qr',
      deviceSlotKey: 'device-phase26-qr',
      admittedAt: '2026-05-20T05:55:00.000Z',
      activeUntilAt: '2026-05-20T06:10:00.000Z',
      reentryGraceUntilAt: '2026-05-20T06:12:00.000Z',
    },
    paymentDeadlineAt: '2026-05-20T06:08:00.000Z',
    bookingPolicy: {
      maxTicketsPerOrder: 1,
      cancellationChangePolicy: 'CANCEL_ONLY',
      sameGradeChangeEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
    },
    refundTimeline: {
      currentState: 'COMPLETED',
      requestedAt: '2026-05-20T06:01:00.000Z',
      customerServiceCtaVisible: false,
    },
    cancelledSeatHold: null,
    qrTicket: {
      token: rawQrToken,
      jti: rawQrJti,
      status: 'ACTIVE',
      issuedAt: '2026-05-20T06:02:00.000Z',
      emailScheduledAt: '2026-07-17T10:00:00.000Z',
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
      body: JSON.stringify({ accessToken: 'phase26-qr-access-token' }),
    });
  });

  await page.route('**/api/v1/users/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'phase26-user-id',
        email: 'admin@grabit.test',
        name: 'Phase26 QR Tester',
        role: 'user',
        phone: '010-0000-0000',
        isEmailVerified: true,
        isPhoneVerified: true,
      }),
    });
  });
}

async function expectNoRawSecrets(page: Page) {
  await expect(page.getByText(rawPaymentKey, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawQrToken, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawQrJti, { exact: true })).toHaveCount(0);
}

test.describe('phase26 QR visibility', () => {
  test('payment complete page exposes active QR access after confirmed payment', async ({ page }) => {
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
      `/booking/phase26-qr-performance/complete?paymentKey=${rawPaymentKey}&orderId=phase26-order-id&amount=77000`,
    );

    await expect(
      page.getByText('결제가 완료되었습니다. QR 티켓을 바로 확인할 수 있습니다.'),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'QR 티켓 보기' })).toBeVisible();
    await expect(page.getByText('QR 활성')).toBeVisible();
    await expect(page.getByText(maskedQrJti)).toBeVisible();
    await expectNoRawSecrets(page);
  });

  test('My Page reservation detail exposes active QR metadata without raw tokens', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page);

    await page.route('**/api/v1/reservations/phase26-qr-reservation', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createReservationDetail()),
      });
    });

    await page.goto('/mypage/reservations/phase26-qr-reservation');

    await expect(page.getByRole('heading', { name: 'QR 티켓' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('QR 활성')).toBeVisible();
    await expect(page.getByText(maskedQrJti)).toBeVisible();
    await expect(page.getByText('2026.05.20')).toBeVisible();
    await expect(page.getByText('예매번호')).toBeVisible();
    await expect(page.getByText('GRP-26-QR-0001')).toBeVisible();
    await expect(page.getByText('결제 완료')).toBeVisible();
    await expect(page.getByText('Phase 26 QR Visibility Performance')).toBeVisible();
    await expect(page.getByText('Phase 26 QR Venue')).toBeVisible();
    await expectNoRawSecrets(page);
  });
});
