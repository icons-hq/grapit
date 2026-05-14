import { expect, test } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe.skip('Admin Operations Inbox E2E - enabled in Plan 25-23', () => {
  test('renders the unified operations queue with SLA and escalation signals', async ({
    page,
  }) => {
    await loginAsTestUser(page);
    await page.goto('/admin/operations');

    await expect(
      page.getByRole('heading', { name: '운영 인박스', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('카테고리')).toBeVisible();
    await expect(page.getByText('SLA')).toBeVisible();
  });

  test('keeps requester metadata masked in table rows', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin/operations');

    await expect(page.getByText(/@\w+/)).not.toContainText(
      /raw-customer@example\.com/,
    );
    await expect(page.getByText(/\*\*\*/).first()).toBeVisible();
  });
});
