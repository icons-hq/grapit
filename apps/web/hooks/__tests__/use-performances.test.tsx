import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Banner, PerformanceListResponse } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { CATALOG_BOOKING_START_REFETCH_GRACE_MS } from '@/components/performance/performance-display-status';
import { useBrowsePerformances, useHomeBanners } from '../use-performances';

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function mockMatchMedia(isDesktop: boolean) {
  const mediaQueryList = {
    matches: isDesktop,
    media: '(min-width: 768px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQueryList),
  });
}

function banner(id: string, deviceTarget: Banner['deviceTarget']): Banner {
  return {
    id,
    imageUrl: `https://r2.example.com/banners/${id}.jpg`,
    linkUrl: null,
    placement: 'home_hero',
    deviceTarget,
    status: 'active',
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
    isActive: true,
  };
}

describe('useHomeBanners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mobile and all banners on mobile viewports', async () => {
    mockMatchMedia(false);
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      banner('desktop-only', 'desktop'),
      banner('mobile-only', 'mobile'),
      banner('shared', 'all'),
    ]);

    const { result } = renderHook(() => useHomeBanners(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((item) => item.id)).toEqual([
      'mobile-only',
      'shared',
    ]);
  });

  it('returns desktop and all banners on desktop viewports', async () => {
    mockMatchMedia(true);
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue([
      banner('desktop-only', 'desktop'),
      banner('mobile-only', 'mobile'),
      banner('shared', 'all'),
    ]);

    const { result } = renderHook(() => useHomeBanners(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((item) => item.id)).toEqual([
      'desktop-only',
      'shared',
    ]);
  });
});

describe('useBrowsePerformances', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refetches the filtered list after the nearest booking start in the page passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T10:59:00.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const page: PerformanceListResponse = {
      data: [{
        id: 'opening', title: 'Opening', genre: 'artist_celebrity', posterUrl: null, status: 'upcoming',
        startDate: '2026-10-09T15:00:00.000Z', endDate: '2026-10-09T15:00:00.000Z', venueName: null,
        bookingStartsAt: '2026-10-01T11:00:00.000Z',
      }],
      total: 1, page: 1, limit: 12, totalPages: 1,
    };
    const get = apiClient.get as ReturnType<typeof vi.fn>;
    get.mockReset();
    get.mockResolvedValue(page);

    renderHook(() => useBrowsePerformances('upcoming', 1), { wrapper: createWrapper() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + CATALOG_BOOKING_START_REFETCH_GRACE_MS - 1);
    });
    expect(get).toHaveBeenCalledTimes(1);

    get.mockResolvedValue({ ...page, data: [] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(get).toHaveBeenCalledTimes(2);

    // Once no row is waiting for a booking start the list stops polling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
