'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Home, LayoutGrid, Search, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { resolveLocaleFromPathname } from '@/i18n/routing';

interface Tab {
  href: string;
  label: 'home' | 'category' | 'search' | 'mypage';
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { href: '/', label: 'home', icon: Home },
  { href: '/genre/artist_celebrity', label: 'category', icon: LayoutGrid },
  { href: '/search', label: 'search', icon: Search },
  { href: '/mypage', label: 'mypage', icon: User },
];

function isTabActive(href: string, pathname: string): boolean {
  if (href === '/') {
    return pathname === '/';
  }
  // For category tab, match any /genre/* path
  if (href === '/genre/artist_celebrity') {
    return pathname.startsWith('/genre');
  }
  return pathname.startsWith(href);
}

export function MobileTabBar() {
  const pathname = usePathname();
  const activeLocale = resolveVisibleCopyLocale(useLocale());
  const copy = getVisibleCopy(activeLocale);
  const { pathnameWithoutLocale } = resolveLocaleFromPathname(pathname);

  return (
    <nav
      role="navigation"
      className="fixed bottom-0 left-0 right-0 z-50 flex h-[56px] border-t border-border bg-white pb-safe md:hidden"
    >
      {TABS.map((tab) => {
        const active = isTabActive(tab.href, pathnameWithoutLocale);
        const Icon = tab.icon;
        const label = copy.nav[tab.label];

        return (
          <Link
            key={tab.href}
            href={getLocalizedPathname(tab.href, activeLocale)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5',
              active ? 'text-primary' : 'text-gray-400',
            )}
          >
            <Icon className="h-5 w-5" />
            <span
              className={cn(
                'text-[14px] leading-tight',
                active
                  ? 'font-semibold text-primary'
                  : 'font-normal text-gray-500',
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
