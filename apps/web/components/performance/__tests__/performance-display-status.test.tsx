import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_BOOKING_START_REFETCH_GRACE_MS,
  CATALOG_BOOKING_START_REFETCH_SPREAD_MS,
  getCatalogBookingStartRefetchDelay,
  getCatalogListBookingStartRefetchInterval,
  resetCatalogRefetchJitterForTests,
  resolveTimeAwarePerformanceStatus,
} from '../performance-display-status';
import { recordServerTimeSample, resetServerClockForTests } from '@/lib/server-clock';

const NOW = Date.parse('2026-10-01T10:59:00.000Z');
const OPEN = '2026-10-01T11:00:00.000Z';
const PAST = '2026-10-01T10:00:00.000Z';

describe('resolveTimeAwarePerformanceStatus', () => {
  it.each([
    ['upcoming', OPEN, 'upcoming'],
    ['upcoming', PAST, 'selling'],
    ['upcoming', null, 'upcoming'],
    // An operator marking a performance selling before its booking start must not read as on sale.
    ['selling', OPEN, 'upcoming'],
    ['closing_soon', OPEN, 'upcoming'],
    ['selling', PAST, 'selling'],
    ['closing_soon', PAST, 'closing_soon'],
    ['selling', null, 'selling'],
    ['ended', OPEN, 'ended'],
    ['ended', PAST, 'ended'],
    ['selling', 'not-a-date', 'selling'],
  ] as const)('%s with booking start %s reads as %s', (status, startsAt, expected) => {
    expect(resolveTimeAwarePerformanceStatus(status, startsAt, NOW)).toBe(expected);
  });

  it('flips exactly at the booking start instant', () => {
    const openMs = Date.parse(OPEN);
    expect(resolveTimeAwarePerformanceStatus('upcoming', OPEN, openMs - 1)).toBe('upcoming');
    expect(resolveTimeAwarePerformanceStatus('upcoming', OPEN, openMs)).toBe('selling');
  });
});

describe('getCatalogBookingStartRefetchDelay', () => {
  const openMs = Date.parse(OPEN);
  const GRACE = CATALOG_BOOKING_START_REFETCH_GRACE_MS;

  it('refetches once shortly after the nearest booking start pending at fetch time', () => {
    const cards = [
      { status: 'upcoming' as const, bookingStartsAt: '2026-10-01T12:00:00.000Z' },
      { status: 'selling' as const, bookingStartsAt: OPEN },
      { status: 'selling' as const, bookingStartsAt: PAST },
      { status: 'upcoming' as const, bookingStartsAt: null },
    ];

    expect(getCatalogBookingStartRefetchDelay(cards, NOW, NOW, 7_000)).toBe(
      60_000 + GRACE + 7_000,
    );
  });

  it('keeps the same target when re-evaluated after the booking start passed', () => {
    // TanStack Query recomputes refetchInterval on every render; a re-render one
    // second after the start must not drop the refetch scheduled at fetch time.
    const cards = [{ status: 'upcoming' as const, bookingStartsAt: OPEN }];
    expect(getCatalogBookingStartRefetchDelay(cards, NOW, openMs + 1_000, 7_000)).toBe(
      GRACE + 7_000 - 1_000,
    );
    // A target that already passed fires on the next tick instead of being dropped.
    expect(getCatalogBookingStartRefetchDelay(cards, NOW, openMs + 60_000, 7_000)).toBe(1);
  });

  it('still refetches a page fetched within the grace window after the start', () => {
    // The API cache can serve the pre-opening page right after the start.
    const cards = [{ status: 'upcoming' as const, bookingStartsAt: OPEN }];
    expect(getCatalogBookingStartRefetchDelay(cards, openMs + 1_000, openMs + 1_000, 0)).toBe(
      GRACE - 1_000,
    );
    expect(getCatalogBookingStartRefetchDelay(cards, openMs + GRACE, openMs + GRACE, 0)).toBe(false);
  });

  it('stops once the refetch settled after its target', () => {
    const cards = [{ status: 'selling' as const, bookingStartsAt: OPEN }];
    const refetchedAt = openMs + GRACE + 7_000;
    expect(getCatalogBookingStartRefetchDelay(cards, refetchedAt, refetchedAt, 7_000)).toBe(false);
  });

  it('does not poll when no row is waiting for a booking start', () => {
    expect(getCatalogBookingStartRefetchDelay(undefined, NOW, NOW, 0)).toBe(false);
    expect(getCatalogBookingStartRefetchDelay([], NOW, NOW, 0)).toBe(false);
    expect(getCatalogBookingStartRefetchDelay([
      { status: 'selling', bookingStartsAt: PAST },
      { status: 'ended', bookingStartsAt: OPEN },
    ], NOW, NOW, 0)).toBe(false);
  });
});

describe('getCatalogListBookingStartRefetchInterval', () => {
  const page = { data: [{ status: 'upcoming' as const, bookingStartsAt: OPEN }] };
  const GRACE = CATALOG_BOOKING_START_REFETCH_GRACE_MS;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Jitter 0, drawn fresh for this test instead of whatever an earlier test cached.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    resetCatalogRefetchJitterForTests();
    resetServerClockForTests();
  });

  afterEach(() => {
    resetServerClockForTests();
    resetCatalogRefetchJitterForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('anchors on the latest settled fetch, including a failed refetch', () => {
    const openMs = Date.parse(OPEN);
    expect(getCatalogListBookingStartRefetchInterval({
      state: { data: page, dataUpdatedAt: NOW, errorUpdatedAt: 0, fetchStatus: 'idle' },
    })).toBe(openMs - NOW + GRACE);
    // A refetch that failed after the target must not retry every millisecond.
    expect(getCatalogListBookingStartRefetchInterval({
      state: {
        data: page,
        dataUpdatedAt: NOW,
        errorUpdatedAt: openMs + CATALOG_BOOKING_START_REFETCH_GRACE_MS + CATALOG_BOOKING_START_REFETCH_SPREAD_MS,
        fetchStatus: 'idle',
      },
    })).toBe(false);
  });

  it('waits for an in-flight or paused fetch to settle', () => {
    for (const fetchStatus of ['fetching', 'paused'] as const) {
      expect(getCatalogListBookingStartRefetchInterval({
        state: { data: page, dataUpdatedAt: NOW, errorUpdatedAt: 0, fetchStatus },
      })).toBe(false);
    }
  });

  it('does not schedule before any fetch settled, whatever the clock offset', () => {
    recordServerTimeSample({ serverNowMs: NOW + 90_100, requestStartedAtMs: NOW, responseReceivedAtMs: NOW + 200 });
    expect(getCatalogListBookingStartRefetchInterval({
      state: { data: page, dataUpdatedAt: 0, errorUpdatedAt: 0, fetchStatus: 'idle' },
    })).toBe(false);
  });

  it.each([
    ['runs 90 seconds fast', -90_000],
    ['runs 90 seconds slow', 90_000],
  ])('refetches at the server booking start when the device clock %s', (_name, offsetMs) => {
    const openMs = Date.parse(OPEN);
    // The device reads NOW; the server is offsetMs ahead of it.
    recordServerTimeSample({
      serverNowMs: NOW + offsetMs + 100,
      requestStartedAtMs: NOW,
      responseReceivedAtMs: NOW + 200,
    });
    const serverNowMs = NOW + offsetMs;
    const delay = getCatalogListBookingStartRefetchInterval({
      state: { data: page, dataUpdatedAt: NOW, errorUpdatedAt: 0, fetchStatus: 'idle' },
    });

    if (serverNowMs > openMs + GRACE) {
      // The page was fetched on the server clock after the start: nothing left to wait for.
      expect(delay).toBe(false);
    } else {
      expect(delay).toBe(openMs + GRACE - serverNowMs);
    }
  });

  it('keeps polling a page fetched before the server start even on a fast device clock', () => {
    const openMs = Date.parse(OPEN);
    // Device runs 90s fast: it reads OPEN + 30s while the server is still 60s before OPEN.
    vi.setSystemTime(openMs + 30_000);
    recordServerTimeSample({
      serverNowMs: openMs - 60_000 + 100,
      requestStartedAtMs: openMs + 30_000,
      responseReceivedAtMs: openMs + 30_200,
    });

    expect(getCatalogListBookingStartRefetchInterval({
      state: { data: page, dataUpdatedAt: openMs + 30_000, errorUpdatedAt: 0, fetchStatus: 'idle' },
    })).toBe(60_000 + GRACE);
  });
});
