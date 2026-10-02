import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Upper bound of the random delay before resyncing seat-status after a
 * socket reconnect. A restarted WS instance reconnects every viewer at once;
 * the jitter keeps them from reloading the whole seat map in the same instant.
 */
export const SEAT_STATUS_RECONNECT_JITTER_MS = 3_000;

/**
 * Reads a query again with a request sent after this call.
 *
 * A fetch already in flight was sent earlier, so it may predate whatever made
 * the caller ask (a socket room join, a seat lock). TanStack shares an
 * in-flight load that has no data yet with every new fetch, whatever
 * `cancelRefetch` says, so invalidating during that load sends no new
 * request. Instead this waits for the in-flight fetch to settle and then
 * invalidates once; a fetch started after the call (a poll, a focus refetch)
 * is newer and is reused. Nothing is requested when `isCancelled` turns true
 * while waiting (the page moved on).
 */
export async function refetchAfterInFlight(
  queryClient: QueryClient,
  queryKey: QueryKey,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const query = queryClient.getQueryCache().find({ queryKey, exact: true });
  const inFlight = query?.state.fetchStatus === 'fetching' ? query.promise : undefined;
  if (inFlight) {
    await inFlight.catch(() => undefined);
  }
  if (isCancelled()) {
    return;
  }
  await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
}
