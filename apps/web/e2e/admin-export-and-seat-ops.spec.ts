import { expect, test } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

/**
 * Deferred route-level E2E contract for Phase 25 reservation export + seat ops.
 *
 * Do not treat this file as complete route evidence in Plan 25-11. It stays
 * skipped until Plan 25-23 wires the full admin route surface and Plan 25-15
 * runs final verification.
 */
test.describe.skip('Admin export and seat operations - deferred until 25-23/25-15', () => {
  test('exports raw reservation CSV only after reasoned confirmation', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin/bookings');

    await expect(page.getByRole('heading', { name: '예매 관리' })).toBeVisible();
    await expect(page.getByLabel('이벤트')).toBeVisible();
    await page.getByRole('button', { name: '예약자 원본 CSV 내보내기' }).click();
    await expect(
      page.getByRole('heading', { name: '예약자 원본 CSV를 내보내시겠습니까?' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'CSV 내보내기' })).toBeDisabled();
  });

  test('keeps cancelled-seat immediate open in reservation detail flow', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/admin/bookings');

    await expect(page.getByRole('heading', { name: '예매 관리' })).toBeVisible();
    await expect(page.getByText('취소 좌석 즉시 개방')).toBeVisible();
  });
});
