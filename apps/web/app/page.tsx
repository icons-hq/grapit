'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ArrowUp, ChevronRight } from 'lucide-react';
import type { Genre } from '@grabit/shared';
import { BannerCarousel } from '@/components/home/banner-carousel';
import { GenreGrid } from '@/components/home/genre-grid';
import { TicketShelf } from '@/components/home/ticket-shelf';
import { TicketCuration, VenueShelf } from '@/components/home/ticket-curation';
import { GenreTabs } from '@/components/performance/genre-tabs';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useCatalogPerformances, useHomeBanners } from '@/hooks/use-performances';
import { useRuntimeFlags } from '@/hooks/use-runtime-flags';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';

export default function HomePage() {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const legacy = getVisibleCopy(locale);
  const [genre, setGenre] = useState<Genre | ''>('');
  const banners = useHomeBanners();
  const upcoming = useCatalogPerformances({ status: 'upcoming', sort: 'opening', limit: 10 });
  const ranking = useCatalogPerformances({ genre: genre || undefined, sort: 'popular', ended: true, limit: 10 });
  const latest = useCatalogPerformances({ sort: 'latest', ended: true, limit: 10 });
  const { bookingEnabled, isResolved } = useRuntimeFlags();
  const href = (path: string) => getLocalizedPathname(path, locale);
  return <main className="ticket-home">
    <h1 className="sr-only">Grabit {copy.ticket}</h1>
    <BannerCarousel banners={banners.data?.filter((banner) => banner.placement === 'home_hero') ?? []}
      performances={latest.data?.data} isLoading={banners.isLoading && latest.isLoading} locale={locale} />
    <div className="ticket-container">
      <Link href={href('/support')} className="ticket-notice"><span>{copy.notice}</span><p>{copy.noticeText}</p><ChevronRight size={16} /></Link>
      <GenreGrid />
      {isResolved && !bookingEnabled && <p role="status" className="ticket-booking-notice">{legacy.home.bookingPaused}</p>}
      <TicketShelf title={copy.upcoming} href={href('/upcoming')} items={upcoming.data?.data} isLoading={upcoming.isLoading} isError={upcoming.isError}
        onRetry={() => void upcoming.refetch()} variant="opening" empty={copy.noUpcoming} />
      <TicketShelf title={copy.rankingTitle} href={`${href('/ranking')}${genre ? `?genre=${genre}` : ''}`} items={ranking.data?.data} isLoading={ranking.isLoading} isError={ranking.isError}
        onRetry={() => void ranking.refetch()} variant="ranking">
        <GenreTabs value={genre} onChange={setGenre} /><p className="ticket-ranking-basis">{copy.rankingBasis}</p>
      </TicketShelf>
      {banners.data?.some((banner) => banner.placement === 'home_secondary') && <div className="ticket-secondary-banners">
        {banners.data.filter((banner) => banner.placement === 'home_secondary').map((banner) => <a key={banner.id} href={banner.linkUrl ?? href('/categories')}><img src={banner.imageUrl} alt={legacy.home.promotionAlt} loading="lazy" /></a>)}
      </div>}
      <TicketShelf title={copy.newShows} href={href('/categories')} items={latest.data?.data} isLoading={latest.isLoading} isError={latest.isError} onRetry={() => void latest.refetch()} />
      <TicketCuration items={latest.data?.data ?? []} />
      <VenueShelf />
      <div className="ticket-home-service-links">
        <Link href={href('/venues')}><span>{copy.venueTitle}</span><ChevronRight size={20} /></Link>
        <Link href={`${href('/mypage')}?tab=wallet`}><span>{copy.myTickets}</span><ChevronRight size={20} /></Link>
        <Link href={href('/support')}><span>{copy.ticketGuide}</span><ChevronRight size={20} /></Link>
      </div>
    </div>
    <button type="button" className="ticket-to-top" aria-label={copy.toTop} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={20} /></button>
  </main>;
}
