import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingRoute from '../page';

const {
  routerReplaceMock,
  useQueueMock,
  useBookingAvailabilityMock,
  useAuthStoreMock,
  useLocaleMock,
} = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  useQueueMock: vi.fn(),
  useBookingAvailabilityMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
  useLocaleMock: vi.fn(() => 'ko'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
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
  QueueWaiting: ({ status }: { status: string }) => <div>queue {status}</div>,
}));

describe('BookingRoute auth gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
