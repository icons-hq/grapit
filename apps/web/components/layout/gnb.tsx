'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Search, Menu, Heart, Clock3, Ticket, UserRound, LogOut, ChevronDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { getLocalizedPathname, LocaleSwitcher, MobileLocaleSwitcher } from '@/components/i18n/locale-switcher';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { GenreGrid } from '@/components/home/genre-grid';
import { TicketActions } from '@/components/performance/ticket-actions';
import { PUBLIC_GENRES } from '@/lib/performance/public-genres';

export function GNB() {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearch = useSearchParams().get('q') ?? '';
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(locale);
  const ticket = getTicketCopy(locale);
  const { user, isInitialized, accessToken, clearAuth } = useAuthStore();
  const [profileOpen, setProfileOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [search, setSearch] = useState('');
  const profileRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const authenticated = isInitialized && !!accessToken && !!user;
  const { pathnameWithoutLocale: path } = resolveLocaleFromPathname(pathname);
  const home = path === '/' || path === '/ticket';
  const detailId = path.startsWith('/performance/') ? path.split('/')[2] : undefined;
  const genre = PUBLIC_GENRES.find((value) => path === `/genre/${value}`);
  const mobileTitle = genre ? copy.genres[genre] : path === '/ranking' ? ticket.ranking : path === '/upcoming' ? ticket.upcoming : null;
  const href = (value: string) => getLocalizedPathname(value, locale);
  useEffect(() => { setSearch(currentSearch); }, [currentSearch]);
  useEffect(() => {
    function dismiss(event: MouseEvent) { if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') setProfileOpen(false); }
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!search.trim()) { inputRef.current?.focus(); return; }
    router.push(`${href('/search')}?q=${encodeURIComponent(search.trim())}`);
  }
  async function logout() {
    setProfileOpen(false);
    try { await apiClient.post('/api/v1/auth/logout'); } catch { /* Local logout still applies. */ }
    clearAuth(); toast.success(copy.nav.logoutSuccess); router.push(href('/'));
  }
  const links = [
    { href: '/', label: ticket.ticket }, { href: '/upcoming', label: ticket.upcoming },
    { href: '/ranking', label: ticket.ranking }, { href: '/venues', label: ticket.venues },
    { href: '/support', label: ticket.guide },
  ];
  return <>
    <header className={cn('ticket-header', home && 'ticket-header-home', detailId && 'ticket-header-detail', mobileTitle && 'ticket-header-context')}>
      <div className="ticket-container ticket-header-inner">
        {!home && <button type="button" className="ticket-menu-icon" aria-label={ticket.allCategories} onClick={() => setCategoriesOpen(true)}><Menu size={21} /></button>}
        <Link href={href('/')} className="ticket-logo" aria-label="Grabit">Grabit<span aria-hidden="true">.</span></Link>
        {mobileTitle && <div className="ticket-mobile-page-heading">{genre
          ? <button type="button" aria-label={`${mobileTitle}: ${ticket.allCategories}`} onClick={() => setCategoriesOpen(true)}><span>{mobileTitle}</span><ChevronDown size={16} className="shrink-0" /></button>
          : <span>{mobileTitle}</span>}</div>}
        <form role="search" className="ticket-header-search" onSubmit={submit}>
          {!home && <span className="ticket-search-scope">Grabit {ticket.ticket}</span>}
          <input ref={inputRef} type="search" role="searchbox" aria-label={copy.nav.searchAriaLabel} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={ticket.searchPlaceholder} maxLength={200} />
          {search && <button type="button" onClick={() => { setSearch(''); inputRef.current?.focus(); }} aria-label={copy.nav.clearSearch} className="ticket-search-clear"><X size={16} /></button>}
          <button type="submit" aria-label={ticket.search}><Search size={24} strokeWidth={1.8} /></button>
        </form>
        {mobileTitle && <Link className="ticket-mobile-page-search" href={href('/search')} aria-label={ticket.search}><Search size={21} /></Link>}
        <div className="ticket-mobile-locale"><MobileLocaleSwitcher /></div>
        <div className="ticket-header-actions">
          {authenticated ? <div ref={profileRef} className="relative">
            <button type="button" aria-label={copy.nav.mypage} aria-expanded={profileOpen} onClick={() => setProfileOpen(!profileOpen)} className="ticket-header-action"><UserRound size={18} /><span>{ticket.my}</span><ChevronDown size={12} /></button>
            {profileOpen && <div className="ticket-profile-menu"><Link href={href('/mypage')} onClick={() => setProfileOpen(false)}>{copy.nav.mypage}</Link><button type="button" onClick={() => void logout()}><LogOut size={16} />{copy.nav.logout}</button></div>}
          </div> : <Link className="ticket-header-action" href={href('/auth')}><UserRound size={18} /><span>{copy.nav.loginSignup}</span></Link>}
          <Link className="ticket-header-action" href={href('/wishlist')}><Heart size={18} /><span>{ticket.wishlist}</span></Link>
          <Link className="ticket-header-action" href={`${href('/mypage')}?tab=wallet`}><Ticket size={18} /><span>{ticket.myTickets}</span></Link>
          <Link className="ticket-header-action" href={href('/recent')}><Clock3 size={18} /><span>{ticket.recent}</span></Link>
          <LocaleSwitcher />
        </div>
        {detailId && <div className="ticket-detail-header-actions"><TicketActions performanceId={detailId} /></div>}
      </div>
    </header>
    {home && <nav className="ticket-main-nav" aria-label={ticket.ticket}>
      <div className="ticket-container ticket-main-nav-inner">
        <button type="button" className="ticket-all-categories" onClick={() => setCategoriesOpen(true)}><Menu size={20} />{ticket.allCategories}</button>
        {links.map((link) => <Link key={link.href} href={href(link.href)} aria-current={path === link.href ? 'page' : undefined}>{link.label}</Link>)}
      </div>
    </nav>}
    <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}>
      <DialogContent className="ticket-dialog ticket-category-dialog" aria-describedby={undefined}>
        <DialogTitle>{ticket.allCategories}</DialogTitle>
        <div onClick={(event) => { if ((event.target as HTMLElement).closest('a')) setCategoriesOpen(false); }}><GenreGrid all /></div>
        <div className="ticket-category-shortcuts">{links.slice(1).map((link) => <Link key={link.href} href={href(link.href)} onClick={() => setCategoriesOpen(false)}>{link.label}</Link>)}</div>
      </DialogContent>
    </Dialog>
  </>;
}
