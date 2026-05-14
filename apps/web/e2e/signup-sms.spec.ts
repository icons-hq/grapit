import { test, expect } from '@playwright/test';

/**
 * SMS Mock 모드 E2E 테스트 -- Plan 09 GREEN 전환
 *
 * CI 환경에서 TWILIO_ACCOUNT_SID 미설정 -> dev mock 자동 진입
 * 000000 유니버설 코드로 회원가입 step3 전화번호 인증 플로우 완주
 *
 * 전제 조건:
 * - web(3000) + api(8080) 모두 실행 중
 * - API는 TWILIO_ACCOUNT_SID 미설정 상태 -> dev mock 모드
 */

test.describe('회원가입 SMS 인증 (mock 모드)', () => {
  /**
   * 회원가입 step1(이메일/비밀번호) + step2(약관) 진행 헬퍼.
   * step3 전화번호 인증 화면까지 도달합니다.
   */
  async function navigateToStep3(page: import('@playwright/test').Page) {
    await page.goto('/auth');

    // 회원가입 탭 클릭
    await page.getByRole('tab', { name: '회원가입' }).click();

    // Step 1: 이메일/비밀번호
    const timestamp = Date.now();
    await page.getByPlaceholder('이메일을 입력해주세요').fill(`test${timestamp}@e2e.grabit.dev`);
    await page.getByPlaceholder('비밀번호를 입력해주세요').fill('TestPass1!');
    await page.getByPlaceholder('비밀번호를 다시 입력해주세요').fill('TestPass1!');
    await page.getByRole('button', { name: '다음' }).click();

    // Step 2: 약관 동의
    await expect(page.getByText('전체 동의')).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('전체 동의').check();
    await page.getByRole('button', { name: '다음' }).click();

    // Step 3: 개인정보 + 전화번호 인증 화면
    await expect(page.getByLabel('전화번호')).toBeVisible({ timeout: 10_000 });
  }

  test('전화번호 인증 mock(000000)으로 회원가입 step3 인증 완료', async ({ page }) => {
    await navigateToStep3(page);

    // 이름 입력
    await page.getByPlaceholder('이름을 입력해주세요').fill('테스트유저');

    // 성별 선택
    await page.getByRole('button', { name: '선택안함' }).click();

    // 생년월일 입력
    await page.getByPlaceholder('YYYY').fill('1990');
    await page.getByPlaceholder('MM').fill('01');
    await page.getByPlaceholder('DD').fill('15');

    // 전화번호 입력
    const phoneInput = page.getByLabel('전화번호');
    await phoneInput.fill('01012345678');

    // 인증번호 발송
    await page.getByRole('button', { name: '인증번호 발송' }).click();

    // 쿨다운 라벨 확인: "재발송 (30s)" or similar
    await expect(page.getByText(/재발송.*\d+s/)).toBeVisible({ timeout: 10_000 });

    // 만료 타이머 확인 (Twilio Verify 기본 10분)
    await expect(page.locator('text=/^(0\\d|10):\\d{2}$/')).toBeVisible({ timeout: 10_000 });

    // 인증번호 6자리 입력 (mock 모드: 000000)
    const codeInput = page.getByLabel('인증번호 6자리');
    await expect(codeInput).toBeVisible({ timeout: 10_000 });
    await codeInput.fill('000000');

    // 확인 버튼 클릭
    await page.getByRole('button', { name: '확인' }).click();

    // 인증 완료 확인
    await expect(page.getByText('인증 완료')).toBeVisible({ timeout: 10_000 });
  });

  test('잘못된 인증번호 -> "인증번호가 일치하지 않습니다"', async ({ page }) => {
    await navigateToStep3(page);

    // 이름/성별/생년월일 입력
    await page.getByPlaceholder('이름을 입력해주세요').fill('테스트유저');
    await page.getByRole('button', { name: '선택안함' }).click();
    await page.getByPlaceholder('YYYY').fill('1990');
    await page.getByPlaceholder('MM').fill('01');
    await page.getByPlaceholder('DD').fill('15');

    // 전화번호 입력 + 발송
    await page.getByLabel('전화번호').fill('01012345678');
    await page.getByRole('button', { name: '인증번호 발송' }).click();

    // 잘못된 인증번호 입력
    const codeInput = page.getByLabel('인증번호 6자리');
    await expect(codeInput).toBeVisible({ timeout: 10_000 });
    await codeInput.fill('111111');
    await page.getByRole('button', { name: '확인' }).click();

    // 에러 메시지 확인
    await expect(page.getByText('인증번호가 일치하지 않습니다')).toBeVisible({ timeout: 10_000 });
  });

  test('30초 쿨다운 "재발송 (Ns)" 라벨 존재 확인', async ({ page }) => {
    await navigateToStep3(page);

    // 전화번호 입력
    await page.getByLabel('전화번호').fill('01012345678');

    // 인증번호 발송
    await page.getByRole('button', { name: '인증번호 발송' }).click();

    // 쿨다운 라벨 확인: "재발송 (30s)" or similar countdown
    await expect(page.getByText(/재발송.*\d+s/)).toBeVisible({ timeout: 10_000 });
  });
});
