'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { PUBLIC_GENRES, GENRE_IMAGE } from '@/lib/performance/public-genres';

export function GenreGrid({ all = false }: { all?: boolean }) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  const ticket = getTicketCopy(locale);
  const genres = all ? PUBLIC_GENRES : PUBLIC_GENRES.filter((genre) => genre !== 'leisure_camping');
  return <nav className="ticket-genre-grid" aria-label={copy.home.genreShortcuts}>
    {genres.map((genre) => <Link key={genre} href={getLocalizedPathname(`/genre/${genre}`, locale)} className="ticket-genre-link">
      <span className="ticket-genre-art"><Image src={`/images/ticket-genres/${GENRE_IMAGE[genre]}.png`} alt="" width={72} height={72} /></span>
      <span>{copy.genres[genre]}</span>
    </Link>)}
    {!all && <Link href={getLocalizedPathname('/venues', locale)} className="ticket-genre-link">
      <span className="ticket-genre-art"><Image src="/images/ticket-genres/venue.png" alt="" width={72} height={72} /></span><span>{ticket.venues}</span>
    </Link>}
  </nav>;
}
