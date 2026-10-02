'use client';

import { useEffect, useState } from 'react';
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

/**
 * TanStack Query refetchInterval for status-filtered catalog lists. Rows move
 * between the upcoming and selling filters at their booking start, so the list
 * is refetched once shortly after the nearest future start in the current page.
 */
export function getCatalogBookingStartRefetchDelay(
  cards: ReadonlyArray<Pick<PerformanceCardData, 'status' | 'bookingStartsAt'>> | undefined,
  nowMs: number = Date.now(),
  jitterMs: number = getClientRefetchJitterMs(),
): number | false {
  if (!cards?.length) return false;
  const next = getNextBookingStartMs(
    cards
      .filter((card) => card.status !== 'ended')
      .map((card) => card.bookingStartsAt),
    nowMs,
  );
  if (next === null) return false;
  return Math.min(
    next - nowMs + CATALOG_BOOKING_START_REFETCH_GRACE_MS + jitterMs,
    MAX_TIMEOUT_MS,
  );
}
