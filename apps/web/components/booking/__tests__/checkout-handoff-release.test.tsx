import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { useAuthStore } from '@/stores/use-auth-store';

/**
 * The real confirm page and the real payment widget run against a fake Toss SDK and a
 * fake server that keeps Provider Handoff state the way the API does: branch records
 * it (refusing a second one), release clears it, and the order lookup reports it.
 */
const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), cancel: vi.fn(), unlock: vi.fn(),
  replace: vi.fn(), toastError: vi.fn(), search: new URLSearchParams(),
  get: vi.fn(), post: vi.fn(),
  sdkRequestPayment: vi.fn(), agreementHandlers: [] as Array<(status: unknown) => void>,
  server: { checkoutStartedAt: null as string | null, releaseRefused: false },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-return' }),
  useRouter: () => ({ replace: boundary.replace, push: vi.fn() }),
  useSearchParams: () => boundary.search,
}));
vi.mock('next-intl', () => ({ useLocale: () => 'ko', useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: boundary.toastError } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: boundary.get, post: boundary.post } }));
vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingAvailability: () => ({ bookingAvailable: true }),
}));
vi.mock('@/hooks/use-booking', () => ({
  useBookingPaymentSnapshot: () => ({
    paymentDeadlineAt: '2099-01-01T00:00:00.000Z',
    lockExpiresAt: '2099-01-01T00:00:00.000Z',
    bookingPolicy: { paymentWindowMinutes: 7, seatHoldMinutes: 10 },
    isPaymentDeadlineExpired: false,
  }),
  usePrepareReservation: () => ({ mutateAsync: boundary.prepare }),
  useUnlockAllSeats: () => ({ mutate: boundary.unlock, mutateAsync: boundary.unlock }),
  useCancelPendingReservation: () => ({ mutate: boundary.cancel, mutateAsync: boundary.cancel }),
}));
vi.mock('@/components/auth/auth-guard', () => ({
  AuthGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@tosspayments/tosspayments-sdk', () => ({
  loadTossPayments: vi.fn(async () => ({
    widgets: () => ({
      setAmount: vi.fn().mockResolvedValue(undefined),
      renderPaymentMethods: vi.fn().mockResolvedValue({
        on: vi.fn(),
        getSelectedPaymentMethod: vi.fn().mockResolvedValue({ code: 'CARD' }),
        destroy: vi.fn().mockResolvedValue(undefined),
      }),
      renderAgreement: vi.fn().mockResolvedValue({
        on: vi.fn((event: string, handler: (status: unknown) => void) => {
          if (event === 'agreementStatusChange') boundary.agreementHandlers.push(handler);
        }),
        destroy: vi.fn().mockResolvedValue(undefined),
      }),
      requestPayment: boundary.sdkRequestPayment,
    }),
  })),
}));

const ORDER_ID = 'GRP-return';
const CARD = { method: 'CARD', provider: 'CARD', currency: 'KRW' };
const savedSeats = [{
  seatId: 'A-1', seatKey: '2F:A-1', floorKey: '2F', floorLabel: '2층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const savedOrder = {
  id: 'reservation-return', tossOrderId: ORDER_ID, performanceId: 'performance-return',
  showtimeId: 'showtime-return', status: 'PENDING_PAYMENT', performanceTitle: 'Return Test', posterUrl: null,
  showDateTime: '2099-01-02T09:00:00.000Z', venue: 'Test Hall', seats: savedSeats, totalAmount: 52000,
  paymentDeadlineAt: '2099-01-01T00:00:00.000Z', paymentInfo: null, checkoutPaymentMethod: CARD,
};
const originalClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
const originalVariantKey = process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;

function fakeServer() {
  boundary.get.mockImplementation(async () => ({
    ...savedOrder,
    checkoutStartedAt: boundary.server.checkoutStartedAt,
  }));
  boundary.post.mockImplementation(async (path: string, body: { orderId: string }) => {
    if (path === '/api/v1/payments/branch') {
      if (boundary.server.checkoutStartedAt) {
        throw Object.assign(new Error('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.'), { statusCode: 409 });
      }
      boundary.server.checkoutStartedAt = new Date().toISOString();
      return {
        orderId: body.orderId, ...CARD, asyncStatus: 'sync', useInternationalCardOnly: false,
        successUrl: 'https://grabit.test/booking/performance-return/complete',
        failUrl: 'https://grabit.test/booking/performance-return/confirm?error=true',
      };
    }
    if (path === '/api/v1/payments/branch/release') {
      if (boundary.server.releaseRefused) {
        throw Object.assign(new Error('결제 상태를 확인 중입니다. 기존 예매를 다시 확인해주세요.'), { statusCode: 409 });
      }
      boundary.server.checkoutStartedAt = null;
      return { orderId: body.orderId, released: true };
    }
    throw new Error(`unexpected POST ${path}`);
  });
}

function releaseCalls() {
  return boundary.post.mock.calls.filter(([path]) => path === '/api/v1/payments/branch/release');
}

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
}

async function payOnce() {
  const user = userEvent.setup();
  await screen.findByText('Return Test');
  await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
  await waitFor(() => expect(boundary.agreementHandlers.length).toBeGreaterThan(0));
  act(() => {
    for (const handler of boundary.agreementHandlers) handler({ agreedRequiredTerms: true, agreements: [] });
  });
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]).toBeEnabled());
  await user.click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
}

describe('Provider SDK rejection before checkout opens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = 'test-client-key';
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = 'DEFAULT';
    boundary.agreementHandlers.length = 0;
    boundary.server.checkoutStartedAt = null;
    boundary.server.releaseRefused = false;
    boundary.search = new URLSearchParams(`resumeOrderId=${ORDER_ID}`);
    window.history.replaceState({}, '', `/booking/performance-return/confirm?resumeOrderId=${ORDER_ID}`);
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-return', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    boundary.prepare.mockImplementation(async ({ orderId }: { orderId: string }) => ({
      reservationId: 'reservation-return', orderId, paymentDeadlineAt: savedOrder.paymentDeadlineAt,
      paymentMethod: CARD,
    }));
    fakeServer();
    boundary.sdkRequestPayment.mockRejectedValueOnce(Object.assign(
      new Error('카드 결제 정보를 선택해주세요.'),
      { code: 'NEED_CARD_PAYMENT_DETAIL' },
    ));
  });

  afterEach(() => {
    if (originalClientKey === undefined) delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    else process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY = originalClientKey;
    if (originalVariantKey === undefined) delete process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY;
    else process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY = originalVariantKey;
  });

  it('hands the order back after the SDK rejects, so the buyer pays the same order again on the same page', async () => {
    mountPage();

    await payOnce();

    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith('카드 결제 정보를 선택해주세요.'));
    expect(releaseCalls()).toEqual([
      ['/api/v1/payments/branch/release', { orderId: ORDER_ID }, { showErrorToast: false }],
    ]);
    expect(boundary.server.checkoutStartedAt).toBeNull();
    await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(boundary.cancel).not.toHaveBeenCalled();

    boundary.sdkRequestPayment.mockImplementation(() => new Promise(() => {}));
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
    await waitFor(() => expect(boundary.sdkRequestPayment).toHaveBeenCalledTimes(2));
    // The prepared order is reused with its saved method: no new prepare (which needs
    // the queue access window), the handoff alone re-validates it.
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.post.mock.calls
      .filter(([path]) => path === '/api/v1/payments/branch')
      .map(([, body]) => body.orderId)).toEqual([ORDER_ID, ORDER_ID]);
    expect(boundary.server.checkoutStartedAt).not.toBeNull();
  });

  it('falls back to status review when the server keeps the handoff', async () => {
    boundary.server.releaseRefused = true;
    mountPage();

    await payOnce();

    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(
      `/booking/performance-return/complete?pending=true&orderId=${ORDER_ID}`,
    ));
    expect(releaseCalls()).toHaveLength(1);
    expect(boundary.server.checkoutStartedAt).not.toBeNull();
  });
});
