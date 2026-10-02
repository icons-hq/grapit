import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookingRoute from '../page';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';

const {
  queueRetryMock,
  refetchRuntimeFlagsMock,
  toastWarningMock,
  useQueueMock,
  useBookingAvailabilityMock,
  useAuthStoreMock,
} = vi.hoisted(() => ({
  queueRetryMock: vi.fn(),
  refetchRuntimeFlagsMock: vi.fn(),
  toastWarningMock: vi.fn(),
  useQueueMock: vi.fn(),
  useBookingAvailabilityMock: vi.fn(),
  useAuthStoreMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('sonner', () => ({
  toast: { warning: toastWarningMock },
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
  BookingPage: ({
    performanceId,
    queueAccessExpiresAt,
  }: {
    performanceId: string;
    queueAccessExpiresAt?: number | null;
  }) => (
    <div>
      booking page {performanceId} until {String(queueAccessExpiresAt ?? 'none')}
    </div>
  ),
}));

vi.mock('@/components/booking/queue-waiting', () => ({
  QueueWaiting: ({ status, onRetry }: { status: string; onRetry?: () => void }) => (
    <div>
      queue {status}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          retry
        </button>
      ) : null}
    </div>
  ),
}));

const ADMITTED_AT = Date.parse('2026-10-02T11:00:00.000Z');
const ACTIVE_UNTIL = ADMITTED_AT + 10 * 60_000;

function admittedQueue(overrides: Record<string, unknown> = {}) {
  return {
    status: 'admitted',
    position: 0,
    etaSeconds: 0,
    remainingSeats: 120,
    autoEnter: true,
    isReady: true,
    admittedAt: new Date(ADMITTED_AT).toISOString(),
    activeUntilAt: new Date(ACTIVE_UNTIL).toISOString(),
    reentryGraceUntilAt: new Date(ACTIVE_UNTIL + 180_000).toISOString(),
    retry: queueRetryMock,
    enterNow: vi.fn(),
    ...overrides,
  };
}

function renderBookingRoute() {
  return render(
    <Suspense fallback={<div>loading params</div>}>
      <BookingRoute params={fulfilledParams({ performanceId: 'performance-queue' })} />
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

describe('BookingRoute queue access window (audit #32)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetServerClockForTests();
    useBookingAvailabilityMock.mockReturnValue({
      bookingAvailable: true,
      isAdminBookingBypassActive: false,
      isResolved: true,
      isError: false,
      refetch: refetchRuntimeFlagsMock,
    });
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
      user: { email: 'buyer@example.test', isEmailVerified: true, isPhoneVerified: true },
    });
    useQueueMock.mockReturnValue(admittedQueue());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands the queue access deadline to the seat screen', () => {
    vi.setSystemTime(ADMITTED_AT + 4 * 60_000);

    renderBookingRoute();

    expect(
      screen.getByText(`booking page performance-queue until ${ACTIVE_UNTIL}`),
    ).toBeInTheDocument();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it('warns two minutes before access ends and then shows the re-entry screen', () => {
    vi.setSystemTime(ADMITTED_AT + 7 * 60_000);
    renderBookingRoute();

    act(() => {
      vi.advanceTimersByTime(60_000 + 100); // 8:00 after admission
    });
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock.mock.calls[0]?.[0]).toContain('2분');
    expect(screen.getByText(/booking page performance-queue/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText('queue expired')).toBeInTheDocument();
    expect(screen.queryByText(/booking page/)).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(queueRetryMock).toHaveBeenCalledTimes(1);
  });

  it('judges the access window on the server clock, not a fast device clock', () => {
    // Device runs 3 minutes fast: it already shows 11 minutes after admission.
    vi.setSystemTime(ADMITTED_AT + 11 * 60_000);
    recordServerTimeSample({
      serverNowMs: ADMITTED_AT + 8 * 60_000,
      requestStartedAtMs: Date.now() - 50,
      responseReceivedAtMs: Date.now() + 50,
    });

    renderBookingRoute();

    expect(screen.getByText(/booking page performance-queue/)).toBeInTheDocument();
    expect(screen.queryByText('queue expired')).not.toBeInTheDocument();
  });
});

describe('BookingRoute runtime flag failures (audit #67)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
      user: { email: 'buyer@example.test', isEmailVerified: true, isPhoneVerified: true },
    });
    useQueueMock.mockReturnValue(admittedQueue({ status: 'loading', isReady: false }));
  });

  it('shows a retryable state, not the disabled booking page, when the flag check failed', () => {
    useBookingAvailabilityMock.mockReturnValue({
      bookingAvailable: false,
      isAdminBookingBypassActive: false,
      isResolved: false,
      isError: true,
      refetch: refetchRuntimeFlagsMock,
    });

    renderBookingRoute();

    expect(screen.getByText('queue retry')).toBeInTheDocument();
    expect(screen.queryByText(/booking page/)).not.toBeInTheDocument();
    expect(useQueueMock).toHaveBeenCalledWith({
      performanceId: 'performance-queue',
      enabled: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(refetchRuntimeFlagsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps showing the loading state while the first flag check is in flight', () => {
    useBookingAvailabilityMock.mockReturnValue({
      bookingAvailable: false,
      isAdminBookingBypassActive: false,
      isResolved: false,
      isError: false,
      refetch: refetchRuntimeFlagsMock,
    });

    renderBookingRoute();

    expect(screen.getByText('queue loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'retry' })).not.toBeInTheDocument();
  });
});
