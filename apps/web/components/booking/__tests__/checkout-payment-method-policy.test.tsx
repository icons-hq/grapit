import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { CHECKOUT_PAYMENT_METHOD_NOT_ALLOWED_MESSAGE, type PaymentMethod } from '@grabit/shared';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import type { PaymentMethodSelection } from '@/components/booking/toss-payment-widget';

const copy = getCheckoutCopy('ko');

const boundary = vi.hoisted(() => ({
  prepare: vi.fn(), read: vi.fn(), cancel: vi.fn(), unlock: vi.fn(), requestPayment: vi.fn(),
  replace: vi.fn(), search: new URLSearchParams(),
  policy: { allowedPaymentMethods: ['CARD'] as string[], allowedPaymentMethodsKnown: false },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-policy' }),
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
    ...boundary.policy,
  }),
  usePrepareReservation: () => ({ mutateAsync: boundary.prepare }),
  useUnlockAllSeats: () => ({ mutate: boundary.unlock, mutateAsync: boundary.unlock }),
  useCancelPendingReservation: () => ({ mutate: boundary.cancel, mutateAsync: boundary.cancel }),
}));
vi.mock('@/components/auth/auth-guard', () => ({
  AuthGuard: ({ children }: { children: ReactNode }) => children,
}));

const TRANSFER: PaymentMethod = { method: 'TRANSFER', provider: 'CARD', currency: 'KRW' };
const CARD: PaymentMethod = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

vi.mock('@/components/booking/toss-payment-widget', async (importOriginal) => ({
  // The real selection rules (isPayableWidgetSelection) with a test double for the iframe.
  ...(await importOriginal<typeof import('@/components/booking/toss-payment-widget')>()),
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
    const choose = (code: string, paymentMethod: PaymentMethod) => props.onPaymentMethodChange?.({
      code, paymentMethod, requiresOverseasDisclaimer: false, requestFlow: 'widget',
    });
    // What the real widget reports for a raw iframe code (resolvePaymentMethodSelection).
    const chooseCode = async (code: string) => {
      const { resolvePaymentMethodSelection } = await vi.importActual<
        typeof import('@/components/booking/toss-payment-widget')
      >('@/components/booking/toss-payment-widget');
      props.onPaymentMethodChange?.(resolvePaymentMethodSelection(code));
    };
    return (
      <div>
        <button type="button" onClick={() => choose('TRANSFER', TRANSFER)}>Choose transfer</button>
        <button type="button" onClick={() => choose('CARD', CARD)}>Choose card</button>
        {['VIRTUAL_ACCOUNT', 'MOBILE_PHONE', 'PAYCO', '가상계좌'].map((code) => (
          <button key={code} type="button" onClick={() => void chooseCode(code)}>{`Choose ${code}`}</button>
        ))}
      </div>
    );
  }),
}));

const seats = [{
  seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const booking = {
  id: 'reservation-policy', performanceId: 'performance-policy', showtimeId: 'showtime-policy',
  status: 'PENDING_PAYMENT', performanceTitle: 'Policy Test', posterUrl: null,
  showDateTime: '2099-01-02T09:00:00.000Z', venue: 'Test Hall', seats,
  totalAmount: 52000, paymentDeadlineAt: '2099-01-01T00:00:00.000Z', paymentInfo: null,
};

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
}

function payButton(name: string) {
  return screen.getAllByRole('button', { name })[0]!;
}

describe('Checkout payment methods outside the performance policy (audit #70)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.read.mockReset();
    boundary.prepare.mockReset();
    boundary.unlock.mockReset().mockResolvedValue(undefined);
    boundary.cancel.mockResolvedValue(undefined);
    boundary.search = new URLSearchParams();
    boundary.policy = { allowedPaymentMethods: ['CARD'], allowedPaymentMethodsKnown: false };
    window.history.replaceState({}, '', '/booking/performance-policy/confirm');
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-policy', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    boundary.requestPayment.mockImplementation(() => new Promise(() => {}));
  });

  it('keeps the seats and lets the buyer switch methods after prepare rejects the method', async () => {
    const user = userEvent.setup();
    boundary.prepare
      .mockRejectedValueOnce(Object.assign(new Error(CHECKOUT_PAYMENT_METHOD_NOT_ALLOWED_MESSAGE), { statusCode: 409 }))
      .mockImplementationOnce(async ({ orderId, paymentMethod }: { orderId: string; paymentMethod: PaymentMethod }) => ({
        reservationId: 'reservation-policy', orderId, paymentMethod,
        paymentDeadlineAt: '2099-01-01T00:00:00.000Z',
      }));
    boundary.read.mockResolvedValue(null);
    useBookingStore.getState().setBookingData({
      ...booking, selectedSeats: seats, expiresAt: Date.parse(booking.paymentDeadlineAt),
    });
    mountPage();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: 'Choose transfer' }));
    await user.click(payButton('paymentDisclaimer.payNow'));

    expect(await screen.findByText(copy.methodNotAllowed)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'paymentRecovery.reselectCta' })).not.toBeInTheDocument();
    expect(payButton(copy.chooseAnotherMethod)).toBeDisabled();
    expect(new URL(window.location.href).searchParams.get('resumeOrderId')).toBeNull();
    expect(boundary.cancel).not.toHaveBeenCalled();
    expect(boundary.unlock).not.toHaveBeenCalled();
    expect(boundary.requestPayment).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Choose card' }));
    expect(screen.queryByText(copy.methodNotAllowed)).not.toBeInTheDocument();
    await user.click(payButton('paymentDisclaimer.payNow'));

    await waitFor(() => expect(boundary.requestPayment).toHaveBeenCalledTimes(1));
    const [rejected, accepted] = boundary.prepare.mock.calls.map(([input]) => input as {
      orderId: string; paymentMethod: PaymentMethod;
    });
    expect(rejected!.paymentMethod.method).toBe('TRANSFER');
    expect(accepted!.paymentMethod.method).toBe('CARD');
    expect(accepted!.orderId).toBe(rejected!.orderId);
  });

  it('blocks a method outside the cached performance policy before any prepare', async () => {
    const user = userEvent.setup();
    boundary.policy = { allowedPaymentMethods: ['CARD'], allowedPaymentMethodsKnown: true };
    useBookingStore.getState().setBookingData({
      ...booking, selectedSeats: seats, expiresAt: Date.parse(booking.paymentDeadlineAt),
    });
    mountPage();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: 'Choose transfer' }));

    expect(screen.getByText(copy.methodNotAllowed)).toBeInTheDocument();
    expect(payButton(copy.chooseAnotherMethod)).toBeDisabled();
    expect(boundary.prepare).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Choose card' }));
    expect(screen.queryByText(copy.methodNotAllowed)).not.toBeInTheDocument();
    expect(payButton('paymentDisclaimer.payNow')).toBeEnabled();
  });

  it('leaves the decision to the server while the policy is only a fallback', async () => {
    const user = userEvent.setup();
    useBookingStore.getState().setBookingData({
      ...booking, selectedSeats: seats, expiresAt: Date.parse(booking.paymentDeadlineAt),
    });
    mountPage();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: 'Choose transfer' }));

    expect(screen.queryByText(copy.methodNotAllowed)).not.toBeInTheDocument();
    expect(payButton('paymentDisclaimer.payNow')).toBeEnabled();
  });

  it.each([
    ['VIRTUAL_ACCOUNT', { allowedPaymentMethods: ['CARD', 'VIRTUAL_ACCOUNT'], allowedPaymentMethodsKnown: true }],
    ['MOBILE_PHONE', { allowedPaymentMethods: ['CARD'], allowedPaymentMethodsKnown: false }],
    ['PAYCO', { allowedPaymentMethods: ['CARD', 'SIMPLE_PAY'], allowedPaymentMethodsKnown: true }],
    ['가상계좌', { allowedPaymentMethods: ['CARD'], allowedPaymentMethodsKnown: false }],
  ])('refuses a %s widget selection under any policy without calling prepare', async (code, policy) => {
    const user = userEvent.setup();
    boundary.policy = policy;
    useBookingStore.getState().setBookingData({
      ...booking, selectedSeats: seats, expiresAt: Date.parse(booking.paymentDeadlineAt),
    });
    mountPage();
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: `Choose ${code}` }));

    expect(await screen.findByText(copy.methodNotAllowed)).toBeInTheDocument();
    const blocked = payButton(copy.chooseAnotherMethod);
    expect(blocked).toBeDisabled();
    await user.click(blocked);
    expect(boundary.prepare).toHaveBeenCalledTimes(0);
    expect(boundary.requestPayment).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Choose card' }));
    expect(screen.queryByText(copy.methodNotAllowed)).not.toBeInTheDocument();
    expect(payButton('paymentDisclaimer.payNow')).toBeEnabled();
  });

  it('lets a returning buyer resume the order with its fixed method after the policy changed', async () => {
    const user = userEvent.setup();
    boundary.policy = { allowedPaymentMethods: ['CARD'], allowedPaymentMethodsKnown: true };
    boundary.search = new URLSearchParams('resumeOrderId=GRP-fixed');
    boundary.read.mockResolvedValue({ ...booking, tossOrderId: 'GRP-fixed', checkoutPaymentMethod: TRANSFER });
    mountPage();
    await screen.findByText('Policy Test');
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }));
    await user.click(screen.getByRole('button', { name: 'Choose transfer' }));

    expect(screen.queryByText(copy.methodNotAllowed)).not.toBeInTheDocument();
    expect(payButton('paymentDisclaimer.payNow')).toBeEnabled();
  });
});
