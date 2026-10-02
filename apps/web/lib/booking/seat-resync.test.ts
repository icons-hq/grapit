import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { refetchAfterInFlight } from './seat-resync';

type Load = { resolve: (value: string) => void; reject: (error: unknown) => void };

/** A real query with an active observer; each fetch waits until the test settles it. */
function createWatchedQuery() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queryKey = ['seat-status', 'showtime-1'] as const;
  const loads: Load[] = [];
  const queryFn = vi.fn(() => new Promise<string>((resolve, reject) => {
    loads.push({ resolve, reject });
  }));
  const observer = new QueryObserver(queryClient, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => undefined);
  return { queryClient, queryKey, queryFn, loads, unsubscribe };
}

describe('refetchAfterInFlight', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('waits for a first load still in flight, then sends exactly one newer read', async () => {
    const { queryClient, queryKey, queryFn, loads, unsubscribe } = createWatchedQuery();
    cleanups.push(unsubscribe);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    const done = refetchAfterInFlight(queryClient, queryKey);
    await Promise.resolve();
    // A plain invalidate here would join the in-flight first load instead.
    expect(queryFn).toHaveBeenCalledTimes(1);

    loads[0]!.resolve('before join');
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    loads[1]!.resolve('after join');
    await done;

    expect(queryClient.getQueryData(queryKey)).toBe('after join');
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('still reads again when the in-flight load fails', async () => {
    const { queryClient, queryKey, queryFn, loads, unsubscribe } = createWatchedQuery();
    cleanups.push(unsubscribe);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    const done = refetchAfterInFlight(queryClient, queryKey);
    loads[0]!.reject(new Error('503'));
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    loads[1]!.resolve('recovered');
    await done;

    expect(queryClient.getQueryData(queryKey)).toBe('recovered');
  });

  it('reads right away when nothing is in flight', async () => {
    const { queryClient, queryKey, queryFn, loads, unsubscribe } = createWatchedQuery();
    cleanups.push(unsubscribe);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    loads[0]!.resolve('loaded');
    await vi.waitFor(() => expect(queryClient.getQueryData(queryKey)).toBe('loaded'));

    void refetchAfterInFlight(queryClient, queryKey);

    expect(queryFn).toHaveBeenCalledTimes(2);
    loads[1]!.resolve('reloaded');
  });

  it('sends nothing when cancelled while waiting', async () => {
    const { queryClient, queryKey, queryFn, loads, unsubscribe } = createWatchedQuery();
    cleanups.push(unsubscribe);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    let cancelled = false;

    const done = refetchAfterInFlight(queryClient, queryKey, () => cancelled);
    cancelled = true;
    loads[0]!.resolve('loaded');
    await done;

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
