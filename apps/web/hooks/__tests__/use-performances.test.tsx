import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERFORMANCE_QUERY_MAX_PAGE, type Banner } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
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
