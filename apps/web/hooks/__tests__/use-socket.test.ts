import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// Mock socket.io-client
const mockSocket = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connected: false,
  io: { on: vi.fn(), off: vi.fn() },
};

vi.mock('@/lib/socket-client', () => ({
  createBookingSocket: vi.fn(() => mockSocket),
}));

// Mock booking store
const mockStore = {
  setConnected: vi.fn(),
  selectedShowtimeId: null as string | null,
  selectedSeats: [] as Array<{ seatId: string; seatKey: string }>,
  removeSeat: vi.fn(),
};

vi.mock('@/stores/use-booking-store', () => ({
  useBookingStore: Object.assign(vi.fn(() => mockStore), {
    getState: vi.fn(() => mockStore),
  }),
}));

// Mock react-query
type MockQuery = { state: { fetchStatus: 'fetching' | 'idle' }; promise?: Promise<unknown> };
const mockFindQuery = vi.fn<() => MockQuery | undefined>(() => undefined);
const mockQueryClient = {
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  getQueryCache: vi.fn(() => ({ find: mockFindQuery })),
};

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import {
  SEAT_UPDATE_EVENT,
  SEAT_UPDATE_FLUSH_MAX_DELAY_MS,
  SEAT_UPDATE_V2_EVENT,
  useBookingSocket,
} from '../use-socket';
import { createBookingSocket } from '@/lib/socket-client';
import { SEAT_STATUS_RECONNECT_JITTER_MS } from '@/lib/booking/seat-resync';
import {
  clearSeatUpdateEvents,
  overlayRecentSeatEvents,
} from '@/lib/booking/seat-event-overlay';
import { useAuthStore } from '@/stores/use-auth-store';

type SeatStatusCache = { showtimeId: string; seats: Record<string, string> };
type CacheUpdater = (old: SeatStatusCache | undefined) => SeatStatusCache | undefined;

/** Animation frames under test control: they run only when flushed. */
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function runAnimationFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(performance.now());
}

/** The cache after applying every setQueryData updater so far. */
function applyCacheUpdates(initial: SeatStatusCache): SeatStatusCache | undefined {
  let cache: SeatStatusCache | undefined = initial;
  for (const [, updater] of (mockQueryClient.setQueryData as Mock).mock.calls as Array<[unknown, CacheUpdater]>) {
    cache = updater(cache);
  }
  return cache;
}

describe('useBookingSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockStore.selectedShowtimeId = null;
    mockStore.selectedSeats = [];
    useAuthStore.setState({ user: null });
    mockFindQuery.mockReturnValue(undefined);
    frames.clear();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      frames.delete(id);
    }));
  });

  afterEach(() => {
    clearSeatUpdateEvents();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connects socket when showtimeId is provided', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    expect(createBookingSocket).toHaveBeenCalled();
    expect(mockSocket.connect).toHaveBeenCalled();
  });

  it('emits join-showtime on connect', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    // Find the 'connect' handler from on() calls
    const connectCall = (mockSocket.on as Mock).mock.calls.find(
      (call: unknown[]) => call[0] === 'connect',
    );
    expect(connectCall).toBeDefined();

    // Trigger the connect handler
    const connectHandler = connectCall![1] as () => void;
    connectHandler();

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'join-showtime',
      'test-showtime-id',
    );
  });

  it('calls setConnected(false) on disconnect', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    // Find the 'disconnect' handler
    const disconnectCall = (mockSocket.on as Mock).mock.calls.find(
      (call: unknown[]) => call[0] === 'disconnect',
    );
    expect(disconnectCall).toBeDefined();

    // Trigger the disconnect handler
    const disconnectHandler = disconnectCall![1] as () => void;
    disconnectHandler();

    expect(mockStore.setConnected).toHaveBeenCalledWith(false);
  });

  it('applies seat-update events to the seat-status cache on the next frame', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });
    expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();
    runAnimationFrames();

    expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
    const [queryKey, updater] = (mockQueryClient.setQueryData as Mock).mock.calls[0]! as [
      unknown,
      (old: { showtimeId: string; seats: Record<string, string> } | undefined) => unknown,
    ];
    expect(queryKey).toEqual(['seat-status', 'test-showtime-id']);
    expect(updater({ showtimeId: 'test-showtime-id', seats: { '1F:A-2': 'sold' } })).toEqual({
      showtimeId: 'test-showtime-id',
      seats: { '1F:A-2': 'sold', '1F:A-1': 'locked' },
    });
    expect(updater(undefined)).toBeUndefined();
  });

  it('does nothing when showtimeId is null', () => {
    renderHook(() => useBookingSocket(null));

    expect(createBookingSocket).not.toHaveBeenCalled();
  });

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() =>
      useBookingSocket('test-showtime-id'),
    );

    unmount();

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'leave-showtime',
      'test-showtime-id',
    );
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('never drops a selected seat on a locked broadcast, which does not say whose lock it is (audit #92)', () => {
    // Signed in, with the broadcast seat selected in this showtime: the
    // removal the old userId check performed would apply here.
    useAuthStore.setState({ user: { id: 'me' } as never });
    mockStore.selectedShowtimeId = 'test-showtime-id';
    mockStore.selectedSeats = [
      { seatId: 'A-1', seatKey: '1F:A-1' },
      { seatId: 'A-2', seatKey: '1F:A-2' },
    ];
    renderHook(() => useBookingSocket('test-showtime-id'));
    const seatUpdate = socketHandler('seat-update');

    // Our own lock, broadcast before (or after) its HTTP response, carries no
    // user id; neither does a lock by someone else.
    seatUpdate({ seatId: '1F:A-1', status: 'locked' });
    seatUpdate({ seatId: 'A-1', status: 'locked' });
    // A payload that still names another user is not trusted either: the lock
    // response (409) and the my-locks read-back decide.
    seatUpdate({ seatId: '1F:A-2', status: 'locked', userId: 'other-user' });
    runAnimationFrames();

    // One cache write for the frame; every locked seat is shown as taken.
    expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
    expect(applyCacheUpdates({ showtimeId: 'test-showtime-id', seats: {} })?.seats).toEqual({
      'A-1': 'locked',
      '1F:A-2': 'locked',
    });
    expect(mockStore.removeSeat).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  describe('frame batching (audit #11)', () => {
    it('applies a frame of events with one cache write where the latest state of a seat wins', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const seatUpdate = socketHandler(SEAT_UPDATE_V2_EVENT);

      for (let i = 1; i <= 50; i += 1) {
        seatUpdate({ seatId: `1F:B-${i}`, status: 'locked' });
      }
      seatUpdate({ seatId: '1F:A-1', status: 'locked' });
      seatUpdate({ seatId: '1F:A-1', status: 'available' });
      seatUpdate({ seatId: '1F:A-2', status: 'available' });
      seatUpdate({ seatId: '1F:A-2', status: 'sold' });
      expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();

      runAnimationFrames();

      expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
      const seats = applyCacheUpdates({
        showtimeId: 'test-showtime-id',
        seats: { '1F:A-9': 'sold', '1F:A-1': 'sold' },
      })?.seats;
      expect(seats).toMatchObject({ '1F:A-9': 'sold', '1F:A-1': 'available', '1F:A-2': 'sold', '1F:B-50': 'locked' });
      expect(Object.keys(seats ?? {})).toHaveLength(53);

      // Nothing left to write on the next frame.
      runAnimationFrames();
      expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
    });

    it('merges into the cache present at flush time, keeping a seat-status read that landed first', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });
      runAnimationFrames();

      const [, updater] = (mockQueryClient.setQueryData as Mock).mock.calls[0] as [unknown, CacheUpdater];
      // A poll replaced the map between the event and the frame.
      expect(updater({ showtimeId: 'test-showtime-id', seats: { '1F:A-3': 'sold' } })).toEqual({
        showtimeId: 'test-showtime-id',
        seats: { '1F:A-3': 'sold', '1F:A-1': 'locked' },
      });
      expect(updater(undefined)).toBeUndefined();
    });

    it('records each event for the snapshot overlay when it arrives, not when it is flushed', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const requestStartedAtMs = Date.now();
      socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });

      // A snapshot read before the event, answered before the frame runs.
      expect(
        overlayRecentSeatEvents(
          'test-showtime-id',
          { showtimeId: 'test-showtime-id', seats: { '1F:A-1': 'available' } } as never,
          { requestStartedAtMs },
        ).seats,
      ).toEqual({ '1F:A-1': 'locked' });
    });

    it('flushes within the time cap when no frame runs (hidden tab)', () => {
      // Timers only: animation frames stay under the test's control.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        renderHook(() => useBookingSocket('test-showtime-id'));
        socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });

        vi.advanceTimersByTime(SEAT_UPDATE_FLUSH_MAX_DELAY_MS - 1);
        expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
        // The frame that was also requested does not write again.
        runAnimationFrames();
        expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('flushes at once when the tab visibility changes', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });

      document.dispatchEvent(new Event('visibilitychange'));

      expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
    });

    it('drops buffered events on unmount instead of writing them to the left showtime', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        const { unmount } = renderHook(() => useBookingSocket('test-showtime-id'));
        socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });

        unmount();
        runAnimationFrames();
        vi.advanceTimersByTime(SEAT_UPDATE_FLUSH_MAX_DELAY_MS * 2);
        document.dispatchEvent(new Event('visibilitychange'));

        expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('seat-update.v2 rollout (audit #92 compatibility)', () => {
    it('listens to both the v2 and the legacy event', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));

      expect(SEAT_UPDATE_V2_EVENT).toBe('seat-update.v2');
      expect(SEAT_UPDATE_EVENT).toBe('seat-update');
      socketHandler(SEAT_UPDATE_V2_EVENT);
      socketHandler(SEAT_UPDATE_EVENT);
    });

    it('applies a v2 locked event', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));

      socketHandler(SEAT_UPDATE_V2_EVENT)({ seatId: '1F:A-1', status: 'locked' });
      runAnimationFrames();

      expect(applyCacheUpdates({ showtimeId: 'test-showtime-id', seats: {} })?.seats).toEqual({
        '1F:A-1': 'locked',
      });
    });

    it('applies an event received as both v2 and legacy once', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const v2 = socketHandler(SEAT_UPDATE_V2_EVENT);
      const legacy = socketHandler(SEAT_UPDATE_EVENT);

      v2({ seatId: '1F:A-1', status: 'available' });
      runAnimationFrames();
      legacy({ seatId: '1F:A-1', status: 'available' });
      runAnimationFrames();

      expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(1);
    });

    it('never lets a late legacy copy undo a newer v2 state of the same seat', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const v2 = socketHandler(SEAT_UPDATE_V2_EVENT);
      const legacy = socketHandler(SEAT_UPDATE_EVENT);

      // Released, then locked by someone else before the release's legacy copy arrives.
      v2({ seatId: '1F:A-1', status: 'available' });
      v2({ seatId: '1F:A-1', status: 'locked' });
      legacy({ seatId: '1F:A-1', status: 'available' });
      runAnimationFrames();

      expect(applyCacheUpdates({ showtimeId: 'test-showtime-id', seats: {} })?.seats).toEqual({
        '1F:A-1': 'locked',
      });
    });

    it('still applies legacy events from an API without v2 (rollback)', () => {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const legacy = socketHandler(SEAT_UPDATE_EVENT);

      legacy({ seatId: '1F:A-1', status: 'locked' });
      legacy({ seatId: '1F:A-2', status: 'sold' });
      runAnimationFrames();
      legacy({ seatId: '1F:A-1', status: 'available' });
      runAnimationFrames();

      expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(2);
      expect(applyCacheUpdates({ showtimeId: 'test-showtime-id', seats: {} })?.seats).toEqual({
        '1F:A-1': 'available',
        '1F:A-2': 'sold',
      });
    });
  });

  it('reloads seat-status once after the first join (audit #27)', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('connect')();

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['seat-status', 'test-showtime-id'] },
      { cancelRefetch: false },
    );
  });

  it('waits for a seat-status load sent before the first join, then reads once more (audit #27)', async () => {
    let finishLoad!: () => void;
    const load = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    mockFindQuery.mockReturnValue({ state: { fetchStatus: 'fetching' }, promise: load });
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('connect')();
    await Promise.resolve();
    expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled();

    finishLoad();
    await vi.waitFor(() => expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(1));
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['seat-status', 'test-showtime-id'] },
      { cancelRefetch: false },
    );
  });

  it('drops the post-join read when the page left the showtime meanwhile', async () => {
    let finishLoad!: () => void;
    const load = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    mockFindQuery.mockReturnValue({ state: { fetchStatus: 'fetching' }, promise: load });
    const { unmount } = renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('connect')();
    unmount();
    finishLoad();
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }

    expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('spreads the seat-status reload after a reconnect with a random delay (audit #8)', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      renderHook(() => useBookingSocket('test-showtime-id'));
      const connect = socketHandler('connect');
      connect();
      mockQueryClient.invalidateQueries.mockClear();

      socketHandler('disconnect')('transport close');
      connect();

      expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SEAT_STATUS_RECONNECT_JITTER_MS / 2 - 1);
      expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['seat-status', 'test-showtime-id'],
      });
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

function socketHandler(event: string) {
  const call = (mockSocket.on as Mock).mock.calls.find(
    (candidate: unknown[]) => candidate[0] === event,
  );
  expect(call).toBeDefined();
  return call![1] as (...args: unknown[]) => void;
}
