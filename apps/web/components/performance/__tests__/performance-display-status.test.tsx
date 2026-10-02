import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  CATALOG_BOOKING_START_REFETCH_GRACE_MS,
  getCatalogBookingStartRefetchDelay,
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
  it('refetches once shortly after the nearest future booking start in the page', () => {
    const cards = [
      { status: 'upcoming' as const, bookingStartsAt: '2026-10-01T12:00:00.000Z' },
      { status: 'selling' as const, bookingStartsAt: OPEN },
      { status: 'selling' as const, bookingStartsAt: PAST },
      { status: 'upcoming' as const, bookingStartsAt: null },
    ];

    expect(getCatalogBookingStartRefetchDelay(cards, NOW, 7_000)).toBe(
      60_000 + CATALOG_BOOKING_START_REFETCH_GRACE_MS + 7_000,
    );
  });

  it('does not poll when no row is waiting for a booking start', () => {
    expect(getCatalogBookingStartRefetchDelay(undefined, NOW, 0)).toBe(false);
    expect(getCatalogBookingStartRefetchDelay([], NOW, 0)).toBe(false);
    expect(getCatalogBookingStartRefetchDelay([
      { status: 'selling', bookingStartsAt: PAST },
      { status: 'ended', bookingStartsAt: OPEN },
    ], NOW, 0)).toBe(false);
  });
});
