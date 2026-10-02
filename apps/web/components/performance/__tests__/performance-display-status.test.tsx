import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  CATALOG_BOOKING_START_REFETCH_GRACE_MS,
  CATALOG_BOOKING_START_REFETCH_SPREAD_MS,
  getCatalogBookingStartRefetchDelay,
  getCatalogListBookingStartRefetchInterval,
  resolveTimeAwarePerformanceStatus,
  useBookingStartClock,
} from '../performance-display-status';

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

function ClockProbe({ startsAt }: { startsAt: Array<string | null> }) {
  const nowMs = useBookingStartClock(startsAt);
  return (
    <span data-testid="status">
      {resolveTimeAwarePerformanceStatus('upcoming', startsAt[0], nowMs)}
    </span>
  );
}

describe('useBookingStartClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-renders when the booking start passes without a reload', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    render(<ClockProbe startsAt={[OPEN]} />);
    expect(screen.getByTestId('status').textContent).toBe('upcoming');

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(screen.getByTestId('status').textContent).toBe('upcoming');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('status').textContent).toBe('selling');
  });

  it('catches up when data with an already-passed start arrives after mount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { rerender } = render(<ClockProbe startsAt={[null]} />);

    // The response lands two seconds after the opening second.
    vi.setSystemTime(Date.parse(OPEN) + 2_000);
    rerender(<ClockProbe startsAt={[OPEN]} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('status').textContent).toBe('selling');
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

  it('anchors on the latest settled fetch, including a failed refetch', () => {
    const openMs = Date.parse(OPEN);
    expect(getCatalogListBookingStartRefetchInterval({
      state: { data: page, dataUpdatedAt: NOW, errorUpdatedAt: 0, fetchStatus: 'idle' },
    })).toBeGreaterThan(0);
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
});
