'use client';
import { use } from 'react';
import { notFound } from 'next/navigation';
import { useLocale } from 'next-intl';
import { GENRES, type Genre } from '@grabit/shared';
import { BannerCarousel } from '@/components/home/banner-carousel';
import { TicketShelf } from '@/components/home/ticket-shelf';
import { GenreNavigation } from '@/components/performance/genre-tabs';
import { CatalogResults } from '@/components/performance/catalog-results';
import { useCatalogPerformances } from '@/hooks/use-performances';
import { useCatalogNavigation } from '@/hooks/use-catalog-navigation';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';

export default function GenrePage({ params }: { params: Promise<{genre: string}> }) {
  const { genre } = use(params);
  if (!(GENRES as readonly string[]).includes(genre)) notFound();
  return <GenreCatalog genre={genre as Genre} />;
}
function GenreCatalog({ genre }: { genre: Genre }) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const { options, update, reset } = useCatalogNavigation();
  const results = useCatalogPerformances({ ...options, genre });
  const ranked = useCatalogPerformances({ genre, sort:'popular',ended:true,limit:10 });
  const upcoming = useCatalogPerformances({ genre,status:'upcoming',sort:'opening',limit:10 });
  return <main className="ticket-genre-page">
    <div className="ticket-container"><GenreNavigation genre={genre} /><h1 className="sr-only">{getVisibleCopy(locale).genres[genre]}</h1></div>
    <BannerCarousel banners={[]} performances={ranked.data?.data} isLoading={ranked.isLoading} locale={locale} />
    <div className="ticket-container">
      <nav className="ticket-anchor-nav" aria-label={copy.browse}><a href="#upcoming">{copy.upcoming}</a><a href="#ranking">{copy.ranking}</a><a href="#browse">{copy.browse}</a></nav>
      <div id="upcoming" className="scroll-mt-24"><TicketShelf title={copy.upcoming} href={`${getLocalizedPathname('/upcoming',locale)}?genre=${genre}`}
        items={upcoming.data?.data} isLoading={upcoming.isLoading} isError={upcoming.isError} onRetry={() => void upcoming.refetch()} variant="opening" empty={copy.noUpcoming} /></div>
      <div id="ranking" className="scroll-mt-24"><TicketShelf title={copy.ranking} href={`${getLocalizedPathname('/ranking',locale)}?genre=${genre}`}
        items={ranked.data?.data} isLoading={ranked.isLoading} isError={ranked.isError} onRetry={() => void ranked.refetch()} variant="ranking"><p className="ticket-ranking-basis">{copy.rankingBasis}</p></TicketShelf></div>
      <section id="browse" className="ticket-shelf ticket-page scroll-mt-24"><h2 className="ticket-page-title">{copy.browse}</h2><CatalogResults data={results.data} isLoading={results.isLoading} isError={results.isError} retry={() => void results.refetch()} value={{ ...options, genre }} update={update} reset={reset} fixedGenre /></section>
    </div>
  </main>;
}
