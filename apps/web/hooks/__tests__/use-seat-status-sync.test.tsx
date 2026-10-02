import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import {
  SEAT_STATUS_POLL_CONNECTED_MS,
  SEAT_STATUS_POLL_DISCONNECTED_MS,
  getSeatStatusPollInterval,
  useMyLocks,
  useSeatStatus,
} from '../use-booking';
import { useBookingStore } from '@/stores/use-booking-store';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: getMock, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({ bookingEnabled: true, isLoading: false, bookingDisabledMessage: '' }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

function seatStatusCalls() {
  return getMock.mock.calls.filter(([path]) => String(path).includes('/seats'));
}

describe('seat-status resync (audit #27, #8)', () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockImplementation(async (path: string) => (
      path.includes('/my-locks/')
        ? { seatIds: [], expiresAt: null }
        : { showtimeId: 'showtime-1', seats: {} }
    ));
    useBookingStore.getState().resetBooking();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('spreads the poll interval with a bounded per-viewer jitter', () => {
    expect(getSeatStatusPollInterval(true, 0)).toBe(SEAT_STATUS_POLL_CONNECTED_MS);
    expect(getSeatStatusPollInterval(true, 1)).toBe(SEAT_STATUS_POLL_CONNECTED_MS * 1.5);
    expect(getSeatStatusPollInterval(false, 0)).toBe(SEAT_STATUS_POLL_DISCONNECTED_MS);
    expect(getSeatStatusPollInterval(false, 7)).toBe(SEAT_STATUS_POLL_DISCONNECTED_MS * 1.5);
  });

  it('polls seat-status so seats released by Redis TTL reappear without a reload', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    useBookingStore.getState().setConnected(true);
    const { Wrapper } = createWrapper();
    renderHook(() => useSeatStatus('showtime-1'), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seatStatusCalls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEAT_STATUS_POLL_CONNECTED_MS - 1);
    });
    expect(seatStatusCalls()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(seatStatusCalls()).toHaveLength(2);
  });

  it('polls faster while the live socket is down (including after reconnect_failed)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { Wrapper } = createWrapper();
    renderHook(() => useSeatStatus('showtime-1'), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEAT_STATUS_POLL_DISCONNECTED_MS);
    });
    expect(seatStatusCalls()).toHaveLength(2);
  });

  it('only lets the first seat-status load surface an error toast', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { Wrapper } = createWrapper();
    renderHook(() => useSeatStatus('showtime-1'), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEAT_STATUS_POLL_DISCONNECTED_MS);
    });

    const calls = seatStatusCalls();
    expect(calls[0]?.[1]).toEqual({ showErrorToast: true });
    expect(calls[1]?.[1]).toEqual({ showErrorToast: false });
  });

  it('does not repeat the error toast while polls keep failing before any data', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    getMock.mockRejectedValue(new Error('unavailable'));
    const { Wrapper } = createWrapper();
    renderHook(() => useSeatStatus('showtime-1'), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEAT_STATUS_POLL_DISCONNECTED_MS * 2);
    });

    const calls = seatStatusCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.[1]).toEqual({ showErrorToast: true });
    expect(calls.slice(1).every(([, options]) => options?.showErrorToast === false)).toBe(true);
  });

  it('does not poll without a showtime', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useSeatStatus(null), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEAT_STATUS_POLL_CONNECTED_MS * 2);
    });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('tags each my-locks snapshot with an increasing request sequence', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useMyLocks('showtime-1'), { wrapper: Wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const first = result.current.data?.requestSeq ?? 0;
    expect(first).toBeGreaterThan(0);

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['my-locks', 'showtime-1'] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.requestSeq).toBeGreaterThan(first);
  });
});
