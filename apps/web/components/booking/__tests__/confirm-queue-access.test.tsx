import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';
import { getQueueAccessClosedCopy } from '@/lib/booking/queue-access';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { SHOWTIME_SALES_CLOSED_MESSAGE } from '@/lib/booking/showtime-sales';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { resetServerClockForTests } from '@/lib/server-clock';

const boundary = vi.hoisted(() => ({
  locale: 'ko',
  prepare: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  unlock: vi.fn(),
  requestPayment: vi.fn(),
  replace: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-queue' }),
  useRouter: () => ({ replace: boundary.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-intl', () => ({
  useLocale: () => boundary.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock('sonner', () => ({
  toast: {
    error: boundary.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: boundary.read },
}));
vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingAvailability: () => ({ bookingAvailable: true }),
}));
// The real payment snapshot hook: its expiry must follow the clock.
vi.mock('@/hooks/use-booking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-booking')>()),
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

const NOW = Date.parse('2026-10-02T11:08:00.000Z');
const seats = [{
  seatId: 'A-1', seatKey: '2F:A-1', floorKey: '2F', floorLabel: '2층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];
const queueCopy = getQueueAccessClosedCopy('ko');
const confirmCopy = getVisibleCopy('ko').bookingExtra.confirm;

function seedCheckout({ lockExpiresAt, queueAccessExpiresAt, showDateTime = '2099-01-02T09:00:00.000Z' }: {
  lockExpiresAt: number;
  queueAccessExpiresAt: number;
  showDateTime?: string;
}) {
  useBookingStore.getState().setBookingData({
    selectedSeats: seats,
    showtimeId: 'showtime-queue',
    performanceId: 'performance-queue',
    performanceTitle: 'Queue Test',
    showDateTime,
    venue: 'Test Hall',
    posterUrl: null,
    // Same value the seat screen hands over: the earlier of the two.
    expiresAt: Math.min(lockExpiresAt, queueAccessExpiresAt),
    queueAccessExpiresAt,
  });
}

function mountPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmPage />
    </QueryClientProvider>,
  );
}

function payButtons() {
  return screen.getAllByRole('button').filter((button) =>
    button.textContent === 'paymentDisclaimer.payNow'
    || button.textContent === confirmCopy.agreeTerms
    || button.textContent === queueCopy.title
    || button.textContent === 'paymentRecovery.expiredCta'
    || button.textContent === 'seatSelection.showtimeClosed'
    || button.textContent === confirmCopy.processing);
}

async function agreeToTerms(locale: 'ko' | 'en' | 'th' | 'zh-CN' = 'ko') {
  await act(async () => {
    fireEvent.click(screen.getByRole('checkbox', { name: getCheckoutCopy(locale).allTerms }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function clickPay() {
  await act(async () => {
    fireEvent.click(payButtons()[0]!);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('Checkout step queue access deadline (audit #32 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.locale = 'ko';
    boundary.prepare.mockReset();
    boundary.read.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    resetServerClockForTests();
    boundary.unlock.mockResolvedValue(undefined);
    boundary.cancel.mockResolvedValue(undefined);
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-queue', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks payment and offers a rejoin when the queue access window closes first', async () => {
    seedCheckout({
      lockExpiresAt: NOW + 6 * 60_000,
      queueAccessExpiresAt: NOW + 2 * 60_000,
    });
    mountPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText(queueCopy.body)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000 + 100);
    });

    // Not the seat-lock "returning to seat selection" message: the lock is alive.
    expect(boundary.toastError).toHaveBeenCalledWith(queueCopy.toast);
    expect(boundary.toastError).not.toHaveBeenCalledWith(confirmCopy.lockExpiredRedirect);
    expect(screen.getByText(queueCopy.body)).toBeInTheDocument();
    expect(screen.queryByText('paymentRecovery.expiredTitle')).not.toBeInTheDocument();
    const blocked = payButtons();
    expect(blocked.length).toBeGreaterThan(0);
    for (const button of blocked) {
      expect(button).toHaveTextContent(queueCopy.title);
      expect(button).toBeDisabled();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: queueCopy.rejoin }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(boundary.unlock).toHaveBeenCalledWith({ showtimeId: 'showtime-queue' });
    expect(boundary.replace).toHaveBeenCalledWith('/booking/performance-queue');
    expect(boundary.prepare).not.toHaveBeenCalled();
  });

  it('keeps the seat-lock wording and blocks payment on time when the seat lock ends first', async () => {
    seedCheckout({
      lockExpiresAt: NOW + 60_000,
      queueAccessExpiresAt: NOW + 2 * 60_000,
    });
    mountPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (const button of payButtons()) {
      expect(button).not.toHaveTextContent('paymentRecovery.expiredCta');
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 100);
    });

    expect(boundary.toastError).toHaveBeenCalledWith(confirmCopy.lockExpiredRedirect);
    expect(screen.queryByText(queueCopy.body)).not.toBeInTheDocument();
    expect(screen.getByText('paymentRecovery.expiredTitle')).toBeInTheDocument();
    for (const button of payButtons()) {
      expect(button).toHaveTextContent('paymentRecovery.expiredCta');
      expect(button).toBeDisabled();
    }

    // The expiry notice offers the way out instead of a dead end.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'paymentRecovery.reselectCta' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(boundary.unlock).toHaveBeenCalledWith({ showtimeId: 'showtime-queue' });
    expect(boundary.replace).toHaveBeenCalledWith('/booking/performance-queue');
  });

  it('keeps the pay button open while the seat lock and queue access are alive (audit #95)', async () => {
    // Ten minutes of seat lock; the server payment window only starts at prepare.
    seedCheckout({
      lockExpiresAt: NOW + 10 * 60_000,
      queueAccessExpiresAt: NOW + 20 * 60_000,
    });
    mountPage();
    await agreeToTerms();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8 * 60_000);
    });

    expect(screen.queryByText('paymentRecovery.expiredTitle')).not.toBeInTheDocument();
    const buttons = payButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toHaveTextContent('paymentDisclaimer.payNow');
      expect(button).toBeEnabled();
    }
  });

  it('does not let the queue rejoin cancel the order while prepare is in flight', async () => {
    boundary.prepare.mockReturnValue(new Promise(() => {}));
    seedCheckout({
      lockExpiresAt: NOW + 6 * 60_000,
      queueAccessExpiresAt: NOW + 60_000,
    });
    mountPage();
    await agreeToTerms();
    await clickPay();
    expect(boundary.prepare).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + 100);
    });

    const rejoin = screen.getByRole('button', { name: queueCopy.rejoin });
    expect(rejoin).toBeDisabled();
    await act(async () => {
      fireEvent.click(rejoin);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(boundary.cancel).not.toHaveBeenCalled();
    expect(boundary.unlock).not.toHaveBeenCalled();
  });

  it('closes the pay button at the showtime start and offers seat reselection (C1)', async () => {
    seedCheckout({
      lockExpiresAt: NOW + 6 * 60_000,
      queueAccessExpiresAt: NOW + 6 * 60_000,
      showDateTime: new Date(NOW + 60_000).toISOString(),
    });
    mountPage();
    await agreeToTerms();
    for (const button of payButtons()) {
      expect(button).toBeEnabled();
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    const blocked = payButtons();
    expect(blocked.length).toBeGreaterThan(0);
    for (const button of blocked) {
      expect(button).toHaveTextContent('seatSelection.showtimeClosed');
      expect(button).toBeDisabled();
    }
    // The notice itself, besides the two pay buttons that carry the same text.
    expect(screen.getAllByText('seatSelection.showtimeClosed')).toHaveLength(blocked.length + 1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'paymentRecovery.reselectCta' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(boundary.prepare).not.toHaveBeenCalled();
    expect(boundary.replace).toHaveBeenCalledWith('/booking/performance-queue');
  });

  it.each(['en', 'th', 'zh-CN'] as const)(
    'shows locale copy, not the generic failure, when prepare is refused for a closed showtime or queue access (%s)',
    async (locale) => {
      boundary.locale = locale;
      // A successful owner lookup returning null: no order was created.
      boundary.read.mockResolvedValue(null);
      boundary.prepare
        .mockRejectedValueOnce(Object.assign(new Error(SHOWTIME_SALES_CLOSED_MESSAGE), { statusCode: 403 }));
      seedCheckout({ lockExpiresAt: NOW + 6 * 60_000, queueAccessExpiresAt: NOW + 6 * 60_000 });
      const view = mountPage();
      await agreeToTerms(locale);
      await clickPay();

      expect(screen.getByText('seatSelection.showtimeClosed')).toBeInTheDocument();
      expect(screen.queryByText(SHOWTIME_SALES_CLOSED_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByText(getVisibleCopy(locale).bookingExtra.confirm.paymentRequestFailed))
        .not.toBeInTheDocument();
      view.unmount();

      boundary.prepare
        .mockRejectedValueOnce(Object.assign(new Error('대기열 입장 시간이 만료되었습니다'), { statusCode: 403 }));
      useBookingStore.getState().resetBooking();
      seedCheckout({ lockExpiresAt: NOW + 6 * 60_000, queueAccessExpiresAt: NOW + 6 * 60_000 });
      mountPage();
      await agreeToTerms(locale);
      await clickPay();

      expect(screen.getByText(getQueueAccessClosedCopy(locale).toast)).toBeInTheDocument();
      expect(screen.queryByText('대기열 입장 시간이 만료되었습니다')).not.toBeInTheDocument();
    },
  );
});
