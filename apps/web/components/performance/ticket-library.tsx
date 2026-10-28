'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Heart, Clock3 } from 'lucide-react';
import { useFavorites, useRecentPerformanceIds, clearRecentPerformances } from '@/hooks/use-ticket-library';
import { useCatalogPerformances } from '@/hooks/use-performances';
import { PerformanceCard } from './performance-card';
import { PaginationNav } from './pagination-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { useAuthStore } from '@/stores/use-auth-store';

export function TicketLibrary({ mode }: { mode:'wishlist'|'recent' }) {
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const labels = getVisibleCopy(locale);
  const favorites = useFavorites(mode === 'wishlist');
  const recent = useRecentPerformanceIds();
  const initialized = useAuthStore((s) => s.isInitialized);
  const [requestedPage, setPage] = useState(1);
  const ids = mode === 'wishlist' ? favorites.data?.ids ?? [] : recent.ids;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(ids.length/20)));
  const pageIds = ids.slice((page-1)*20,page*20);
  const query = useCatalogPerformances({ ids:pageIds,ended:true,limit:50 },pageIds.length > 0);
  const waiting = mode === 'wishlist' ? !initialized || favorites.isLoading : !recent.ready;
  const href = (value:string) => getLocalizedPathname(value,locale);
  const sorted = pageIds.flatMap((id) => query.data?.data.filter((item) => item.id === id) ?? []);
  const Icon = mode === 'wishlist' ? Heart : Clock3;
  return <main className="ticket-container ticket-page">
    <div className="ticket-section-heading"><h1 className="ticket-page-title !mb-0">{mode === 'wishlist' ? copy.wishlistTitle : copy.recent}</h1>
      {mode === 'recent' && ids.length > 0 && <button type="button" className="text-xs text-muted-foreground underline" onClick={clearRecentPerformances}>{copy.clearRecent}</button>}</div>
    {mode === 'recent' && <p className="mb-6 text-sm text-muted-foreground">{copy.recentNote}</p>}
    {waiting || (pageIds.length > 0 && query.isLoading) ? <div className="ticket-product-grid">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}</div>
      : mode === 'wishlist' && !favorites.authenticated ? <div className="ticket-empty"><Icon size={32} /><p>{copy.loginForWishlist}</p><Link href={`${href('/auth')}?returnTo=${encodeURIComponent(href('/wishlist'))}`}>{copy.login}</Link></div>
        : (mode === 'wishlist' && favorites.isError) || (ids.length > 0 && query.isError) ? <div role="alert" className="ticket-empty"><p>{copy.loadError}</p><button type="button" onClick={() => { void favorites.refetch(); void query.refetch(); }}>{copy.retry}</button></div>
          : !sorted.length ? <div className="ticket-empty"><Icon size={32} /><p>{mode === 'wishlist' ? copy.savedEmpty : copy.recentEmpty}</p><span>{mode === 'wishlist' ? copy.savedEmptyBody : copy.recentEmptyBody}</span><Link href={href('/categories')}>{copy.browse}</Link></div>
            : <div className="ticket-product-grid">{sorted.map((item) => <PerformanceCard key={item.id} performance={item} />)}</div>}
    {ids.length > 20 && <div className="ticket-pagination"><PaginationNav currentPage={page} totalPages={Math.ceil(ids.length/20)} onPageChange={setPage} labels={{navigation:labels.search.paginationNav,previous:copy.previous,next:copy.next}} /></div>}
  </main>;
}
