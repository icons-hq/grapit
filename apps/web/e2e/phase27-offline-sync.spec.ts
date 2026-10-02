import { expect, test, type Page, type Route } from '@playwright/test';

const fieldShowtimeId = '00000000-0000-4000-8000-000000000027';
const rawQrToken = 'raw-token-phase27-offline-should-not-render';
const rawQrJTI = 'raw-JTI-phase27-offline-should-not-render';
const rawPaymentKey = 'raw-payment-key-offline-should-not-render';
const rawBuyerEmail = 'offline-buyer-phase27@example.com';

async function mockScannerSession(page: Page) {
  await page.route('**/api/v1/field/check-in/showtimes', async (route) => {
    await route.fulfill({ json: [{ id: fieldShowtimeId, eventId: 'field-event', title: 'Phase 27 Offline Sync Performance', dateTime: '2026-07-04T10:00:00Z', venueName: 'Hall' }] });
  });
  await page.route('**/api/v1/auth/refresh', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: 'phase27-offline-access-token' }),
    });
  });

  await page.route('**/api/v1/users/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'scanner-phase27-offline',
        email: 'scanner-offline@grabit.test',
        name: 'Phase27 Offline Scanner',
        role: 'admin',
        phone: '+821000002727',
        isEmailVerified: true,
        isPhoneVerified: true,
        adminCapabilityBundle: 'scanner',
        adminCapabilities: ['field.scan.verify', 'field.scan.consume', 'field.scan.sync'],
      }),
    });
  });
}

async function mockVerify(page: Page) {
  const attemptIds: string[] = [];
  await page.route('**/api/v1/field/check-in/verify**', async (route: Route) => {
    attemptIds.push(route.request().postDataJSON().deviceAttemptId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: 'processable',
        resultLabel: '입장 가능 티켓입니다',
        reservationNumber: 'GRP-27-OFF-0001',
        performanceTitle: 'Phase 27 Offline Sync Performance',
        showtimeAt: '2026-07-04T10:00:00.000Z',
        seats: ['VIP A열 1번'],
      }),
    });
  });
  return attemptIds;
}

async function expectNoRawSecrets(page: Page) {
  await expect(page.getByText(rawQrToken, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawQrJTI, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawPaymentKey, { exact: true })).toHaveCount(0);
  await expect(page.getByText(rawBuyerEmail, { exact: true })).toHaveCount(0);
}

test.describe('phase27 offline sync browser contracts', () => {
  test('offline consume failure stores a pending scan and recovered connectivity syncs it', async ({ page }) => {
    await mockScannerSession(page);
    const verifyAttemptIds = await mockVerify(page);
    const syncedAttemptIds: string[] = [];

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}&showtimeId=${fieldShowtimeId}`);
    await expect(
      page.getByRole('status', { name: '입장 가능 티켓입니다' }),
    ).toBeVisible({ timeout: 10000 });

    await page.context().setOffline(true);
    await page.getByRole('button', { name: '이 좌석 입장 처리' }).click();

    await expect(
      page.getByRole('status', {
        name: '입장 동기화 대기',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('offline-sync-status')).toContainText(
      '보류 상태는 최종 입장 증거가 아닙니다',
    );
    await expect(page.getByTestId('offline-sync-status')).toContainText('동기화 대기');
    await expect(page.getByText('입장 처리가 완료되었습니다')).toHaveCount(0);

    // Recovered connectivity syncs automatically, so the server mock must exist first.
    await page.route('**/api/v1/field/check-in/offline-sync**', async (route: Route) => {
      syncedAttemptIds.push(route.request().postDataJSON().attempts[0].deviceAttemptId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              deviceAttemptId: route.request().postDataJSON().attempts[0].deviceAttemptId,
              outcome: 'entered',
              syncState: 'synced',
              resultLabel: '보류 스캔 동기화 완료',
            },
          ],
        }),
      });
    });
    await page.context().setOffline(false);

    await expect(page.getByTestId('offline-sync-status')).toContainText(
      '보류 스캔 동기화 완료',
    );
    await expect(page.getByRole('button', { name: '보류 스캔 동기화' })).toBeDisabled();
    expect(page.url()).not.toContain(rawQrToken);
    await expect(page.getByTestId('offline-sync-status')).toContainText('서버 확정');
    // The scan keeps its card and shows its own server result instead of offering entry again.
    await expect(page.getByRole('status', { name: '보류 스캔 동기화 완료' })).toBeVisible();
    await expect(page.getByRole('button', { name: '이 좌석 입장 처리' })).toHaveCount(0);
    // Verify, the queued entry and its sync carry one attempt id, so the server
    // never records the scanner's own re-check as a new duplicate scan.
    expect(syncedAttemptIds).toHaveLength(1);
    expect(new Set(verifyAttemptIds)).toEqual(new Set(syncedAttemptIds));
    await expectNoRawSecrets(page);
  });

  test('offline sync conflict shows rejected state instead of green local success', async ({ page }) => {
    await mockScannerSession(page);
    await mockVerify(page);

    await page.route('**/api/v1/field/check-in/offline-sync**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              deviceAttemptId: route.request().postDataJSON().attempts[0].deviceAttemptId,
              syncState: 'rejected',
              result: 'duplicate',
              resultLabel: '이미 입장 처리된 티켓입니다',
            },
          ],
        }),
      });
    });

    await page.goto(`/field/check-in?ticket=${encodeURIComponent(rawQrToken)}&showtimeId=${fieldShowtimeId}`);
    await expect(
      page.getByRole('status', { name: '입장 가능 티켓입니다' }),
    ).toBeVisible({ timeout: 10000 });

    await page.context().setOffline(true);
    await page.getByRole('button', { name: '이 좌석 입장 처리' }).click();
    await expect(page.getByTestId('offline-sync-status')).toContainText('동기화 대기');
    await page.context().setOffline(false);

    await expect(page.getByTestId('offline-sync-status')).toContainText('충돌 확인 필요');
    await expect(page.getByTestId('offline-sync-status')).toContainText(
      '이미 입장 처리된 티켓입니다',
    );
    await expect(page.getByRole('status', { name: '이미 입장 처리된 티켓입니다' })).toBeVisible();
    await expect(page.getByText('입장 처리가 완료되었습니다')).toHaveCount(0);
    await expectNoRawSecrets(page);
  });
});

// Real venue offline rehearsal and phone-camera verification are manual-only Plan 27-16 evidence.
