'use client';
import { useLocale } from 'next-intl';
import { useCatalogNavigation } from '@/hooks/use-catalog-navigation';
import { useCatalogPerformances } from '@/hooks/use-performances';
import { CatalogResults } from '@/components/performance/catalog-results';
import { TicketShelf } from '@/components/home/ticket-shelf';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export default function UpcomingPage() {
  const copy = getTicketCopy(useLocale());
  const { options, params, update, reset } = useCatalogNavigation();
  const value = { ...options, status:'upcoming' as const, sort: params.has('sort') ? options.sort : 'opening' as const };
  const query = useCatalogPerformances(value);
  return <main className="ticket-container ticket-page ticket-upcoming-page"><h1 className="ticket-page-title">{copy.upcoming}</h1>
    {!query.isError && (query.isLoading || !!query.data?.data.length) && <div className="ticket-upcoming-featured">
      <TicketShelf title={copy.upcoming} items={query.data?.data.slice(0,6)} isLoading={query.isLoading} variant="opening" hideHeading />
    </div>}
    <CatalogResults data={query.data} isLoading={query.isLoading} isError={query.isError} retry={() => void query.refetch()} value={value} update={update} reset={reset} upcoming compact />
  </main>;
}
