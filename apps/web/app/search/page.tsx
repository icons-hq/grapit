'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { SearchIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [searchValue, setSearchValue] = useState(q);

  const { data, isLoading, isError } = useSearch();

  useEffect(() => {
    setSearchValue(q);
  }, [q]);

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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = searchValue.trim();
    if (!nextQuery) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set('q', nextQuery);
    params.delete('page');
    router.replace(`${pathname}?${params.toString()}`);
  }

  const searchForm = (
    <form
      onSubmit={handleSearchSubmit}
      className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm"
      role="search"
    >
      <div className="relative min-w-0 flex-1">
        <SearchIcon
          className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-primary"
          aria-hidden="true"
        />
        <Input
          type="search"
          role="searchbox"
          aria-label={copy.nav.searchAriaLabel}
          placeholder={copy.nav.searchPlaceholder}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="h-11 rounded-lg border-0 bg-gray-50 pl-10 pr-3 text-sm font-semibold shadow-none focus-visible:ring-2"
        />
      </div>
      <Button type="submit" className="h-11 px-4">
        {copy.nav.search}
      </Button>
    </form>
  );

  // No query -- prompt to search
  if (!q) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
        {searchForm}
        <div className="flex flex-col items-center py-12 md:py-16">
          <SearchIcon className="h-12 w-12 text-gray-400" aria-hidden="true" />
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
      {searchForm}

      {/* Heading */}
      <h1 className="mt-6 text-xl font-semibold text-gray-900">
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
            labels={{
              navigation: copy.search.paginationNav,
              previous: copy.search.previousPage,
              next: copy.search.nextPage,
            }}
          />
        </div>
      )}
    </main>
  );
}
