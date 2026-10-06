import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BookingPage } from '@/components/booking/booking-page';
import { ApiClientError } from '@/lib/api-client';
import { getQueueAccessClosedCopy } from '@/lib/booking/queue-access';
import { nextSeatSyncSequence } from '@/lib/booking/seat-sync-sequence';
import { getStatusMessages } from '@/lib/error-messages';
import { useBookingStore } from '@/stores/use-booking-store';

const {
  routerPushMock,
  serverLocksRef,
  localeRef,
  seatStatesRef,
  lockMutateAsyncMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
  // What the server answers to a my-locks read requested by the page.
  serverLocksRef: {
    current: { seatIds: [] as string[], expiresAt: null as number | null },
  },
  localeRef: { current: 'ko' },
  seatStatesRef: { current: { '1F:A-1': 'locked' } as Record<string, string> },
  lockMutateAsyncMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeRef.current,
}));

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock, info: vi.fn(), success: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    isLoading: false,
    isResolved: true,
    bookingDisabledMessage: '',
  }),
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({
    data: createPerformanceDetail(),
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-socket', () => ({
  useBookingSocket: vi.fn(),
}));

vi.mock('@/hooks/use-booking', () => ({
  useSeatStatus: () => ({ data: { seats: seatStatesRef.current } }),
  useMyLocks: () => ({
    data: { seatIds: [], expiresAt: null },
    // Checkout and expiry re-read my-locks; answer with a snapshot requested
    // after the click (audit #30/#31 server verification).
    refetch: async () => ({
      isError: false,
      data: { ...serverLocksRef.current, requestSeq: nextSeatSyncSequence() },
    }),
  }),
  useLockSeat: () => ({ mutate: vi.fn(), mutateAsync: lockMutateAsyncMock, isPending: false }),
  useUnlockSeat: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useUnlockAllSeats: () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));

vi.mock('@/components/booking/booking-header', () => ({
  BookingHeader: ({
    expiresAt,
    onExpire,
  }: {
    expiresAt: number | null;
    onExpire: () => void;
  }) => (
    <header>
      <span>header deadline {String(expiresAt)}</span>
      <button type="button" onClick={onExpire}>
        header countdown ends
      </button>
    </header>
  ),
}));

vi.mock('@/components/booking/seat-map-viewer', () => ({
  SeatMapViewer: ({ onSeatClick }: { onSeatClick: (seatId: string) => void }) => (
    <div>
      seat map ready
      <button type="button" onClick={() => onSeatClick('1F:A-1')}>
        좌석 A-1
      </button>
    </div>
  ),
}));

vi.mock('@/components/booking/seat-legend', () => ({
  SeatLegend: () => <div>seat legend</div>,
}));

vi.mock('@/components/booking/timer-expired-modal', () => ({
  TimerExpiredModal: ({ open }: { open: boolean }) =>
    open ? <div>seat hold expired modal</div> : null,
}));

const NOW = Date.parse('2026-10-02T11:04:00.000Z');
const SELECTED_SEAT = {
  seatId: 'A-1',
  tierName: 'VIP',
  tierColor: '#6C3CE0',
  row: 'A',
  number: '1',
  price: 110000,
  floorKey: '1F',
  floorLabel: '1층',
  seatKey: '1F:A-1',
};

function createPerformanceDetail() {
  const seatMap = {
    id: 'seat-map-1f',
    performanceId: 'performance-queue',
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: '/1F-map.svg',
    seatConfig: {
      tiers: [{ tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1'] }],
    },
    totalSeats: 1,
  };

  return {
    id: 'performance-queue',
    title: 'Queue Fanmeet',
    genre: 'artist_celebrity' as const,
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: 'queue access fixture',
    startDate: '2026-10-18T00:00:00.000+09:00',
    endDate: '2026-10-18T23:59:59.000+09:00',
    runtime: '120분',
    ageRating: '전체관람가',
    status: 'selling' as const,
    salesInfo: null,
    viewCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    venue: { id: 'venue-1', name: '서울 공연장', address: null },
    castings: [],
    showtimes: [
      {
        id: 'showtime-queue',
        performanceId: 'performance-queue',
        dateTime: '2026-10-18T19:00:00.000+09:00',
      },
    ],
    priceTiers: [
      {
        id: 'tier-vip',
        performanceId: 'performance-queue',
        tierName: 'VIP',
        price: 110000,
        sortOrder: 0,
      },
    ],
    seatMaps: [seatMap],
    bookingPolicy: {
      maxTicketsPerUser: 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
    seatMap,
  };
}

function renderWithQuery(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function seedLockedSeat(lockExpiresAt: number) {
  serverLocksRef.current = { seatIds: [SELECTED_SEAT.seatKey], expiresAt: lockExpiresAt };
  useBookingStore.setState({
    selectedDate: new Date('2026-10-18T00:00:00.000+09:00'),
    selectedShowtimeId: 'showtime-queue',
    selectedSeats: [SELECTED_SEAT],
    timerExpiresAt: lockExpiresAt,
    isTimerExpired: false,
  });
}

describe('BookingPage queue access window (audit #32)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    serverLocksRef.current = { seatIds: [], expiresAt: null };
    localeRef.current = 'ko';
    seatStatesRef.current = { '1F:A-1': 'locked' };
    lockMutateAsyncMock.mockReset();
    toastErrorMock.mockReset();
    useBookingStore.getState().resetBooking();
    routerPushMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down to the queue access end when it closes before the seat lock', () => {
    // Admitted at 11:00, seat locked at 11:04: lock 11:14, access 11:10.
    const queueAccessExpiresAt = NOW + 6 * 60_000;
    seedLockedSeat(NOW + 10 * 60_000);

    renderWithQuery(
      <BookingPage
        performanceId="performance-queue"
        queueAccessExpiresAt={queueAccessExpiresAt}
      />,
    );

    expect(
      screen.getByText(`header deadline ${queueAccessExpiresAt}`),
    ).toBeInTheDocument();

    // The route handles the access window; the seat hold is still valid.
    fireEvent.click(screen.getByRole('button', { name: 'header countdown ends' }));
    expect(useBookingStore.getState().isTimerExpired).toBe(false);
    expect(screen.queryByText('seat hold expired modal')).not.toBeInTheDocument();
  });

  it('still expires the seat hold when the lock ends first', async () => {
    const lockExpiresAt = NOW + 3 * 60_000;
    seedLockedSeat(lockExpiresAt);
    // The server confirms the hold is gone before the page declares expiry.
    serverLocksRef.current = { seatIds: [], expiresAt: null };

    renderWithQuery(
      <BookingPage
        performanceId="performance-queue"
        queueAccessExpiresAt={NOW + 6 * 60_000}
      />,
    );

    expect(screen.getByText(`header deadline ${lockExpiresAt}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'header countdown ends' }));
    await waitFor(() => expect(useBookingStore.getState().isTimerExpired).toBe(true));
  });

  it('shows the access window before any seat is held', () => {
    const queueAccessExpiresAt = NOW + 6 * 60_000;

    renderWithQuery(
      <BookingPage
        performanceId="performance-queue"
        queueAccessExpiresAt={queueAccessExpiresAt}
      />,
    );

    expect(
      screen.getByText(`header deadline ${queueAccessExpiresAt}`),
    ).toBeInTheDocument();
  });

  it('carries the earlier deadline into the confirm step', async () => {
    const queueAccessExpiresAt = NOW + 6 * 60_000;
    seedLockedSeat(NOW + 10 * 60_000);

    renderWithQuery(
      <BookingPage
        performanceId="performance-queue"
        queueAccessExpiresAt={queueAccessExpiresAt}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(routerPushMock).toHaveBeenCalled());
    expect(useBookingStore.getState().expiresAt).toBe(queueAccessExpiresAt);
    // Kept separately so the confirm step can tell an access-window end apart
    // from a seat-lock end.
    expect(useBookingStore.getState().queueAccessExpiresAt).toBe(queueAccessExpiresAt);
    expect(routerPushMock).toHaveBeenCalledWith('/booking/performance-queue/confirm');
  });

  describe('seat lock refused by the queue (audit #32)', () => {
    function chooseShowtime() {
      useBookingStore.setState({
        selectedDate: new Date('2026-10-18T00:00:00.000+09:00'),
        selectedShowtimeId: 'showtime-queue',
      });
      seatStatesRef.current = {};
    }

    it.each([
      '대기열 입장 시간이 만료되었습니다',
      '대기열 입장 인증이 필요합니다',
      '대기열 입장 정보가 현재 공연과 일치하지 않습니다',
    ])('hands "%s" to the route and explains it in the buyer language', async (message) => {
      chooseShowtime();
      lockMutateAsyncMock.mockRejectedValueOnce(new ApiClientError(message, 403));
      const onQueueAccessRejected = vi.fn();

      renderWithQuery(
        <BookingPage
          performanceId="performance-queue"
          queueAccessExpiresAt={NOW + 6 * 60_000}
          onQueueAccessRejected={onQueueAccessRejected}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '좌석 A-1' }));

      await waitFor(() => expect(onQueueAccessRejected).toHaveBeenCalledTimes(1));
      expect(toastErrorMock).toHaveBeenCalledWith(
        getQueueAccessClosedCopy('ko').toast,
        expect.objectContaining({ id: 'queue-access-rejected' }),
      );
    });

    it('shows the English queue copy instead of the generic 403 text', async () => {
      localeRef.current = 'en';
      chooseShowtime();
      lockMutateAsyncMock.mockRejectedValueOnce(
        new ApiClientError('대기열 입장 시간이 만료되었습니다', 403),
      );
      const onQueueAccessRejected = vi.fn();

      renderWithQuery(
        <BookingPage
          performanceId="performance-queue"
          queueAccessExpiresAt={NOW + 6 * 60_000}
          onQueueAccessRejected={onQueueAccessRejected}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '좌석 A-1' }));

      await waitFor(() => expect(onQueueAccessRejected).toHaveBeenCalledTimes(1));
      const [message] = toastErrorMock.mock.calls[0] ?? [];
      expect(message).toBe(getQueueAccessClosedCopy('en').toast);
      expect(message).toBe('Your queue access ended, so booking cannot continue. Please rejoin the queue.');
      expect(message).not.toBe(getStatusMessages()[403]);
    });

    it('keeps other 403 lock failures on the seat screen', async () => {
      chooseShowtime();
      lockMutateAsyncMock.mockRejectedValueOnce(new ApiClientError('예매가 일시 중단되었습니다', 403));
      const onQueueAccessRejected = vi.fn();

      renderWithQuery(
        <BookingPage
          performanceId="performance-queue"
          onQueueAccessRejected={onQueueAccessRejected}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '좌석 A-1' }));

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('예매가 일시 중단되었습니다'));
      expect(onQueueAccessRejected).not.toHaveBeenCalled();
    });
  });
});
