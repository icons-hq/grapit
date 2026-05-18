import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { fulfillJson } from './helpers/mock-admin';

const memberUser = {
  id: 'member-e2e-user',
  email: 'member@example.com',
  name: '홍회원',
  role: 'user',
  phone: '+821011112222',
  gender: 'unspecified',
  country: 'KR',
  birthDate: '1994-01-01',
  preferredLocale: 'ko',
  marketingConsent: false,
  isEmailVerified: true,
  isPhoneVerified: true,
  adminCapabilityBundle: null,
  adminCapabilities: [],
  createdAt: '2026-05-01T00:00:00.000Z',
};

test.describe('My page account withdrawal', () => {
  test('requires explicit confirmation and posts self-withdrawal from the browser', async ({
    page,
  }) => {
    const requests = await mockMemberSession(page);

    await page.goto('/mypage?tab=settings');

    await expect(page.getByRole('heading', { name: '설정 센터' })).toBeVisible();
    await expect(page.getByText('회원 탈퇴').first()).toBeVisible();

    const withdrawButton = page.getByRole('button', { name: '회원 탈퇴' });
    await expect(withdrawButton).toBeDisabled();

    await page.getByLabel('탈퇴 사유').fill('서비스 이용 종료');
    await page.getByRole('checkbox', { name: '회원 탈퇴 확인' }).click();
    await expect(withdrawButton).toBeEnabled();
    await withdrawButton.click();
    await page.getByRole('button', { name: '탈퇴 확정' }).click();

    await expect.poll(() => requests.withdrawPayloads.length).toBe(1);
    expect(requests.withdrawPayloads[0]).toEqual({
      reason: '서비스 이용 종료',
      confirmed: true,
    });
    await expect(page).toHaveURL(/\/auth\?withdrawn=1/);
  });
});

async function mockMemberSession(page: Page) {
  const withdrawPayloads: Array<Record<string, unknown>> = [];

  await page.route('**/api/v1/auth/refresh', async (route) => {
    await fulfillJson(route, { accessToken: 'member-e2e-access-token' });
  });

  await page.route('**/api/v1/users/me/reservations**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/v1/users/me/withdrawal', async (route) => {
    withdrawPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 204 });
  });

  await page.route('**/api/v1/users/me', async (route) => {
    await handleUserMeRoute(route);
  });

  return { withdrawPayloads };
}

async function handleUserMeRoute(route: Route) {
  const request = route.request();
  if (request.method() === 'GET') {
    await fulfillJson(route, memberUser);
    return;
  }

  await route.fallback();
}
