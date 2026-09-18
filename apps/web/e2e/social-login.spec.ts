import { test, expect } from '@playwright/test';

test.describe('Social Login - Error Scenarios', () => {
  test('oauth_denied 에러 시 취소 메시지와 재시도 버튼이 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=oauth_denied&provider=kakao');
    await expect(page.getByText('소셜 로그인이 취소되었습니다.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('oauth_failed 에러 시 실패 메시지와 재시도 버튼이 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=oauth_failed&provider=naver');
    await expect(page.getByText('소셜 로그인에 실패했습니다. 다시 시도해주세요.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('server_error 에러 시 일시적 오류 메시지가 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=server_error&provider=google');
    await expect(page.getByText('일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('account_conflict 에러 시 계정 충돌 메시지가 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=account_conflict&provider=kakao');
    await expect(page.getByText('이미 다른 계정에 연결된 소셜 계정입니다. 기존 계정으로 로그인해주세요.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('token_expired 에러 시 만료 메시지가 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=token_expired');
    await expect(page.getByText('로그인 세션이 만료되었습니다. 다시 시도해주세요.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('알 수 없는 에러 코드 시 기본 에러 메시지가 표시된다', async ({ page }) => {
    await page.goto('/auth/callback?error=unknown_error');
    // Unknown error codes fall back to server_error messages
    await expect(page.getByText('일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')).toBeVisible();
    await expect(page.getByText('다시 로그인하기')).toBeVisible();
  });

  test('재시도 버튼 클릭 시 /auth 로그인 페이지로 이동한다', async ({ page }) => {
    await page.goto('/auth/callback?error=oauth_failed&provider=kakao');
    await page.getByText('다시 로그인하기').click();
    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe('Social Login - Login Page Error Display', () => {
  test('소셜 에러 query parameter로 로그인 페이지에 에러 메시지가 표시된다', async ({ page }) => {
    await page.goto('/auth?error=oauth_failed');
    await expect(page.getByText('소셜 로그인에 실패했습니다. 다시 시도해주세요.')).toBeVisible();
  });
});

test.describe('Social Login - Processing State', () => {
  test('callback waits for one session refresh, then exits loading when refresh fails', async ({ page }) => {
    let releaseRefresh!: () => void;
    const pendingRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let refreshCount = 0;
    await page.route('**/api/v1/auth/refresh', async (route) => {
      refreshCount += 1;
      await pendingRefresh;
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/auth/callback?status=authenticated');
    await expect(page.getByText('로그인 처리 중...', { exact: true })).toBeVisible();
    releaseRefresh();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole('tab', { name: '로그인', exact: true })).toBeVisible();
    expect(refreshCount).toBe(1);
  });
});

test.describe('Social Login - Localized callback recovery', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const { locale, message, retry, conflict } of [
    { locale: 'en', message: 'Social login failed. Please try again.', retry: 'Try logging in again', conflict: 'This social account is already connected to another account. Log in using the existing account.' },
    { locale: 'th', message: 'เข้าสู่ระบบด้วยโซเชียลไม่สำเร็จ โปรดลองอีกครั้ง', retry: 'ลองเข้าสู่ระบบอีกครั้ง', conflict: 'บัญชีโซเชียลนี้เชื่อมต่อกับบัญชีอื่นแล้ว กรุณาเข้าสู่ระบบด้วยบัญชีเดิม' },
    { locale: 'zh-CN', message: '社交登录失败。请重试。', retry: '重新登录', conflict: '该社交账号已连接到其他账户。请使用原有账户登录。' },
  ]) {
    test(`localized ${locale} conflict action identifies the existing account`, async ({ page }) => {
      await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, body: '{}' }));
      await page.goto(`/${locale}/auth/callback?error=account_conflict&provider=kakao`);
      await expect(page.getByText(conflict, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: retry, exact: true })).toBeVisible();
    });
    test(`localized ${locale} error and retry keep the selected language`, async ({ page }, testInfo) => {
      await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, body: '{}' }));
      await page.goto(`/${locale}/auth/callback?error=oauth_failed&provider=kakao`);
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await testInfo.attach(`callback-${locale}`, { body: await page.screenshot(), contentType: 'image/png' });
      await page.getByRole('button', { name: retry, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/auth$`));
    });
  }
});
