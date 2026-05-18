import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

const adminCapabilities = [
  'event.write',
  'event.publish',
  'support.manage',
  'support.escalate',
  'reservations.export_raw',
  'seat.disable',
  'seat.reactivate',
  'seat.manual_open',
  'banner.manage',
  'audit.read',
  'security.manage',
] as const;

const listUser = {
  id: 'user-fan-1',
  name: '박팬',
  maskedEmail: 'pa***@example.com',
  maskedPhone: '+82********78',
  role: 'admin',
  preferredLocale: 'ko',
  country: 'KR',
  marketingConsent: true,
  adminCapabilityBundle: 'admin',
  adminCapabilities,
  verification: {
    email: true,
    phone: false,
  },
  reservations: {
    total: 3,
    pendingPayment: 1,
    confirmed: 2,
    cancelled: 0,
    totalAmount: 240000,
  },
  support: {
    openThreads: 1,
    totalThreads: 2,
    latestThreadAt: '2026-05-17T03:00:00.000Z',
    latestSubject: '좌석 위치 문의',
  },
  audit: {
    lastActionAt: '2026-05-17T02:00:00.000Z',
    lastAction: 'security.permission.update',
  },
  createdAt: '2026-05-01T00:00:00.000Z',
  lastActivityAt: '2026-05-17T04:00:00.000Z',
};

const secondPageUser = {
  ...listUser,
  id: 'user-fan-2',
  name: '이페이지',
  maskedEmail: 'se***@example.com',
  maskedPhone: '+82********99',
  role: 'user',
  adminCapabilityBundle: null,
  adminCapabilities: [],
  reservations: {
    total: 1,
    pendingPayment: 0,
    confirmed: 1,
    cancelled: 0,
    totalAmount: 120000,
  },
};

const detailUser = {
  ...listUser,
  email: 'parkfan@example.com',
  phone: '+821012345678',
  gender: 'unspecified',
  birthDate: '1995-01-01',
  accountStatus: 'active',
  lastLoginAt: '2026-05-17T04:00:00.000Z',
  recentReservations: [
    {
      id: 'reservation-1',
      reservationNumber: 'R-20260517-001',
      performanceTitle: '걸룰스 팬미팅',
      status: 'CONFIRMED',
      totalAmount: 120000,
      createdAt: '2026-05-17T01:00:00.000Z',
      showDateTime: '2026-06-01T10:00:00.000Z',
    },
  ],
  supportThreads: [
    {
      id: 'support-1',
      subject: '좌석 위치 문의',
      status: 'open',
      category: 'seat',
      lastMessageAt: '2026-05-17T03:00:00.000Z',
      createdAt: '2026-05-17T02:40:00.000Z',
    },
  ],
  recentAuditEvents: [
    {
      id: 'audit-1',
      actorUserId: 'admin-1',
      action: 'security.permission.update',
      status: 'success',
      reason: '운영 담당자 권한 조정',
      changedFields: ['adminCapabilities'],
      ipAddress: '203.0.113.0',
      createdAt: '2026-05-17T02:00:00.000Z',
    },
  ],
};

const secondPageDetailUser = {
  ...detailUser,
  ...secondPageUser,
  email: 'secondfan@example.com',
  phone: '+821099999999',
  recentReservations: [
    {
      id: 'reservation-2',
      reservationNumber: 'R-20260517-002',
      performanceTitle: '두번째 페이지 공연',
      status: 'CONFIRMED',
      totalAmount: 120000,
      createdAt: '2026-05-17T01:00:00.000Z',
      showDateTime: '2026-06-01T10:00:00.000Z',
    },
  ],
};

test.describe('Admin user management', () => {
  test('renders list/detail context and sends reasoned confirmed permission updates', async ({
    page,
  }) => {
    await mockAdminAuth(page);
    const requests = await mockAdminUsers(page);

    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: '회원 관리', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: '회원 관리' }).first()).toHaveAttribute(
      'href',
      '/admin/users',
    );
    await expect(page.getByRole('button', { name: '박팬 회원 상세 보기' })).toBeVisible();
    await expect(page.getByText('parkfan@example.com')).toBeVisible();
    await expect(page.getByText('예매 컨텍스트')).toBeVisible();
    await expect(page.getByText('걸룰스 팬미팅')).toBeVisible();
    await expect(page.getByText('CS 컨텍스트')).toBeVisible();
    await expect(page.getByText('좌석 위치 문의')).toBeVisible();
    await expect(page.getByText('Masked audit 컨텍스트')).toBeVisible();
    await expect(page.getByText(/masked IP 203\.0\.113\.0/)).toBeVisible();

    const searchRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === '/api/v1/admin/users' &&
        url.searchParams.get('search') === 'fan'
      );
    });
    await page.getByLabel('회원 검색어').fill('fan');
    await page.getByRole('button', { name: '검색' }).click();
    await searchRequest;

    await page.getByRole('checkbox', { name: '보안 권한 관리' }).click();
    await page.getByLabel('권한 변경 사유').fill('보안 담당자 교체로 권한을 회수합니다.');
    await page.getByRole('checkbox', { name: '권한 변경 영향 확인' }).click();
    await page.getByRole('button', { name: '권한 변경 검토' }).click();
    await page.getByRole('button', { name: '변경 확정' }).click();

    await expect.poll(() => requests.patchPayloads.length).toBe(1);
    expect(requests.patchPayloads[0]).toMatchObject({
      role: 'admin',
      adminCapabilityBundle: 'admin',
      reason: '보안 담당자 교체로 권한을 회수합니다.',
      confirmed: true,
    });
    expect(requests.patchPayloads[0].adminCapabilities).not.toContain(
      'security.manage',
    );
  });

  test('shows pagination and switches detail context on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAdminAuth(page);
    await mockAdminUsers(page);

    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: '회원 관리', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '페이지 네비게이션' })).toBeVisible();
    await expect(page.getByText('총 50명 · 1/2 페이지')).toBeVisible();
    await expect(page.getByText('parkfan@example.com')).toBeVisible();

    const pageTwoRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === '/api/v1/admin/users' &&
        url.searchParams.get('page') === '2'
      );
    });
    await page.getByRole('button', { name: '2' }).click();
    await pageTwoRequest;

    await expect(page.getByRole('button', { name: '이페이지 회원 상세 보기' })).toBeVisible();
    await expect(page.getByText('secondfan@example.com')).toBeVisible();
    await expect(page.getByText('parkfan@example.com')).not.toBeVisible();
  });
});

async function mockAdminUsers(page: Page) {
  const patchPayloads: Array<Record<string, unknown>> = [];

  await page.route('**/api/v1/admin/users**', async (route) => {
    await handleAdminUsersRoute(route, patchPayloads);
  });

  return { patchPayloads };
}

async function handleAdminUsersRoute(
  route: Route,
  patchPayloads: Array<Record<string, unknown>>,
) {
  const request = route.request();
  const url = new URL(request.url());

  if (request.method() === 'GET' && url.pathname === '/api/v1/admin/users') {
    const page = Number(url.searchParams.get('page') ?? 1);
    await fulfillJson(route, {
      items: page === 2 ? [secondPageUser] : [listUser],
      total: 50,
      page,
      limit: Number(url.searchParams.get('limit') ?? 25),
      totalPages: 2,
    });
    return;
  }

  if (
    request.method() === 'GET' &&
    url.pathname === '/api/v1/admin/users/user-fan-1'
  ) {
    await fulfillJson(route, detailUser);
    return;
  }

  if (
    request.method() === 'GET' &&
    url.pathname === '/api/v1/admin/users/user-fan-2'
  ) {
    await fulfillJson(route, secondPageDetailUser);
    return;
  }

  if (
    request.method() === 'PATCH' &&
    url.pathname === '/api/v1/admin/users/user-fan-1/permissions'
  ) {
    patchPayloads.push(request.postDataJSON() as Record<string, unknown>);
    await fulfillJson(route, {
      ...detailUser,
      adminCapabilities: adminCapabilities.filter(
        (capability) => capability !== 'security.manage',
      ),
    });
    return;
  }

  await route.fallback();
}
