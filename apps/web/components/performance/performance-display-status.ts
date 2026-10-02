'use client';

import { useEffect, useState } from 'react';
import type { FetchStatus } from '@tanstack/react-query';
import type { PerformanceCardData, PerformanceStatus } from '@grabit/shared';

/** Browsers fire setTimeout immediately when the delay overflows a signed 32-bit int. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Wait a little after the booking start so the API catalog cache has expired. */
export const CATALOG_BOOKING_START_REFETCH_GRACE_MS = 5_000;
/** Spread list refetches so every open page does not hit the API at the opening second. */
export const CATALOG_BOOKING_START_REFETCH_SPREAD_MS = 55_000;

export function parseBookingStartMs(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const startsAtMs = Date.parse(value);
  return Number.isFinite(startsAtMs) ? startsAtMs : null;
}

/**
 * Buyer-facing sale status at `nowMs`, matching the API public catalog rule:
 * a booking start in the future always reads as upcoming (unless ended), and an
 * upcoming performance whose booking start has passed reads as selling.
 * The sitewide booking gate is applied separately by getDisplayPerformanceStatus.
 */
export function resolveTimeAwarePerformanceStatus(
  status: PerformanceStatus,
  bookingStartsAt: string | null | undefined,
  nowMs: number,
): PerformanceStatus {
  if (status === 'ended') return status;
  const startsAtMs = parseBookingStartMs(bookingStartsAt);
  if (startsAtMs === null) return status;
  if (startsAtMs > nowMs) return 'upcoming';
  return status === 'upcoming' ? 'selling' : status;
}

export function getNextBookingStartMs(
  values: ReadonlyArray<string | null | undefined>,
  afterMs: number,
): number | null {
  let next: number | null = null;
  for (const value of values) {
    const startsAtMs = parseBookingStartMs(value);
    if (startsAtMs === null || startsAtMs <= afterMs) continue;
    if (next === null || startsAtMs < next) next = startsAtMs;
  }
  return next;
}

/**
 * Current time for status display that re-renders exactly when the nearest
 * booking start passes, so badges and schedule copy flip without a reload.
 */
export function useBookingStartClock(
  bookingStartsAtValues: ReadonlyArray<string | null | undefined>,
): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const valuesKey = bookingStartsAtValues
    .filter((value): value is string => Boolean(value))
    .join('|');

  useEffect(() => {
    const next = getNextBookingStartMs(
      valuesKey ? valuesKey.split('|') : [],
      nowMs,
    );
    if (next === null) return;

    // A start already passed (for example data arriving after the opening
    // second) resolves with a zero delay instead of waiting for a reload.
    const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS);
    const timeout = window.setTimeout(() => setNowMs(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [valuesKey, nowMs]);

  return nowMs;
}

let clientRefetchJitterMs: number | null = null;

function getClientRefetchJitterMs(): number {
  if (clientRefetchJitterMs === null) {
    clientRefetchJitterMs = Math.floor(
      Math.random() * CATALOG_BOOKING_START_REFETCH_SPREAD_MS,
    );
  }
  return clientRefetchJitterMs;
}

type CatalogRefetchCards = ReadonlyArray<
  Pick<PerformanceCardData, 'status' | 'bookingStartsAt'>
>;

/**
 * Delay until the one refetch of a status-filtered catalog list. Rows move
 * between the upcoming and selling filters at their booking start, so the list
 * is refetched once, grace + per-client jitter after the nearest booking start
 * that was still pending when the list was fetched.
 *
 * The target is anchored to `fetchedAtMs`, not to the current time: TanStack
 * Query re-evaluates refetchInterval on every render, and a target derived from
 * "the next start after now" would disappear once the start passes, cancelling
 * the refetch whenever the page re-renders before it fires. A start within the
 * grace window before the fetch still counts as pending, because the API cache
 * may have served the pre-opening page right after the start.
 */
export function getCatalogBookingStartRefetchDelay(
  cards: CatalogRefetchCards | undefined,
  fetchedAtMs: number,
  nowMs: number = Date.now(),
  jitterMs: number = getClientRefetchJitterMs(),
): number | false {
  if (!cards?.length || !(fetchedAtMs > 0)) return false;
  const next = getNextBookingStartMs(
    cards
      .filter((card) => card.status !== 'ended')
      .map((card) => card.bookingStartsAt),
    fetchedAtMs - CATALOG_BOOKING_START_REFETCH_GRACE_MS,
  );
  if (next === null) return false;
  const refetchAtMs = next + CATALOG_BOOKING_START_REFETCH_GRACE_MS + jitterMs;
  // A target that already passed (for example a re-render after the tick was
  // missed) fires on the next tick rather than being dropped.
  return Math.min(Math.max(1, refetchAtMs - nowMs), MAX_TIMEOUT_MS);
}

type CatalogListQuery = {
  state: {
    data?: { data?: CatalogRefetchCards };
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    fetchStatus: FetchStatus;
  };
};

/**
 * TanStack Query refetchInterval for the status-filtered home list. The anchor
 * is the last settled fetch (success or error), so the refetch result, even a
 * failed one, moves the anchor past the start and polling stops.
 */
export function getCatalogListBookingStartRefetchInterval(
  query: CatalogListQuery,
): number | false {
  // An in-flight or offline-paused fetch re-arms the timer when it settles.
  if (query.state.fetchStatus !== 'idle') return false;
  return getCatalogBookingStartRefetchDelay(
    query.state.data?.data,
    Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt),
  );
}
