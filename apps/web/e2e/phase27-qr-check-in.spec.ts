import { expect, test, type Page, type Route } from '@playwright/test';

const rawQrToken = 'raw-token-phase27-check-in-should-not-render';
const rawQrJTI = 'raw-JTI-phase27-check-in-should-not-render';
const rawPaymentKey = 'raw-payment-key-phase27-should-not-render';
const rawCookie = 'raw-cookie-phase27-should-not-render';
const rawBuyerEmail = 'buyer-phase27@example.com';
const checkInUrl = `https://heygrabit.com/field/check-in?ticket=${rawQrToken}`;

function createReservationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'phase27-qr-reservation',
    reservationNumber: 'GRP-27-QR-0001',
    status: 'CONFIRMED',
    performanceTitle: 'Phase 27 QR Check-in Performance',
    posterUrl: null,
    showDateTime: '2026-07-04T10:00:00.000Z',
    venue: 'Phase 27 Hall',
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
    createdAt: '2026-05-22T06:00:00.000Z',
    paymentMethod: 'CARD',
    paidAt: '2026-05-22T06:01:00.000Z',
    cancelDeadline: '2026-07-01T14:00:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    paymentKey: rawPaymentKey,
    refundTimeline: {
      currentState: 'COMPLETED',
      requestedAt: '2026-05-22T06:01:00.000Z',
      customerServiceCtaVisible: false,
    },
    cancelledSeatHold: null,
    qrTicket: {
      token: rawQrToken,
      jti: rawQrJTI,
      status: 'ACTIVE',
      issuedAt: '2026-05-22T06:02:00.000Z',
      emailScheduledAt: '2026-07-03T10:00:00.000Z',
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

async function mockAuthenticatedSession(
  page: Page,
  user: {
    role: 'user' | 'admin';
    adminCapabilityBundle?: string | null;
    adminCapabilities?: string[];
  },
) {
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'phase27-check-in-access-token' }),
    });
  });

  await page.route('**/api/v1/users/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `${user.role}-phase27-user`,
        email: user.role === 'admin' ? 'scanner@grabit.test' : rawBuyerEmail,
        name: user.role === 'admin' ? 'Phase27 Scanner' : 'Phase27 Buyer',
        role: user.role,
        phone: '010-0000-2727',
        isEmailVerified: true,
        isPhoneVerified: true,
        adminCapabilityBundle: user.adminCapabilityBundle ?? null,
        adminCapabilities: user.adminCapabilities ?? [],
      }),
    });
  });
}

async function expectNoRawSecrets(page: Page) {
  await expect(page.getByText(rawQrToken, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawQrJTI, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawPaymentKey, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawCookie, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawBuyerEmail, { exact: true })).toHaveCount(0);
  await expect(page.getByText(checkInUrl, { exact: true })).toHaveCount(0);
}

test.describe('phase27 QR check-in browser contracts', () => {
  test('buyer payment complete renders a real QR image for the protected /field/check-in route', async ({ page }) => {
    await enableBooking(page);
    await mockAuthenticatedSession(page, { role: 'user' });

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createReservationDetail()),
      });
    });

    await page.goto(
      `/booking/phase27-performance/complete?paymentKey=${rawPaymentKey}&orderId=phase27-order-id&amount=77000`,
    );

    await expect(
      page
        .getByText('QR 티켓이 준비되었습니다. 입장 시 현장 스태프가 QR을 확인합니다.')
        .first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('현장 검표 결과가 최종 입장 기준입니다.')).toBeVisible();
    await expect(page.getByTestId('qr-ticket-image')).toBeVisible();
    await expect(page.getByTestId('qr-ticket-image')).toHaveAttribute(
      'data-qr-url',
      /https:\/\/heygrabit\.com\/field\/check-in/,
    );
    await expectNoRawSecrets(page);
  });

  test('logged-out QR visitors are sent to login with a return target', async ({ page }) => {
    await enableBooking(page);

    await page.route('**/api/v1/auth/refresh', async (route: Route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`);

    await expect(page).toHaveURL(/\/auth\?returnTo=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('returnTo') ?? '')).toBe(
      `/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`,
    );
    await expectNoRawSecrets(page);
  });

  test('regular members opening /field/check-in are denied and opening the QR URL alone does not consume entry', async ({ page }) => {
    let consumeCalls = 0;
    await enableBooking(page);
    await mockAuthenticatedSession(page, { role: 'user' });

    await page.route('**/api/v1/field/check-in/consume**', async (route: Route) => {
      consumeCalls += 1;
      await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`);

    await expect(
      page.getByRole('alert', { name: '이 티켓을 검표할 권한이 없습니다' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('입장 처리가 완료되었습니다')).toHaveCount(0);
    await expect(page.getByText('예매 관리')).toHaveCount(0);
    await expect(page.getByText('회원 관리')).toHaveCount(0);
    expect(consumeCalls).toBe(0);
    await expectNoRawSecrets(page);
  });

  test('scanner-only staff manually processes entry and then sees duplicate rejection on repeat scan', async ({ page }) => {
    let consumeCalls = 0;
    let consumed = false;
    await page.setViewportSize({ width: 390, height: 844 });
    await enableBooking(page);
    await mockAuthenticatedSession(page, {
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
    });

    await page.route('**/api/v1/field/check-in/verify**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: consumed ? 'duplicate' : 'processable',
          resultLabel: consumed ? '이미 입장 처리된 티켓입니다' : '입장 가능 티켓입니다',
          reservationNumber: 'GRP-27-QR-0001',
          performanceTitle: 'Phase 27 QR Check-in Performance',
          showtimeAt: '2026-07-04T10:00:00.000Z',
          seats: ['VIP A열 1번'],
          priorScanContext: consumed
            ? {
                checkedInAt: '2026-07-04T10:05:00.000Z',
                scannerName: 'Phase27 Scanner',
              }
            : null,
        }),
      });
    });

    await page.route('**/api/v1/field/check-in/consume**', async (route: Route) => {
      consumeCalls += 1;
      consumed = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: 'processed',
          resultLabel: '입장 처리가 완료되었습니다',
        }),
      });
    });

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}`);

    await expect(
      page.getByRole('status', { name: '입장 가능 티켓입니다' }),
    ).toBeVisible({ timeout: 10000 });
    const actionBox = await page.getByTestId('scanner-sticky-action').boundingBox();
    const statusBox = await page
      .getByRole('status', { name: '입장 가능 티켓입니다' })
      .boundingBox();
    expect(actionBox?.width).toBeGreaterThan(320);
    expect(statusBox?.width).toBeGreaterThan(320);
    await expect(page.getByText('입장 처리가 완료되었습니다')).toHaveCount(0);
    expect(consumeCalls).toBe(0);

    await page.getByRole('button', { name: '입장 처리' }).click();

    await expect(
      page.getByRole('status', { name: '입장 처리가 완료되었습니다' }),
    ).toBeVisible();
    expect(consumeCalls).toBe(1);

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}&duplicate=1`);

    await expect(
      page.getByRole('status', { name: '이미 입장 처리된 티켓입니다' }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '입장 처리' })).toHaveCount(0);
    expect(consumeCalls).toBe(1);
    await expectNoRawSecrets(page);
  });
});

// Real phone-camera verification is manual-only and belongs to Plan 27-16 evidence.
