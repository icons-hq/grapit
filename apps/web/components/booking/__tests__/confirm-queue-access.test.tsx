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
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { resetServerClockForTests } from '@/lib/server-clock';

const boundary = vi.hoisted(() => ({
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
  useLocale: () => 'ko',
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

function seedCheckout({ lockExpiresAt, queueAccessExpiresAt }: {
  lockExpiresAt: number;
  queueAccessExpiresAt: number;
}) {
  useBookingStore.getState().setBookingData({
    selectedSeats: seats,
    showtimeId: 'showtime-queue',
    performanceId: 'performance-queue',
    performanceTitle: 'Queue Test',
    showDateTime: '2099-01-02T09:00:00.000Z',
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
    || button.textContent === 'paymentRecovery.expiredCta');
}

describe('Checkout step queue access deadline (audit #32 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
