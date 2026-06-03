'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { GENRES, type Genre } from '@grabit/shared';
import { Switch } from '@/components/ui/switch';
import { SortToggle } from '@/components/performance/sort-toggle';
import { PerformanceGrid } from '@/components/performance/performance-grid';
import { PaginationNav } from '@/components/performance/pagination-nav';
import { usePerformances } from '@/hooks/use-performances';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';

function isValidGenre(genre: string): genre is Genre {
  return (GENRES as readonly string[]).includes(genre);
}

export default function GenrePage({
  params,
}: {
  params: Promise<{ genre: string }>;
}) {
  const { genre } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const copy = getVisibleCopy(useLocale());

  if (!isValidGenre(genre)) {
    notFound();
  }

  const sort = (searchParams.get('sort') ?? 'latest') as 'latest' | 'popular';
  const ended = searchParams.get('ended') === 'true';

  const { data, isLoading, isError } = usePerformances(genre);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Reset page on filter change (except page changes)
    if (key !== 'page') {
      params.delete('page');
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
      {/* Page title */}
      <h1 className="text-display font-semibold leading-[1.2]">
        {copy.genrePage.title.replace('{genre}', copy.genres[genre])}
      </h1>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SortToggle
          value={sort}
          onChange={(v) => updateParam('sort', v)}
          labels={copy.genrePage.sort}
        />
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

      {/* Performance grid */}
      <div className="mt-8">
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
            emptyHeading={copy.genrePage.emptyHeading}
            emptyBody={copy.genrePage.emptyBody}
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
