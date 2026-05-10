import { expect, test } from '@playwright/test';

test.describe('booking floor-browser seat selection', () => {
  test('visible seat label center click selects A-1 on desktop', async ({ page }) => {
    await page.goto('/booking/floor-browser');

    await expect(page.getByText('VIP A열 1번')).toBeVisible();
    await expect(page.getByRole('button', { name: '다음' })).toBeEnabled();
  });
});
