import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

test.describe('admin event publish review', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);

    const performance = createPerformanceFixture();
    await page.route('**/api/v1/performances/perf-25-08', async (route) => {
      await fulfillJson(route, performance);
    });
    await page.route(
      '**/api/v1/admin/performances/perf-25-08',
      async (route) => {
        await fulfillJson(route, performance);
      },
    );
    await page.route(
      '**/api/v1/admin/performances/perf-25-08/publish',
      async (route) => {
        await fulfillJson(route, {
          ...performance,
          publishState: 'published',
          publishedAt: '2026-05-14T00:00:00.000Z',
        });
      },
    );
  });

  test('shows venue, transport, sale summary, and reason-gated publish confirmation', async ({
    page,
  }) => {
    await page.goto('/admin/performances/perf-25-08/edit');

    await expect(page.getByText('동해문화예술관 대극장')).toBeVisible();
    await expect(page.getByText('6호선 고려대역 하차 후 도보 10분')).toBeVisible();

    await page.getByRole('button', { name: '이벤트 게시하기' }).click();

    await expect(
      page.getByRole('heading', { name: '이 이벤트를 게시하시겠습니까?' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        '게시 후 공개 화면과 판매 설정이 운영 기준으로 반영됩니다. 변경된 필드와 판매 일정을 확인한 뒤 진행하세요.',
      ),
    ).toBeVisible();

    const confirm = page.getByRole('button', { name: '이벤트 게시하기' }).last();
    await expect(confirm).toBeDisabled();

    await page.getByLabel('게시 사유').fill('운영 기준 확인 완료');
    await expect(confirm).toBeDisabled();

    await page
      .getByRole('checkbox', {
        name: '변경된 필드와 판매 일정을 확인했습니다',
      })
      .check();
    await expect(confirm).toBeEnabled();
  });
});

function createPerformanceFixture() {
  return {
    id: 'perf-25-08',
    title: 'Grabit Fanmeet 2026',
    genre: 'artist_celebrity',
    subcategory: null,
    venueId: 'venue-25',
    posterUrl: null,
    description: '운영 검증용 팬미팅 상세 설명입니다.',
    startDate: '2026-07-04T09:00:00.000Z',
    endDate: '2026-07-04T12:00:00.000Z',
    runtime: '120분',
    ageRating: '만 7세 이상',
    status: 'upcoming',
    publishState: 'publish_ready',
    publishReviewRequestedAt: '2026-05-14T00:00:00.000Z',
    publishReadyAt: '2026-05-14T00:30:00.000Z',
    publishedAt: null,
    publishedByUserId: null,
    salesInfo: '팬클럽 선예매 후 일반 판매',
    viewCount: 10,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    venue: {
      id: 'venue-25',
      name: '동해문화예술관 대극장',
      address: '서울시 성북구 운영로 25',
      accessNotes: '공연 60분 전 입장 시작',
      transportSummary: '6호선 고려대역 하차 후 도보 10분',
    },
    priceTiers: [
      {
        id: 'tier-vip',
        performanceId: 'perf-25-08',
        tierName: 'VIP',
        price: 110000,
        sortOrder: 0,
      },
    ],
    showtimes: [
      {
        id: 'showtime-25',
        performanceId: 'perf-25-08',
        dateTime: '2026-07-04T09:00:00.000Z',
      },
    ],
    castings: [],
    seatMaps: [],
    bookingPolicy: {
      maxTicketsPerUser: 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap: null,
  };
}
