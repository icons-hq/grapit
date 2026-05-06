import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PerformanceWithDetails } from '@grabit/shared';
import PerformanceDetailPage from '../page';

vi.mock('next-intl', () => ({
  useLocale: () => 'th',
}));

vi.mock('@/hooks/use-performances', () => ({
  usePerformanceDetail: () => ({
    data: fixturePerformance,
    isLoading: false,
    isError: false,
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

const fixturePerformance: PerformanceWithDetails = {
  id: 'perf-23-14',
  title: 'Girl Rules Fanmeet',
  genre: 'concert',
  subcategory: null,
  venueId: 'venue-1',
  posterUrl: null,
  description: 'Fanmeet fixture',
  startDate: '2026-07-04T09:00:00.000Z',
  endDate: '2026-07-04T12:00:00.000Z',
  runtime: '120분',
  ageRating: '만 7세 이상',
  status: 'selling',
  salesInfo: null,
  viewCount: 10,
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
  venue: {
    id: 'venue-1',
    name: 'Bangkok Hall',
    address: null,
  },
  priceTiers: [
    {
      id: 'tier-vip',
      performanceId: 'perf-23-14',
      tierName: 'VIP',
      price: 110000,
      sortOrder: 0,
    },
  ],
  showtimes: [],
  castings: [],
  seatMap: null,
};

describe('PerformanceDetailPage i18n formatting', () => {
  it('renders the visible detail surface with KST/KRW anchors and estimated pricing disclaimer', async () => {
    const params = Promise.resolve({ id: 'perf-23-14' }) as Promise<{
      id: string;
    }> & {
      status: 'fulfilled';
      value: { id: string };
    };
    params.status = 'fulfilled';
    params.value = { id: 'perf-23-14' };

    render(
      <Suspense fallback={<div>loading</div>}>
        <PerformanceDetailPage params={params} />
      </Suspense>,
    );

    expect(await screen.findAllByText(/KST/)).toHaveLength(2);
    expect(screen.getByText('KRW 110,000')).toBeDefined();
    expect(screen.getByText(/THB/)).toBeDefined();
    expect(screen.getByText(/exchange rate may change|환율/)).toBeDefined();
  });
});
