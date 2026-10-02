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
  useRuntimeFlags,
} from '@/hooks/use-runtime-flags';
import { resetServerClockForTests } from '@/lib/server-clock';

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

function renderRuntimeFlags() {
  // Mirrors the app defaults (apps/web/app/providers.tsx).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, ...renderHook(() => useRuntimeFlags(), { wrapper }) };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useRuntimeFlags', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deliver observer updates synchronously so only retry timers need ticking.
    notifyManager.setScheduler((callback) => callback());
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerClockForTests();
  });

  afterEach(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    vi.unstubAllGlobals();
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
});
