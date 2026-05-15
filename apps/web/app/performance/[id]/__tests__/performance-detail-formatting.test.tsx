import { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/hooks/use-runtime-flags', () => ({
  useRuntimeFlags: () => ({
    bookingEnabled: true,
    isLoading: false,
    bookingDisabledMessage: 'Ticket booking will open later',
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
  genre: 'artist_celebrity',
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
  seatMaps: [],
  bookingPolicy: {
    maxTicketsPerUser: 1,
    allowedPaymentMethods: ['CARD'],
    changePolicyEnabled: false,
    paymentWindowMinutes: 7,
    seatHoldMinutes: 10,
    cancelledSeatHoldMinMinutes: 1,
    cancelledSeatHoldMaxMinutes: 10,
    manualOpenEnabled: true,
  },
  seatMap: null,
};

describe('PerformanceDetailPage i18n formatting', () => {
  beforeEach(() => {
    fixturePerformance.status = 'selling';
  });

  it('renders the visible detail surface with KST anchors and KRW-only pricing', async () => {
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
    expect(screen.queryByText(/THB|USD|approx/i)).toBeNull();
    expect(screen.queryByText(/exchange rate may change|환율/)).toBeNull();
  });

  it('shows only detail and sales tabs for fanmeeting-focused detail pages', async () => {
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

    expect(await screen.findByRole('tab', { name: 'รายละเอียด' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'ข้อมูลการขาย' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: '캐스팅' })).toBeNull();
  });

  it('shows 오픈예정 instead of date anchors for upcoming performances', async () => {
    fixturePerformance.status = 'upcoming';
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

    expect(await screen.findAllByText('오픈예정')).not.toHaveLength(0);
    expect(screen.queryByText(/KST/)).toBeNull();
  });
});
