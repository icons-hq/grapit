import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_QUERY_MAX_PAGE,
  type Banner,
  type PerformanceListResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { CATALOG_BOOKING_START_REFETCH_GRACE_MS } from '@/components/performance/performance-display-status';
import {
  clampCatalogPage,
  useBrowsePerformances,
  useHomeBanners,
  usePerformances,
} from '../use-performances';

const navigation = vi.hoisted(() => ({ search: '' }));

vi.mock('next-intl', () => ({
  useLocale: () => 'ko',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
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

describe('catalog page bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigation.search = '';
    (apiClient.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [], total: 0, page: 1, limit: 20, totalPages: 0,
    });
  });

  function requestedPage() {
    const [url] = (apiClient.get as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    return new URL(String(url), 'https://heygrabit.test').searchParams.get('page');
  }

  it('clamps out-of-range pages to what the API accepts', () => {
    expect(clampCatalogPage(PERFORMANCE_QUERY_MAX_PAGE + 1)).toBe(PERFORMANCE_QUERY_MAX_PAGE);
    expect(clampCatalogPage(0)).toBe(1);
    expect(clampCatalogPage(Number.NaN)).toBe(1);
    expect(clampCatalogPage(2.7)).toBe(2);
  });

  it('requests the last allowed genre page for a hand-edited ?page= above the API limit', async () => {
    navigation.search = `page=${PERFORMANCE_QUERY_MAX_PAGE + 4000}`;

    const { result } = renderHook(() => usePerformances('artist_celebrity'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedPage()).toBe(String(PERFORMANCE_QUERY_MAX_PAGE));
  });

  it('requests page 1 for a non-numeric ?page= instead of an invalid query', async () => {
    navigation.search = 'page=abc';

    const { result } = renderHook(() => usePerformances('artist_celebrity'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedPage()).toBe('1');
  });

  it('clamps the home browse page as well', async () => {
    const { result } = renderHook(
      () => useBrowsePerformances('selling', PERFORMANCE_QUERY_MAX_PAGE + 1),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedPage()).toBe(String(PERFORMANCE_QUERY_MAX_PAGE));
  });
});

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
  const OPEN_MS = Date.parse('2026-10-01T11:00:00.000Z');
  const REFETCH_AT_MS = OPEN_MS + CATALOG_BOOKING_START_REFETCH_GRACE_MS;
  const row = {
    id: 'opening', title: 'Opening', genre: 'artist_celebrity' as const, posterUrl: null, status: 'upcoming' as const,
    startDate: '2026-10-09T15:00:00.000Z', endDate: '2026-10-09T15:00:00.000Z', venueName: null,
    bookingStartsAt: '2026-10-01T11:00:00.000Z',
  };
  const page: PerformanceListResponse = { data: [row], total: 1, page: 1, limit: 12, totalPages: 1 };
  const get = apiClient.get as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(OPEN_MS - 60_000);
    // Jitter 0: the refetch lands exactly grace after the booking start.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    get.mockReset();
    get.mockResolvedValue(page);
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function advanceTo(timeMs: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(timeMs - Date.now());
    });
  }

  it('refetches the filtered list after the nearest booking start in the page passes', async () => {
    renderHook(() => useBrowsePerformances('upcoming', 1), { wrapper: createWrapper() });
    await advanceTo(Date.now());
    expect(get).toHaveBeenCalledTimes(1);

    await advanceTo(REFETCH_AT_MS - 1);
    expect(get).toHaveBeenCalledTimes(1);

    // Even if the refetch still carries the opened row, its start is before the
    // new fetch time, so the list stops polling.
    get.mockResolvedValue({ ...page, data: [{ ...row, status: 'selling' }] });
    await advanceTo(REFETCH_AT_MS);
    expect(get).toHaveBeenCalledTimes(2);

    await advanceTo(REFETCH_AT_MS + 10 * 60_000);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps the refetch when the page re-renders between the booking start and the refetch', async () => {
    const { rerender } = renderHook(() => useBrowsePerformances('selling', 1), { wrapper: createWrapper() });
    await advanceTo(Date.now());
    expect(get).toHaveBeenCalledTimes(1);

    // For example typing in the search box re-renders HomePage one second after the start.
    await advanceTo(OPEN_MS + 1_000);
    rerender();
    await advanceTo(OPEN_MS + 2_000);
    rerender();

    await advanceTo(REFETCH_AT_MS);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('refetches in a background tab because window focus does not refetch', async () => {
    renderHook(() => useBrowsePerformances('upcoming', 1), { wrapper: createWrapper() });
    await advanceTo(Date.now());
    expect(get).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await advanceTo(REFETCH_AT_MS);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not refetch the unfiltered list, whose rows do not move at the booking start', async () => {
    renderHook(() => useBrowsePerformances('all', 1), { wrapper: createWrapper() });
    await advanceTo(Date.now());
    expect(get).toHaveBeenCalledTimes(1);

    await advanceTo(REFETCH_AT_MS + 10 * 60_000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
