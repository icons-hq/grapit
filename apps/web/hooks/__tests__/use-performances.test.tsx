import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Banner } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useHomeBanners } from '../use-performances';

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
