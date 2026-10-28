'use client';
import { useLocale } from 'next-intl';
import { GenreTabs } from '@/components/performance/genre-tabs';
import { PerformanceCard } from '@/components/performance/performance-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCatalogNavigation } from '@/hooks/use-catalog-navigation';
import { useCatalogPerformances } from '@/hooks/use-performances';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';

export default function RankingPage() {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const { options, update } = useCatalogNavigation();
  const query = useCatalogPerformances({ genre:options.genre,sort:'popular',ended:true,limit:30 });
  return <main className="ticket-container ticket-page ticket-ranking-page"><h1 className="ticket-page-title">{copy.ranking}</h1>
    <GenreTabs value={options.genre ?? ''} onChange={(genre) => update({genre})} withImages /><p className="ticket-ranking-basis">{copy.rankingBasis}</p>
    {query.isError ? <div className="ticket-empty" role="alert"><p>{copy.loadError}</p><button type="button" onClick={() => void query.refetch()}>{copy.retry}</button></div>
      : query.isLoading ? <div className="ticket-product-grid">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}</div>
        : !query.data?.data.length ? <div className="ticket-empty"><p>{copy.noShows}</p><span>{copy.noShowsBody}</span></div>
          : <ol className="ticket-ranking-cards">{query.data.data.map((item,index) => <li key={item.id}>
            <PerformanceCard performance={item} rank={index+1} rankPlacement="body" variant="ranking" />
          </li>)}</ol>}
  </main>;
}
