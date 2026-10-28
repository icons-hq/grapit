import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import type { SearchResponse } from '@grabit/shared';
import { getCatalogOptions } from '@/lib/performance/catalog-query';

export function useSearch() {
  const searchParams = useSearchParams();
  const locale = resolveVisibleCopyLocale(useLocale());
  const q = searchParams.get('q') ?? '';
  const filters = getCatalogOptions(searchParams);
  const { ended, page } = filters;
  const sort = ['latest', 'popular', 'date'].includes(searchParams.get('sort') ?? '') ? searchParams.get('sort')! : 'relevance';
  const params = new URLSearchParams({ q, page: String(page), locale, sort });
  for (const key of ['genre', 'status', 'region', 'venueId', 'dateFrom', 'dateTo'] as const) {
    if (filters[key]) params.set(key, filters[key]!);
  }
  if (ended) params.set('ended', 'true');
  const query = params.toString();

  return useQuery({
    queryKey: ['search', query],
    queryFn: () => {
      return apiClient.get<SearchResponse>(
        `/api/v1/search?${query}`,
      );
    },
    enabled: q.length > 0,
  });
}
