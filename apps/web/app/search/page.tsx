'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { SearchIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { GenreChip } from '@/components/performance/genre-chip';
import { PerformanceGrid } from '@/components/performance/performance-grid';
import { PaginationNav } from '@/components/performance/pagination-nav';
import { useSearch } from '@/hooks/use-search';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { GENRES } from '@grabit/shared';

export default function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = getVisibleCopy(useLocale());
  const genreFilterChips = [
    { label: copy.search.allGenres, value: '' },
    ...GENRES.map((genre) => ({
      label: copy.genres[genre],
      value: genre,
    })),
  ];

  const q = searchParams.get('q') ?? '';
  const genre = searchParams.get('genre') ?? '';
  const ended = searchParams.get('ended') === 'true';

  const { data, isLoading, isError } = useSearch();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (key !== 'page') {
      params.delete('page');
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  // No query -- prompt to search
  if (!q) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-12 md:px-6 md:py-16">
        <div className="flex flex-col items-center">
          <SearchIcon className="h-12 w-12 text-gray-400" />
          <h1 className="mt-4 text-xl font-semibold text-gray-900">
            {copy.search.promptTitle}
          </h1>
          <p className="mt-2 text-sm text-gray-600">{copy.search.promptBody}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
      {/* Heading */}
      <h1 className="text-xl font-semibold text-gray-900">
        {copy.search.resultTitle.replace('{query}', q)}
      </h1>
      <p className="mt-1 h-5 text-sm text-gray-600">
        {data
          ? copy.search.totalCount.replace('{count}', String(data.total))
          : '\u00A0'}
      </p>

      {/* Genre filter chips */}
      <div className="mt-4 flex gap-2 overflow-x-auto scrollbar-hide">
        {genreFilterChips.map((chip) => (
          <GenreChip
            key={chip.value}
            label={chip.label}
            value={chip.value}
            isActive={genre === chip.value}
            onClick={() => updateParam('genre', chip.value)}
          />
        ))}
      </div>

      {/* Ended toggle */}
      <div className="mt-4 flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <span>{copy.search.includeEnded}</span>
          <Switch
            checked={ended}
            onCheckedChange={(checked: boolean) =>
              updateParam('ended', checked ? 'true' : '')
            }
          />
        </label>
      </div>

      {/* Results */}
      <div className="mt-6">
        {isError ? (
          <div className="flex flex-col items-center py-16">
            <p className="text-base text-gray-900">
              {copy.search.loadError}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 min-h-[44px] rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white"
            >
              {copy.search.retry}
            </button>
          </div>
        ) : (
          <PerformanceGrid
            performances={data?.data ?? []}
            isLoading={isLoading}
            emptyHeading={copy.search.emptyHeading}
            emptyBody={copy.search.emptyBody}
          />
        )}
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="mt-12">
          <PaginationNav
            currentPage={data.page}
            totalPages={data.totalPages}
            onPageChange={(page) => updateParam('page', String(page))}
          />
        </div>
      )}
    </main>
  );
}
