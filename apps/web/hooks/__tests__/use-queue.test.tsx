import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

const {
  postMock,
  getMock,
  ioMock,
  socketMock,
  ApiClientErrorMock,
} = vi.hoisted(() => {
  class ApiClientError extends Error {
    statusCode: number;
    data: unknown;

    constructor(message: string, statusCode: number, data?: unknown) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.data = data;
    }
  }

  const socket = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  };

  return {
    postMock: vi.fn(),
    getMock: vi.fn(),
    ioMock: vi.fn(() => socket),
    socketMock: socket,
    ApiClientErrorMock: ApiClientError,
  };
});

vi.mock('socket.io-client', () => ({
  io: ioMock,
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: postMock,
    get: getMock,
  },
  ApiClientError: ApiClientErrorMock,
}));

import { useQueue } from '../use-queue';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

async function flushQueueEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('skips the waiting surface when a fetched queue session is immediately admitted', async () => {
    postMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-1',
    });
    getMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-1',
      state: 'ADMITTED',
      position: 0,
      waitingCount: 0,
      etaSeconds: 0,
      remainingSeats: 17,
      autoEnter: true,
      admittedAt: '2026-05-08T09:00:00.000Z',
      activeUntilAt: '2026-05-08T09:10:00.000Z',
      reentryGraceUntilAt: '2026-05-08T09:13:00.000Z',
    });

    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-1',
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();
    expect(result.current.status).toBe('admitted');
    expect(result.current.isReady).toBe(true);
    expect(result.current.remainingSeats).toBe(17);
    expect(result.current.etaSeconds).toBe(0);
    // Admitted buyers go straight to the booking screen without holding a
    // queue socket (audit #61).
    expect(socketMock.connect).not.toHaveBeenCalled();
  });

  it('skips the waiting surface when the enter response is immediately admitted', async () => {
    postMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-immediate',
      state: 'ADMITTED',
      position: 0,
      waitingCount: 0,
      etaSeconds: 0,
      remainingSeats: 21,
      autoEnter: true,
      admittedAt: '2026-05-08T09:00:00.000Z',
      activeUntilAt: '2026-05-08T09:10:00.000Z',
      reentryGraceUntilAt: '2026-05-08T09:13:00.000Z',
    });

    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-immediate',
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();

    expect(getMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('admitted');
    expect(result.current.isReady).toBe(true);
    expect(result.current.remainingSeats).toBe(21);
  });

  it('moves to expired state when queue:expired arrives over the socket contract', async () => {
    postMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-2',
    });
    getMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-2',
      state: 'WAITING',
      position: 3,
      waitingCount: 12,
      etaSeconds: 30,
      remainingSeats: 9,
      autoEnter: false,
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
    });

    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-2',
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();
    expect(result.current.status).toBe('waiting');

    const expiredCall = (socketMock.on as Mock).mock.calls.find(
      (call: unknown[]) => call[0] === 'queue:expired',
    );
    expect(expiredCall).toBeDefined();

    const expiredHandler = expiredCall?.[1] as (payload: {
      queueSessionId: string;
      state: string;
      autoEnter: boolean;
    }) => void;

    act(() => {
      expiredHandler({
        queueSessionId: 'queue-session-2',
        state: 'EXPIRED',
        autoEnter: false,
      });
    });

    expect(result.current.status).toBe('expired');
    expect(result.current.autoEnter).toBe(false);
  });

  it('polls waiting sessions when socket admission events do not arrive', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    postMock.mockResolvedValueOnce({
      queueSessionId: 'queue-session-poll',
    });
    getMock
      .mockResolvedValueOnce({
        queueSessionId: 'queue-session-poll',
        state: 'WAITING',
        position: 1,
        waitingCount: 1,
        etaSeconds: 0,
        remainingSeats: 5,
        autoEnter: false,
        admittedAt: null,
        activeUntilAt: null,
        reentryGraceUntilAt: null,
      })
      .mockResolvedValueOnce({
        queueSessionId: 'queue-session-poll',
        state: 'ADMITTED',
        position: 0,
        waitingCount: 0,
        etaSeconds: 0,
        remainingSeats: 5,
        autoEnter: true,
        admittedAt: '2026-05-08T09:00:00.000Z',
        activeUntilAt: '2026-05-08T09:10:00.000Z',
        reentryGraceUntilAt: '2026-05-08T09:13:00.000Z',
      });

    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-poll',
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();
    expect(result.current.status).toBe('waiting');

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('admitted');
    randomSpy.mockRestore();
  });

  it('keeps authentication failures distinct from retryable queue throttling', async () => {
    postMock.mockRejectedValueOnce(
      new ApiClientErrorMock('인증이 만료되었습니다. 다시 로그인해주세요.', 401),
    );

    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-auth-required',
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();

    expect(result.current.status).toBe('authRequired');
  });

  it('does not enter the queue while the booking route is disabled by auth gating', async () => {
    const { result } = renderHook(
      () =>
        useQueue({
          performanceId: 'performance-disabled',
          enabled: false,
        }),
      {
        wrapper: createWrapper(),
      },
    );

    await flushQueueEffects();

    expect(postMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
  });

  it('exposes a pending wait estimate instead of a fake countdown', async () => {
    postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-eta', { etaPending: true }));

    const { result } = renderQueue('performance-eta');
    await flushQueueEffects();

    expect(result.current.status).toBe('waiting');
    expect(result.current.etaPending).toBe(true);
  });

  describe('booking not open yet (audit #33)', () => {
    it('shows the not-open surface and enters automatically at the server-corrected open time', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      // Device clock runs 30s ahead of the server.
      vi.setSystemTime(new Date('2026-06-04T09:59:30.000Z'));
      postMock.mockRejectedValueOnce(
        new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          statusCode: 403,
          message: '예매는 추후 오픈 예정입니다',
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: '2026-06-04T10:00:00.000Z',
          serverNow: '2026-06-04T09:59:00.000Z',
        }),
      );

      const { result } = renderQueue('performance-not-open');
      await flushQueueEffects();

      expect(result.current.status).toBe('notOpen');
      expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T10:00:30.000Z'));
      expect(getMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(postMock).toHaveBeenCalledTimes(1);

      let resolveEnter: (value: unknown) => void = () => undefined;
      postMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveEnter = resolve;
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(postMock).toHaveBeenCalledTimes(2);
      // The automatic re-entry keeps the not-open surface instead of a blank page.
      expect(result.current.status).toBe('notOpen');

      await act(async () => {
        resolveEnter(waitingSnapshot('queue-session-open'));
        await Promise.resolve();
      });
      await flushQueueEffects();

      expect(result.current.status).toBe('waiting');
      expect(result.current.bookingOpensAt).toBeNull();
      randomSpy.mockRestore();
    });

    it('falls back to the performance open time and the filter timestamp when the 403 body has no details', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T09:59:00.000Z'));
      postMock.mockRejectedValueOnce(
        new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          statusCode: 403,
          message: '예매는 추후 오픈 예정입니다',
          timestamp: '2026-06-04T09:58:00.000Z',
        }),
      );
      getMock.mockResolvedValueOnce({
        id: 'performance-fallback',
        bookingPolicy: { bookingStartsAt: '2026-06-04T10:00:00.000Z' },
      });

      const { result } = renderQueue('performance-fallback');
      await flushQueueEffects();
      await flushQueueEffects();

      expect(getMock).toHaveBeenCalledWith(
        '/api/v1/performances/performance-fallback',
        { showErrorToast: false },
      );
      expect(result.current.status).toBe('notOpen');
      // Server is 60s behind the device: open at 10:01:00 on this device.
      expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T10:01:00.000Z'));
      randomSpy.mockRestore();
    });

    it('does not show the retryable "too many requests" surface for a not-open rejection', async () => {
      postMock.mockRejectedValueOnce(
        new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: null,
          serverNow: new Date().toISOString(),
        }),
      );
      getMock.mockResolvedValueOnce({ bookingPolicy: { bookingStartsAt: null } });

      const { result } = renderQueue('performance-unknown-open');
      await flushQueueEffects();
      await flushQueueEffects();

      expect(result.current.status).toBe('notOpen');
      expect(result.current.bookingOpensAt).toBeNull();
    });
  });

  it.each([
    [403, '이미 시작된 회차는 예매할 수 없습니다.', { errorCode: 'NO_BOOKABLE_SHOWTIME' }],
    [403, '판매가 종료된 공연입니다', {}],
    [404, '공연을 찾을 수 없습니다', { errorCode: 'PERFORMANCE_NOT_FOUND' }],
    [400, '올바른 공연 ID가 아닙니다', {}],
  ])('maps a %s "%s" entry rejection to the closed surface without auto retry', async (statusCode, message, data) => {
    postMock.mockRejectedValueOnce(new ApiClientErrorMock(message, statusCode, data));

    const { result } = renderQueue('performance-closed');
    await flushQueueEffects();

    expect(result.current.status).toBe('closed');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('switches to the loading surface only when queue entry is slow', async () => {
    let resolveEnter: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveEnter = resolve;
      }),
    );

    const { result } = renderQueue('performance-slow');
    await flushQueueEffects();

    expect(result.current.status).toBe('loading');
    expect(result.current.isSlowLoading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(result.current.isSlowLoading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.isSlowLoading).toBe(true);

    await act(async () => {
      resolveEnter(waitingSnapshot('queue-session-slow'));
      await Promise.resolve();
    });
    await flushQueueEffects();

    expect(result.current.status).toBe('waiting');
    expect(result.current.isSlowLoading).toBe(false);
  });

  describe('waiting poll failures (audit #4)', () => {
    it('moves to the re-entry surface when the waiting session is gone (404)', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-gone'));
      getMock.mockRejectedValueOnce(
        new ApiClientErrorMock('대기열 세션을 찾을 수 없습니다', 404),
      );

      const { result } = renderQueue('performance-gone');
      await flushQueueEffects();
      expect(result.current.status).toBe('waiting');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('expired');
      expect(result.current.isReady).toBe(false);

      // No further polling for a session that no longer exists.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(getMock).toHaveBeenCalledTimes(1);
      randomSpy.mockRestore();
    });

    it('keeps waiting and polling through transient poll failures', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-transient'));
      getMock
        .mockRejectedValueOnce(new ApiClientErrorMock('서버 오류', 503))
        .mockResolvedValueOnce(waitingSnapshot('queue-session-transient', { position: 2 }));

      const { result } = renderQueue('performance-transient');
      await flushQueueEffects();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(result.current.status).toBe('waiting');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(getMock).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('waiting');
      expect(result.current.position).toBe(2);
      randomSpy.mockRestore();
    });
  });

  describe('queue socket after admission (audit #61)', () => {
    it('closes the queue socket once the booking screen is shown', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-socket'));
      getMock.mockResolvedValueOnce(
        admittedSnapshot('queue-session-socket', { waitingCount: 40 }),
      );

      const { result } = renderQueue('performance-socket');
      await flushQueueEffects();
      expect(socketMock.connect).toHaveBeenCalledTimes(1);
      expect(socketMock.disconnect).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(result.current.status).toBe('admitted');
      expect(result.current.isReady).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });

      expect(result.current.isReady).toBe(true);
      expect(socketMock.disconnect).toHaveBeenCalledTimes(1);
      expect(socketMock.connect).toHaveBeenCalledTimes(1);
      randomSpy.mockRestore();
    });

    it('confirms admission expiry with a status request instead of the socket event', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      postMock.mockResolvedValueOnce(
        admittedSnapshot('queue-session-expiry', {
          activeUntilAt: '2026-06-04T10:10:00.000Z',
          reentryGraceUntilAt: '2026-06-04T10:13:00.000Z',
        }),
      );
      getMock
        // Server has not expired it yet: the booking screen must stay mounted.
        .mockResolvedValueOnce(
          admittedSnapshot('queue-session-expiry', {
            waitingCount: 12,
            activeUntilAt: '2026-06-04T10:10:00.000Z',
            reentryGraceUntilAt: '2026-06-04T10:13:00.000Z',
          }),
        )
        .mockResolvedValueOnce({
          ...waitingSnapshot('queue-session-expiry'),
          state: 'EXPIRED',
          position: 0,
        });

      const { result } = renderQueue('performance-expiry');
      await flushQueueEffects();
      expect(result.current.isReady).toBe(true);
      expect(socketMock.connect).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(getMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(result.current.isReady).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(getMock).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('expired');
      expect(result.current.isReady).toBe(false);
    });
  });
});

function renderQueue(performanceId: string) {
  return renderHook(() => useQueue({ performanceId }), {
    wrapper: createWrapper(),
  });
}

function waitingSnapshot(
  queueSessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    queueSessionId,
    state: 'WAITING',
    position: 5,
    waitingCount: 50,
    etaSeconds: 0,
    etaPending: true,
    remainingSeats: 100,
    autoEnter: false,
    admittedAt: null,
    activeUntilAt: null,
    reentryGraceUntilAt: null,
    ...overrides,
  };
}

function admittedSnapshot(
  queueSessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    queueSessionId,
    state: 'ADMITTED',
    position: 0,
    waitingCount: 0,
    etaSeconds: 0,
    etaPending: false,
    remainingSeats: 100,
    autoEnter: true,
    admittedAt: '2026-06-04T10:00:00.000Z',
    activeUntilAt: '2026-06-04T10:10:00.000Z',
    reentryGraceUntilAt: '2026-06-04T10:13:00.000Z',
    ...overrides,
  };
}
