import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import type { PaymentMethodSelection } from '@/components/booking/toss-payment-widget';

const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), read: vi.fn(), cancel: vi.fn(), unlock: vi.fn(), requestPayment: vi.fn(),
  replace: vi.fn(), search: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-return' }),
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
    return <div>Provider widget<button onClick={() => props.onPaymentMethodChange?.({
      code: 'VISA', paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'USD' },
      requiresOverseasDisclaimer: true, requestFlow: 'widget',
    })}>Choose overseas card</button></div>;
  }),
}));

const savedSeats = [{
  seatId: 'A-1', seatKey: '2F:A-1', floorKey: '2F', floorLabel: '2층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const savedBooking = {
  id: 'reservation-return', performanceId: 'performance-return', showtimeId: 'showtime-return',
  status: 'PENDING_PAYMENT', performanceTitle: 'Return Test', posterUrl: null,
  showDateTime: '2099-01-02T09:00:00.000Z', venue: 'Test Hall', seats: savedSeats,
  totalAmount: 52000, paymentDeadlineAt: '2099-01-01T00:00:00.000Z', paymentInfo: null,
};

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
}

describe('Checkout document return recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.read.mockReset();
    boundary.unlock.mockReset().mockResolvedValue(undefined);
    boundary.cancel.mockResolvedValue(undefined);
    boundary.search = new URLSearchParams();
    window.history.replaceState({}, '', '/booking/performance-return/confirm');
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-return', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    boundary.requestPayment.mockImplementation(() => new Promise(() => {}));
  });

  it('waits for old seat locks to release before allowing another selection', async () => {
    let releaseSeats!: () => void;
    boundary.unlock.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseSeats = resolve; }));
    boundary.search = new URLSearchParams('resumeOrderId=GRP-return');
    boundary.read.mockResolvedValue({ ...savedBooking, tossOrderId: 'GRP-return' });
    mountPage();
    await screen.findByText('Return Test');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '좌석 선택으로' }));
    await waitFor(() => expect(boundary.unlock).toHaveBeenCalledTimes(1));
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);
    await act(async () => { releaseSeats(); });
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith('/booking/performance-return'));
    expect(useBookingStore.getState().selectedSeats).toHaveLength(0);
  });

  it('restores the server seat snapshot and reuses one prepared order after a full page return', async () => {
    const user = userEvent.setup();
    const unpaidOrders = new Map<string, string>();
    boundary.prepare.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (!unpaidOrders.has(orderId)) unpaidOrders.set(orderId, 'reservation-return');
      return { reservationId: unpaidOrders.get(orderId), orderId, paymentDeadlineAt: savedBooking.paymentDeadlineAt };
    });
    useBookingStore.getState().setBookingData({
      ...savedBooking, selectedSeats: savedSeats, expiresAt: Date.parse(savedBooking.paymentDeadlineAt),
    });
    let view = mountPage();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
    await waitFor(() => expect(unpaidOrders.size).toBe(1));
    const originalOrderId = [...unpaidOrders.keys()][0]!;

    view.unmount();
    act(() => useBookingStore.getState().resetBooking());
    boundary.search = new URLSearchParams({
      error: 'true', code: 'PAY_PROCESS_CANCELED', orderId: originalOrderId,
    });
    boundary.read.mockResolvedValue({ ...savedBooking, tossOrderId: originalOrderId });
    view = mountPage();
    expect(await screen.findByText('Return Test')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]).toBeEnabled());
    await user.click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(2));

    expect([...unpaidOrders.keys()]).toEqual([originalOrderId]);
    expect(boundary.prepare.mock.calls.at(-1)?.[0]).toMatchObject({
      orderId: originalOrderId, showtimeId: 'showtime-return', seats: savedSeats, amount: 52000,
    });
    expect(boundary.cancel).not.toHaveBeenCalled();
    view.unmount();
  });

  it('sends an already confirmed order to its tickets instead of offering another payment', async () => {
    boundary.search = new URLSearchParams({ resumeOrderId: 'confirmed-order' });
    boundary.read.mockResolvedValue({ ...savedBooking, tossOrderId: 'confirmed-order', status: 'CONFIRMED' });
    mountPage();
    await waitFor(() => expect(boundary.replace).toHaveBeenCalledWith(
      '/booking/performance-return/complete?pending=true&orderId=confirmed-order',
    ));
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.cancel).not.toHaveBeenCalled();
  });

  it('does not turn a lookup failure into a new order or an automatic cancellation', async () => {
    boundary.search = new URLSearchParams({ resumeOrderId: 'unknown-order' });
    boundary.read.mockRejectedValue(new Error('Network unavailable'));
    mountPage();
    expect(await screen.findByRole('heading', { name: '예매 상태를 확인하지 못했어요' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '상태 다시 확인' })).toBeEnabled();
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.cancel).not.toHaveBeenCalled();
    expect(boundary.replace).not.toHaveBeenCalled();
  });

  it('does not hydrate a booking for a different performance', async () => {
    boundary.search = new URLSearchParams({ resumeOrderId: 'different-order' });
    boundary.read.mockResolvedValue({ ...savedBooking, tossOrderId: 'different-order', performanceId: 'other-performance' });
    mountPage();
    expect(await screen.findByRole('heading', { name: '예매 상태를 확인하지 못했어요' })).toBeInTheDocument();
    expect(useBookingStore.getState().selectedSeats).toEqual([]);
  });

  it('shows the fixed provider quote for review before opening an overseas payment', async () => {
    const user = userEvent.setup();
    const quote = { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36', rate: '0.00068', quotedAt: '2026-09-21T06:00:00.000Z' };
    boundary.prepare.mockImplementation(async ({ orderId }: { orderId: string }) => ({
      orderId, reservationId: 'reservation-return', paymentDeadlineAt: savedBooking.paymentDeadlineAt,
      checkoutEnabled: true, providerChargeQuote: quote,
    }));
    useBookingStore.getState().setBookingData({
      ...savedBooking, selectedSeats: savedSeats, expiresAt: Date.parse(savedBooking.paymentDeadlineAt),
    });
    mountPage();
    await user.click(screen.getByRole('button', { name: 'Choose overseas card' }));
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('checkbox', { name: '해외 결제 및 환불 유의사항에 동의합니다' }));
    await user.click(screen.getAllByRole('button', { name: /paymentDisclaimer.payNow|최종 청구 금액 확인/ })[0]!);
    expect(within(await screen.findByRole('region', { name: '실제 청구 금액' })).getByText('USD 35.36')).toBeInTheDocument();
    expect(boundary.requestPayment).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'USD 35.36 결제하기' })[0]!);
    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledWith(expect.objectContaining({ providerChargeQuote: quote })));
  });
});
