'use client';
import { useLocale } from 'next-intl';
import { GenreGrid } from '@/components/home/genre-grid';
import { CatalogResults } from '@/components/performance/catalog-results';
import { useCatalogNavigation } from '@/hooks/use-catalog-navigation';
import { useCatalogPerformances } from '@/hooks/use-performances';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export default function CategoriesPage() {
  const copy = getTicketCopy(useLocale());
  const { options, update, reset } = useCatalogNavigation();
  const query = useCatalogPerformances(options);
  return <main className="ticket-container ticket-page"><h1 className="ticket-page-title">{copy.categoryHeading}</h1>
    <GenreGrid all /><div className="mt-12"><CatalogResults data={query.data} isLoading={query.isLoading} isError={query.isError} retry={() => void query.refetch()} value={options} update={update} reset={reset} /></div>
  </main>;
}
