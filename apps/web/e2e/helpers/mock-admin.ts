import type { Page, Route } from '@playwright/test';

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockAdminAuth(page: Page) {
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await fulfillJson(route, { accessToken: 'admin-e2e-access-token' });
  });

  await page.route('**/api/v1/users/me', async (route) => {
    await fulfillJson(route, {
      id: 'admin-e2e-user',
      email: 'admin@grapit.test',
      name: '관리자',
      role: 'admin',
      phone: '010-0000-0000',
      gender: 'unspecified',
      country: 'KR',
      birthDate: '1990-01-01',
      preferredLocale: 'ko',
      marketingConsent: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      adminCapabilityBundle: 'admin',
      adminCapabilities: [
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
      ],
      createdAt: '2026-05-01T00:00:00.000Z',
    });
  });
}
