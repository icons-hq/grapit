import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { BookingPage } from '@/components/booking/booking-page';
import { formatKstTimeLabel, getKstCalendarDate } from '@/lib/booking-datetime';
import { useBookingStore } from '@/stores/use-booking-store';

/**
 * Seat selection flow against the real booking hooks (TanStack Query
 * mutations/queries) with a small in-memory booking API. Each test
 * reproduces an audit failure scenario (#2, #8, #10, #27, #28, #29, #30,
 * #31, #94) with controllable request timing.
 */

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const hoisted = vi.hoisted(() => {
  class ApiClientError extends Error {
    statusCode: number;
    data: unknown;

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
    }
  }

  return {
    ApiClientError,
    getMock: vi.fn(),
    postMock: vi.fn(),
    deleteMock: vi.fn(),
    routerPushMock: vi.fn(),
    toastInfoMock: vi.fn(),
    toastErrorMock: vi.fn(),
    performanceRef: { current: null as unknown },
    headerRef: {
      current: null as null | { expiresAt: number | null; onExpire: () => void },
    },
  };
});

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: hoisted.getMock,
    post: hoisted.postMock,
    delete: hoisted.deleteMock,
    put: vi.fn(),
    patch: vi.fn(),
  },
  ApiClientError: hoisted.ApiClientError,
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.routerPushMock }),
}));

vi.mock('sonner', () => ({
  toast: {
    info: hoisted.toastInfoMock,
    error: hoisted.toastErrorMock,
    success: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    isLoading: false,
    isResolved: true,
    bookingDisabledMessage: '예매는 추후 오픈 예정입니다',
  }),
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({
    data: hoisted.performanceRef.current,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-socket', () => ({
  useBookingSocket: vi.fn(),
}));

vi.mock('@/components/booking/booking-header', () => ({
  BookingHeader: (props: { expiresAt: number | null; onExpire: () => void }) => {
    hoisted.headerRef.current = props;
    return <header>{props.expiresAt === null ? 'no timer' : 'timer running'}</header>;
  },
}));

vi.mock('@/components/booking/date-picker', () => ({
  DatePicker: ({
    availableDates,
    onSelect,
  }: {
    availableDates: Date[];
    onSelect: (date: Date) => void;
  }) => (
    <div>
      {availableDates.map((date) => {
        const label = `날짜 ${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
        return (
          <button key={label} type="button" onClick={() => onSelect(date)}>
            {label}
          </button>
        );
      })}
    </div>
  ),
}));

vi.mock('@/components/booking/seat-legend', () => ({
  SeatLegend: () => <div>seat legend</div>,
}));

vi.mock('@/components/booking/seat-map-viewer', () => ({
  SeatMapViewer: ({
    seatConfig,
    seatStates,
    selectedSeatIds,
    onSeatClick,
  }: {
    seatConfig: { tiers: Array<{ seatIds: string[] }> };
    seatStates: Map<string, string>;
    selectedSeatIds: Set<string>;
    onSeatClick: (seatId: string) => void;
  }) => (
    <div>
      {seatConfig.tiers.flatMap((tier) => tier.seatIds).map((seatId) => (
        <button
          key={seatId}
          type="button"
          aria-pressed={selectedSeatIds.has(seatId)}
          data-state={seatStates.get(seatId) ?? 'available'}
          onClick={() => onSeatClick(seatId)}
        >
          {`좌석 ${seatId}`}
        </button>
      ))}
    </div>
  ),
}));

const DAY_MS = 24 * 60 * 60 * 1000;
const SHOWTIME_A = 'showtime-a';
const SHOWTIME_B = 'showtime-b';
const SEAT_TAKEN = '이미 다른 사용자가 선택한 좌석입니다';

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** In-memory booking API: per-showtime seat locks owned by the test user. */
const server = {
  held: new Map<string, Map<string, number>>(),
  takenByOthers: new Set<string>(),
  lockGates: new Map<string, Deferred>(),
  holdMs: 10 * 60 * 1000,
  maxSeats: 2,
};

function heldFor(showtimeId: string) {
  let held = server.held.get(showtimeId);
  if (!held) {
    held = new Map();
    server.held.set(showtimeId, held);
  }
  return held;
}

function toSeatKey(seatId: string) {
  return seatId.includes(':') ? seatId : `1F:${seatId}`;
}

function countGets(pattern: RegExp) {
  return hoisted.getMock.mock.calls.filter(([path]) => pattern.test(String(path))).length;
}

function lockAllCalls(showtimeId: string) {
  return hoisted.deleteMock.mock.calls.filter(
    ([path]) => path === `/api/v1/booking/seats/lock-all/${showtimeId}`,
  ).length;
}

function singleUnlockCalls(showtimeId: string, seatKey: string) {
  return hoisted.deleteMock.mock.calls.filter(
    ([path]) => path === `/api/v1/booking/seats/lock/${showtimeId}/${encodeURIComponent(seatKey)}`,
  ).length;
}

function installServer() {
  hoisted.getMock.mockImplementation(async (path: string) => {
    const seats = path.match(/^\/api\/v1\/booking\/schedules\/([^/]+)\/seats$/);
    if (seats) {
      const result: Record<string, string> = {};
      for (const seatKey of server.takenByOthers) result[seatKey] = 'locked';
      for (const seatKey of heldFor(seats[1]).keys()) result[seatKey] = 'locked';
      return { showtimeId: seats[1], seats: result };
    }
    const myLocks = path.match(/^\/api\/v1\/booking\/my-locks\/([^/]+)$/);
    if (myLocks) {
      const held = heldFor(myLocks[1]);
      return {
        seatIds: [...held.keys()],
        expiresAt: held.size > 0 ? Math.min(...held.values()) : null,
      };
    }
    throw new Error(`unexpected GET ${path}`);
  });

  hoisted.postMock.mockImplementation(async (path: string, body: { showtimeId: string; seatId: string }) => {
    if (path !== '/api/v1/booking/seats/lock') {
      throw new Error(`unexpected POST ${path}`);
    }
    const seatKey = toSeatKey(body.seatId);
    const gate = server.lockGates.get(seatKey);
    if (gate) {
      server.lockGates.delete(seatKey);
      await gate.promise;
    }
    const held = heldFor(body.showtimeId);
    if (server.takenByOthers.has(seatKey) || held.has(seatKey)) {
      throw new hoisted.ApiClientError(SEAT_TAKEN, 409);
    }
    if (held.size >= server.maxSeats) {
      throw new hoisted.ApiClientError(`최대 ${server.maxSeats}석까지 선택할 수 있습니다`, 409);
    }
    const expiresAt = held.size > 0
      ? Math.min(...held.values())
      : Date.now() + server.holdMs;
    held.set(seatKey, expiresAt);
    return { success: true, lockId: `lock-${seatKey}`, seatId: body.seatId, seatKey, floorKey: '1F', expiresAt };
  });

  hoisted.deleteMock.mockImplementation(async (path: string) => {
    const lockAll = path.match(/^\/api\/v1\/booking\/seats\/lock-all\/([^/]+)$/);
    if (lockAll) {
      const held = heldFor(decodeURIComponent(lockAll[1]));
      const unlockedSeats = [...held.keys()];
      held.clear();
      return { unlockedSeats };
    }
    const single = path.match(/^\/api\/v1\/booking\/seats\/lock\/([^/]+)\/([^/]+)$/);
    if (single) {
      heldFor(decodeURIComponent(single[1])).delete(decodeURIComponent(single[2]));
      return undefined;
    }
    throw new Error(`unexpected DELETE ${path}`);
  });
}

function createPerformance(options: {
  id?: string;
  maxTicketsPerUser?: number;
  showtimes?: Array<{ id: string; dateTime: string }>;
} = {}) {
  const id = options.id ?? 'performance-a';
  const seatMap = {
    id: `${id}-seat-map`,
    performanceId: id,
    floorKey: '1F',
    floorLabel: '1층',
    sortOrder: 0,
    svgUrl: '/1F-map.svg',
    seatConfig: {
      tiers: [{ tierName: 'VIP', color: '#6C3CE0', seatIds: ['A-1', 'A-2', 'A-3'] }],
    },
    totalSeats: 3,
  };
  const showtimes = (options.showtimes ?? [
    { id: SHOWTIME_A, dateTime: new Date(Date.now() + 3 * DAY_MS).toISOString() },
    { id: SHOWTIME_B, dateTime: new Date(Date.now() + 5 * DAY_MS).toISOString() },
  ]).map((showtime) => ({ ...showtime, performanceId: id }));

  return {
    id,
    title: 'Seat Flow Live',
    genre: 'artist_celebrity' as const,
    subcategory: null,
    venueId: 'venue-1',
    posterUrl: null,
    description: null,
    startDate: showtimes[0]?.dateTime ?? new Date().toISOString(),
    endDate: showtimes[showtimes.length - 1]?.dateTime ?? new Date().toISOString(),
    runtime: '120분',
    ageRating: '전체관람가',
    status: 'selling' as const,
    salesInfo: null,
    viewCount: 0,
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    venue: { id: 'venue-1', name: '서울 공연장', address: null },
    castings: [],
    showtimes,
    priceTiers: [{ id: 'tier-vip', performanceId: id, tierName: 'VIP', price: 110000, sortOrder: 0 }],
    seatMaps: [seatMap],
    seatMap,
    bookingPolicy: {
      maxTicketsPerUser: options.maxTicketsPerUser ?? 2,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
    },
  };
}

function seat(seatId: string) {
  const [row, number] = seatId.split('-');
  return {
    seatId,
    tierName: 'VIP',
    tierColor: '#6C3CE0',
    row: row ?? seatId,
    number: number ?? '',
    price: 110000,
    floorKey: '1F',
    floorLabel: '1층',
    seatKey: `1F:${seatId}`,
  };
}

function selectShowtimeInStore(showtimeId: string) {
  const performance = hoisted.performanceRef.current as ReturnType<typeof createPerformance>;
  const showtime = performance.showtimes.find((item) => item.id === showtimeId);
  useBookingStore.getState().setDate(showtime ? getKstCalendarDate(showtime.dateTime) : new Date());
  useBookingStore.getState().setShowtime(showtimeId);
}

function renderBookingPage(performanceId = 'performance-a') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BookingPage performanceId={performanceId} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function selectedTag(seatId: string) {
  const [row, number] = seatId.split('-');
  return screen.queryByRole('button', { name: `1층 ${row}열 ${number}번 선택 해제` });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('BookingPage seat lock flow', () => {
  beforeEach(() => {
    hoisted.getMock.mockReset();
    hoisted.postMock.mockReset();
    hoisted.deleteMock.mockReset();
    hoisted.routerPushMock.mockReset();
    hoisted.toastInfoMock.mockReset();
    hoisted.toastErrorMock.mockReset();
    hoisted.headerRef.current = null;
    server.held.clear();
    server.takenByOthers.clear();
    server.lockGates.clear();
    server.holdMs = 10 * 60 * 1000;
    server.maxSeats = 2;
    installServer();
    hoisted.performanceRef.current = createPerformance();
    useBookingStore.getState().resetBooking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('#10 rolls back a seat whose lock failed even when another seat was clicked meanwhile', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    const gateA = deferred();
    const gateB = deferred();
    server.lockGates.set('1F:A-1', gateA);
    server.lockGates.set('1F:A-2', gateB);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await user.click(screen.getByRole('button', { name: '좌석 A-2' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(2));

    server.takenByOthers.add('1F:A-1');
    await act(async () => {
      gateA.resolve();
    });
    await act(async () => {
      gateB.resolve();
    });

    await waitFor(() => expect(selectedTag('A-1')).not.toBeInTheDocument());
    expect(selectedTag('A-2')).toBeInTheDocument();
    expect(hoisted.toastInfoMock).toHaveBeenCalledWith(SEAT_TAKEN);
    expect(useBookingStore.getState().selectedSeats.map((item) => item.seatKey)).toEqual(['1F:A-2']);
    // The surviving lock still sets the hold timer from its own response.
    expect(useBookingStore.getState().timerExpiresAt).toBe(heldFor(SHOWTIME_A).get('1F:A-2'));
  });

  it('#10 starts the hold timer from a successful lock even when a later click fails first', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    const gateA = deferred();
    server.lockGates.set('1F:A-1', gateA);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(1));
    // A-2 still looks available on this (stale) map but another user holds it.
    server.takenByOthers.add('1F:A-2');
    await user.click(screen.getByRole('button', { name: '좌석 A-2' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hoisted.toastInfoMock).toHaveBeenCalledWith(SEAT_TAKEN));

    await act(async () => {
      gateA.resolve();
    });

    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());
    expect(useBookingStore.getState().timerExpiresAt).toBe(heldFor(SHOWTIME_A).get('1F:A-1'));
    expect(selectedTag('A-1')).toBeInTheDocument();
    expect(selectedTag('A-2')).not.toBeInTheDocument();
  });

  it('#28 releases a lock that lands after the seat was tapped again', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    const gate = deferred();
    server.lockGates.set('1F:A-1', gate);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '좌석 A-1' }));

    expect(selectedTag('A-1')).not.toBeInTheDocument();
    // No unlock can overtake the pending lock.
    expect(singleUnlockCalls(SHOWTIME_A, '1F:A-1')).toBe(0);

    await act(async () => {
      gate.resolve();
    });

    await waitFor(() => expect(singleUnlockCalls(SHOWTIME_A, '1F:A-1')).toBe(1));
    await waitFor(() => expect(heldFor(SHOWTIME_A).size).toBe(0));
    expect(useBookingStore.getState().selectedSeats).toEqual([]);
    expect(hoisted.toastInfoMock).not.toHaveBeenCalled();
  });

  it('#28 keeps a single lock when the seat is tapped off and on while its lock is pending', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    const gate = deferred();
    server.lockGates.set('1F:A-1', gate);
    renderBookingPage();

    const seatButton = await screen.findByRole('button', { name: '좌석 A-1' });
    await user.click(seatButton);
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(1));
    await user.click(seatButton);
    await user.click(seatButton);

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());

    expect(hoisted.postMock).toHaveBeenCalledTimes(1);
    expect(singleUnlockCalls(SHOWTIME_A, '1F:A-1')).toBe(0);
    expect(heldFor(SHOWTIME_A).has('1F:A-1')).toBe(true);
    expect(selectedTag('A-1')).toBeInTheDocument();
  });

  it('#28 waits for a pending release before locking another seat at the 1-seat limit', async () => {
    const user = userEvent.setup();
    hoisted.performanceRef.current = createPerformance({ maxTicketsPerUser: 1 });
    server.maxSeats = 1;
    selectShowtimeInStore(SHOWTIME_A);
    const gateA = deferred();
    const gateB = deferred();
    server.lockGates.set('1F:A-1', gateA);
    server.lockGates.set('1F:A-2', gateB);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: '좌석 A-1' }));
    await user.click(screen.getByRole('button', { name: '좌석 A-2' }));

    // The server processes the A-1 lock first, then A-2.
    await act(async () => {
      gateA.resolve();
    });
    await act(async () => {
      gateB.resolve();
    });

    await waitFor(() => expect(heldFor(SHOWTIME_A).has('1F:A-2')).toBe(true));
    expect(heldFor(SHOWTIME_A).has('1F:A-1')).toBe(false);
    expect(selectedTag('A-2')).toBeInTheDocument();
    expect(hoisted.toastInfoMock).not.toHaveBeenCalled();
  });

  it('#29 keeps held seats when the selected showtime chip is tapped again and releases them on change', async () => {
    const user = userEvent.setup();
    const performance = hoisted.performanceRef.current as ReturnType<typeof createPerformance>;
    const [showtimeA, showtimeB] = performance.showtimes;
    renderBookingPage();

    const dateLabel = (dateTime: string) => {
      const date = getKstCalendarDate(dateTime);
      return `날짜 ${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    };
    const chipLabel = (dateTime: string) => `${formatKstTimeLabel(dateTime)} KST`;

    await user.click(screen.getByRole('button', { name: dateLabel(showtimeA!.dateTime) }));
    await user.click(screen.getByRole('button', { name: chipLabel(showtimeA!.dateTime) }));
    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(heldFor(SHOWTIME_A).has('1F:A-1')).toBe(true));

    await user.click(screen.getByRole('button', { name: chipLabel(showtimeA!.dateTime) }));
    await settle();

    expect(selectedTag('A-1')).toBeInTheDocument();
    expect(useBookingStore.getState().timerExpiresAt).not.toBeNull();
    expect(lockAllCalls(SHOWTIME_A)).toBe(0);

    await user.click(screen.getByRole('button', { name: dateLabel(showtimeB!.dateTime) }));

    await waitFor(() => expect(lockAllCalls(SHOWTIME_A)).toBe(1));
    expect(heldFor(SHOWTIME_A).size).toBe(0);
    expect(useBookingStore.getState().selectedShowtimeId).toBeNull();
  });

  it('#29 releases a lock that was still in flight when the showtime changed', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    const gate = deferred();
    server.lockGates.set('1F:A-1', gate);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(hoisted.postMock).toHaveBeenCalledTimes(1));

    const performance = hoisted.performanceRef.current as ReturnType<typeof createPerformance>;
    const showtimeB = performance.showtimes[1]!;
    const date = getKstCalendarDate(showtimeB.dateTime);
    await user.click(screen.getByRole('button', { name: `날짜 ${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` }));
    await waitFor(() => expect(lockAllCalls(SHOWTIME_A)).toBe(1));

    await act(async () => {
      gate.resolve();
    });

    // The lock landed after the release-all; it is released explicitly.
    await waitFor(() => expect(heldFor(SHOWTIME_A).size).toBe(0));
  });

  it('#30 does not resurrect seats after "clear all" on a restored selection', async () => {
    const user = userEvent.setup();
    heldFor(SHOWTIME_A).set('1F:A-1', Date.now() + 5 * 60 * 1000);
    heldFor(SHOWTIME_A).set('1F:A-2', Date.now() + 5 * 60 * 1000);
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    expect(await screen.findByRole('button', { name: '1층 A열 1번 선택 해제' })).toBeInTheDocument();
    expect(selectedTag('A-2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '전체 해제' }));

    expect(selectedTag('A-1')).not.toBeInTheDocument();
    await waitFor(() => expect(lockAllCalls(SHOWTIME_A)).toBe(1));
    await waitFor(() => expect(countGets(/my-locks/)).toBeGreaterThanOrEqual(2));
    await settle();

    expect(selectedTag('A-1')).not.toBeInTheDocument();
    expect(selectedTag('A-2')).not.toBeInTheDocument();
    expect(useBookingStore.getState().selectedSeats).toEqual([]);
    expect(useBookingStore.getState().timerExpiresAt).toBeNull();
  });

  it('#30 does not resurrect the last restored seat after it is removed', async () => {
    const user = userEvent.setup();
    heldFor(SHOWTIME_A).set('1F:A-1', Date.now() + 5 * 60 * 1000);
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '1층 A열 1번 선택 해제' }));

    expect(selectedTag('A-1')).not.toBeInTheDocument();
    await waitFor(() => expect(singleUnlockCalls(SHOWTIME_A, '1F:A-1')).toBe(1));
    await waitFor(() => expect(countGets(/my-locks/)).toBeGreaterThanOrEqual(2));
    await settle();

    expect(selectedTag('A-1')).not.toBeInTheDocument();
    expect(useBookingStore.getState().timerExpiresAt).toBeNull();
  });

  it('#31 follows the server deadline of a new selection after every seat was released', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    server.holdMs = 10 * 60 * 1000;
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());
    const firstDeadline = useBookingStore.getState().timerExpiresAt;

    await user.click(screen.getByRole('button', { name: '1층 A열 1번 선택 해제' }));
    expect(useBookingStore.getState().timerExpiresAt).toBeNull();
    await waitFor(() => expect(heldFor(SHOWTIME_A).size).toBe(0));

    // A later first lock gets a fresh full TTL from the server.
    server.holdMs = 18 * 60 * 1000;
    await user.click(screen.getByRole('button', { name: '좌석 A-2' }));
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).toBe(heldFor(SHOWTIME_A).get('1F:A-2')));
    expect(useBookingStore.getState().timerExpiresAt).toBeGreaterThan(firstDeadline!);
  });

  it('#31 re-checks the server deadline before declaring the hold expired', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());

    // The client countdown ran out early, but the server still holds the seat.
    const serverDeadline = Date.now() + 4 * 60 * 1000;
    heldFor(SHOWTIME_A).set('1F:A-1', serverDeadline);
    await act(async () => {
      hoisted.headerRef.current?.onExpire();
    });

    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).toBe(serverDeadline));
    expect(useBookingStore.getState().isTimerExpired).toBe(false);
    expect(lockAllCalls(SHOWTIME_A)).toBe(0);
    expect(selectedTag('A-1')).toBeInTheDocument();
  });

  it('#31 shows the expiry modal when the server no longer holds the seats', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());

    heldFor(SHOWTIME_A).clear();
    await act(async () => {
      hoisted.headerRef.current?.onExpire();
    });

    await waitFor(() => expect(useBookingStore.getState().isTimerExpired).toBe(true));
    expect(await screen.findByText('시간이 만료되었습니다')).toBeInTheDocument();
    expect(hoisted.toastInfoMock).not.toHaveBeenCalledWith(
      '점유 상태가 바뀐 좌석이 있어 선택 목록을 갱신했습니다. 선택 좌석을 확인해 주세요.',
    );
  });

  it('#94 resets a selection left over from another performance and releases its locks', async () => {
    heldFor('showtime-other').set('1F:A-1', Date.now() + 5 * 60 * 1000);
    useBookingStore.getState().setDate(new Date());
    useBookingStore.getState().setShowtime('showtime-other');
    useBookingStore.getState().addSeat(seat('A-1'));
    useBookingStore.getState().setTimerExpiry(Date.now() + 5 * 60 * 1000);

    renderBookingPage();

    await waitFor(() => expect(lockAllCalls('showtime-other')).toBe(1));
    const state = useBookingStore.getState();
    expect(state.selectedShowtimeId).toBeNull();
    expect(state.selectedSeats).toEqual([]);
    expect(state.timerExpiresAt).toBeNull();
    expect(countGets(/schedules\/showtime-other\/seats/)).toBe(0);
    expect(countGets(/my-locks\/showtime-other/)).toBe(0);
    expect(screen.queryByRole('button', { name: '좌석 A-1' })).not.toBeInTheDocument();
  });

  it('#2 does not offer showtimes that already started', () => {
    hoisted.performanceRef.current = createPerformance({
      showtimes: [
        { id: 'showtime-past', dateTime: new Date(Date.now() - 2 * DAY_MS).toISOString() },
        { id: SHOWTIME_A, dateTime: new Date(Date.now() + 3 * DAY_MS).toISOString() },
      ],
    });
    renderBookingPage();

    const pastDate = getKstCalendarDate(new Date(Date.now() - 2 * DAY_MS).toISOString());
    const futureDate = getKstCalendarDate(new Date(Date.now() + 3 * DAY_MS).toISOString());
    expect(
      screen.queryByRole('button', { name: `날짜 ${pastDate.getFullYear()}-${pastDate.getMonth() + 1}-${pastDate.getDate()}` }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `날짜 ${futureDate.getFullYear()}-${futureDate.getMonth() + 1}-${futureDate.getDate()}` }),
    ).toBeInTheDocument();
  });

  it('#2 drops a selected showtime that already started and releases its seats', async () => {
    hoisted.performanceRef.current = createPerformance({
      showtimes: [
        { id: 'showtime-past', dateTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        { id: SHOWTIME_A, dateTime: new Date(Date.now() + 3 * DAY_MS).toISOString() },
      ],
    });
    heldFor('showtime-past').set('1F:A-1', Date.now() + 5 * 60 * 1000);
    useBookingStore.getState().setDate(new Date());
    useBookingStore.getState().setShowtime('showtime-past');
    useBookingStore.getState().addSeat(seat('A-1'));

    renderBookingPage();

    await waitFor(() => expect(lockAllCalls('showtime-past')).toBe(1));
    expect(useBookingStore.getState().selectedShowtimeId).toBeNull();
    expect(hoisted.toastInfoMock).toHaveBeenCalledWith('이미 시작된 회차는 예매할 수 없습니다.');
    expect(countGets(/schedules\/showtime-past\/seats/)).toBe(0);
    expect(hoisted.postMock).not.toHaveBeenCalled();
  });

  it('#2 closes the selected showtime when it starts while the page is open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const startsAt = Date.now() + 2_000;
    hoisted.performanceRef.current = createPerformance({
      showtimes: [{ id: SHOWTIME_A, dateTime: new Date(startsAt).toISOString() }],
    });
    heldFor(SHOWTIME_A).set('1F:A-1', Date.now() + 5 * 60 * 1000);
    selectShowtimeInStore(SHOWTIME_A);
    useBookingStore.getState().addSeat(seat('A-1'));

    renderBookingPage();
    expect(screen.getByRole('button', { name: '좌석 A-1' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    expect(useBookingStore.getState().selectedShowtimeId).toBeNull();
    expect(screen.queryByRole('button', { name: '좌석 A-1' })).not.toBeInTheDocument();
    expect(hoisted.toastInfoMock).toHaveBeenCalledWith('이미 시작된 회차는 예매할 수 없습니다.');
    expect(lockAllCalls(SHOWTIME_A)).toBe(1);
  });

  it('#27 reloads the seat map and my locks after a lock conflict', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    const seatButton = await screen.findByRole('button', { name: '좌석 A-1' });
    await waitFor(() => expect(countGets(/schedules\/showtime-a\/seats/)).toBe(1));
    // Taken after our snapshot; no broadcast reached this page.
    server.takenByOthers.add('1F:A-1');
    expect(seatButton).toHaveAttribute('data-state', 'available');

    await user.click(seatButton);

    await waitFor(() => expect(countGets(/schedules\/showtime-a\/seats/)).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '좌석 A-1' })).toHaveAttribute('data-state', 'locked'));
    expect(countGets(/my-locks\/showtime-a/)).toBeGreaterThanOrEqual(2);
  });

  it('#8 updates the seat map locally after a successful lock instead of reloading it', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await waitFor(() => expect(useBookingStore.getState().timerExpiresAt).not.toBeNull());
    await settle();

    expect(countGets(/schedules\/showtime-a\/seats/)).toBe(1);
    expect(screen.getByRole('button', { name: '좌석 A-1' })).toHaveAttribute('data-state', 'locked');
  });

  it('#10 verifies held seats with the server before moving to checkout', async () => {
    const user = userEvent.setup();
    selectShowtimeInStore(SHOWTIME_A);
    renderBookingPage();

    await user.click(await screen.findByRole('button', { name: '좌석 A-1' }));
    await user.click(screen.getByRole('button', { name: '좌석 A-2' }));
    await waitFor(() => expect(heldFor(SHOWTIME_A).size).toBe(2));

    // The server lost A-1 (TTL / lost response): checkout must not start with it.
    heldFor(SHOWTIME_A).delete('1F:A-1');
    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(selectedTag('A-1')).not.toBeInTheDocument());
    expect(hoisted.routerPushMock).not.toHaveBeenCalled();
    expect(hoisted.toastInfoMock).toHaveBeenCalledWith(
      '점유 상태가 바뀐 좌석이 있어 선택 목록을 갱신했습니다. 선택 좌석을 확인해 주세요.',
    );

    await user.click(screen.getByRole('button', { name: '다음' }));

    await waitFor(() => expect(hoisted.routerPushMock).toHaveBeenCalledWith('/booking/performance-a/confirm'));
    const state = useBookingStore.getState();
    expect(state.selectedSeats.map((item) => item.seatKey)).toEqual(['1F:A-2']);
    expect(state.expiresAt).toBe(heldFor(SHOWTIME_A).get('1F:A-2'));
  });
});
