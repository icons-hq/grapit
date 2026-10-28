'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Home, LayoutGrid, Search, UserRound, Heart } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getTicketCopy } from '@/lib/i18n/ticket-copy';
import { getVisibleCopy, resolveVisibleCopyLocale } from '@/lib/i18n/visible-copy';
import { resolveLocaleFromPathname } from '@/i18n/routing';

export function MobileTabBar() {
  const { pathnameWithoutLocale: path } = resolveLocaleFromPathname(usePathname());
  const locale = resolveVisibleCopyLocale(useLocale());
  const copy = getTicketCopy(locale);
  const tabs = [
    { href: '/categories', label: copy.allCategories, icon: LayoutGrid, active: path === '/categories' || path.startsWith('/genre') },
    { href: '/search', label: copy.search, icon: Search, active: path === '/search' },
    { href: '/', label: getVisibleCopy(locale).nav.home, icon: Home, active: path === '/' || path === '/ticket' },
    { href: '/wishlist', label: copy.wishlist, icon: Heart, active: path === '/wishlist' },
    { href: '/mypage', label: copy.my, icon: UserRound, active: path.startsWith('/mypage') },
  ];
  return <nav className="ticket-mobile-tabs" aria-label={copy.ticket}>
    {tabs.map(({ icon: Icon, ...tab }) => <Link key={tab.href} href={getLocalizedPathname(tab.href, locale)} aria-current={tab.active ? 'page' : undefined} className={cn('ticket-mobile-tab', tab.active && 'active')}>
      <Icon size={21} strokeWidth={1.7} fill={tab.active && tab.href === '/' ? 'currentColor' : 'none'} /><span>{tab.label}</span>
    </Link>)}
  </nav>;
}
