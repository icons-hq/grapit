'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Venue } from '@grabit/shared';
import { Search } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { Skeleton } from '@/components/ui/skeleton';

export default function VenuesPage() {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const [search,setSearch] = useState('');
  const query = useQuery({queryKey:['ticket-venues'],queryFn:() => apiClient.get<Array<Venue & {performanceCount:number}>>('/api/v1/venues')});
  const venues = query.data?.filter((venue) => `${venue.name} ${venue.address ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  return <main className="ticket-container ticket-page"><h1 className="ticket-page-title">{copy.venues}</h1>
    <div className="ticket-search-form"><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label={copy.venueSearch} placeholder={copy.venueSearch} /><Search size={22} /></div>
    {query.isLoading ? <div className="ticket-venue-grid">{[0,1,2,3,4,5].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
      : query.isError ? <div className="ticket-empty" role="alert"><p>{copy.loadError}</p><button type="button" onClick={() => void query.refetch()}>{copy.retry}</button></div>
        : !venues.length ? <div className="ticket-empty"><p>{copy.venueEmpty}</p></div>
          : <div className="ticket-venue-grid">{venues.map((venue) => <Link key={venue.id} href={`${getLocalizedPathname('/categories',locale)}?venueId=${venue.id}&ended=true`} className="ticket-venue-card">
            <Image src="/images/ticket-genres/venue.png" alt="" width={64} height={64} /><div><h2>{venue.name}</h2><p>{venue.address}</p><p>{copy.ticket} · {venue.performanceCount}</p></div>
          </Link>)}</div>}
  </main>;
}
