'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import {
  fetchRuntimeFlags,
  getBookingDisabledCopy,
  type RuntimeFlags,
} from '@/lib/runtime-flags';

/** Gating stays closed while the real flag value is unknown. */
const FAIL_CLOSED_FLAGS: RuntimeFlags = { bookingEnabled: false };

export const RUNTIME_FLAGS_QUERY_KEY = ['runtime-flags'] as const;
export const RUNTIME_FLAGS_STALE_TIME_MS = 30_000;
export const RUNTIME_FLAGS_RETRY_COUNT = 3;
/** While no flag value was ever loaded, keep checking instead of giving up. */
export const RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS = 10_000;

export function useRuntimeFlags() {
  const locale = useLocale();
  const query = useQuery({
    queryKey: RUNTIME_FLAGS_QUERY_KEY,
    queryFn: () => fetchRuntimeFlags(),
    // No placeholder data: a failed request must stay an error (and keep the
    // last good value on refetch) instead of looking like "booking disabled".
    staleTime: RUNTIME_FLAGS_STALE_TIME_MS,
    retry: RUNTIME_FLAGS_RETRY_COUNT,
    refetchInterval: (current) =>
      current.state.data === undefined && current.state.status === 'error'
        ? RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS
        : false,
  });
  const isResolved = query.data !== undefined;

  return {
    ...(query.data ?? FAIL_CLOSED_FLAGS),
    locale,
    isLoading: query.isLoading,
    isResolved,
    /** No flag value is known and the last check failed. */
    isError: !isResolved && query.isError,
    refetch: query.refetch,
    bookingDisabledMessage: getBookingDisabledCopy(locale),
  };
}
