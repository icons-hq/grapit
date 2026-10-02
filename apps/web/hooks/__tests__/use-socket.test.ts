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
import { useBookingSocket } from '../use-socket';
import { createBookingSocket } from '@/lib/socket-client';
import { SEAT_STATUS_RECONNECT_JITTER_MS } from '@/lib/booking/seat-resync';
import { useAuthStore } from '@/stores/use-auth-store';

describe('useBookingSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockStore.selectedShowtimeId = null;
    mockStore.selectedSeats = [];
    useAuthStore.setState({ user: null });
    mockFindQuery.mockReturnValue(undefined);
  });

  afterEach(() => {
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

  it('applies seat-update events to the seat-status cache', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('seat-update')({ seatId: '1F:A-1', status: 'locked' });

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

    expect(mockQueryClient.setQueryData).toHaveBeenCalledTimes(3);
    expect(mockStore.removeSeat).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
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
