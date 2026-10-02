'use client';

import { useEffect, useRef } from 'react';
import { useQuery, type Query } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useServerClockOffsetMs } from '@/hooks/use-server-clock';
import { getServerNowMs } from '@/lib/server-clock';
import {
  RuntimeFlagsUnavailableError,
  fetchRuntimeFlags,
  getBookingDisabledCopy,
  type RuntimeFlags,
} from '@/lib/runtime-flags';

/** Gating stays closed while the real flag value is unknown. */
const FAIL_CLOSED_FLAGS: RuntimeFlags = { bookingEnabled: false };

export const RUNTIME_FLAGS_QUERY_KEY = ['runtime-flags'] as const;
export const RUNTIME_FLAGS_STALE_TIME_MS = 30_000;
export const RUNTIME_FLAGS_RETRY_COUNT = 3;
/** Retry backoff ceiling grows 1s, 2s, 4s ... up to this cap. */
export const RUNTIME_FLAGS_RETRY_BASE_DELAY_MS = 1_000;
export const RUNTIME_FLAGS_RETRY_MAX_DELAY_MS = 30_000;
/** While no flag value was ever loaded, keep checking instead of giving up. */
export const RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS = 10_000;
export const RUNTIME_FLAGS_ERROR_REFETCH_MAX_INTERVAL_MS = 60_000;
/** A Retry-After longer than this is not worth keeping the check idle for. */
export const RUNTIME_FLAGS_MAX_RETRY_AFTER_MS = 60_000;

type Random = () => number;

function retryAfterMsOf(error: unknown): number {
  if (
    error instanceof RuntimeFlagsUnavailableError &&
    error.retryAfterMs !== null
  ) {
    return Math.min(error.retryAfterMs, RUNTIME_FLAGS_MAX_RETRY_AFTER_MS);
  }
  return 0;
}

/**
 * Retry delay with full jitter. The check fails for everybody at once when
 * the web service is saturated (open-time 429/503), so clients must not come
 * back in lockstep; a server Retry-After is a floor.
 */
export function getRuntimeFlagsRetryDelayMs(
  failureCount: number,
  error: unknown,
  random: Random = Math.random,
): number {
  const ceiling = Math.min(
    RUNTIME_FLAGS_RETRY_MAX_DELAY_MS,
    RUNTIME_FLAGS_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failureCount),
  );
  return Math.max(retryAfterMsOf(error), Math.round(random() * ceiling));
}

/**
 * Interval of the background re-check while no value is known: grows from
 * 10s to 60s per failed round, with equal jitter so it never drops to zero.
 */
export function getRuntimeFlagsErrorRefetchIntervalMs(
  failedRounds: number,
  error: unknown,
  random: Random = Math.random,
): number {
  const ceiling = Math.min(
    RUNTIME_FLAGS_ERROR_REFETCH_MAX_INTERVAL_MS,
    RUNTIME_FLAGS_ERROR_REFETCH_INTERVAL_MS * 2 ** Math.max(0, failedRounds - 1),
  );
  const jittered = Math.round(ceiling / 2 + random() * (ceiling / 2));
  return Math.max(retryAfterMsOf(error), jittered);
}

// The observer re-reads refetchInterval on every render and restarts its timer
// whenever the value changes, so the jittered value is drawn once per failed
// round of each query instead of on every call.
const errorRefetchPlans = new WeakMap<
  Query<RuntimeFlags>,
  { failedRounds: number; intervalMs: number }
>();

function planErrorRefetchInterval(query: Query<RuntimeFlags>): number | false {
  const { data, status, errorUpdateCount, error } = query.state;
  if (data !== undefined || status !== 'error') {
    errorRefetchPlans.delete(query);
    return false;
  }

  const planned = errorRefetchPlans.get(query);
  if (planned?.failedRounds === errorUpdateCount) {
    return planned.intervalMs;
  }

  const intervalMs = getRuntimeFlagsErrorRefetchIntervalMs(
    errorUpdateCount,
    error,
  );
  errorRefetchPlans.set(query, { failedRounds: errorUpdateCount, intervalMs });
  return intervalMs;
}

/** How long before a booking start the server clock sample is refreshed. */
export const SERVER_CLOCK_RESYNC_LEAD_MS = 30_000;
/** Per-client spread so open pages do not all re-check at the same second. */
export const SERVER_CLOCK_RESYNC_SPREAD_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface ResyncPlan {
  targetMs: number;
  /** Server instant of the re-read, jitter included. */
  resyncAtMs: number;
  /** The re-read already ran; a later offset change must not trigger another one. */
  done: boolean;
}

export interface UseRuntimeFlagsOptions {
  /**
   * A server instant (for example a booking start) the page acts on. The flags are
   * re-read once 20–30 seconds before it: the response carries a fresh `serverNow`,
   * so a slow first clock sample taken under load is replaced by a tighter one
   * before the CTA opens (lib/server-clock.ts keeps the sample with the smaller RTT).
   */
  resyncClockBeforeMs?: number | null;
}

export function useRuntimeFlags(options: UseRuntimeFlagsOptions = {}) {
  const locale = useLocale();
  const query = useQuery({
    queryKey: RUNTIME_FLAGS_QUERY_KEY,
    queryFn: () => fetchRuntimeFlags(),
    // No placeholder data: a failed request must stay an error (and keep the
    // last good value on refetch) instead of looking like "booking disabled".
    staleTime: RUNTIME_FLAGS_STALE_TIME_MS,
    retry: RUNTIME_FLAGS_RETRY_COUNT,
    retryDelay: (failureCount, error) =>
      getRuntimeFlagsRetryDelayMs(failureCount, error),
    refetchInterval: planErrorRefetchInterval,
  });
  const isResolved = query.data !== undefined;
  const { refetch } = query;
  const resyncClockBeforeMs = options.resyncClockBeforeMs ?? null;
  // The delay is measured on the server clock, so it must be re-armed whenever a
  // sample corrects the offset: the first sample usually lands after mount, and a
  // device that is X seconds slow would otherwise re-check X seconds late.
  const serverClockOffsetMs = useServerClockOffsetMs();
  const resyncPlanRef = useRef<ResyncPlan | null>(null);

  useEffect(() => {
    if (resyncClockBeforeMs === null || !Number.isFinite(resyncClockBeforeMs)) return;
    // One jittered instant per target: re-arming after an offset change keeps it.
    let plan = resyncPlanRef.current;
    if (plan?.targetMs !== resyncClockBeforeMs) {
      plan = {
        targetMs: resyncClockBeforeMs,
        resyncAtMs: resyncClockBeforeMs - SERVER_CLOCK_RESYNC_LEAD_MS
          + Math.floor(Math.random() * SERVER_CLOCK_RESYNC_SPREAD_MS),
        done: false,
      };
      resyncPlanRef.current = plan;
    }
    const activePlan = plan;
    if (activePlan.done) return;

    let timer: number | null = null;
    const arm = () => {
      const delayMs = activePlan.resyncAtMs - getServerNowMs();
      // Already inside the window (the flags, and with them a clock sample, have
      // just been read) or too far away.
      if (delayMs <= 0 || delayMs > MAX_TIMEOUT_MS) return;
      timer = window.setTimeout(() => {
        timer = null;
        // Timers can fire early relative to the corrected clock; wait for it.
        if (getServerNowMs() < activePlan.resyncAtMs) {
          arm();
          return;
        }
        activePlan.done = true;
        void refetch();
      }, delayMs);
    };
    arm();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refetch, resyncClockBeforeMs, serverClockOffsetMs]);

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
