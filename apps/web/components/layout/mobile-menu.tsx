'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { X, User, LogOut, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  getLocalizedPathname,
  LocaleSwitcher,
} from '@/components/i18n/locale-switcher';
import {
  getVisibleCopy,
  resolveVisibleCopyLocale,
} from '@/lib/i18n/visible-copy';
import { GENRES } from '@grabit/shared';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  isAuthenticated?: boolean;
  userName?: string;
}

export function MobileMenu({
  isOpen,
  onClose,
  onLogout,
  isAuthenticated = false,
  userName,
}: MobileMenuProps) {
  const router = useRouter();
  const locale = useLocale();
  const activeLocale = resolveVisibleCopyLocale(locale);
  const copy = getVisibleCopy(activeLocale);
  const [searchValue, setSearchValue] = React.useState('');

  // Prevent body scroll when menu is open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  function handleSearch() {
    const trimmed = searchValue.trim();
    if (trimmed.length === 0) return;
    router.push(
      `${getLocalizedPathname('/search', activeLocale)}?q=${encodeURIComponent(trimmed)}`,
    );
    setSearchValue('');
    onClose();
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/50 transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-in panel */}
      <div
        className={cn(
          'fixed right-0 top-0 z-50 h-full w-72 bg-white shadow-xl transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6">
          <span className="text-lg font-semibold text-primary">Grabit</span>
          <button
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="메뉴 닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="border-b border-gray-200 px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              role="searchbox"
              aria-label={copy.nav.searchAriaLabel}
              placeholder={copy.nav.searchPlaceholder}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="h-10 w-full rounded-lg bg-gray-100 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Auth section */}
        <div className="border-b border-gray-200 px-6 py-4">
          {isAuthenticated ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-normal text-white">
                  {userName
                    ?.split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
                <span className="text-base font-normal text-gray-900">
                  {userName}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <Link
                  href={getLocalizedPathname('/mypage', activeLocale)}
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                >
                  <User className="h-4 w-4" />
                  {copy.nav.mypage}
                </Link>
                <button
                  onClick={() => { onLogout(); onClose(); }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
                >
                  <LogOut className="h-4 w-4" />
                  {copy.nav.logout}
                </button>
              </div>
            </div>
          ) : (
            <Link
              href={getLocalizedPathname('/auth', activeLocale)}
              onClick={onClose}
              className="block w-full rounded-lg bg-primary px-4 py-3 text-center text-base font-semibold text-white"
            >
              {copy.nav.loginSignup}
            </Link>
          )}
        </div>

        <div className="border-b border-gray-200 px-6 py-4">
          <p className="mb-3 text-sm font-normal text-gray-500">
            {copy.nav.language}
          </p>
          <LocaleSwitcher
            className="w-full justify-between"
            onLocaleChange={onClose}
          />
        </div>

        {/* Genre tabs -- all 8 genres (no "더보기" on mobile) */}
        <div className="px-6 py-4">
          <p className="mb-3 text-sm font-normal text-gray-500">
            {copy.nav.category}
          </p>
          <div className="flex flex-col gap-1">
            {GENRES.map((genre) => (
              <Link
                key={genre}
                href={getLocalizedPathname(`/genre/${genre}`, activeLocale)}
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-left text-base text-gray-900 hover:bg-gray-100"
              >
                {copy.genres[genre]}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
