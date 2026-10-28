'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useLocale } from 'next-intl';
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { PerformanceCardData, Genre, Venue } from '@grabit/shared';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { apiClient } from '@/lib/api-client';
import { PUBLIC_GENRES } from '@/lib/performance/public-genres';

export function TicketCuration({ items }: {items:PerformanceCardData[]}) {
  const locale=resolveVisibleCopyLocale(useLocale());
  const copy=getVisibleCopy(locale);
  const [selected,setSelected]=useState<Genre|null>(null);
  const groups=PUBLIC_GENRES.map((genre)=>({genre,items:items.filter((item)=>item.genre===genre)})).filter((group)=>group.items.length>1).slice(0,4);
  if(groups.length<2)return null;
  const active=groups.some((group)=>group.genre===selected)?selected:groups[0]?.genre;
  return <section className="ticket-curation" aria-label={getTicketCopy(locale).browse}>
    {groups.map((group)=><div key={group.genre} className={active===group.genre?'ticket-curation-group active':'ticket-curation-group'}>
      <h2><button type="button" aria-expanded={active===group.genre} aria-controls={`curation-${group.genre}`} onClick={()=>setSelected(group.genre)}>
        {copy.genres[group.genre]}{active===group.genre?<ChevronUp size={20}/>:<ChevronDown size={20}/>}
      </button></h2>
      <div id={`curation-${group.genre}`} hidden={active!==group.genre} className="ticket-curation-cards">
        {group.items.slice(0,5).map((item)=><Link key={item.id} href={getLocalizedPathname(`/performance/${item.id}`,locale)}>
          {item.posterUrl&&<Image src={item.posterUrl} alt="" fill sizes="(max-width:767px) 180px, 240px" />}
          <strong>{item.title}</strong>
        </Link>)}
      </div>
    </div>)}
  </section>;
}

export function VenueShelf() {
  const locale=resolveVisibleCopyLocale(useLocale());
  const copy=getTicketCopy(locale);
  const query=useQuery({queryKey:['ticket-venues'],queryFn:()=>apiClient.get<Array<Venue&{performanceCount:number}>>('/api/v1/venues')});
  if(!query.data?.length)return null;
  return <section className="ticket-venue-shelf">
    <div className="ticket-section-heading"><h2>{copy.venueTitle}</h2><Link href={getLocalizedPathname('/venues',locale)}>{copy.viewAll}<ChevronRight size={17}/></Link></div>
    <div className="ticket-venue-rail">{query.data.map((venue)=><Link key={venue.id} href={`${getLocalizedPathname('/categories',locale)}?venueId=${venue.id}&ended=true`}>
      <span><Image src="/images/ticket-genres/venue.png" alt="" width={72} height={72}/></span><p>{venue.name}</p>
    </Link>)}</div>
  </section>;
}
