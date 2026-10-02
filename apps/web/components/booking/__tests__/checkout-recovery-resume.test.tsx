import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import type { PaymentMethodSelection } from '@/components/booking/toss-payment-widget';

/**
 * Checkout reached from the booking route's payment recovery screen (or the
 * reservation list) after the queue access window closed. The server refuses
 * prepare then (AdmissionGuard needs activeUntilAt), while the handoff and
 * payment confirm still accept the prepared order through its order binding,
 * and refuse another browser session with a queue 403 (the handoff before the
 * provider checkout; see payment-branch-admission.http.spec.ts in the API).
 */
const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), read: vi.fn(), cancel: vi.fn(), unlock: vi.fn(), requestPayment: vi.fn(),
  replace: vi.fn(), search: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-recovery' }),
  useRouter: () => ({ replace: boundary.replace, push: vi.fn() }),
  useSearchParams: () => boundary.search,
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: boundary.read },
}));
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
    props: {
      onReady: () => void;
      onWidgetAgreementChange: (agreed: boolean) => void;
      onPaymentMethodChange?: (selection: PaymentMethodSelection) => void;
    }, ref,
  ) {
    const { onReady, onWidgetAgreementChange } = props;
    useImperativeHandle(ref, () => ({ requestPayment: boundary.requestPayment }));
    useEffect(() => {
      onReady();
      onWidgetAgreementChange(true);
    }, [onReady, onWidgetAgreementChange]);
    return (
      <div>
        Provider widget
        <button
          type="button"
          onClick={() => props.onPaymentMethodChange?.({
            code: 'TRANSFER',
            paymentMethod: { method: 'TRANSFER', provider: 'CARD', currency: 'KRW' },
            requiresOverseasDisclaimer: false,
            requestFlow: 'widget',
          })}
        >
          Choose transfer
        </button>
        <button
          type="button"
          onClick={() => props.onPaymentMethodChange?.({
            code: 'PAYPAL',
            paymentMethod: { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' },
            requiresOverseasDisclaimer: false,
            requestFlow: 'widget',
          })}
        >
          Choose PayPal
        </button>
      </div>
    );
  }),
}));

const ORDER_ID = 'GRP-recovery';
const CARD = { method: 'CARD', provider: 'CARD', currency: 'KRW' } as const;
const PASSED_QUEUE_ACCESS_END = Date.parse('2026-01-01T00:00:00.000Z');
const savedSeats = [{
  seatId: 'A-1', seatKey: '2F:A-1', floorKey: '2F', floorLabel: '2층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const preparedOrder = {
  id: 'reservation-recovery', tossOrderId: ORDER_ID, performanceId: 'performance-recovery',
  showtimeId: 'showtime-recovery', status: 'PENDING_PAYMENT', performanceTitle: 'Recovery Test',
  posterUrl: null, showDateTime: '2099-01-02T09:00:00.000Z', venue: 'Test Hall', seats: savedSeats,
  totalAmount: 52000, paymentDeadlineAt: '2099-01-01T00:00:00.000Z', paymentInfo: null,
  checkoutPaymentMethod: CARD, checkoutStartedAt: null,
};

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
}

async function agreeAndPay() {
  const user = userEvent.setup();
  expect(await screen.findByText('Recovery Test')).toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
  const pay = screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!;
  await waitFor(() => expect(pay).toBeEnabled());
  await user.click(pay);
}

describe('Checkout resume after the queue access window closed (audit #4, #32)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.read.mockReset().mockResolvedValue(preparedOrder);
    boundary.prepare.mockReset().mockRejectedValue(
      Object.assign(new Error('대기열 입장 시간이 만료되었습니다'), { statusCode: 403 }),
    );
    boundary.requestPayment.mockReset().mockImplementation(() => new Promise(() => {}));
    boundary.search = new URLSearchParams({ resumeOrderId: ORDER_ID });
    window.history.replaceState({}, '', `/booking/performance-recovery/confirm?resumeOrderId=${ORDER_ID}`);
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-recovery', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('pays the prepared order with its saved method without a new prepare', async () => {
    // The recovery screen link reset the store; checkout restores the order.
    mountPage();

    await agreeAndPay();

    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(1));
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.requestPayment).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'reservation-recovery',
      orderId: ORDER_ID,
      paymentDeadlineAt: preparedOrder.paymentDeadlineAt,
      paymentMethod: CARD,
    }));
    expect(boundary.cancel).not.toHaveBeenCalled();
    expect(boundary.unlock).not.toHaveBeenCalled();
  });

  it('stops a resume whose handoff refuses this browser session, before any provider checkout', async () => {
    // "Continue payment" opened on another device: the order is bound to the
    // browser session that prepared it, so POST /payments/branch answers the
    // queue 403 (the widget rethrows it) and no provider checkout opens.
    boundary.requestPayment.mockReset().mockRejectedValue(
      Object.assign(new Error('대기열 입장 인증이 필요합니다'), { statusCode: 403 }),
    );
    mountPage();

    await agreeAndPay();

    expect(await screen.findByText('이 예매는 결제를 시작한 기기·브라우저의 로그인 세션에서만 이어서 결제할 수 있습니다. 그곳에서 결제 기한 안에 완료하거나, 대기열에 다시 입장해 새로 예매해 주세요. 다시 입장하면 이 예매가 취소되고 좌석이 해제됩니다.'))
      .toBeInTheDocument();
    const pays = screen.getAllByRole('button', { name: '이 화면에서는 결제를 이어갈 수 없습니다' });
    for (const pay of pays) expect(pay).toBeDisabled();
    expect(screen.getByRole('button', { name: '대기열 다시 입장하기' })).toBeEnabled();
    expect(boundary.requestPayment).toHaveBeenCalledTimes(1);
    expect(boundary.prepare).not.toHaveBeenCalled();
    // The order stays payable from the bound session: nothing is cancelled or released.
    expect(boundary.cancel).not.toHaveBeenCalled();
    expect(boundary.unlock).not.toHaveBeenCalled();
    expect(screen.queryByText('대기열 입장 시간이 끝났습니다')).not.toBeInTheDocument();
  });

  it('is not blocked by the passed queue access deadline of a seat screen in the same tab', async () => {
    // Same selection as the order, so checkout keeps the store (and its
    // passed queue access deadline) as it is.
    useBookingStore.getState().setBookingData({
      selectedSeats: savedSeats,
      showtimeId: preparedOrder.showtimeId,
      performanceId: preparedOrder.performanceId,
      performanceTitle: preparedOrder.performanceTitle,
      showDateTime: preparedOrder.showDateTime,
      venue: preparedOrder.venue,
      posterUrl: preparedOrder.posterUrl,
      expiresAt: PASSED_QUEUE_ACCESS_END,
      queueAccessExpiresAt: PASSED_QUEUE_ACCESS_END,
    });
    mountPage();

    await agreeAndPay();

    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(1));
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(screen.queryByText('대기열 입장 시간이 끝났습니다')).not.toBeInTheDocument();
    expect(useBookingStore.getState().queueAccessExpiresAt).toBe(PASSED_QUEUE_ACCESS_END);
  });

  it('still needs the queue access window to change the saved method (a new prepare)', async () => {
    useBookingStore.getState().setBookingData({
      selectedSeats: savedSeats,
      showtimeId: preparedOrder.showtimeId,
      performanceId: preparedOrder.performanceId,
      performanceTitle: preparedOrder.performanceTitle,
      showDateTime: preparedOrder.showDateTime,
      venue: preparedOrder.venue,
      posterUrl: preparedOrder.posterUrl,
      expiresAt: PASSED_QUEUE_ACCESS_END,
      queueAccessExpiresAt: PASSED_QUEUE_ACCESS_END,
    });
    const user = userEvent.setup();
    mountPage();
    expect(await screen.findByText('Recovery Test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose transfer' }));
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));

    const pays = await screen.findAllByRole('button', { name: '대기열 입장 시간이 끝났습니다' });
    for (const pay of pays) expect(pay).toBeDisabled();
    expect(screen.getByRole('button', { name: '대기열 다시 입장하기' })).toBeInTheDocument();
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.requestPayment).not.toHaveBeenCalled();
  });

  it('reuses the stored provider quote of a foreign order instead of preparing again', async () => {
    const quote = {
      currency: 'USD', amountMinor: 3536, amountDecimal: '35.36', rate: '0.00068',
      quotedAt: '2026-09-21T06:00:00.000Z',
    } as const;
    const paypal = { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' } as const;
    boundary.read.mockResolvedValue({
      ...preparedOrder, checkoutPaymentMethod: paypal, providerChargeQuote: quote,
    });
    const user = userEvent.setup();
    mountPage();
    expect(await screen.findByText('Recovery Test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Choose PayPal' }));
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    const pay = screen.getAllByRole('button', { name: 'USD 35.36 결제하기' })[0]!;
    await waitFor(() => expect(pay).toBeEnabled());
    await user.click(pay);

    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(1));
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.requestPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: ORDER_ID,
      paymentMethod: paypal,
      checkoutEnabled: true,
      providerChargeQuote: quote,
    }));
  });
});
