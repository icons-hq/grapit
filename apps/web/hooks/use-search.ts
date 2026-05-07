import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import type { SearchResponse } from '@grabit/shared';

export function useSearch() {
  const searchParams = useSearchParams();
  const locale = resolveVisibleCopyLocale(useLocale());
  const q = searchParams.get('q') ?? '';
  const genre = searchParams.get('genre') ?? '';
  const ended = searchParams.get('ended') === 'true';
  const page = Number(searchParams.get('page') ?? '1');

  return useQuery({
    queryKey: ['search', q, genre, ended, page, locale],
    queryFn: () => {
      const params = new URLSearchParams({ q, page: String(page), locale });
      if (genre) params.set('genre', genre);
      if (ended) params.set('ended', 'true');
      return apiClient.get<SearchResponse>(
        `/api/v1/search?${params.toString()}`,
      );
    },
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}
