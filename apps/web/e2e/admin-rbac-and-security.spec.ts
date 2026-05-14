import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd().endsWith(path.join('apps', 'web'))
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

const PHASE_25_ADMIN_REGISTRATIONS = [
  'AdminOperationsController',
  'AdminSupportContentController',
  'AdminSeatOperationsController',
  'AdminAuditController',
  'AdminSecurityController',
  'AdminOperationsService',
  'AdminSupportContentService',
  'AdminSeatOperationsService',
  'AdminAuditService',
  'AdminSecurityService',
  'AdminCapabilitiesGuard',
] as const;

const ADMIN_SIDEBAR_LABELS = [
  '대시보드',
  '공연 관리',
  '배너 관리',
  '예매 관리',
  '동의 감사',
  '번역 검수',
  '운영 인박스',
  'FAQ/공지',
  '좌석 운영',
  '감사 로그',
  '보안 설정',
] as const;

const PHASE_25_LINKS = [
  { label: '운영 인박스', href: '/admin/operations' },
  { label: 'FAQ/공지', href: '/admin/support-content' },
  { label: '좌석 운영', href: '/admin/seat-operations' },
  { label: '감사 로그', href: '/admin/audit' },
  { label: '보안 설정', href: '/admin/security' },
] as const;

test.describe('Admin RBAC and security route wiring', () => {
  test('AdminModule registers every Phase 25 admin controller and provider before route smoke runs', async () => {
    const adminModule = await readFile(
      path.join(ROOT, 'apps/api/src/modules/admin/admin.module.ts'),
      'utf8',
    );

    for (const registration of PHASE_25_ADMIN_REGISTRATIONS) {
      expect
        .soft(adminModule, `${registration} must be registered in AdminModule`)
        .toContain(registration);
    }
  });

  test('non-admin users see an explicit access-denied state', async ({ page }) => {
    await mockUser(page, { role: 'user' });

    await page.goto('/admin/security');

    const accessDenied = page.getByRole('alert', {
      name: '관리자 접근 권한이 없습니다',
    });
    await expect(accessDenied).toBeVisible();
    await expect(accessDenied).toContainText(
      '백엔드 권한 검사는 계속 API guard에서 처리됩니다.',
    );
  });

  test('admin sidebar preserves existing entries and exposes Phase 25 operations/security links', async ({
    page,
  }) => {
    await mockUser(page, { role: 'admin' });
    await mockAdminSecurityStatus(page);

    await page.goto('/admin/security');

    for (const label of ADMIN_SIDEBAR_LABELS) {
      await expect(
        page.getByRole('link', { name: label }).first(),
        `${label} sidebar link should remain visible`,
      ).toBeVisible();
    }

    for (const link of PHASE_25_LINKS) {
      await expect(page.getByRole('link', { name: link.label })).toHaveAttribute(
        'href',
        link.href,
      );
    }

    await expect(
      page.getByRole('heading', { name: '보안 운영', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.',
      ).first(),
    ).toBeVisible();
  });
});

async function mockUser(page: Page, user: { role: 'user' | 'admin' }) {
  await page.route('**/api/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: `${user.role}-access-token` }),
    });
  });
  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `${user.role}-user-id`,
        email: `${user.role}@grapit.test`,
        name: user.role === 'admin' ? '관리자' : '일반 사용자',
        role: user.role,
      }),
    });
  });
}

async function mockAdminSecurityStatus(page: Page) {
  await page.route('**/api/v1/admin/security/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mfa: {
          status: 'deferred_accepted_risk',
          note: 'MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.',
        },
        ipAllowlist: {
          mode: 'monitoring',
          activeRecords: 0,
          lastChangedAt: null,
        },
        lastAuditEventAt: null,
        currentRequest: {
          allowed: true,
          source: 'non_production_bypass',
          maskedIpAddress: '127.0.0.0',
          matchedCidr: null,
          allowlistRecordId: null,
          reason: 'E2E non-production route smoke',
        },
        deferredMfaCopy:
          'MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.',
        requiredCapability: 'security.manage',
      }),
    });
  });
}
