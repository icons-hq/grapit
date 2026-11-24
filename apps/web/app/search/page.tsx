'use client';
import { useEffect, useRef, type FormEvent } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { CatalogResults } from '@/components/performance/catalog-results';
import { GenreGrid } from '@/components/home/genre-grid';
import { useCatalogNavigation } from '@/hooks/use-catalog-navigation';
import { useSearch } from '@/hooks/use-search';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export default function SearchPage() {
  const copy = getTicketCopy(useLocale());
  const { params, options, update, reset } = useCatalogNavigation();
  const q = params.get('q') ?? '';
  const query = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusAfterClear = useRef(false);
  const hasFilters = Boolean(options.genre || options.region || options.venueId || options.dateFrom || options.dateTo
    || options.status !== 'all' || options.ended === false);
  function clearSearch() {
    focusAfterClear.current = true;
    update({ q: '' });
  }
  useEffect(() => {
    if (!q && focusAfterClear.current) {
      inputRef.current?.focus();
      focusAfterClear.current = false;
    }
  }, [q]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = new FormData(event.currentTarget).get('q');
    if (typeof term === 'string' && term.trim()) update({ q: term.trim() });
  }
  return <main className="ticket-container ticket-page">
    <h1 className={q ? 'sr-only' : 'ticket-page-title'}>{q ? `“${q}” ${copy.search}` : copy.searchPrompt}</h1>
    <form method="get" className="ticket-search-form" role="search" onSubmit={submit}>
      {Array.from(params.entries()).filter(([name]) => name !== 'q' && name !== 'page').map(([name, value], index) => (
        <input key={index} type="hidden" name={name} value={value} />
      ))}
      <input key={q} ref={inputRef} name="q" type="search" defaultValue={q} placeholder={copy.searchHint} aria-label={copy.search} maxLength={200} />
      <button type="submit" aria-label={copy.search}><Search size={23} /></button>
    </form>
    {q ? <CatalogResults data={query.data} isLoading={query.isLoading} isError={query.isError} retry={() => void query.refetch()} value={options} update={update} reset={reset} search clearSearch={hasFilters ? undefined : clearSearch} currentSort={params.get('sort') ?? 'relevance'} />
      : <><GenreGrid all /><p className="mt-10 text-center text-sm text-muted-foreground">{copy.searchHint}</p></>}
  </main>;
}
