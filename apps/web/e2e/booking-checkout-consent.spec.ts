import { expect, test, type Page, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import { injectBookingFixture } from './fixtures/booking-store';

// @grabit/shared has no "type": "module", so this ESM spec cannot import its values
// by name; require() loads the same module the app bundles.
const require = createRequire(import.meta.url);
const {
  BOOKING_CONSENT_ITEM_KEYS,
  CONSENT_DOCUMENT_VERSIONS,
  resolveConsentDocumentLanguage,
} = require('@grabit/shared') as typeof import('@grabit/shared');

/**
 * Checkout consent of a new order, rendered in a real browser (account-access-12(b)):
 * the consent area shows the two booking documents, each document carries the
 * effective date that `CONSENT_DOCUMENT_VERSIONS` records, and `POST
 * /reservations/prepare` sends exactly those keys and versions in the document
 * language of the page. The consent-document-versions runbook's rollback conditions
 * rely on this payload. The Toss SDK script is replaced by a stand-in; no provider
 * is contacted, and every API call is answered here.
 */

const PERFORMANCE_ID = '00000000-0000-4000-8000-000000000412';
const SHOWTIME_ID = '00000000-0000-4000-8000-000000000512';
const CARD = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

const FAKE_TOSS_SDK = `
window.__tossAgreementHandlers = [];
window.__tossAgree = function () {
  window.__tossAgreementHandlers.forEach(function (handler) {
    handler({ agreedRequiredTerms: true, agreements: [] });
  });
};
window.TossPayments = function () {
  return {
    widgets: function () {
      return {
        setAmount: async function () {},
        renderPaymentMethods: async function () {
          return {
            on: function () {},
            getSelectedPaymentMethod: async function () { return { code: 'CARD' }; },
            destroy: async function () {},
          };
        },
        renderAgreement: async function () {
          return {
            on: function (event, handler) {
              if (event === 'agreementStatusChange') window.__tossAgreementHandlers.push(handler);
            },
            destroy: async function () {},
          };
        },
        requestPayment: function (payload) {
          window.__tossRequested = payload;
          return new Promise(function () {});
        },
      };
    },
  };
};
`;

const VIEWPORTS = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  { name: '375px', size: { width: 375, height: 812 } },
] as const;

const LOCALES = [
  {
    locale: 'ko',
    prefix: '',
    terms: '약관 동의',
    allTerms: '전체 동의',
    documents: {
      terms: '이용약관 및 예매·취소 규정 동의 (필수)',
      privacy: '개인정보 처리 안내 확인 (필수)',
    },
    view: '보기',
    close: '확인',
    payNow: '결제하기',
  },
  {
    locale: 'en',
    prefix: '/en',
    terms: 'Terms and privacy',
    allTerms: 'Agree to all required terms',
    documents: {
      terms: 'Terms of service and cancellation policy (required)',
      privacy: 'Privacy notice (required)',
    },
    view: 'Read',
    close: 'Close',
    payNow: 'Pay now',
  },
] as const;

/** Mirrors playwright.config.ts: the dev server gets the same client key. */
const TOSS_CLIENT_KEY =
  process.env['TOSS_CLIENT_KEY_TEST'] ?? process.env['NEXT_PUBLIC_TOSS_CLIENT_KEY'] ?? '';

for (const viewport of VIEWPORTS) {
  for (const copy of LOCALES) {
    test.describe(`booking checkout consent (${copy.locale}, ${viewport.name})`, () => {
      test.use({ viewport: viewport.size });

      test('shows the booking documents at their recorded versions and sends them with prepare', async ({ page }) => {
        test.skip(!TOSS_CLIENT_KEY, 'needs a Toss client key so the (stubbed) widget renders');
        const prepareBodies: Array<Record<string, unknown>> = [];
        await mockCheckoutBackend(page, {
          onPrepare: async (route, body) => {
            prepareBodies.push(body);
            await fulfillJson(route, 200, {
              reservationId: 'reservation-e2e-consent',
              orderId: body.orderId,
              paymentDeadlineAt: new Date(Date.now() + 7 * 60_000).toISOString(),
              paymentMethod: body.paymentMethod,
            });
          },
        });
        await openNewOrderCheckout(page, copy.prefix);

        const consent = page.getByRole('region', { name: copy.terms });
        await expect(consent.getByRole('checkbox', { name: copy.allTerms })).toBeVisible();
        for (const key of BOOKING_CONSENT_ITEM_KEYS) {
          const label = copy.documents[key];
          await expect(consent.getByText(label, { exact: true })).toBeVisible();
          // The document the buyer reads carries the version the payload records.
          await consent.getByRole('button', { name: `${label} · ${copy.view}` }).click();
          const dialog = page.getByRole('dialog', { name: label });
          await expect(dialog).toBeVisible();
          await expect(dialog).toContainText(CONSENT_DOCUMENT_VERSIONS[key]);
          // The footer button; the corner X carries the same (sr-only) name in English.
          await dialog.getByRole('button', { name: copy.close }).first().click();
          await expect(dialog).toHaveCount(0);
        }

        await consent.getByRole('checkbox', { name: copy.allTerms }).click();
        await agreeToWidgetTerms(page);
        await consent.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: test.info().outputPath(`checkout-consent-${copy.locale}-${viewport.name}.png`),
        });

        const pay = page.getByRole('button', { name: copy.payNow }).first();
        await expect(pay).toBeEnabled();
        await pay.click();

        await expect.poll(() => prepareBodies.length).toBe(1);
        const consentItems = prepareBodies[0]!.consentItems as Array<Record<string, unknown>>;
        expect(consentItems.map((item) => item.key).sort()).toEqual([...BOOKING_CONSENT_ITEM_KEYS].sort());
        for (const item of consentItems) {
          const key = item.key as (typeof BOOKING_CONSENT_ITEM_KEYS)[number];
          expect(item).toEqual({
            key,
            version: CONSENT_DOCUMENT_VERSIONS[key],
            language: resolveConsentDocumentLanguage(copy.locale),
            accepted: true,
            sourceFlow: 'booking',
          });
        }
        // The prepared order reached the (stubbed) provider request only after prepare.
        await expect.poll(() => page.evaluate(() => (
          window as unknown as { __tossRequested?: { orderId?: string } }
        ).__tossRequested?.orderId ?? null)).toBe(prepareBodies[0]!.orderId);
      });
    });
  }

  test.describe(`checkout pay button when the payment widget cannot load (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test('labels the pay button with the widget error instead of asking for payment terms', async ({ page }) => {
      let prepareCalls = 0;
      await mockCheckoutBackend(page, {
        onPrepare: async (route) => {
          prepareCalls += 1;
          await fulfillJson(route, 500, { statusCode: 500, message: 'unexpected prepare' });
        },
        // With a client key the SDK script itself fails; without one the widget stops
        // at its setup check (a local stack without Toss keys).
        sdk: 'unavailable',
      });
      await openNewOrderCheckout(page, '');

      const widgetError = TOSS_CLIENT_KEY
        ? '결제 시스템 로딩에 실패했습니다. 페이지를 새로고침해주세요.'
        : '결제 설정이 완료되지 않았습니다. 관리자에게 문의해주세요.';
      // The widget's own message, in place of the payment methods and terms.
      const widgetMessage = page.locator('p', { hasText: widgetError });
      await expect(widgetMessage).toBeVisible();
      await page.getByRole('checkbox', { name: '전체 동의' }).click();

      const pay = page.getByRole('button', { name: widgetError }).first();
      await expect(pay).toBeVisible();
      await expect(pay).toBeDisabled();
      await expect(page.getByRole('button', { name: '결제 약관에 동의해주세요' })).toHaveCount(0);
      await widgetMessage.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(
          `checkout-widget-error-${TOSS_CLIENT_KEY ? 'sdk' : 'no-key'}-${viewport.name}.png`,
        ),
      });
      expect(prepareCalls).toBe(0);
    });
  });
}

async function openNewOrderCheckout(page: Page, prefix: string) {
  await injectBookingFixture(page, {
    performanceId: PERFORMANCE_ID,
    showtimeId: SHOWTIME_ID,
    seats: [{
      seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층',
      tierName: 'VIP', row: 'A', number: '1', price: 50000,
    }],
    performanceTitle: 'E2E Consent Show',
    showDateTime: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    venue: 'E2E Hall',
  });
  await page.goto(`${prefix}/booking/${PERFORMANCE_ID}/confirm`);
  await expect(page.getByText('E2E Consent Show').first()).toBeVisible();
}

async function agreeToWidgetTerms(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __tossAgreementHandlers?: unknown[] }
  ).__tossAgreementHandlers?.length ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __tossAgree: () => void }).__tossAgree());
}

async function mockCheckoutBackend(page: Page, options: {
  onPrepare: (route: Route, body: Record<string, unknown>) => Promise<void>;
  sdk?: 'stub' | 'unavailable';
}) {
  // Anything not answered below fails here instead of reaching a local API.
  await page.route('**/api/v1/**', (route) => fulfillJson(route, 404, { statusCode: 404, message: 'not mocked' }));
  await page.route('**/api/v1/auth/refresh', (route) =>
    fulfillJson(route, 200, { accessToken: 'booking-consent-access-token' }),
  );
  await page.route('**/api/v1/users/me', (route) =>
    fulfillJson(route, 200, {
      id: 'booking-consent-user',
      email: 'booking-consent-user@example.test',
      name: 'Booking Consent User',
      phone: '+821012345678',
      gender: 'unspecified',
      country: 'KR',
      birthDate: '1990-01-01',
      preferredLocale: 'ko',
      isEmailVerified: true,
      isPhoneVerified: true,
      marketingConsent: false,
      role: 'user',
      createdAt: '2026-05-20T00:00:00.000Z',
    }),
  );
  await page.route('**/api/runtime-flags', (route) => fulfillJson(route, 200, { bookingEnabled: true }));
  await page.route('https://js.tosspayments.com/**', (route) => (
    options.sdk === 'unavailable'
      ? route.abort('failed')
      : route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_TOSS_SDK })
  ));
  await page.route('**/api/v1/reservations/prepare', async (route) => {
    await options.onPrepare(route, route.request().postDataJSON() as Record<string, unknown>);
  });
  await page.route('**/api/v1/payments/branch', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await fulfillJson(route, 200, {
      orderId: body.orderId,
      ...CARD,
      successUrl: body.successUrl,
      failUrl: body.failUrl,
      asyncStatus: 'sync',
      useInternationalCardOnly: false,
      paymentDeadlineAt: new Date(Date.now() + 7 * 60_000).toISOString(),
    });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
