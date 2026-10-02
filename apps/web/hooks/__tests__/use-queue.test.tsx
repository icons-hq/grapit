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
import { recordServerTimeSample, resetServerClockForTests } from '@/lib/server-clock';

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
    // Fixture admissions are dated 2026-05-08 / 2026-06-04: keep them open
    // unless a test moves the clock past their window on purpose.
    vi.setSystemTime(new Date('2026-05-08T09:00:00.000Z'));
    resetServerClockForTests();
    vi.clearAllMocks();
    // Drop queued once-responses so one failing test cannot leak into the next.
    postMock.mockReset();
    getMock.mockReset();
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

  it('checks the admission end on the server clock when the device clock runs behind (u05b x w2b)', async () => {
    const deviceNow = Date.parse('2026-05-08T09:00:00.000Z');
    vi.setSystemTime(deviceNow);
    // The server is 30s ahead of this device.
    recordServerTimeSample({
      serverNowMs: deviceNow + 30_000,
      requestStartedAtMs: deviceNow - 5,
      responseReceivedAtMs: deviceNow + 5,
    });
    try {
      postMock.mockResolvedValueOnce({ queueSessionId: 'queue-session-skew' });
      const admitted = {
        queueSessionId: 'queue-session-skew',
        state: 'ADMITTED',
        position: 0,
        waitingCount: 0,
        etaSeconds: 0,
        remainingSeats: 17,
        autoEnter: true,
        admittedAt: new Date(deviceNow + 30_000 - 540_000).toISOString(),
        // 60s left on the server clock (90s on the device clock).
        activeUntilAt: new Date(deviceNow + 90_000).toISOString(),
        reentryGraceUntilAt: new Date(deviceNow + 270_000).toISOString(),
      };
      getMock.mockResolvedValue(admitted);

      const { result } = renderHook(() => useQueue({ performanceId: 'performance-skew' }), {
        wrapper: createWrapper(),
      });
      await flushQueueEffects();
      expect(result.current.isReady).toBe(true);
      const callsAfterAdmission = getMock.mock.calls.length;

      // 60s of server time plus the 2s grace: the single status check is sent.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(62_000);
      });
      expect(getMock.mock.calls.length).toBe(callsAfterAdmission + 1);
    } finally {
      resetServerClockForTests();
    }
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

  it('exposes the server wait range instead of a fake countdown (audit #91)', async () => {
    postMock.mockResolvedValueOnce(
      waitingSnapshot('queue-session-eta', {
        position: 1_500,
        etaSeconds: 1_600,
        etaMinSeconds: 600,
        etaUnavailable: false,
      }),
    );

    const { result } = renderQueue('performance-eta');
    await flushQueueEffects();

    expect(result.current.status).toBe('waiting');
    expect(result.current).toMatchObject({
      etaSeconds: 1_600,
      etaMinSeconds: 600,
      etaUnavailable: false,
    });
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

    it('trusts an explicit bookingStartsAt: null and never reads the public detail (audit #33)', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      postMock.mockImplementation(async () => {
        throw new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: null,
          serverNow: new Date().toISOString(),
        });
      });

      try {
        const { result } = renderQueue('performance-unscheduled');
        await flushQueueEffects();
        expect(result.current.status).toBe('notOpen');
        expect(result.current.bookingOpensAt).toBeNull();

        // Several periodic re-checks: still no detail GET (each would count a view).
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2 * 60_000);
        });
        expect(postMock.mock.calls.length).toBeGreaterThan(3);
        expect(getMock).not.toHaveBeenCalled();
      } finally {
        postMock.mockReset();
        randomSpy.mockRestore();
      }
    });

    it('converts the open time with the measured server clock when the 403 body has no server time', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      // The device clock runs 90s behind the server (server 09:59:50 now).
      const deviceNow = Date.parse('2026-06-04T09:58:20.000Z');
      vi.setSystemTime(deviceNow);
      recordServerTimeSample({
        serverNowMs: deviceNow + 90_000,
        requestStartedAtMs: deviceNow - 5,
        responseReceivedAtMs: deviceNow + 5,
      });
      postMock
        .mockRejectedValueOnce(
          new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
            errorCode: 'BOOKING_NOT_OPEN',
            bookingStartsAt: '2026-06-04T10:00:00.000Z',
          }),
        )
        .mockResolvedValueOnce(waitingSnapshot('queue-session-on-time'));

      try {
        const { result } = renderQueue('performance-slow-device');
        await flushQueueEffects();

        // 10:00:00 server time is 09:58:30 on this device.
        expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T09:58:30.000Z'));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(9_999);
        });
        expect(postMock).toHaveBeenCalledTimes(1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        await flushQueueEffects();
        // Entered at the server open time, not 90s later on the device clock.
        expect(postMock).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe('waiting');
        expect(getMock).not.toHaveBeenCalled();
      } finally {
        randomSpy.mockRestore();
      }
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

    it('re-checks an unknown open time every 15 seconds instead of every minute', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T09:00:00.000Z'));
      postMock.mockImplementation(async () => {
        throw new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: null,
          serverNow: new Date().toISOString(),
        });
      });
      getMock.mockResolvedValue({ bookingPolicy: { bookingStartsAt: null } });

      try {
        const { result } = renderQueue('performance-unknown-recheck');
        await flushQueueEffects();
        await flushQueueEffects();
        expect(result.current.status).toBe('notOpen');
        expect(postMock).toHaveBeenCalledTimes(1);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(14_999);
        });
        expect(postMock).toHaveBeenCalledTimes(1);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(postMock).toHaveBeenCalledTimes(2);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(45_000);
        });
        // 15s cadence (+ jitter): about 4 checks a minute, well inside the
        // 20/min queue-entry limit.
        expect(postMock).toHaveBeenCalledTimes(5);
        expect(result.current.status).toBe('notOpen');
      } finally {
        postMock.mockReset();
        getMock.mockReset();
        randomSpy.mockRestore();
      }
    });

    it('re-reads a postponed open time instead of looping on the cached one (fallback path)', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T09:59:00.000Z'));
      // Filter-stripped 403 body: only the timestamp survives.
      postMock.mockImplementation(async () => {
        throw new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          statusCode: 403,
          message: '예매는 추후 오픈 예정입니다',
          timestamp: new Date().toISOString(),
        });
      });
      getMock
        .mockResolvedValueOnce({ bookingPolicy: { bookingStartsAt: '2026-06-04T09:59:30.000Z' } })
        // The admin postponed the open by 30 minutes after this page loaded.
        .mockResolvedValueOnce({ bookingPolicy: { bookingStartsAt: '2026-06-04T10:29:30.000Z' } });

      try {
        const { result } = renderQueue('performance-postponed');
        await flushQueueEffects();
        await flushQueueEffects();
        expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T09:59:30.000Z'));

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        await flushQueueEffects();

        // Re-entry at the old open time is refused: the cached time is re-read.
        expect(postMock).toHaveBeenCalledTimes(2);
        expect(getMock).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe('notOpen');
        expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T10:29:30.000Z'));

        // No 1.5s POST loop toward the 20/min limit: the next check waits for
        // the (capped) pre-open re-check.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4 * 60_000);
        });
        expect(postMock).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe('notOpen');
      } finally {
        postMock.mockReset();
        getMock.mockReset();
        randomSpy.mockRestore();
      }
    });

    it('backs off when the open time has passed but entry is still refused', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      // The server's own open time is already reached on this device's clock
      // (e.g. a skewed instance); the answer does not change.
      postMock.mockImplementation(async () => {
        throw new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: '2026-06-04T09:59:59.000Z',
          serverNow: new Date().toISOString(),
        });
      });

      try {
        const { result } = renderQueue('performance-overdue');
        await flushQueueEffects();
        expect(postMock).toHaveBeenCalledTimes(1);

        const callsAfter = async (ms: number) => {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
          });
          return postMock.mock.calls.length;
        };

        // 2s, 4s, 8s, 16s, 32s ... capped at 60s instead of a tight loop.
        expect(await callsAfter(1_999)).toBe(1);
        expect(await callsAfter(1)).toBe(2);
        expect(await callsAfter(4_000)).toBe(3);
        expect(await callsAfter(8_000)).toBe(4);
        expect(await callsAfter(16_000)).toBe(5);
        // Within the first minute: at most 5 attempts.
        expect(await callsAfter(29_000)).toBe(5);
        expect(result.current.status).toBe('notOpen');
      } finally {
        postMock.mockReset();
        randomSpy.mockRestore();
      }
    });

    it('keeps the not-open surface and retries quietly when the automatic entry hits 503/429', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T09:59:58.000Z'));
      postMock
        .mockRejectedValueOnce(
          new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
            errorCode: 'BOOKING_NOT_OPEN',
            bookingStartsAt: '2026-06-04T10:00:00.000Z',
            serverNow: '2026-06-04T09:59:58.000Z',
          }),
        )
        .mockRejectedValueOnce(new ApiClientErrorMock('Service Unavailable', 503))
        .mockRejectedValueOnce(new ApiClientErrorMock('TRAFFIC_RATE_LIMITED', 429))
        .mockResolvedValueOnce(waitingSnapshot('queue-session-after-open'));

      try {
        const { result } = renderQueue('performance-open-burst');
        await flushQueueEffects();
        expect(result.current.status).toBe('notOpen');

        // Open time: first automatic attempt fails with 503.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(postMock).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe('notOpen');
        expect(result.current.bookingOpensAt).toBe(Date.parse('2026-06-04T10:00:00.000Z'));

        // 2s later: 429, still no manual "too many requests" surface.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(postMock).toHaveBeenCalledTimes(3);
        expect(result.current.status).toBe('notOpen');

        // 4s later: entered.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000);
        });
        await flushQueueEffects();
        expect(postMock).toHaveBeenCalledTimes(4);
        expect(result.current.status).toBe('waiting');
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('falls back to the manual retry surface after the bounded automatic retries', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      vi.setSystemTime(new Date('2026-06-04T09:59:59.000Z'));
      postMock.mockRejectedValueOnce(
        new ApiClientErrorMock('예매는 추후 오픈 예정입니다', 403, {
          errorCode: 'BOOKING_NOT_OPEN',
          bookingStartsAt: '2026-06-04T10:00:00.000Z',
          serverNow: '2026-06-04T09:59:59.000Z',
        }),
      );
      postMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      postMock.mockRejectedValueOnce(new ApiClientErrorMock('Bad Gateway', 502));
      postMock.mockRejectedValueOnce(new ApiClientErrorMock('Service Unavailable', 503));
      postMock.mockRejectedValueOnce(new ApiClientErrorMock('Service Unavailable', 503));

      try {
        const { result } = renderQueue('performance-open-down');
        await flushQueueEffects();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000);
        });
        await flushQueueEffects();

        expect(postMock).toHaveBeenCalledTimes(5);
        expect(result.current.status).toBe('retry');

        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(postMock).toHaveBeenCalledTimes(5);
      } finally {
        randomSpy.mockRestore();
      }
    });
  });

  it.each([
    [403, '이미 시작된 회차는 예매할 수 없습니다.', { errorCode: 'NO_BOOKABLE_SHOWTIME' }, 'unavailable'],
    // Message-only C1 rejection (older API or a filter that drops errorCode).
    [403, '이미 시작된 회차는 예매할 수 없습니다.', {}, 'unavailable'],
    [403, '판매가 종료된 공연입니다', {}, 'unavailable'],
    [404, '공연을 찾을 수 없습니다', { errorCode: 'PERFORMANCE_NOT_FOUND' }, 'notFound'],
    [404, '공연을 찾을 수 없습니다', {}, 'notFound'],
    [400, '올바른 공연 ID가 아닙니다', {}, 'notFound'],
  ])('maps a %s "%s" entry rejection to the closed surface without auto retry', async (statusCode, message, data, closedReason) => {
    postMock.mockRejectedValueOnce(new ApiClientErrorMock(message, statusCode, data));

    const { result } = renderQueue('performance-closed');
    await flushQueueEffects();

    expect(result.current.status).toBe('closed');
    // Missing performances get their own copy instead of "sales ended".
    expect(result.current.closedReason).toBe(closedReason);
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
        // A transient failure keeps the booking screen and retries later.
        .mockRejectedValueOnce(new ApiClientErrorMock('Service Unavailable', 503))
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

  describe('admissions whose seat window closed (audit #4, #32)', () => {
    it('never opens the seat screen for an admission whose window already closed and re-enters once', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock
        // Window 10:00-10:10 is over; an older API still hands it out.
        .mockResolvedValueOnce(admittedSnapshot('queue-session-closed'))
        .mockResolvedValueOnce(waitingSnapshot('queue-session-new', { position: 40 }));

      const { result } = renderQueue('performance-closed-window');
      await flushQueueEffects();
      expect(result.current.isReady).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await flushQueueEffects();

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(result.current.isReady).toBe(false);
      expect(result.current.status).toBe('waiting');
      expect(result.current.position).toBe(40);
    });

    it('re-enters a closed admission automatically only once per entry the user starts', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock.mockResolvedValue(admittedSnapshot('queue-session-closed'));

      const { result } = renderQueue('performance-closed-loop');
      await flushQueueEffects();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(postMock).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('expired');
      expect(result.current.isReady).toBe(false);

      // A manual retry may again re-enter once.
      await act(async () => {
        await result.current.retry();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(postMock).toHaveBeenCalledTimes(4);
      expect(result.current.status).toBe('expired');
    });

    it('leaves the seat screen when the status check finds the window closed', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      postMock
        .mockResolvedValueOnce(admittedSnapshot('queue-session-stale'))
        .mockResolvedValueOnce(waitingSnapshot('queue-session-next', { position: 7 }));
      // An older API still reports the admission after its window.
      getMock.mockResolvedValueOnce(admittedSnapshot('queue-session-stale', { waitingCount: 3 }));

      const { result } = renderQueue('performance-stale');
      await flushQueueEffects();
      expect(result.current.isReady).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 2_000);
      });
      await flushQueueEffects();
      // The one automatic re-entry runs on the next timer turn.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      await flushQueueEffects();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(result.current.isReady).toBe(false);
      expect(postMock).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('waiting');
    });

    it('does not auto-enter a PAYMENT_RECOVERY session the server did not mark for entry', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:05:00.000Z'));
      postMock.mockResolvedValueOnce(
        admittedSnapshot('queue-session-recovering', {
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
        }),
      );

      const { result } = renderQueue('performance-recovering');
      await flushQueueEffects();

      // Inside the window it is a normal admission, not an immediate one.
      expect(result.current.status).toBe('admitted');
      expect(result.current.autoEnter).toBe(false);
      expect(result.current.isReady).toBe(false);
      expect(result.current.recoveryOrderId).toBeNull();
    });

    it('offers only payment recovery for an order bound to a closed window', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock.mockResolvedValueOnce(
        admittedSnapshot('queue-session-recovery', {
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
          paymentRecoveryUntilAt: '2026-06-04T10:13:00.000Z',
          recoveryOrderId: 'order-awaiting-payment',
        }),
      );
      getMock.mockResolvedValueOnce(waitingSnapshot('queue-session-after-recovery', { position: 9 }));

      const { result } = renderQueue('performance-recovery');
      await flushQueueEffects();

      expect(result.current.isReady).toBe(false);
      expect(result.current.recoveryOrderId).toBe('order-awaiting-payment');
      // No queue socket for a session that can only pay, and no re-entry loop.
      expect(socketMock.connect).not.toHaveBeenCalled();
      expect(postMock).toHaveBeenCalledTimes(1);

      // The recovery end (paymentRecoveryUntilAt + grace) is checked once.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_999);
      });
      expect(getMock).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      await flushQueueEffects();
      expect(getMock).toHaveBeenCalledTimes(1);
      expect(result.current.recoveryOrderId).toBeNull();
      expect(result.current.status).toBe('waiting');
      expect(result.current.position).toBe(9);
    });
  });

  describe('server answer on the ended admission (seat release, audit #4, #32)', () => {
    it('reports the end only once the server answers, not on the local clock or a rejoin in flight', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:09:00.000Z'));
      postMock
        .mockResolvedValueOnce(admittedSnapshot('queue-session-seat-screen'))
        // The rejoin's answer is still on its way.
        .mockImplementationOnce(() => new Promise(() => {}));
      getMock.mockImplementation(() => new Promise(() => {}));

      const { result } = renderQueue('performance-release');
      await flushQueueEffects();
      expect(result.current.isReady).toBe(true);
      expect(result.current.accessEndedByServer).toBe(false);

      // Past activeUntilAt locally; the window-end check has not answered.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000 + 500);
      });
      expect(result.current.accessEndedByServer).toBe(false);

      await act(async () => {
        void result.current.retry();
      });
      await flushQueueEffects();
      expect(result.current.status).toBe('loading');
      expect(result.current.isReady).toBe(false);
      expect(result.current.accessEndedByServer).toBe(false);
    });

    it('reports the end when the status check finds the admission expired', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:09:00.000Z'));
      postMock.mockResolvedValueOnce(admittedSnapshot('queue-session-expiring'));
      getMock.mockResolvedValueOnce({
        ...waitingSnapshot('queue-session-expiring'),
        state: 'EXPIRED',
        position: 0,
      });

      const { result } = renderQueue('performance-expiring');
      await flushQueueEffects();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000 + 2_000);
      });
      await flushQueueEffects();

      expect(result.current.status).toBe('expired');
      expect(result.current.accessEndedByServer).toBe(true);
    });

    it('keeps an order awaiting payment out of the end, also after a rejoin', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock.mockResolvedValue(
        admittedSnapshot('queue-session-recovery-only', {
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
          paymentRecoveryUntilAt: '2026-06-04T10:13:00.000Z',
          recoveryOrderId: 'order-awaiting-payment',
        }),
      );

      const { result } = renderQueue('performance-recovery-only');
      await flushQueueEffects();

      expect(result.current.recoveryOrderId).toBe('order-awaiting-payment');
      expect(result.current.accessEndedByServer).toBe(false);

      await act(async () => {
        await result.current.retry();
      });
      expect(postMock).toHaveBeenCalledTimes(2);
      expect(result.current.recoveryOrderId).toBe('order-awaiting-payment');
      expect(result.current.accessEndedByServer).toBe(false);
    });

    it('does not report the end for a closed PAYMENT_RECOVERY admission an older API sends without its order', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock.mockResolvedValue(
        admittedSnapshot('queue-session-old-api', {
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
        }),
      );

      const { result } = renderQueue('performance-old-api');
      await flushQueueEffects();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      await flushQueueEffects();

      // Re-entry surface, but an order of another tab may still need its seats.
      expect(result.current.status).toBe('expired');
      expect(result.current.isReady).toBe(false);
      expect(result.current.accessEndedByServer).toBe(false);
    });

    it('reports the end for a closed ADMITTED admission and for a new waiting position', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:11:00.000Z'));
      postMock
        .mockResolvedValueOnce(admittedSnapshot('queue-session-closed-admitted'))
        .mockImplementationOnce(() => new Promise(() => {}));

      const { result } = renderQueue('performance-closed-admitted');
      await flushQueueEffects();
      expect(result.current.status).toBe('expired');
      expect(result.current.accessEndedByServer).toBe(true);

      postMock.mockReset();
      postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-next', { position: 3 }));
      await act(async () => {
        await result.current.retry();
      });
      expect(result.current.status).toBe('waiting');
      expect(result.current.accessEndedByServer).toBe(true);
    });
  });

  describe('status checks after the sale closed (audit #2, #4)', () => {
    it('maps a 403 NO_BOOKABLE_SHOWTIME status answer to the closed surface instead of re-entry', async () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      postMock.mockResolvedValueOnce(waitingSnapshot('queue-session-sold-out'));
      getMock.mockRejectedValueOnce(
        new ApiClientErrorMock('이미 시작된 회차는 예매할 수 없습니다.', 403, {
          errorCode: 'NO_BOOKABLE_SHOWTIME',
        }),
      );

      try {
        const { result } = renderQueue('performance-sold-out');
        await flushQueueEffects();
        expect(result.current.status).toBe('waiting');

        await act(async () => {
          await vi.advanceTimersByTimeAsync(15_000);
        });

        expect(result.current.status).toBe('closed');
        expect(result.current.closedReason).toBe('unavailable');
        expect(result.current.isReady).toBe(false);
        // No polling or re-entry for a sale that ended.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
        expect(getMock).toHaveBeenCalledTimes(1);
        expect(postMock).toHaveBeenCalledTimes(1);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('re-reads the status at once when asked (a queue 403 on the seat screen)', async () => {
      vi.setSystemTime(new Date('2026-06-04T10:02:00.000Z'));
      postMock.mockResolvedValueOnce(admittedSnapshot('queue-session-used'));
      getMock.mockResolvedValueOnce({
        ...waitingSnapshot('queue-session-used'),
        state: 'EXPIRED',
        position: 0,
      });

      const { result } = renderQueue('performance-used');
      await flushQueueEffects();
      expect(result.current.isReady).toBe(true);

      await act(async () => {
        await result.current.recheck();
      });

      expect(getMock).toHaveBeenCalledWith('/api/v1/queue/sessions/queue-session-used', {
        showErrorToast: false,
      });
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
    etaSeconds: 800,
    etaMinSeconds: 0,
    etaUnavailable: false,
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
    etaMinSeconds: 0,
    etaUnavailable: false,
    remainingSeats: 100,
    autoEnter: true,
    admittedAt: '2026-06-04T10:00:00.000Z',
    activeUntilAt: '2026-06-04T10:10:00.000Z',
    reentryGraceUntilAt: '2026-06-04T10:13:00.000Z',
    ...overrides,
  };
}
