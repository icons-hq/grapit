'use client';
import { useLocale } from 'next-intl';
import type { PerformanceListResponse, PerformanceQuery } from '@grabit/shared';
import { CatalogFilters, MobileCatalogFilters, type FilterUpdates } from './catalog-filters';
import { PerformanceCard } from './performance-card';
import { PaginationNav } from './pagination-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export function CatalogResults({ data, isLoading, isError, retry, value, update, reset, fixedGenre, upcoming, search, currentSort, compact = false }: {
  data?: PerformanceListResponse; isLoading: boolean; isError: boolean; retry: () => void;
  value: Partial<PerformanceQuery>; update: (updates: FilterUpdates) => void; reset: () => void; fixedGenre?: boolean; upcoming?: boolean; search?: boolean; currentSort?: string; compact?: boolean;
}) {
  const locale = useLocale();
  const copy = getTicketCopy(locale);
  const labels = getVisibleCopy(locale);
  const filters = { value, onChange: update, onReset: reset, fixedGenre, hideStatus: upcoming };
  return <div className={`ticket-results-layout${compact ? ' ticket-results-compact' : ''}`}>
    {!compact && <CatalogFilters {...filters} />}
    <div className="min-w-0">
      <div className="ticket-results-toolbar"><h2 aria-live="polite">{data ? `${data.total} ${copy.results}` : copy.browse}</h2>
        <div className="flex items-center gap-2"><MobileCatalogFilters {...filters} />
          <select aria-label={labels.genrePage.sort.ariaLabel} value={currentSort ?? value.sort ?? (search ? 'relevance' : 'latest')} onChange={(event) => update({ sort: event.target.value })}>
            {search && <option value="relevance">{copy.relevance}</option>}
            {upcoming && <option value="opening">{copy.openingOrder}</option>}
            <option value="latest">{copy.latest}</option><option value="popular">{copy.popular}</option><option value="date">{copy.dateOrder}</option>
          </select>
        </div>
      </div>
      {isError ? <div className="ticket-empty" role="alert"><p>{copy.loadError}</p><button type="button" onClick={retry}>{copy.retry}</button></div>
        : isLoading ? <div className="ticket-product-grid" role="status" aria-label={labels.home.loading}>{Array.from({ length: 8 },(_,i) => <div key={i}><Skeleton className="aspect-[3/4] w-full rounded-2xl" /><Skeleton className="mt-3 h-5 w-full" /></div>)}</div>
          : !data?.data.length ? <div className="ticket-empty" role="status"><p>{upcoming ? copy.noUpcoming : copy.noShows}</p><span>{copy.noShowsBody}</span><button type="button" onClick={reset}>{copy.reset}</button></div>
            : <div className="ticket-product-grid">{data.data.map((performance, index) => <PerformanceCard key={performance.id} performance={performance} priority={index < 2} variant={upcoming ? 'opening' : 'poster'} />)}</div>}
      {data && data.totalPages > 1 && !isError && <div className="ticket-pagination"><PaginationNav currentPage={data.page} totalPages={data.totalPages} onPageChange={(page) => update({ page: String(page) })}
        labels={{ navigation: labels.search.paginationNav, previous: copy.previous, next: copy.next }} /></div>}
    </div>
  </div>;
}
