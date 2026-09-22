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
  '운영 현황',
  '공연 관리',
  '홈 배너',
  '예매·취소',
  '개인정보 동의 기록',
  '번역 검수',
  '고객 문의',
  '공지·자주 묻는 질문',
  '회원 관리',
  '좌석 관리',
  '관리자 활동 기록',
  '접근 보안',
] as const;

const PHASE_25_LINKS = [
  { label: '고객 문의', href: '/admin/operations' },
  { label: '공지·자주 묻는 질문', href: '/admin/support-content' },
  { label: '회원 관리', href: '/admin/users' },
  { label: '좌석 관리', href: '/admin/seat-operations' },
  { label: '관리자 활동 기록', href: '/admin/audit' },
  { label: '접근 보안', href: '/admin/security' },
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
      '이 화면은 운영 권한이 있는 계정만 사용할 수 있습니다.',
    );
  });

  test('admin sidebar preserves existing entries and exposes Phase 25 operations/security links', async ({
    page,
  }) => {
    await mockUser(page, { role: 'admin' });
    await mockAdminSecurityStatus(page);

    await page.goto('/admin/security');

    await page.getByRole('button', { name: '고객·콘텐츠', exact: true }).click();
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

    await page.getByRole('link', { name: '좌석 관리' }).click();
    await expect(page).toHaveURL(/\/admin\/seat-operations$/);
    await expect(
      page.getByRole('heading', { name: '좌석 관리', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText('회차별 좌석 비활성화, 재활성화, 운영 이력을 한 곳에서 관리합니다.'),
    ).toBeVisible();

    await page.goto('/admin/security');

    await expect(
      page.getByRole('heading', { name: '접근 보안', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText(
        '추가 본인 인증은 아직 적용되지 않았습니다. 허용된 접속 주소와 관리자 활동 기록으로 접근을 확인합니다.',
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
        phone: '+821000000000',
        gender: 'unspecified',
        country: 'KR',
        birthDate: '1990-01-01',
        preferredLocale: 'ko',
        marketingConsent: user.role === 'admin',
        isEmailVerified: true,
        isPhoneVerified: true,
        adminCapabilityBundle: user.role === 'admin' ? 'admin' : null,
        adminCapabilities:
          user.role === 'admin'
            ? [
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
              ]
            : [],
        createdAt: '2026-05-01T00:00:00.000Z',
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
          note: '추가 본인 인증은 아직 적용되지 않았습니다. 허용된 접속 주소와 관리자 활동 기록으로 접근을 확인합니다.',
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
          '추가 본인 인증은 아직 적용되지 않았습니다. 허용된 접속 주소와 관리자 활동 기록으로 접근을 확인합니다.',
        requiredCapability: 'security.manage',
      }),
    });
  });
}
