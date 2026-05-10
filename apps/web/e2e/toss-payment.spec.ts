import { test, expect, type Route } from '@playwright/test';
import { injectBookingFixture } from './fixtures/booking-store';
import { loginAsTestUser } from './helpers/auth';

/**
 * Toss Payments E2E tests.
 *
 * Phase 9 DEBT-05: Validates the payment flow end-to-end.
 * Uses the hybrid approach (D-14) — real SDK loading + `page.route()` interception
 * of the final confirm API call — because Toss sandbox iframes are cross-origin
 * and cannot be automated via Playwright `frameLocator` (RESEARCH §Pitfall 3).
 *
 * Scenario 1 (happy path) is the single source of DEBT-05 closure evidence.
 * Scenarios 2 and 3 are UI regression tests only — they do not substitute for
 * real Toss sandbox flow (REVIEWS.md HIGH-01).
 *
 * Env gate (D-12): Skips entirely when `TOSS_CLIENT_KEY_TEST` is not set.
 * CI main-push runs fail earlier via the `verify-toss-secrets` step, so this
 * skip only applies to fork PRs or local runs without a .env setup.
 *
 * Key isolation (D-13): `TOSS_CLIENT_KEY_TEST` (and its paired server-side
 * alias documented in 09-CONTEXT.md) are CI-only secrets; they MUST NOT
 * appear in `deploy.yml`. This spec references only the public client key.
 *
 * Blocker B1 (revision-2): fixture/intercept `seats` use SeatSelection shape.
 * Blocker B2 (revision-2): loginAsTestUser seeds auth state before navigation.
 */
test.describe('Toss Payments E2E', () => {
  // These tests share the seeded admin account. Running them in parallel rotates
  // the same refresh token family across isolated browser contexts and makes
  // AuthInitializer redirect otherwise valid pages back to /auth.
  test.describe.configure({ mode: 'serial' });

  test.skip(
    !process.env['TOSS_CLIENT_KEY_TEST'],
    'Skipped: TOSS_CLIENT_KEY_TEST not set. CI main-push gate should have failed before reaching this.',
  );

  // ============================================================================
  // Scenario 1: HAPPY PATH — DEBT-05 closure evidence (REVIEWS.md HIGH-01)
  // ============================================================================
  // Phase 09.1 closure: previous 401 from Playwright login helper resolved (9.1-03-SUMMARY).
  test('happy path: widget mounts AND confirm API intercepts on complete page', async ({
    page,
  }) => {
    let confirmIntercepted = false;

    await enableBooking(page);

    // 0. Blocker B2: seed auth so /confirm + /complete do not redirect to /auth.
    //    loginAsTestUser calls the real /api/v1/auth/login endpoint and lands
    //    the httpOnly refreshToken cookie; AuthInitializer then exchanges it
    //    for an accessToken on first render via /api/v1/auth/refresh.
    await loginAsTestUser(page);

    // 1. Register intercept BEFORE any navigation so complete page's POST is caught.
    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      confirmIntercepted = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-reservation-id',
          reservationNumber: 'GRP-TEST-0001',
          status: 'CONFIRMED',
          performanceTitle: 'E2E Test Performance',
          posterUrl: null,
          showDateTime: new Date(Date.now() + 86400000).toISOString(),
          venue: 'E2E Venue',
          // Blocker B1: SeatSelection[] shape matching packages/shared/src/types/booking.types.ts
          seats: [{ seatId: 's1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
          totalAmount: 50000,
          createdAt: new Date().toISOString(),
          // ReservationDetail additional fields (booking.types.ts:52-59)
          paymentMethod: 'card',
          paidAt: new Date().toISOString(),
          cancelDeadline: new Date(Date.now() + 86400000).toISOString(),
          cancelledAt: null,
          cancelReason: null,
          paymentKey: 'test_payment_key',
        }),
      });
    });

    // 2. Seed booking fixture so confirm page doesn't redirect to /booking/:id.
    const perfId = 'e2e-test-performance';
    await injectBookingFixture(page, {
      performanceId: perfId,
      showtimeId: 'e2e-test-showtime',
      // Blocker B1: SeatSelection shape
      seats: [{ seatId: 's1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      performanceTitle: 'E2E Test Performance',
      showDateTime: new Date(Date.now() + 86400000).toISOString(),
      venue: 'E2E Venue',
    });

    // 3. Navigate to confirm page.
    await page.goto(`/booking/${perfId}/confirm`);

    // 4. Assert page is on /confirm (NOT redirected to /booking/:id or /auth).
    await expect(page).toHaveURL(/\/confirm/);

    // 5. Assert Toss widget iframe mounted within 20s — proves real SDK loaded.
    await expect(page.locator('#payment-method iframe')).toBeVisible({ timeout: 20000 });

    // 6. Simulate Toss successUrl redirect by directly navigating the complete page.
    //    This triggers `confirmMutation` in complete/page.tsx:71-79, which hits
    //    POST /api/v1/payments/confirm — our intercept catches it.
    const paymentKey = `test_payment_key_${Date.now()}`;
    const orderId = `test_order_${Date.now()}`;
    const amount = '50000';
    await page.goto(
      `/booking/${perfId}/complete?paymentKey=${paymentKey}&orderId=${orderId}&amount=${amount}`,
    );

    // 7. Strictly assert intercept fired (REVIEWS.md HIGH-01: no typeof-only check).
    await expect.poll(() => confirmIntercepted, {
      timeout: 10000,
      message: 'POST /api/v1/payments/confirm was not intercepted',
    }).toBe(true);

    // 8. Assert complete page shows success state.
    await expect(page.getByRole('heading', { name: '예매가 완료되었습니다' })).toBeVisible({
      timeout: 10000,
    });
  });

  // ============================================================================
  // Scenario 2: UI REGRESSION (cancel) — URL simulation only, not DEBT-05 evidence
  // ============================================================================
  // Phase 09.1 closure: previous 401 from Playwright login helper resolved (9.1-03-SUMMARY).
  test('UI regression: cancel error URL → toast renders', async ({ page }) => {
    // NOTE: This test validates the confirm page's URL-param branch
    // (PAY_PROCESS_CANCELED). It does NOT replace the happy-path real-SDK test;
    // it catches UI regressions in the error handling branch
    // (confirm/page.tsx:75-76). This is UI regression coverage only.
    //
    await enableBooking(page);
    // Auth is still required because /confirm is behind AuthGuard.
    await loginAsTestUser(page);
    await injectBookingFixture(page, {
      performanceId: 'e2e-test-performance',
      showtimeId: 'e2e-test-showtime',
      seats: [{ seatId: 's1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      performanceTitle: 'E2E Test Performance',
      showDateTime: new Date(Date.now() + 86400000).toISOString(),
      venue: 'E2E Venue',
    });
    await page.goto(
      '/booking/e2e-test-performance/confirm?error=true&code=PAY_PROCESS_CANCELED',
    );
    await expect(page.getByText('결제가 취소되었습니다.')).toBeVisible({ timeout: 5000 });
  });

  // ============================================================================
  // Scenario 3: UI REGRESSION (decline) — URL simulation only, not DEBT-05 evidence
  // ============================================================================
  // Phase 09.1 closure: previous 401 from Playwright login helper resolved (9.1-03-SUMMARY).
  test('UI regression: decline error URL → error message renders', async ({ page }) => {
    // NOTE: Same disclaimer as Scenario 2 — URL simulation only. This is not
    // a replacement for real Toss sandbox flow; it only asserts the UI renders
    // the decline message when the error URL params are present.
    await enableBooking(page);
    await loginAsTestUser(page);
    await injectBookingFixture(page, {
      performanceId: 'e2e-test-performance',
      showtimeId: 'e2e-test-showtime',
      seats: [{ seatId: 's1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      performanceTitle: 'E2E Test Performance',
      showDateTime: new Date(Date.now() + 86400000).toISOString(),
      venue: 'E2E Venue',
    });
    const declineMessage = '카드 승인 거절';
    await page.goto(
      `/booking/e2e-test-performance/confirm?error=true&code=INVALID_CARD&message=${encodeURIComponent(declineMessage)}`,
    );
    await expect(page.getByText(/카드 승인 거절|결제에 실패/)).toBeVisible({ timeout: 5000 });
  });

  test('lock ownership: prepare 409 surfaces server message and does not request Toss payment', async ({
    page,
  }) => {
    let confirmIntercepted = false;
    const perfId = 'e2e-test-performance';

    await enableBooking(page);
    await loginAsTestUser(page);
    await injectBookingFixture(page, {
      performanceId: perfId,
      showtimeId: 'e2e-test-showtime',
      seats: [{ seatId: 's1', tierName: 'VIP', price: 50000, row: 'A', number: '1' }],
      performanceTitle: 'E2E Test Performance',
      showDateTime: new Date(Date.now() + 86400000).toISOString(),
      venue: 'E2E Venue',
    });

    await page.route('**/api/v1/reservations/prepare', async (route: Route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 409,
          message: '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.',
          error: 'Conflict',
        }),
      });
    });
    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      confirmIntercepted = true;
      await route.fulfill({ status: 500, body: 'unexpected confirm call' });
    });

    await page.goto(`/booking/${perfId}/confirm`);
    await expect(page).toHaveURL(/\/confirm/);
    await expect(page.locator('#payment-method iframe')).toBeVisible({ timeout: 20000 });

    await page.getByLabel('전체 동의').click();
    await page.getByRole('button', { name: '결제하기' }).click();

    await expect(page.getByText('좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: '좌석 다시 선택하기' })).toBeVisible();
    await expect(page.getByRole('button', { name: '좌석을 다시 선택해주세요' })).toBeDisabled();
    await expect.poll(() => confirmIntercepted).toBe(false);
    await expect(page).toHaveURL(/\/booking\/e2e-test-performance\/confirm/);
  });

  test('lock ownership: confirm 409 renders failed state instead of booking success', async ({
    page,
  }) => {
    await loginAsTestUser(page);

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 409,
          message: '이미 다른 사용자가 선택한 좌석입니다.',
          error: 'Conflict',
        }),
      });
    });
    await page.route('**/api/v1/reservations?orderId=**', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 404,
          message: '예매 정보를 찾을 수 없습니다.',
          error: 'Not Found',
        }),
      });
    });

    await page.goto(
      '/booking/e2e-test-performance/complete?paymentKey=test_payment_key_lock_failure&orderId=test_order_lock_failure&amount=50000',
    );

    await expect(page.getByText('예매를 완료하지 못했습니다')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('이미 다른 사용자가 선택한 좌석입니다.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '예매 내역 확인' })).toBeVisible();
    await expect(page.getByText(/예매가 완료|완료되었습니다/)).not.toBeVisible();
  });

  test('complete page: recovery failure after non-lock confirm error renders recoverable failed state', async ({
    page,
  }) => {
    await loginAsTestUser(page);

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 500,
          message: '결제 승인 후 처리 중 오류가 발생했습니다.',
          error: 'Internal Server Error',
        }),
      });
    });
    await page.route('**/api/v1/reservations?orderId=**', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 404,
          message: '예매 정보를 찾을 수 없습니다.',
          error: 'Not Found',
        }),
      });
    });

    await page.goto(
      '/booking/e2e-test-performance/complete?paymentKey=test_payment_key_recovery_failure&orderId=test_order_recovery_failure&amount=50000',
    );

    await expect(page.getByRole('heading', { name: '결제 확인에 실패했습니다' })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText('결제 상태를 아직 확인하지 못했습니다. 잠시 후 다시 확인하거나 예매 내역을 확인해주세요.'),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: '상태 다시 확인' })).toBeVisible();
    await expect(page.getByRole('button', { name: '예매 내역 확인' })).toBeVisible();
    await expect(page.locator('.animate-spin')).not.toBeVisible();
  });

  test('complete page: missing or invalid amount renders invalid access without confirm request', async ({
    page,
  }) => {
    let confirmIntercepted = false;
    await loginAsTestUser(page);

    await page.route('**/api/v1/payments/confirm', async (route: Route) => {
      confirmIntercepted = true;
      await route.fulfill({ status: 500, body: 'unexpected confirm call' });
    });

    await page.goto(
      '/booking/e2e-test-performance/complete?paymentKey=test_payment_key_invalid_amount&orderId=test_order_invalid_amount&amount=abc',
    );

    await expect(page.getByText('잘못된 접근입니다.')).toBeVisible({ timeout: 5000 });
    await expect.poll(() => confirmIntercepted).toBe(false);
  });

  async function enableBooking(page: import('@playwright/test').Page) {
    await page.route('**/api/runtime-flags', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bookingEnabled: true }),
      });
    });
  }
});
