import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PerformanceCardData } from '@grabit/shared';
import { PerformanceCard } from '../performance-card';

const localeMock = vi.hoisted(() => ({
  activeLocale: 'ko',
}));

vi.mock('next-intl', () => ({
  useLocale: () => localeMock.activeLocale,
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

    expect(screen.getByText('2026.07.18 ~ 2026.07.18')).toBeDefined();
  });
});
