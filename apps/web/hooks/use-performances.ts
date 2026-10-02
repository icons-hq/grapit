import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import {
  PERFORMANCE_QUERY_MAX_PAGE,
  type PerformanceListResponse,
  type PerformanceWithDetails,
  type PerformanceCardData,
  type Banner,
  type PerformanceQuery,
} from '@grabit/shared';

/**
 * The catalog API rejects pages outside 1..PERFORMANCE_QUERY_MAX_PAGE with
 * 400. A hand-edited `?page=` URL shows an empty last page instead.
 */
export function clampCatalogPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), PERFORMANCE_QUERY_MAX_PAGE);
}

export function useBrowsePerformances(status: NonNullable<PerformanceQuery['status']>, page: number) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const requestPage = clampCatalogPage(page);
  return useQuery({
    queryKey: ['performances', 'browse', status, requestPage, locale],
    queryFn: () => apiClient.get<PerformanceListResponse>(`/api/v1/performances?${new URLSearchParams({
      genre: 'artist_celebrity', status, page: String(requestPage), limit: '12', ended: 'true', locale,
    })}`),
  });
}

type HomeBannerDeviceTarget = 'mobile' | 'desktop';

const DESKTOP_BANNER_QUERY = '(min-width: 768px)';

function subscribeBannerTarget(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mediaQueryList = window.matchMedia(DESKTOP_BANNER_QUERY);
  mediaQueryList.addEventListener('change', callback);
  return () => mediaQueryList.removeEventListener('change', callback);
}

function getBannerTargetSnapshot(): HomeBannerDeviceTarget | null {
  if (typeof window === 'undefined') return null;
  return window.matchMedia(DESKTOP_BANNER_QUERY).matches ? 'desktop' : 'mobile';
}

function getBannerTargetServerSnapshot(): HomeBannerDeviceTarget | null {
  return null;
}

function useHomeBannerDeviceTarget(): HomeBannerDeviceTarget | null {
  return useSyncExternalStore(
    subscribeBannerTarget,
    getBannerTargetSnapshot,
    getBannerTargetServerSnapshot,
  );
}

export function usePerformances(genre: string) {
  const searchParams = useSearchParams();
  const locale = resolveVisibleCopyLocale(useLocale());
  const page = clampCatalogPage(Number(searchParams.get('page') ?? '1'));
  const sort = (searchParams.get('sort') ?? 'latest') as 'latest' | 'popular';
  const ended = searchParams.get('ended') === 'true';

  return useQuery({
    queryKey: ['performances', genre, page, sort, ended, locale],
    queryFn: () => {
      const params = new URLSearchParams({
        genre,
        page: String(page),
        sort,
        locale,
      });
      if (ended) params.set('ended', 'true');
      return apiClient.get<PerformanceListResponse>(
        `/api/v1/performances?${params.toString()}`,
      );
    },
  });
}

export function usePerformanceDetail(id: string) {
  const locale = resolveVisibleCopyLocale(useLocale());
  return useQuery({
    queryKey: ['performance', id, locale],
    queryFn: () =>
      apiClient.get<PerformanceWithDetails>(
        `/api/v1/performances/${id}?locale=${encodeURIComponent(locale)}`,
      ),
    enabled: !!id,
  });
}

export function useHomeBanners() {
  const target = useHomeBannerDeviceTarget();

  return useQuery({
    queryKey: ['home', 'banners', target],
    enabled: target !== null,
    queryFn: async () => {
      const banners = await apiClient.get<Banner[]>('/api/v1/home/banners');
      return banners.filter(
        (banner) =>
          banner.deviceTarget === 'all' || banner.deviceTarget === target,
      );
    },
  });
}

export function useHotPerformances() {
  const locale = resolveVisibleCopyLocale(useLocale());
  return useQuery({
    queryKey: ['home', 'hot', locale],
    queryFn: () =>
      apiClient.get<PerformanceCardData[]>(
        `/api/v1/home/hot?locale=${encodeURIComponent(locale)}`,
      ),
  });
}

export function useNewPerformances() {
  const locale = resolveVisibleCopyLocale(useLocale());
  return useQuery({
    queryKey: ['home', 'new', locale],
    queryFn: () =>
      apiClient.get<PerformanceCardData[]>(
        `/api/v1/home/new?locale=${encodeURIComponent(locale)}`,
      ),
  });
}
