import { expect, test } from '@playwright/test';
import { fulfillJson, mockAdminAuth } from './helpers/mock-admin';

test.describe('Admin Operations Inbox E2E', () => {
  test.beforeEach(async ({ page }) => {
    await mockAdminAuth(page);
    await page.route('**/api/v1/admin/operations/inbox**', async (route) => {
      await fulfillJson(route, {
        generatedAt: '2026-05-14T00:00:00.000Z',
        totals: { all: 1, escalated: 1, overdue: 1, dueSoon: 0 },
        rows: [
          {
            id: 'ops-1',
            source: 'refund_dispute',
            sourceLabel: '환불 분쟁',
            category: 'refund_dispute',
            categoryLabel: '환불 분쟁',
            subject: '환불 분쟁 확인 요청',
            summary: '고객 환불 상태 확인 필요',
            locale: 'ko',
            status: 'open',
            queue: 'CS 1차',
            assignee: {
              id: 'admin-1',
              name: '운영자',
              email: 'op***@grapit.test',
            },
            requester: {
              id: 'user-1',
              email: 'ra***@example.com',
              phone: '+8210****5678',
              name: '김**',
            },
            priority: 'overdue',
            escalation: {
              state: 'escalated',
              escalated: true,
              label: '즉시 확인',
            },
            sla: {
              dueAt: '2026-05-13T23:00:00.000Z',
              remainingMinutes: -90,
              state: 'overdue',
              label: '기한 초과',
            },
            createdAt: '2026-05-13T00:00:00.000Z',
            updatedAt: '2026-05-14T00:00:00.000Z',
            lastMessageAt: '2026-05-14T00:00:00.000Z',
            reservationId: 'reservation-1',
            refundDispute: {
              refundId: 'refund-1',
              status: 'requested',
              retainedForAudit: true,
              requestedAt: '2026-05-13T00:00:00.000Z',
              expectedDepositAt: null,
            },
            signupFailure: null,
          },
        ],
      });
    });
  });

  test('renders the unified operations queue with SLA and escalation signals', async ({
    page,
  }) => {
    await page.goto('/admin/operations');

    await expect(
      page.getByRole('heading', { name: '운영 인박스', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: '카테고리' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'SLA' })).toBeVisible();
    const row = page
      .getByTestId('operations-inbox-row')
      .filter({ hasText: '환불 분쟁 확인 요청' });
    await expect(row).toBeVisible();
    await expect(row.getByText('기한 초과')).toBeVisible();
    await expect(row.getByText('즉시 확인')).toBeVisible();
  });

  test('keeps requester metadata masked in table rows', async ({ page }) => {
    await page.goto('/admin/operations');

    await expect(page.getByText('raw-customer@example.com')).toHaveCount(0);
    await expect(page.getByText('ra***@example.com')).toBeVisible();
    await expect(page.getByText('+8210****5678')).toBeVisible();
  });
});
