'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import type { Genre } from '@grabit/shared';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { PUBLIC_GENRES, GENRE_IMAGE } from '@/lib/performance/public-genres';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';

export function GenreTabs({ value, onChange, withImages = false }: { value: string; onChange: (value: Genre | '') => void; withImages?: boolean }) {
  const locale = useLocale();
  const copy = getVisibleCopy(locale);
  const ticket = getTicketCopy(locale);
  return <div className="ticket-tabs-scroll"><ToggleGroup type="single" value={value || 'all'} onValueChange={(v) => { if(v) onChange(v === 'all' ? '' : v as Genre); }}
    className={withImages ? 'ticket-genre-tabs ticket-genre-tabs-images' : 'ticket-genre-tabs'} aria-label={ticket.genre}>
    <ToggleGroupItem value="all">{ticket.all}</ToggleGroupItem>
    {PUBLIC_GENRES.map((genre) => <ToggleGroupItem key={genre} value={genre}>
      {withImages && <Image src={`/images/ticket-genres/${GENRE_IMAGE[genre]}.png`} alt="" width={24} height={24} />}{copy.genres[genre]}
    </ToggleGroupItem>)}
  </ToggleGroup></div>;
}

export function GenreNavigation({ genre }: { genre?: Genre }) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  return <nav className="ticket-genre-navigation" aria-label={getTicketCopy(locale).genre}>
    {PUBLIC_GENRES.map((item) => <Link key={item} href={getLocalizedPathname(`/genre/${item}`, locale)} aria-current={genre === item ? 'page' : undefined}>{copy.genres[item]}</Link>)}
  </nav>;
}
