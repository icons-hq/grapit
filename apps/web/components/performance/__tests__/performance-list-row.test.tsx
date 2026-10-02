import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { PerformanceCardData } from '@grabit/shared';
import { PerformanceListRow } from '../performance-list-row';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test double for next/image
    <img alt={alt} {...props} />
  ),
}));

const NOW = Date.parse('2026-10-01T10:59:00.000Z');
const OPEN = '2026-10-01T11:00:00.000Z';

const row: PerformanceCardData = {
  id: 'performance-1',
  title: 'Girl Rules Fanmeet',
  genre: 'artist_celebrity',
  posterUrl: null,
  status: 'upcoming',
  startDate: '2026-10-09T15:00:00.000Z',
  endDate: '2026-10-09T15:00:00.000Z',
  venueName: 'Donghae Arts Center',
  minPrice: 50000,
  bookingStartsAt: OPEN,
};

function renderRow(performance: PerformanceCardData) {
  return render(
    <ul>
      <PerformanceListRow performance={performance} locale="en" bookingEnabled />
    </ul>,
  );
}

describe('PerformanceListRow sale status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches the badge and guidance to on sale when the booking start passes', () => {
    renderRow(row);
    expect(screen.getAllByLabelText('Status: Coming soon')).toHaveLength(2);
    expect(screen.getByText('Booking opens 2026.10.01 20:00 KST')).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getAllByLabelText('Status: On sale')).toHaveLength(2);
    expect(screen.queryByLabelText('Status: Coming soon')).toBeNull();
    expect(screen.queryByText(/Booking opens/)).toBeNull();
  });

  it('does not advertise a selling performance as on sale before its booking start', () => {
    renderRow({ ...row, status: 'selling' });

    expect(screen.getAllByLabelText('Status: Coming soon')).toHaveLength(2);
    expect(screen.queryByLabelText('Status: On sale')).toBeNull();
    expect(screen.getByText('Booking opens 2026.10.01 20:00 KST')).toBeDefined();
  });

  it('keeps the sitewide booking gate override after the booking start', () => {
    render(
      <ul>
        <PerformanceListRow performance={{ ...row, status: 'selling', bookingStartsAt: '2026-10-01T10:00:00.000Z' }} locale="en" bookingEnabled={false} />
      </ul>,
    );

    expect(screen.getAllByLabelText('Status: Coming soon')).toHaveLength(2);
    expect(screen.queryByText(/Booking opens/)).toBeNull();
  });
});
