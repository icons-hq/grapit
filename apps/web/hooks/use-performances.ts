import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import type {
  PerformanceListResponse,
  PerformanceWithDetails,
  PerformanceCardData,
  Banner,
} from '@grabit/shared';

export function usePerformances(genre: string) {
  const searchParams = useSearchParams();
  const locale = resolveVisibleCopyLocale(useLocale());
  const page = Number(searchParams.get('page') ?? '1');
  const sort = (searchParams.get('sort') ?? 'latest') as 'latest' | 'popular';
  const sub = searchParams.get('sub') ?? '';
  const ended = searchParams.get('ended') === 'true';

  return useQuery({
    queryKey: ['performances', genre, page, sort, sub, ended, locale],
    queryFn: () => {
      const params = new URLSearchParams({
        genre,
        page: String(page),
        sort,
        locale,
      });
      if (sub) params.set('sub', sub);
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
  return useQuery({
    queryKey: ['home', 'banners'],
    queryFn: () => apiClient.get<Banner[]>('/api/v1/home/banners'),
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
