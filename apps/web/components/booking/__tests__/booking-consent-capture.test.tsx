import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ConfirmPage from '@/app/booking/[performanceId]/confirm/page';
import { getCheckoutCopy } from '@/lib/booking/checkout-copy';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';

const boundary = vi.hoisted(() => ({
  locale: 'ko',
  prepare: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  unlock: vi.fn(),
  requestPayment: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ performanceId: 'performance-consent' }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-intl', () => ({
  useLocale: () => boundary.locale,
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

const seats = [{
  seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층',
  tierName: 'VIP', row: 'A', number: '1', price: 50000,
}];

async function agreeAndPay(locale: 'ko' | 'en' | 'th' | 'zh-CN') {
  boundary.locale = locale;
  useBookingStore.getState().setBookingData({
    performanceId: 'performance-consent',
    showtimeId: 'showtime-consent',
    performanceTitle: 'Consent Test',
    posterUrl: null,
    showDateTime: '2099-01-02T09:00:00.000Z',
    venue: 'Test Hall',
    selectedSeats: seats,
    expiresAt: Date.parse('2099-01-01T00:00:00.000Z'),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ConfirmPage /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('checkbox', { name: getCheckoutCopy(locale).allTerms }));
  await user.click(screen.getAllByRole('button', { name: 'paymentDisclaimer.payNow' })[0]!);
  await waitFor(() => expect(boundary.prepare).toHaveBeenCalledTimes(1));
  return boundary.prepare.mock.calls[0]![0] as { consentItems: Array<Record<string, unknown>> };
}

describe('Booking consent capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.prepare.mockImplementation(() => new Promise(() => {}));
    boundary.read.mockResolvedValue(null);
    window.history.replaceState({}, '', '/booking/performance-consent/confirm');
    useBookingStore.getState().resetBooking();
    useAuthStore.getState().setAuth('synthetic-test-token', {
      id: 'buyer-consent', email: 'buyer@example.test', name: 'Buyer', phone: '+821012345678',
      gender: 'unspecified', country: 'KR', birthDate: '1990-01-01', preferredLocale: 'ko',
      isEmailVerified: true, isPhoneVerified: true, marketingConsent: false, role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('records only the two rows the checkout shows, on their document versions', async () => {
    const payload = await agreeAndPay('ko');

    expect(payload.consentItems).toEqual([
      { key: 'terms', version: '2026-04-28', language: 'ko', accepted: true, sourceFlow: 'booking' },
      { key: 'privacy', version: '2026-05-11', language: 'ko', accepted: true, sourceFlow: 'booking' },
    ]);
  });

  it.each(['th', 'zh-CN', 'en'] as const)(
    'records English as the consent language for %s, because the English document is shown',
    async (locale) => {
      const payload = await agreeAndPay(locale);

      expect(payload.consentItems.map((item) => item.key)).toEqual(['terms', 'privacy']);
      expect(payload.consentItems.every((item) => item.language === 'en')).toBe(true);
    },
  );
});
