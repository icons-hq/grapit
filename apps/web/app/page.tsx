'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Search, Ticket } from 'lucide-react';
import type { PerformanceQuery } from '@grabit/shared';
import { BannerCarousel } from '@/components/home/banner-carousel';
import { PerformanceListRow } from '@/components/performance/performance-list-row';
import { PaginationNav } from '@/components/performance/pagination-nav';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrowsePerformances, useHomeBanners } from '@/hooks/use-performances';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

const FILTERS = ['all', 'selling', 'upcoming', 'ended'] as const;
type CatalogFilter = NonNullable<PerformanceQuery['status']>;

export default function HomePage() {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  const router = useRouter();
  const params = useSearchParams();
  const requestedFilter = params.get('status');
  const filter: CatalogFilter = FILTERS.includes(requestedFilter as CatalogFilter) ? requestedFilter as CatalogFilter : 'all';
  const parsedPage = Number(params.get('page') ?? '1');
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [search, setSearch] = useState('');
  const { data: banners, isLoading: bannersLoading } = useHomeBanners();
  const { data, isLoading, isError, refetch } = useBrowsePerformances(filter, page);
  const { bookingEnabled, isResolved: flagsResolved } = useRuntimeFlags();

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (search.trim()) router.push(`${getLocalizedPathname('/search', locale)}?q=${encodeURIComponent(search.trim())}`);
  }
  function updateCatalog(status: CatalogFilter, nextPage = 1) {
    const query = new URLSearchParams();
    if (status !== 'all') query.set('status', status);
    if (nextPage > 1) query.set('page', String(nextPage));
    router.replace(`${getLocalizedPathname('/', locale)}${query.size ? `?${query}` : ''}`, { scroll: false });
  }

  return <main className="mx-auto w-full max-w-[1280px] px-4 pb-12 sm:px-6 lg:px-10">
    <section className="mx-auto max-w-3xl py-9 text-center md:py-12">
      <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-5xl">{copy.home.intro}</h1>
      <form role="search" className="mx-auto mt-6 flex max-w-2xl items-center gap-2 rounded-lg border border-border bg-background p-2" onSubmit={submitSearch}>
        <Search className="ml-2 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input type="search" aria-label={copy.home.searchLabel} placeholder={copy.home.searchLabel} value={search}
          onChange={(event) => setSearch(event.target.value)} className="min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0" />
        <Button type="submit" className="shrink-0">{copy.nav.search}</Button>
      </form>
      <div className="mt-4 flex justify-center gap-6 text-sm text-muted-foreground">
        <Link className="inline-flex items-center gap-2 underline-offset-4 hover:underline" href={`${getLocalizedPathname('/mypage', locale)}?tab=wallet`}><Ticket className="size-4" aria-hidden="true" />{copy.home.myTickets}</Link>
        <Link className="underline-offset-4 hover:underline" href={getLocalizedPathname('/support', locale)}>{copy.home.guide}</Link>
      </div>
    </section>

    {bannersLoading ? <Skeleton className="aspect-[1290/600] w-full rounded-xl md:max-h-[400px]" />
      : banners?.length ? <BannerCarousel banners={banners} locale={locale} /> : null}

    <section className="mt-9 md:mt-12" aria-labelledby="browse-events-heading">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-4">
        <h2 id="browse-events-heading" className="text-2xl font-bold tracking-tight md:text-3xl">{copy.home.browse}</h2>
        <div role="group" aria-label={copy.home.browse} className="flex max-w-full gap-1 overflow-x-auto">
          {FILTERS.map((status) => <button key={status} type="button" aria-pressed={filter === status} onClick={() => updateCatalog(status)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${filter === status ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {copy.home[status]}
          </button>)}
        </div>
      </div>
      {flagsResolved && !bookingEnabled && <p role="status" className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">{copy.home.bookingPaused}</p>}
      {isLoading ? <div role="status" aria-label={copy.home.loading} className="space-y-4 py-6">{[0,1,2].map((key) => <Skeleton key={key} className="h-32 w-full rounded-md" />)}</div>
        : isError ? <div role="alert" className="py-12 text-center"><p>{copy.home.loadError}</p><Button className="mt-4" variant="outline" onClick={() => void refetch()}>{copy.commonErrors.retry}</Button></div>
        : data?.data.length ? <ul>{data.data.map((performance) => <PerformanceListRow key={performance.id} performance={performance} locale={locale} bookingEnabled={bookingEnabled} />)}</ul>
        : <p role="status" className="py-12 text-center text-muted-foreground">{copy.home.emptyFiltered}</p>}
      {data && data.totalPages > 1 && !isError && <div className="mt-8"><PaginationNav currentPage={data.page} totalPages={data.totalPages} onPageChange={(nextPage) => updateCatalog(filter, nextPage)} labels={{ navigation: copy.search.paginationNav, previous: copy.search.previousPage, next: copy.search.nextPage }} /></div>}
    </section>
  </main>;
}
