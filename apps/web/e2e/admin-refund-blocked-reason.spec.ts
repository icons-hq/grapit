import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

const BOOKING_ID = 'reservation-confirmed-1';
const WINDOW_BLOCKER = '취소 마감 이후 관리자 환불은 수수료 없는 전액 환불(override)로만 처리할 수 있습니다';

test.describe('Admin refund preview blockers', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);
    await page.route('**/api/v1/users/me', (route) => fulfillJson(route, {
      id: 'admin-e2e-user',
      email: 'admin@grapit.test',
      name: '관리자',
      role: 'admin',
      phone: '+821000000000',
      gender: 'unspecified',
      country: 'KR',
      birthDate: '1990-01-01',
      preferredLocale: 'ko',
      marketingConsent: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      adminCapabilityBundle: 'admin',
      adminCapabilities: ['refund.admin_refund', 'support.manage', 'audit.read'],
      createdAt: '2026-05-01T00:00:00.000Z',
    }));
    const performance = { id: '00000000-0000-4000-8000-000000000101', title: 'Grabit Fanmeet',
      showtimes: [{ id: '00000000-0000-4000-8000-000000000001', dateTime: '2026-07-04T09:00:00.000Z' }],
      seatMaps: [] };
    await page.route('**/api/v1/admin/performances?**', (route) => fulfillJson(route, { data: [performance], total: 1 }));
    await page.route('**/api/v1/admin/performances/00000000-0000-4000-8000-000000000101', (route) => fulfillJson(route, performance));
    await page.route('**/api/v1/admin/bookings?**', (route) => fulfillJson(route, {
      bookings: [confirmedBooking()],
      stats: { totalBookings: 1, totalRevenue: 104000, cancelRate: 0 },
      total: 1,
    }));
    await page.route(`**/api/v1/admin/bookings/${BOOKING_ID}`, (route) => fulfillJson(route, {
      ...confirmedBooking(),
      paymentInfo: { paymentKey: 'payment-key-1', method: 'CARD', amount: 104000, status: 'DONE',
        paidAt: '2026-05-13T09:00:00.000Z' },
      ticketItems: [],
    }));
    await page.route(`**/api/v1/admin/bookings/${BOOKING_ID}/refund-preview?**`, (route) => {
      const override = new URL(route.request().url()).searchParams.get('fullRefundOverride') === 'true';
      return fulfillJson(route, override ? previewWithQuote() : {
        ...previewWithQuote(),
        refundableAmount: 0,
        canRequestRefund: false,
        cancellationQuote: null,
        providerRefund: null,
        blockedReason: WINDOW_BLOCKER,
      });
    });
  });

  test('shows the server blocker and keeps refund confirm disabled until the override clears it', async ({ page }) => {
    await page.goto('/admin/bookings');
    await page.getByRole('button', { name: /Grabit Fanmeet 예매 상세 보기/ }).click();
    await page.getByRole('button', { name: '환불 처리' }).click();
    await page.getByLabel('환불 사유').fill('공연 취소');

    await expect(page.getByRole('alert').filter({ hasText: WINDOW_BLOCKER })).toBeVisible();
    await expect(page.getByRole('button', { name: '환불 확인' })).toBeDisabled();
    await page.screenshot({ path: test.info().outputPath('admin-refund-blocked.png') });

    await page.getByRole('checkbox', { name: '수수료 없이 전액 환불' }).click();

    await expect(page.getByRole('dialog').getByText('104,000원')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: WINDOW_BLOCKER })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '환불 확인' })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('admin-refund-override.png') });
  });
});

function previewWithQuote() {
  return {
    reservationId: BOOKING_ID,
    reservationNumber: 'GRP-CONFIRMED-0001',
    paymentKey: 'payment-key-1',
    refundableAmount: 104000,
    canRequestRefund: true,
    cancelledSeatHoldWindowMinutes: { min: 1, max: 10 },
    refundTimeline: null,
    cancellationQuote: {
      originalPaymentAmount: 104000,
      ticketSubtotal: 100000,
      ticketServiceFeeTotal: 4000,
      cancellationFeeTotal: 0,
      serviceFeeRefundTotal: 4000,
      refundableAmount: 104000,
      policyCodes: ['ADMIN_FULL_REFUND_OVERRIDE'],
      items: [],
    },
    providerRefund: { currency: 'KRW', amountMinor: 104000, amountDecimal: '104000' },
    blockedReason: null,
  };
}

function confirmedBooking() {
  return {
    id: BOOKING_ID,
    reservationNumber: 'GRP-CONFIRMED-0001',
    userName: '홍길동',
    userPhone: '+8210****5678',
    performanceTitle: 'Grabit Fanmeet',
    showDateTime: '2026-07-04T09:00:00.000Z',
    seats: [
      { seatId: 'seat-1', floorKey: '1F', floorLabel: '1층', seatKey: '1F:A-10', tierName: 'VIP', tierColor: '#6C3CE0',
        price: 50000, row: 'A', number: '10' },
      { seatId: 'seat-2', floorKey: '1F', floorLabel: '1층', seatKey: '1F:A-11', tierName: 'VIP', tierColor: '#6C3CE0',
        price: 50000, row: 'A', number: '11' },
    ],
    totalAmount: 104000,
    status: 'CONFIRMED',
    funnelStatus: 'SOLD',
    paymentStatus: 'DONE',
    paymentMethod: 'CARD',
    paymentFailureDiagnostic: null,
    paymentMethodAttribution: { label: '카드 / 카드사 / KRW', method: 'CARD', provider: 'CARD', currency: 'KRW', source: 'DB' },
    ticketStatusCounts: { ACTIVE: 2, CANCELLATION_PENDING: 0, CANCELLED: 0, EXPIRED: 0 },
    userEmail: 'buyer@example.com',
    userCountry: 'KR',
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}
