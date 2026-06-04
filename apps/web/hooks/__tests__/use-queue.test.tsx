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

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
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

  it('auto-enters the booking route when the queue session is admitted', async () => {
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

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.remainingSeats).toBe(17);
    expect(result.current.etaSeconds).toBe(0);
    expect(socketMock.connect).toHaveBeenCalled();
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
});
