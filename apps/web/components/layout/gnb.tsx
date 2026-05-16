'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Search, ChevronDown, LogOut, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { Button } from '@/components/ui/button';
import {
  getLocalizedPathname,
  LocaleSwitcher,
  MobileLocaleSwitcher,
} from '@/components/i18n/locale-switcher';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { PUBLIC_GENRES } from '@/lib/performance/public-genres';

export function GNB() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const activeLocale = resolveVisibleCopyLocale(locale);
  const copy = getVisibleCopy(activeLocale);
  const { user, isInitialized, accessToken, clearAuth } = useAuthStore();
  const [isProfileOpen, setIsProfileOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
  const [isShaking, setIsShaking] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const profileRef = React.useRef<HTMLDivElement>(null);

  const isAuthenticated = isInitialized && !!accessToken && !!user;

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target as Node)
      ) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userInitials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '';

  async function handleLogout() {
    setIsProfileOpen(false);
    try {
      await apiClient.post('/api/v1/auth/logout');
    } catch {
      // Clear state regardless
    }
    clearAuth();
    toast.success('로그아웃되었습니다');
    router.push(getLocalizedPathname('/', activeLocale));
  }

  function handleSearch() {
    const trimmed = searchValue.trim();
    if (trimmed.length === 0) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 200);
      return;
    }
    router.push(
      `${getLocalizedPathname('/search', activeLocale)}?q=${encodeURIComponent(trimmed)}`,
    );
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }

  function isActiveGenre(slug: string): boolean {
    const { pathnameWithoutLocale } = resolveLocaleFromPathname(pathname);
    return pathnameWithoutLocale.startsWith(`/genre/${slug}`);
  }

  return (
    <>
      <header className="sticky top-0 z-50 h-14 border-b border-gray-200 bg-white md:h-16">
        <nav className="mx-auto flex h-full max-w-[1200px] items-center px-4 md:px-6">
          {/* Logo */}
          <Link
            href={getLocalizedPathname('/', activeLocale)}
            className="mr-0 text-lg font-semibold text-primary md:mr-8 md:text-xl"
          >
            Grabit
          </Link>

          {/* Genre tabs - hidden on mobile */}
          <div className="hidden items-center gap-1 md:flex">
            {PUBLIC_GENRES.map((genre) => (
              <Link
                key={genre}
                href={getLocalizedPathname(`/genre/${genre}`, activeLocale)}
                className={cn(
                  'px-3 py-2 text-base transition-colors',
                  isActiveGenre(genre)
                    ? 'border-b-2 border-primary font-semibold text-primary'
                    : 'text-gray-900 hover:text-primary',
                )}
              >
                {copy.genres[genre]}
              </Link>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          <div className="flex items-center gap-1 md:hidden">
            <MobileLocaleSwitcher />
          </div>

          {/* Search bar - hidden on mobile */}
          <div className="mr-4 hidden lg:block">
            <div
              className={cn(
                'relative transition-transform',
                isShaking && 'animate-[shake_200ms_ease-in-out]',
              )}
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                role="searchbox"
                aria-label={copy.nav.searchAriaLabel}
                placeholder={copy.nav.searchPlaceholder}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="h-10 w-64 rounded-lg bg-gray-100 pl-10 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-primary focus:outline-none"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchValue('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={copy.nav.clearSearch}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Auth area */}
          <div className="mr-2 hidden md:block">
            <LocaleSwitcher />
          </div>

          {isAuthenticated ? (
            <div ref={profileRef} className="relative hidden md:block">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-normal text-white">
                  {userInitials}
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-gray-500 transition-transform',
                    isProfileOpen && 'rotate-180',
                  )}
                />
              </button>
              {isProfileOpen && (
                <div className="absolute right-0 top-full mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <Link
                    href={getLocalizedPathname('/mypage', activeLocale)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-900 hover:bg-gray-100"
                    onClick={() => setIsProfileOpen(false)}
                  >
                    <User className="h-4 w-4" />
                    {copy.nav.mypage}
                  </Link>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:bg-gray-100"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-4 w-4" />
                    {copy.nav.logout}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Button
              variant="ghost"
              asChild
              className="hidden text-base text-gray-900 hover:text-primary md:inline-flex"
            >
              <Link href={getLocalizedPathname('/auth', activeLocale)}>
                {copy.nav.loginSignup}
              </Link>
            </Button>
          )}

        </nav>
      </header>
    </>
  );
}
