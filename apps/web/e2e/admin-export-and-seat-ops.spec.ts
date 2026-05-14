import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

test.describe('Admin export and seat operations', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);
    await page.route('**/api/v1/admin/bookings?**', async (route) => {
      await fulfillJson(route, {
        bookings: [createCancelledBooking()],
        stats: { totalBookings: 1, totalRevenue: 110000, cancelRate: 1 },
        total: 1,
      });
    });
    await page.route(
      '**/api/v1/admin/bookings/reservation-cancelled-1',
      async (route) => {
        await fulfillJson(route, {
          ...createCancelledBooking(),
          paymentInfo: {
            paymentKey: 'payment-key-1',
            method: 'CARD',
            amount: 110000,
            status: 'CANCELED',
            paidAt: '2026-05-13T09:00:00.000Z',
          },
        });
      },
    );
    await page.route('**/api/v1/admin/seat-operations/history**', async (route) => {
      await fulfillJson(route, {
        rows: [
          {
            id: 'seat-history-1',
            showtimeId: 'showtime-1',
            seatKey: '1F:A-10',
            operation: 'seat.manual_open',
            previousStatus: 'held_cancelled',
            nextStatus: 'available',
            reason: '취소 입금 확인',
            operatedByUserId: 'admin-1',
            reservationId: 'reservation-cancelled-1',
            createdAt: '2026-05-14T00:00:00.000Z',
          },
        ],
      });
    });
  });

  test('exports raw reservation CSV only after reasoned confirmation', async ({
    page,
  }) => {
    await page.goto('/admin/bookings');

    await expect(page.getByRole('heading', { name: '예매 관리' })).toBeVisible();
    await expect(page.getByLabel('이벤트')).toBeVisible();
    await page.getByRole('button', { name: '예약자 원본 CSV 내보내기' }).click();
    await expect(
      page.getByRole('heading', { name: '예약자 원본 CSV를 내보내시겠습니까?' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'CSV 내보내기' }),
    ).toBeDisabled();
  });

  test('keeps cancelled-seat immediate open in reservation detail flow and seat toggles in the dedicated panel', async ({
    page,
  }) => {
    await page.goto('/admin/bookings');

    await expect(page.getByRole('heading', { name: '예매 관리' })).toBeVisible();
    await page
      .getByRole('button', { name: /Grabit Fanmeet 예매 상세 보기/ })
      .click();
    await page.getByRole('button', { name: '취소 좌석 즉시 개방' }).click();
    await expect(
      page.getByRole('heading', {
        name: '이 취소 좌석을 지금 즉시 개방하시겠습니까?',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '즉시 개방 확인' }),
    ).toBeDisabled();

    await page.goto('/admin/seat-operations');
    await expect(
      page.getByRole('heading', { name: '좌석 운영', level: 1 }),
    ).toBeVisible();
    await page.getByLabel('회차 ID').fill('showtime-1');
    await page.getByLabel('좌석 키').fill('1F:A-10');
    await page.getByRole('button', { name: '좌석 비활성화' }).click();
    await expect(
      page.getByRole('button', { name: '비활성화 확인' }),
    ).toBeDisabled();
  });
});

function createCancelledBooking() {
  return {
    id: 'reservation-cancelled-1',
    reservationNumber: 'GRP-CANCEL-0001',
    userName: '홍길동',
    userPhone: '+8210****5678',
    performanceTitle: 'Grabit Fanmeet',
    showDateTime: '2026-07-04T09:00:00.000Z',
    seats: [
      {
        seatId: 'seat-1',
        floorKey: '1F',
        floorLabel: '1층',
        seatKey: '1F:A-10',
        tierName: 'VIP',
        tierColor: '#6C3CE0',
        price: 110000,
        row: 'A',
        number: '10',
      },
    ],
    totalAmount: 110000,
    status: 'CANCELLED',
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}
