import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookingRoute from '../page';
import { resetServerClockForTests } from '@/lib/server-clock';

// Drives the real useQueue against a scripted queue API so the route sees the
// same snapshots the server sends (normalizeSnapshot, auto-enter, socket).
const {
  postMock,
  getMock,
  socketHandlers,
  socketMock,
  toastWarningMock,
  useBookingAvailabilityMock,
  useAuthStoreMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
  };

  return {
    postMock: vi.fn(),
    getMock: vi.fn(),
    socketHandlers: handlers,
    socketMock: socket,
    toastWarningMock: vi.fn(),
    useBookingAvailabilityMock: vi.fn(),
    useAuthStoreMock: vi.fn(),
  };
});

vi.mock('socket.io-client', () => ({
  io: () => socketMock,
}));

vi.mock('@/lib/api-client', () => {
  class ApiClientError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    apiClient: { post: postMock, get: getMock },
    ApiClientError,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('sonner', () => ({
  toast: { warning: toastWarningMock },
}));

vi.mock('@/hooks/use-booking-availability', () => ({
  useBookingAvailability: useBookingAvailabilityMock,
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@/components/booking/booking-page', () => ({
  BookingPage: ({ queueAccessExpiresAt }: { queueAccessExpiresAt?: number | null }) => (
    <div>booking page until {String(queueAccessExpiresAt ?? 'none')}</div>
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
const REENTRY_GRACE_UNTIL = ACTIVE_UNTIL + 3 * 60_000;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    queueSessionId: 'queue-session-old',
    state: 'ADMITTED',
    position: 0,
    waitingCount: 0,
    etaSeconds: 0,
    remainingSeats: 80,
    autoEnter: true,
    admittedAt: new Date(ADMITTED_AT).toISOString(),
    activeUntilAt: new Date(ACTIVE_UNTIL).toISOString(),
    reentryGraceUntilAt: new Date(REENTRY_GRACE_UNTIL).toISOString(),
    ...overrides,
  };
}

/** prepare ran before the window closed: the server keeps it until the grace. */
const paymentRecoverySnapshot = () =>
  snapshot({ state: 'PAYMENT_RECOVERY', autoEnter: false });
const expiredSnapshot = () =>
  snapshot({
    state: 'EXPIRED',
    autoEnter: false,
    admittedAt: null,
    activeUntilAt: null,
    reentryGraceUntilAt: null,
  });
const newWaitingSnapshot = () =>
  snapshot({
    queueSessionId: 'queue-session-new',
    state: 'WAITING',
    position: 57,
    waitingCount: 57,
    etaSeconds: 280,
    autoEnter: false,
    admittedAt: null,
    activeUntilAt: null,
    reentryGraceUntilAt: null,
  });

function fulfilledParams<T>(value: T): Promise<T> {
  return {
    status: 'fulfilled',
    value,
    then: vi.fn(),
  } as unknown as Promise<T>;
}

function renderBookingRoute() {
  return render(
    <Suspense fallback={<div>loading params</div>}>
      <BookingRoute params={fulfilledParams({ performanceId: 'performance-reentry' })} />
    </Suspense>,
  );
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function enterCalls() {
  return postMock.mock.calls.filter(([url]) =>
    String(url).endsWith('/performances/performance-reentry/enter'),
  ).length;
}

describe('BookingRoute rejoin after the queue access window (audit #32 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockReset();
    getMock.mockReset();
    socketHandlers.clear();
    vi.useFakeTimers();
    resetServerClockForTests();
    getMock.mockImplementation(() => new Promise(() => {}));
    useBookingAvailabilityMock.mockReturnValue({
      bookingAvailable: true,
      isAdminBookingBypassActive: false,
      isResolved: true,
      isError: false,
      refetch: vi.fn(),
    });
    useAuthStoreMock.mockReturnValue({
      isInitialized: true,
      accessToken: 'access-token',
      user: { email: 'buyer@example.test', isEmailVerified: true, isPhoneVerified: true },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not loop on the expired screen when rejoining returns the PAYMENT_RECOVERY session', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    postMock
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(paymentRecoverySnapshot())
      .mockResolvedValueOnce(newWaitingSnapshot());

    renderBookingRoute();
    await flush();
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    // The window closes on the seat screen.
    await flush(60_000 + 100);
    expect(screen.getByText('queue expired')).toBeInTheDocument();

    // Rejoin: the server still reuses the recovery session (until the grace).
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();
    expect(enterCalls()).toBe(2);
    await flush(1_300); // useQueue auto-enter delay for a non-immediate admission

    // No expired <-> admitted loop: the seat screen keeps the server path
    // (no client deadline), where the first seat lock expires the session.
    expect(screen.getByText('booking page until none')).toBeInTheDocument();
    expect(screen.queryByText('queue expired')).not.toBeInTheDocument();
    await flush(5_000);
    expect(screen.getByText('booking page until none')).toBeInTheDocument();
    expect(enterCalls()).toBe(2);

    // That rejected lock expires the session on the server; the pending rejoin
    // then takes a new position without another click.
    await act(async () => {
      socketHandlers.get('queue:expired')?.({
        queueSessionId: 'queue-session-old',
        state: 'EXPIRED',
        autoEnter: false,
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(enterCalls()).toBe(3);
    expect(screen.getByText('queue waiting')).toBeInTheDocument();
  });

  it('keeps the pre-existing seat screen when the route opens on a recovery session', async () => {
    // Back from a failed payment after the window closed.
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    postMock.mockResolvedValueOnce(paymentRecoverySnapshot());

    renderBookingRoute();
    await flush();
    await flush(1_300);

    expect(screen.getByText('booking page until none')).toBeInTheDocument();
    expect(screen.queryByText('queue expired')).not.toBeInTheDocument();
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(enterCalls()).toBe(1);
  });

  it('takes a new position with one click when the rejoin finds the old admission expired', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    postMock
      .mockResolvedValueOnce(snapshot())
      // The reconcile on the rejoin request expired the old admission.
      .mockResolvedValueOnce(expiredSnapshot())
      .mockResolvedValueOnce(newWaitingSnapshot());

    renderBookingRoute();
    await flush();
    await flush(60_000 + 100);
    expect(screen.getByText('queue expired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();
    await flush();

    expect(enterCalls()).toBe(3);
    expect(screen.getByText('queue waiting')).toBeInTheDocument();
  });

  it('enters automatically only once per rejoin click', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    postMock
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValue(expiredSnapshot());

    renderBookingRoute();
    await flush();
    await flush(60_000 + 100);

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();
    await flush();
    await flush(10_000);

    expect(enterCalls()).toBe(3);
    expect(screen.getByText('queue expired')).toBeInTheDocument();
  });
});
