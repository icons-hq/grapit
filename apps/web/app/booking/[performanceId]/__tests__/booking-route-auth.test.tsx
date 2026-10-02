import { Suspense } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingRoute from '../page';

const {
  routerReplaceMock,
  routerPushMock,
  useQueueMock,
  useBookingAvailabilityMock,
  useAuthStoreMock,
  useLocaleMock,
} = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  routerPushMock: vi.fn(),
  useQueueMock: vi.fn(),
  useBookingAvailabilityMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: routerPushMock,
  }),
}));

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}));

vi.mock('@/hooks/use-queue', () => ({
  useQueue: useQueueMock,
}));

vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingAvailability: useBookingAvailabilityMock,
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@/components/booking/booking-page', () => ({
  BookingPage: ({ performanceId }: { performanceId: string }) => (
    <div>booking page {performanceId}</div>
  ),
}));

vi.mock('@/components/booking/queue-waiting', () => ({
  QueueWaiting: ({
    status,
    bookingOpensAt,
    onBack,
  }: {
    status: string;
    bookingOpensAt?: number | null;
    onBack?: () => void;
  }) => (
    <div>
      queue {status}
      {bookingOpensAt ? <span>opens {bookingOpensAt}</span> : null}
      {onBack ? <button onClick={onBack}>back</button> : null}
    </div>
  ),
}));

describe('BookingRoute auth gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLocaleMock.mockReturnValue('ko');
    useBookingAvailabilityMock.mockReturnValue({
      bookingAvailable: true,
      isAdminBookingBypassActive: false,
      isResolved: true,
    });
    useQueueMock.mockReturnValue({
      status: 'loading',
      position: 0,
      etaSeconds: 0,
      remainingSeats: 0,
      autoEnter: false,
      isReady: false,
      retry: vi.fn(),
      enterNow: vi.fn(),
    });
  });

  it('does not enable queue entry before auth initialization completes', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: false,
      accessToken: null,
    });

    renderBookingRoute();

    await waitFor(() => {
      expect(useQueueMock).toHaveBeenCalledWith({
        performanceId: 'performance-auth',
        enabled: false,
      });
    });
    expect(await screen.findByText('queue loading')).toBeInTheDocument();
  });

  it('redirects signed-out visitors to auth with a booking return path instead of showing queue authRequired', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: null,
    });

    renderBookingRoute();

    await waitFor(() => {
      expect(useQueueMock).toHaveBeenCalledWith({
        performanceId: 'performance-auth',
        enabled: false,
      });
    });
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith(
        '/auth?returnTo=%2Fbooking%2Fperformance-auth',
      );
    });
    expect(screen.queryByText('queue authRequired')).not.toBeInTheDocument();
  });

  it.each([
    [false, '/en/auth/verify-email?email=buyer%40example.test&returnTo=%2Fen%2Fbooking%2Fperformance-auth'],
    [true, '/en/mypage?tab=settings&returnTo=%2Fen%2Fbooking%2Fperformance-auth'],
  ])('keeps the booking and language through required verification (email verified: %s)', async (emailVerified, destination) => {
    useLocaleMock.mockReturnValue('en');
    useBookingAvailabilityMock.mockReturnValue({ bookingAvailable: false, verificationRequiredForBooking: true, isResolved: true });
    useAuthStoreMock.mockReturnValue({ isInitialized: true, accessToken: 'session', user: { email: 'buyer@example.test', isEmailVerified: emailVerified, isPhoneVerified: false } });
    renderBookingRoute();
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith(destination));
    expect(useQueueMock).toHaveBeenCalledWith({ performanceId: 'performance-auth', enabled: false });
  });

  it('enables queue entry after the visitor has an access token', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });

    renderBookingRoute();

    await waitFor(() => {
      expect(useQueueMock).toHaveBeenCalledWith({
        performanceId: 'performance-auth',
        enabled: true,
      });
    });
  });

  it('does not show the queue surface while checking immediate admission', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });

    renderBookingRoute();

    await waitFor(() => {
      expect(useQueueMock).toHaveBeenCalledWith({
        performanceId: 'performance-auth',
        enabled: true,
      });
    });
    expect(screen.queryByText('queue loading')).not.toBeInTheDocument();
  });

  it('shows the loading surface instead of a blank page when queue entry is slow (audit #33)', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });
    useQueueMock.mockReturnValue({
      status: 'loading',
      isSlowLoading: true,
      position: 0,
      etaSeconds: 0,
      remainingSeats: 0,
      autoEnter: false,
      isReady: false,
      retry: vi.fn(),
      enterNow: vi.fn(),
    });

    renderBookingRoute();

    expect(await screen.findByText('queue loading')).toBeInTheDocument();
  });

  it('passes the server-corrected open time to the not-open surface (audit #33)', async () => {
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });
    useQueueMock.mockReturnValue({
      status: 'notOpen',
      bookingOpensAt: 1_780_000_000_000,
      position: 0,
      etaSeconds: 0,
      remainingSeats: 0,
      autoEnter: false,
      isReady: false,
      retry: vi.fn(),
      enterNow: vi.fn(),
    });

    renderBookingRoute();

    expect(await screen.findByText('queue notOpen')).toBeInTheDocument();
    expect(screen.getByText('opens 1780000000000')).toBeInTheDocument();
  });

  it('sends closed-sale visitors back to the localized performance page', async () => {
    useLocaleMock.mockReturnValue('en');
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });
    useQueueMock.mockReturnValue({
      status: 'closed',
      position: 0,
      etaSeconds: 0,
      remainingSeats: 0,
      autoEnter: false,
      isReady: false,
      retry: vi.fn(),
      enterNow: vi.fn(),
    });

    renderBookingRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'back' }));
    expect(routerPushMock).toHaveBeenCalledWith('/en/performance/performance-auth');
  });

  it('sends visitors of a missing performance home instead of to its missing detail page', async () => {
    useLocaleMock.mockReturnValue('en');
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
    });
    useQueueMock.mockReturnValue({
      status: 'closed',
      closedReason: 'notFound',
      position: 0,
      etaSeconds: 0,
      remainingSeats: 0,
      autoEnter: false,
      isReady: false,
      retry: vi.fn(),
      enterNow: vi.fn(),
    });

    renderBookingRoute();

    fireEvent.click(await screen.findByRole('button', { name: 'back' }));
    expect(routerPushMock).toHaveBeenCalledWith('/en');
  });
});

function renderBookingRoute() {
  render(
    <Suspense fallback={<div>loading params</div>}>
      <BookingRoute
        params={fulfilledParams({ performanceId: 'performance-auth' })}
      />
    </Suspense>,
  );
}

function fulfilledParams<T>(value: T): Promise<T> {
  return {
    status: 'fulfilled',
    value,
    then: vi.fn(),
  } as unknown as Promise<T>;
}
