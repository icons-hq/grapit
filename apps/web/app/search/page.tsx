'use client';
import { useState, useEffect, type FormEvent } from 'react';
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
  const [input, setInput] = useState(q);
  const query = useSearch();
  useEffect(() => { setInput(q); },[q]);
  function submit(event: FormEvent) { event.preventDefault(); if(input.trim()) update({q:input.trim()}); }
  return <main className="ticket-container ticket-page">
    <h1 className={q ? 'sr-only' : 'ticket-page-title'}>{q ? `“${q}” ${copy.search}` : copy.searchPrompt}</h1>
    <form className="ticket-search-form" role="search" onSubmit={submit}><input type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder={copy.searchHint} aria-label={copy.search} maxLength={200} /><button type="submit" aria-label={copy.search}><Search size={23} /></button></form>
    {q ? <CatalogResults data={query.data} isLoading={query.isLoading} isError={query.isError} retry={() => void query.refetch()} value={options} update={update} reset={reset} search currentSort={params.get('sort') ?? 'relevance'} />
      : <><GenreGrid all /><p className="mt-10 text-center text-sm text-muted-foreground">{copy.searchHint}</p></>}
  </main>;
}
