import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueryClient,
  QueryClientProvider,
  notifyManager,
} from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import {
  RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS,
  RUNTIME_FLAGS_ERROR_REFETCH_MAX_INTERVAL_MS,
  RUNTIME_FLAGS_MAX_RETRY_AFTER_MS,
  getRuntimeFlagsErrorRefetchIntervalMs,
  getRuntimeFlagsRetryDelayMs,
  useRuntimeFlags,
  type UseRuntimeFlagsOptions,
} from '@/hooks/use-runtime-flags';
import { RuntimeFlagsUnavailableError } from '@/lib/runtime-flags';
import {
  getServerClockOffsetMs,
  getServerNowMs,
  recordServerTimeSample,
  resetServerClockForTests,
} from '@/lib/server-clock';

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

const fetchMock = vi.fn<typeof fetch>();

// Plain response doubles: real Response bodies are read on the real event
// loop, which fake timers cannot drive deterministically.
function okResponse(bookingEnabled: boolean): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({ bookingEnabled }),
  } as unknown as Response;
}

function unavailableResponse(): Response {
  return {
    ok: false,
    status: 503,
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Response;
}

function renderRuntimeFlags(options?: UseRuntimeFlagsOptions) {
  // Mirrors the app defaults (apps/web/app/providers.tsx).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, ...renderHook(() => useRuntimeFlags(options), { wrapper }) };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useRuntimeFlags', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Upper end of the jitter: delays match the plain 1s/2s/4s backoff and the
    // 10s re-check. The jitter itself is covered below.
    vi.spyOn(Math, 'random').mockReturnValue(1);
    // Deliver observer updates synchronously so only retry timers need ticking.
    notifyManager.setScheduler((callback) => callback());
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerClockForTests();
  });

  afterEach(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries a transient failure instead of caching it as booking disabled', async () => {
    fetchMock
      .mockResolvedValueOnce(unavailableResponse())
      .mockResolvedValueOnce(okResponse(true));

    const { result } = renderRuntimeFlags();
    await flush();

    // The failed request is not a resolved "disabled" answer.
    expect(result.current.isResolved).toBe(false);
    expect(result.current.bookingEnabled).toBe(false);

    await flush(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.isResolved).toBe(true);
    expect(result.current.bookingEnabled).toBe(true);
  });

  it('keeps the last enabled value when a later refetch fails', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(true));
    const { result } = renderRuntimeFlags();
    await flush();
    expect(result.current.bookingEnabled).toBe(true);

    fetchMock.mockResolvedValue(unavailableResponse());
    await act(async () => {
      void result.current.refetch();
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.bookingEnabled).toBe(true);
    expect(result.current.isResolved).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it('reports an unknown flag after retries and keeps checking until it loads', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderRuntimeFlags();

    // 1 + 3 retries with 1s, 2s, 4s backoff.
    await flush(7_000);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.isResolved).toBe(false);
    expect(result.current.isError).toBe(true);
    expect(result.current.bookingEnabled).toBe(false);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okResponse(true));
    await flush(RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS);

    expect(result.current.isResolved).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.bookingEnabled).toBe(true);
  });

  it('keeps one jittered re-check interval per failed round across re-renders', async () => {
    // A different random value on every call: re-planning on each render would
    // restart the interval timer and starve the re-check.
    let draws = 0;
    vi.mocked(Math.random).mockImplementation(() => {
      draws += 1;
      return (draws % 10) / 10;
    });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { rerender } = renderRuntimeFlags();

    // First round: 1 + 3 retries, each delay below its 1s/2s/4s ceiling.
    await flush(7_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    for (let step = 0; step < 24; step += 1) {
      rerender();
      await flush(500);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThan(4);
  });

  it('re-reads the flags once 20-30 seconds before a booking start to refresh the clock sample', async () => {
    fetchMock.mockResolvedValue(okResponse(true));
    // Math.random() = 1: the latest point of the window, 20 seconds before the start.
    const startMs = Date.now() + 120_000;
    renderRuntimeFlags({ resyncClockBeforeMs: startMs });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(100_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await flush(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-arms the resync on the server clock once the first clock sample corrects the offset', async () => {
    fetchMock.mockResolvedValue(okResponse(true));
    // The device clock is 60 seconds slow; the first sample arrives after mount.
    const deviceSlowByMs = 60_000;
    const serverNowAtMount = Date.now() + deviceSlowByMs;
    const startMs = serverNowAtMount + 120_000;
    renderRuntimeFlags({ resyncClockBeforeMs: startMs });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      const deviceNow = Date.now();
      recordServerTimeSample({
        serverNowMs: deviceNow + deviceSlowByMs,
        requestStartedAtMs: deviceNow,
        responseReceivedAtMs: deviceNow,
      });
    });
    expect(getServerClockOffsetMs()).toBe(deviceSlowByMs);

    // Math.random() = 1: 20 seconds before the start on the server clock,
    // i.e. 100 seconds after mount (not 160 seconds by the device clock).
    await flush(100_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startMs - getServerNowMs()).toBe(20_000);

    // The timer armed on the uncorrected clock is gone: no second re-read.
    await flush(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the jittered resync instant and runs it once across offset corrections', async () => {
    fetchMock.mockResolvedValue(okResponse(true));
    vi.mocked(Math.random).mockReturnValueOnce(0.5);
    const startMs = Date.now() + 120_000;
    renderRuntimeFlags({ resyncClockBeforeMs: startMs });
    await flush();
    // Later draws must not move the planned instant.
    vi.mocked(Math.random).mockReturnValue(0);

    // A device clock 5 seconds fast: the resync (25s before start) is 5s later on it.
    await act(async () => {
      const deviceNow = Date.now();
      recordServerTimeSample({
        serverNowMs: deviceNow - 5_000,
        requestStartedAtMs: deviceNow,
        responseReceivedAtMs: deviceNow,
      });
    });

    await flush(100_000 - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startMs - getServerNowMs()).toBe(25_000);

    // A tighter sample after the re-read moves the clock back again; the resync
    // instant is in the future on it, but the re-read already ran.
    await act(async () => {
      const deviceNow = Date.now();
      recordServerTimeSample({
        serverNowMs: deviceNow - 8_000,
        requestStartedAtMs: deviceNow,
        responseReceivedAtMs: deviceNow,
      });
    });
    await flush(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not re-read when the page opens inside the resync window', async () => {
    fetchMock.mockResolvedValue(okResponse(true));
    renderRuntimeFlags({ resyncClockBeforeMs: Date.now() + 10_000 });
    await flush(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('runtime flag retry spacing', () => {
  it('spreads retries over a full-jitter window instead of a fixed backoff', () => {
    const error = new RuntimeFlagsUnavailableError('503');

    expect(getRuntimeFlagsRetryDelayMs(0, error, () => 0.2)).toBe(200);
    expect(getRuntimeFlagsRetryDelayMs(0, error, () => 0.9)).toBe(900);
    expect(getRuntimeFlagsRetryDelayMs(2, error, () => 0.5)).toBe(2_000);
    expect(getRuntimeFlagsRetryDelayMs(10, error, () => 1)).toBe(30_000);
  });

  it('spreads and grows the background re-check while no value is known', () => {
    const error = new RuntimeFlagsUnavailableError('503');

    expect(getRuntimeFlagsErrorRefetchIntervalMs(1, error, () => 0)).toBe(5_000);
    expect(getRuntimeFlagsErrorRefetchIntervalMs(1, error, () => 1)).toBe(
      RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS,
    );
    expect(getRuntimeFlagsErrorRefetchIntervalMs(2, error, () => 1)).toBe(20_000);
    expect(getRuntimeFlagsErrorRefetchIntervalMs(3, error, () => 1)).toBe(40_000);
    expect(getRuntimeFlagsErrorRefetchIntervalMs(6, error, () => 1)).toBe(
      RUNTIME_FLAGS_ERROR_REFETCH_MAX_INTERVAL_MS,
    );
  });

  it('waits at least the server Retry-After, up to a cap', () => {
    const throttled = new RuntimeFlagsUnavailableError('429', { retryAfterMs: 20_000 });
    const tooLong = new RuntimeFlagsUnavailableError('503', { retryAfterMs: 600_000 });

    expect(getRuntimeFlagsRetryDelayMs(0, throttled, () => 0)).toBe(20_000);
    expect(getRuntimeFlagsErrorRefetchIntervalMs(1, throttled, () => 0)).toBe(20_000);
    expect(getRuntimeFlagsRetryDelayMs(0, tooLong, () => 0)).toBe(
      RUNTIME_FLAGS_MAX_RETRY_AFTER_MS,
    );
    // Network errors carry no Retry-After.
    expect(getRuntimeFlagsRetryDelayMs(0, new TypeError('Failed to fetch'), () => 0)).toBe(0);
  });
});
