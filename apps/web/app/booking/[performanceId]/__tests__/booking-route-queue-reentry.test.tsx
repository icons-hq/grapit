import { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookingRoute from '../page';
import { resetServerClockForTests } from '@/lib/server-clock';
import { useBookingStore } from '@/stores/use-booking-store';

// Drives the real useQueue against a scripted queue API so the route sees the
// same snapshots the server sends (closed windows, payment recovery, socket).
const {
  postMock,
  getMock,
  socketHandlers,
  socketMock,
  toastWarningMock,
  unlockAllMock,
  bookingPageRenders,
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
    unlockAllMock: vi.fn(),
    bookingPageRenders: { count: 0 },
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
    data: unknown;

    constructor(message: string, statusCode: number, data?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.data = data;
    }
  }
  return {
    apiClient: { post: postMock, get: getMock },
    ApiClientError,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

vi.mock('@/hooks/use-booking', () => ({
  useUnlockAllSeats: () => ({ mutate: unlockAllMock }),
}));

vi.mock('@/stores/use-auth-store', () => ({
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@/components/booking/booking-page', () => ({
  BookingPage: ({
    queueAccessExpiresAt,
    onQueueAccessRejected,
  }: {
    queueAccessExpiresAt?: number | null;
    onQueueAccessRejected?: () => void;
  }) => {
    bookingPageRenders.count += 1;
    return (
      <div>
        booking page until {String(queueAccessExpiresAt ?? 'none')}
        <button type="button" onClick={() => onQueueAccessRejected?.()}>
          seat lock refused by the queue
        </button>
      </div>
    );
  },
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
const SHOWTIME_ID = 'showtime-reentry';

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

/** prepare ran, then the window closed: only the bound order may be paid. */
const recoverySnapshot = () =>
  snapshot({
    state: 'PAYMENT_RECOVERY',
    autoEnter: false,
    paymentRecoveryUntilAt: new Date(REENTRY_GRACE_UNTIL).toISOString(),
    recoveryOrderId: 'order-awaiting-payment',
  });
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

function holdSeatsInStore() {
  useBookingStore.setState({
    selectedShowtimeId: SHOWTIME_ID,
    selectedSeats: [
      {
        seatId: 'A-1',
        tierName: 'VIP',
        tierColor: '#6C3CE0',
        row: 'A',
        number: '1',
        price: 110000,
        floorKey: '1F',
        floorLabel: '1층',
        seatKey: '1F:A-1',
      },
    ],
  });
}

describe('BookingRoute queue re-entry (audit #4, #32, D2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockReset();
    getMock.mockReset();
    socketHandlers.clear();
    bookingPageRenders.count = 0;
    vi.useFakeTimers();
    resetServerClockForTests();
    useBookingStore.getState().resetBooking();
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

  it('never opens a seat screen without a countdown for an admission whose window closed', async () => {
    // Back on the route after the window closed; an older API still hands
    // out the old admission once, then queues the buyer again.
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    postMock
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(newWaitingSnapshot());

    renderBookingRoute();
    await flush();
    expect(screen.queryByText(/booking page/)).not.toBeInTheDocument();
    await flush(1);
    await flush(1_300);

    expect(bookingPageRenders.count).toBe(0);
    expect(enterCalls()).toBe(2);
    expect(screen.getByText('queue waiting')).toBeInTheDocument();
  });

  it('stays on the re-entry screen after one automatic re-entry finds the same closed admission', async () => {
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    postMock.mockResolvedValue(snapshot());

    renderBookingRoute();
    await flush();
    await flush(10_000);

    expect(bookingPageRenders.count).toBe(0);
    expect(enterCalls()).toBe(2);
    expect(screen.getByText('queue expired')).toBeInTheDocument();
  });

  it('offers to continue the payment of an order bound to a closed window, not the seat screen', async () => {
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    postMock.mockResolvedValueOnce(recoverySnapshot());

    renderBookingRoute();
    await flush();
    await flush(1_300);

    expect(bookingPageRenders.count).toBe(0);
    expect(
      screen.getByRole('heading', { name: '결제 대기 중인 예매가 있습니다' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '결제 이어하기' })).toHaveAttribute(
      'href',
      '/booking/performance-reentry/confirm?resumeOrderId=order-awaiting-payment',
    );
    expect(screen.getByRole('link', { name: '내 예매 보기' })).toHaveAttribute(
      'href',
      '/mypage?tab=reservations',
    );
    expect(screen.queryByText(/queue expired/)).not.toBeInTheDocument();
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(enterCalls()).toBe(1);
  });

  it('opens checkout for the order from the server, not from the stale seat screen state', async () => {
    // Back from the seat screen in the same tab: the store still holds its
    // seats and the queue access deadline that has passed.
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    holdSeatsInStore();
    useBookingStore.setState({
      performanceId: 'performance-reentry',
      queueAccessExpiresAt: ACTIVE_UNTIL,
      expiresAt: ACTIVE_UNTIL,
    });
    postMock.mockResolvedValueOnce(recoverySnapshot());

    renderBookingRoute();
    await flush();
    await flush(1_300);

    const resume = screen.getByRole('link', { name: '결제 이어하기' });
    resume.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(resume);

    // Checkout (useCheckoutRecovery) fills the store from the order itself, so
    // the passed deadline cannot block its pay button.
    expect(useBookingStore.getState()).toMatchObject({
      selectedShowtimeId: null,
      selectedSeats: [],
      queueAccessExpiresAt: null,
      expiresAt: null,
    });
    // The order's seats stay locked for its payment.
    expect(unlockAllMock).not.toHaveBeenCalled();
  });

  it('shows a new waiting position when the confirm step rejoin button returns here', async () => {
    // The confirm rejoin cancelled the pending order, released the seats and
    // reset the booking store before coming back, so the server queues the
    // buyer again and nothing is left to release.
    vi.setSystemTime(ACTIVE_UNTIL + 30_000);
    postMock.mockResolvedValueOnce(newWaitingSnapshot());

    renderBookingRoute();
    await flush();

    expect(screen.getByText('queue waiting')).toBeInTheDocument();
    expect(bookingPageRenders.count).toBe(0);
    expect(enterCalls()).toBe(1);
    expect(unlockAllMock).not.toHaveBeenCalled();
  });

  it('keeps the seats of an order awaiting payment when rejoin is clicked before the window-end check', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    holdSeatsInStore();
    postMock
      .mockResolvedValueOnce(snapshot({ state: 'PAYMENT_RECOVERY' }))
      .mockResolvedValueOnce(recoverySnapshot());

    renderBookingRoute();
    await flush();
    await flush(1_300);
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    // The local clock closes the window; the status check (activeUntilAt + 2s)
    // has not answered when the buyer clicks rejoin.
    await flush(60_000 - 1_300 + 100);
    expect(screen.getByText('queue expired')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();

    expect(screen.getByRole('link', { name: '결제 이어하기' })).toBeInTheDocument();
    expect(unlockAllMock).not.toHaveBeenCalled();
    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);
  });

  it('releases the seats once a rejoin clicked before the window-end check gets a new position', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    holdSeatsInStore();
    postMock
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(newWaitingSnapshot());

    renderBookingRoute();
    await flush();
    await flush(60_000 + 100);
    expect(screen.getByText('queue expired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();

    expect(screen.getByText('queue waiting')).toBeInTheDocument();
    expect(unlockAllMock).toHaveBeenCalledTimes(1);
    expect(unlockAllMock).toHaveBeenCalledWith({ showtimeId: SHOWTIME_ID });
  });

  it('keeps the seats when an older API reports the closed admission without its order', async () => {
    // Older API (rollback): the window-end check returns the closed
    // PAYMENT_RECOVERY session without recoveryOrderId. Another tab may still
    // be paying the order prepared under it.
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    holdSeatsInStore();
    postMock.mockResolvedValue(snapshot({ state: 'PAYMENT_RECOVERY', autoEnter: false }));
    getMock.mockReset();
    getMock.mockResolvedValue(snapshot({ state: 'PAYMENT_RECOVERY', autoEnter: false }));

    renderBookingRoute();
    await flush();
    await flush(1_300);
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    await flush(60_000 + 2_100);
    await flush(1);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('queue expired')).toBeInTheDocument();
    expect(unlockAllMock).not.toHaveBeenCalled();
  });

  it('releases the held seats once the server confirms the window ended, then rejoins with one click', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    holdSeatsInStore();
    postMock
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(newWaitingSnapshot());
    getMock.mockReset();
    getMock.mockResolvedValueOnce(expiredSnapshot());

    renderBookingRoute();
    await flush();
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    // The window closes on the seat screen: re-entry screen at once.
    await flush(60_000 + 100);
    expect(screen.getByText('queue expired')).toBeInTheDocument();
    // The seats wait for the server's answer (an order may still need them).
    expect(unlockAllMock).not.toHaveBeenCalled();

    await flush(2_000);
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(unlockAllMock).toHaveBeenCalledTimes(1);
    expect(unlockAllMock).toHaveBeenCalledWith({ showtimeId: SHOWTIME_ID });
    expect(useBookingStore.getState().selectedSeats).toEqual([]);
    expect(screen.getByText('queue expired')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await flush();
    expect(enterCalls()).toBe(2);
    expect(screen.getByText('queue waiting')).toBeInTheDocument();
    expect(unlockAllMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the seats of an order still awaiting payment when the window ends', async () => {
    vi.setSystemTime(ADMITTED_AT + 9 * 60_000);
    holdSeatsInStore();
    postMock.mockResolvedValueOnce(snapshot({ state: 'PAYMENT_RECOVERY' }));
    getMock.mockReset();
    getMock.mockResolvedValueOnce(recoverySnapshot());

    renderBookingRoute();
    await flush();
    await flush(1_300);
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    await flush(60_000 + 2_100);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: '결제 이어하기' })).toBeInTheDocument();
    expect(unlockAllMock).not.toHaveBeenCalled();
    expect(useBookingStore.getState().selectedSeats).toHaveLength(1);
  });

  it('leaves the seat screen and releases its seats when a seat lock is refused by the queue', async () => {
    // Another tab bought with the same admission (one admission, one order).
    vi.setSystemTime(ADMITTED_AT + 2 * 60_000);
    holdSeatsInStore();
    postMock.mockResolvedValueOnce(snapshot());
    getMock.mockReset();
    getMock.mockResolvedValueOnce(expiredSnapshot());

    renderBookingRoute();
    await flush();
    expect(screen.getByText(`booking page until ${ACTIVE_UNTIL}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'seat lock refused by the queue' }));
    await flush();

    // Re-read at once, not at the original window end 8 minutes later.
    expect(getMock).toHaveBeenCalledWith('/api/v1/queue/sessions/queue-session-old', {
      showErrorToast: false,
    });
    expect(screen.getByText('queue expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    expect(unlockAllMock).toHaveBeenCalledWith({ showtimeId: SHOWTIME_ID });
  });
});
