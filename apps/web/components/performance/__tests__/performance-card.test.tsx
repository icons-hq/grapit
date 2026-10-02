import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { PerformanceCardData } from '@grabit/shared';
import { recordServerTimeSample, resetServerClockForTests } from '@/lib/server-clock';
import { PerformanceCard } from '../performance-card';

const localeMock = vi.hoisted(() => ({
  activeLocale: 'ko',
}));

const runtimeFlagsMock = vi.hoisted(() => ({
  bookingEnabled: true,
  isResolved: true,
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeMock.activeLocale,
}));

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: runtimeFlagsMock.bookingEnabled,
    isResolved: runtimeFlagsMock.isResolved,
  }),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    ...props
  }: {
    alt: string;
    [key: string]: unknown;
  }) => <img alt={alt} {...props} />,
}));

const basePerformance: PerformanceCardData = {
  id: 'performance-1',
  title: 'Girl Rules Fanmeet',
  genre: 'artist_celebrity',
  posterUrl: null,
  status: 'selling',
  startDate: '2026-07-18T05:00:00.000Z',
  endDate: '2026-07-18T07:00:00.000Z',
  venueName: '동해문화예술관',
};

describe('PerformanceCard', () => {
  beforeEach(() => {
    localeMock.activeLocale = 'ko';
    runtimeFlagsMock.bookingEnabled = true;
    runtimeFlagsMock.isResolved = true;
    resetServerClockForTests();
  });

  afterEach(() => {
    resetServerClockForTests();
    vi.useRealTimers();
  });

  it('judges the booking start on the server clock like the detail page', () => {
    vi.useFakeTimers();
    // Device 10:59:00 runs 90 seconds slow; the server is already past the start.
    const deviceNow = Date.parse('2026-07-01T10:59:00.000Z');
    vi.setSystemTime(deviceNow);
    recordServerTimeSample({
      serverNowMs: deviceNow + 90_000 + 100,
      requestStartedAtMs: deviceNow,
      responseReceivedAtMs: deviceNow + 200,
    });
    render(
      <PerformanceCard
        performance={{ ...basePerformance, status: 'upcoming', bookingStartsAt: '2026-07-01T11:00:00.000Z' }}
      />,
    );

    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
    expect(screen.getByText('2026. 7. 18. KST')).toBeDefined();
  });

  it('keeps the on-sale badge while the runtime flags have not loaded', () => {
    runtimeFlagsMock.bookingEnabled = false;
    runtimeFlagsMock.isResolved = false;

    render(<PerformanceCard performance={basePerformance} />);

    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
    expect(screen.queryByLabelText('상태: 오픈예정')).toBeNull();
  });

  it('shows the upcoming badge for a selling performance until its booking start, then the dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T10:59:00.000Z'));
    render(
      <PerformanceCard
        performance={{
          ...basePerformance,
          status: 'selling',
          bookingStartsAt: '2026-07-01T11:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByLabelText('상태: 오픈예정')).toBeDefined();
    expect(screen.queryByText('2026. 7. 18. KST')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByLabelText('상태: 오픈')).toBeDefined();
    expect(screen.getByText('2026. 7. 18. KST')).toBeDefined();
  });

  it('shows 오픈예정 instead of stored dates for upcoming performances', () => {
    render(
      <PerformanceCard
        performance={{
          ...basePerformance,
          status: 'upcoming',
        }}
      />,
    );

    expect(screen.getAllByText('오픈예정')).not.toHaveLength(0);
    expect(screen.queryByText(/2026\\.07\\.18/)).toBeNull();
  });

  it('localizes the upcoming date label outside Korean', () => {
    localeMock.activeLocale = 'en';
    render(
      <PerformanceCard
        performance={{
          ...basePerformance,
          status: 'upcoming',
        }}
      />,
    );

    expect(screen.getAllByText('Coming soon')).not.toHaveLength(0);
    expect(screen.queryByText('오픈예정')).toBeNull();
  });

  it('keeps date range visible for open performances', () => {
    render(<PerformanceCard performance={basePerformance} />);

    expect(screen.getByText('2026. 7. 18. KST')).toBeDefined();
  });

  it('shows 오픈예정 instead of 오픈 while booking is disabled', () => {
    runtimeFlagsMock.bookingEnabled = false;

    render(<PerformanceCard performance={basePerformance} />);

    expect(screen.getByLabelText('상태: 오픈예정')).toBeDefined();
    expect(screen.queryByLabelText('상태: 오픈')).toBeNull();
    expect(screen.queryByText('오픈')).toBeNull();
  });
});
