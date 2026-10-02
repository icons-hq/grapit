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
const mockQueryClient = {
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
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
import { SEAT_STATUS_RECONNECT_JITTER_MS, useBookingSocket } from '../use-socket';
import { createBookingSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/stores/use-auth-store';

function socketHandler(event: string) {
  const call = (mockSocket.on as Mock).mock.calls.find(
    (candidate: unknown[]) => candidate[0] === event,
  );
  expect(call).toBeDefined();
  return call![1] as (...args: unknown[]) => void;
}

describe('useBookingSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockStore.selectedShowtimeId = null;
    mockStore.selectedSeats = [];
    useAuthStore.setState({ user: null });
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

  it('removes a selected seat taken by another user, matching the broadcast seat key (audit #10)', () => {
    mockStore.selectedShowtimeId = 'test-showtime-id';
    mockStore.selectedSeats = [
      { seatId: 'A-1', seatKey: '1F:A-1' },
      { seatId: 'A-1', seatKey: '2F:A-1' },
    ];
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('seat-update')({ seatId: '2F:A-1', status: 'locked', userId: 'other-user' });

    expect(mockStore.removeSeat).toHaveBeenCalledTimes(1);
    expect(mockStore.removeSeat).toHaveBeenCalledWith('2F:A-1');
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('normalizes legacy broadcast seat ids to the default floor seat key', () => {
    mockStore.selectedShowtimeId = 'test-showtime-id';
    mockStore.selectedSeats = [{ seatId: 'A-1', seatKey: '1F:A-1' }];
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('seat-update')({ seatId: 'A-1', status: 'locked', userId: 'other-user' });

    expect(mockStore.removeSeat).toHaveBeenCalledWith('1F:A-1');
  });

  it('ignores our own lock broadcasts and selections of another showtime', () => {
    useAuthStore.setState({ user: { id: 'me' } as never });
    mockStore.selectedShowtimeId = 'test-showtime-id';
    mockStore.selectedSeats = [{ seatId: 'A-1', seatKey: '1F:A-1' }];
    const { unmount } = renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('seat-update')({ seatId: '1F:A-1', status: 'locked', userId: 'me' });
    expect(mockStore.removeSeat).not.toHaveBeenCalled();
    unmount();

    mockStore.selectedShowtimeId = 'other-showtime';
    vi.clearAllMocks();
    renderHook(() => useBookingSocket('test-showtime-id'));
    socketHandler('seat-update')({ seatId: '1F:A-1', status: 'locked', userId: 'other-user' });
    expect(mockStore.removeSeat).not.toHaveBeenCalled();
  });

  it('reloads seat-status once after the first join without restarting an in-flight load (audit #27)', () => {
    renderHook(() => useBookingSocket('test-showtime-id'));

    socketHandler('connect')();

    expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith(
      { queryKey: ['seat-status', 'test-showtime-id'] },
      { cancelRefetch: false },
    );
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
