import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { useAuthStore } from '@/stores/use-auth-store';

const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), read: vi.fn(), cancel: vi.fn(), unlock: vi.fn(), requestPayment: vi.fn(),
  replace: vi.fn(), toastError: vi.fn(), search: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-return' }),
  useRouter: () => ({ replace: boundary.replace, push: vi.fn() }),
  useSearchParams: () => boundary.search,
}));
vi.mock('next-intl', () => ({ useLocale: () => 'ko', useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: boundary.toastError } }));
vi.mock('@/lib/api-client', () => ({ apiClient: { get: boundary.read } }));
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
vi.mock('@/components/booking/toss-payment-widget', () => ({
  TossPaymentWidget: forwardRef(function TestProviderWidget(
    props: { onReady: () => void; onWidgetAgreementChange: (agreed: boolean) => void },
    ref,
  ) {
    const { onReady, onWidgetAgreementChange } = props;
    useImperativeHandle(ref, () => ({ requestPayment: boundary.requestPayment }));
    useEffect(() => {
      onReady();
      onWidgetAgreementChange(true);
    }, [onReady, onWidgetAgreementChange]);
    return <div>Provider widget</div>;
  }),
}));

const savedSeats = [{
  seatId: 'A-1', seatKey: '2F:A-1', floorKey: '2F', floorLabel: '2층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const savedOrder = {
  id: 'reservation-return', tossOrderId: 'GRP-return', performanceId: 'performance-return',
  showtimeId: 'showtime-return', status: 'PENDING_PAYMENT', performanceTitle: 'Return Test', posterUrl: null,
  showDateTime: '2099-01-02T09:00:00.000Z', venue: 'Test Hall', seats: savedSeats, totalAmount: 52000,
  paymentDeadlineAt: '2099-01-01T00:00:00.000Z', paymentInfo: null,
  checkoutPaymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' }, checkoutStartedAt: null,
};

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
}

async function payOnce() {
  const user = userEvent.setup();
  await screen.findByText('Return Test');
  await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]).toBeEnabled());
  await user.click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
}

describe('Provider SDK rejection before checkout opens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.search = new URLSearchParams('resumeOrderId=GRP-return');
    window.history.replaceState({}, '', '/booking/performance-return/confirm?resumeOrderId=GRP-return');
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-return', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    boundary.prepare.mockImplementation(async ({ orderId }: { orderId: string }) => ({
      reservationId: 'reservation-return', orderId, paymentDeadlineAt: savedOrder.paymentDeadlineAt,
      paymentMethod: savedOrder.checkoutPaymentMethod,
    }));
    boundary.requestPayment.mockRejectedValueOnce(Object.assign(
      new Error('카드 결제 정보를 선택해주세요.'),
      { code: 'NEED_CARD_PAYMENT_DETAIL' },
    ));
  });

  it('keeps the released order payable on the same page and lets the buyer retry it', async () => {
    boundary.read.mockResolvedValue(savedOrder);
    mountPage();

    await payOnce();

    await waitFor(() => expect(boundary.toastError).toHaveBeenCalledWith('카드 결제 정보를 선택해주세요.'));
    await waitFor(() => expect(boundary.read.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(boundary.cancel).not.toHaveBeenCalled();

    boundary.requestPayment.mockImplementation(() => new Promise(() => {}));
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(2));
    expect(boundary.prepare.mock.calls.map(([input]) => input.orderId)).toEqual(['GRP-return', 'GRP-return']);
  });

  it('falls back to status review when the server kept the handoff', async () => {
    boundary.read
      .mockResolvedValueOnce(savedOrder)
      .mockResolvedValue({ ...savedOrder, checkoutStartedAt: '2026-10-02T03:00:00.000Z' });
    mountPage();

    await payOnce();

    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(
      '/booking/performance-return/complete?pending=true&orderId=GRP-return',
    ));
  });
});
