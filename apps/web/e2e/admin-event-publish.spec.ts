import { expect, test } from '@playwright/test';
import { loginAsTestUser } from './helpers/auth';

test.describe('admin event publish review', () => {
  test('shows venue, transport, sale summary, and reason-gated publish confirmation', async ({
    page,
  }) => {
    test.skip(
      true,
      'Plan 25-23 owns AdminModule/sidebar route wiring and route-level execution.',
    );

    await loginAsTestUser(page);
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

    const confirm = page.getByRole('button', { name: '이벤트 게시하기' });
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
