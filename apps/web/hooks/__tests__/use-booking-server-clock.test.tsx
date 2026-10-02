import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PerformanceWithDetails } from '@grabit/shared';
import { useLockSeat } from '../use-booking';
import { BOOKING_DISABLED_COPY } from '@/lib/runtime-flags';
import {
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBookingStore } from '@/stores/use-booking-store';

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }));

vi.mock('@/lib/api-client', () => ({
  apiClient: { post: postMock, put: vi.fn(), delete: vi.fn(), get: vi.fn() },
  ApiClientError: class ApiClientError extends Error {},
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    locale: 'ko',
    isLoading: false,
    isResolved: true,
    isError: false,
    bookingDisabledMessage: BOOKING_DISABLED_COPY.ko,
  }),
}));

const SERVER_OPENED_AT = Date.parse('2026-10-02T11:00:00.000Z');

function syncServerClock(serverNowMs: number) {
  recordServerTimeSample({
    serverNowMs,
    requestStartedAtMs: Date.now() - 50,
    responseReceivedAtMs: Date.now() + 50,
  });
}

function renderLockSeat(bookingStartsAt: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['performance', 'performance-open'], {
    id: 'performance-open',
    status: 'upcoming',
    showtimes: [
      {
        id: 'showtime-open',
        performanceId: 'performance-open',
        dateTime: '2026-10-18T10:00:00.000Z',
      },
    ],
    bookingPolicy: { bookingStartsAt },
  } as unknown as PerformanceWithDetails);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(() => useLockSeat(), { wrapper });
}

describe('useLockSeat opening pre-check on the server clock (audit #97)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetServerClockForTests();
    postMock.mockReset();
    postMock.mockResolvedValue({ success: true, expiresAt: SERVER_OPENED_AT + 600_000 });
    useAuthStore.getState().clearAuth();
    useBookingStore.getState().resetBooking();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets a device clock 90 seconds slow lock a seat once the server has opened', async () => {
    vi.setSystemTime(SERVER_OPENED_AT - 90_000 + 1_000);
    syncServerClock(SERVER_OPENED_AT + 1_000);
    const { result } = renderLockSeat(new Date(SERVER_OPENED_AT).toISOString());

    await result.current.mutateAsync({ showtimeId: 'showtime-open', seatId: 'A-1' });

    expect(postMock).toHaveBeenCalledWith('/api/v1/booking/seats/lock', {
      showtimeId: 'showtime-open',
      seatId: 'A-1',
    });
  });

  it('keeps a fast device clock from calling lock before the server opens', async () => {
    vi.setSystemTime(SERVER_OPENED_AT + 60_000);
    syncServerClock(SERVER_OPENED_AT - 30_000);
    const { result } = renderLockSeat(new Date(SERVER_OPENED_AT).toISOString());

    await expect(
      result.current.mutateAsync({ showtimeId: 'showtime-open', seatId: 'A-1' }),
    ).rejects.toMatchObject({ message: BOOKING_DISABLED_COPY.ko });
    expect(postMock).not.toHaveBeenCalled();
  });
});
