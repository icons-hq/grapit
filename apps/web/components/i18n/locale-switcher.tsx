'use client';

import * as React from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
} from '@grabit/shared/constants/locales.js';
import type { SupportedLocale } from '@grabit/shared/types/i18n.types.js';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/use-auth-store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const PREFERRED_LOCALE_COOKIE = 'preferred-locale';

interface LocaleSwitcherProps {
  className?: string;
  onLocaleChange?: () => void;
}

export function LocaleSwitcher({
  className,
  onLocaleChange,
}: LocaleSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { accessToken, user, setAuth } = useAuthStore();
  const activeLocale = resolveLocaleFromPathname(pathname).locale;

  async function handleLocaleSelect(locale: SupportedLocale) {
    setLocalePreferenceCookie(locale);

    if (accessToken && user) {
      try {
        const updatedUser = await apiClient.patch<typeof user>(
          '/api/v1/users/me',
          { preferredLocale: locale },
          { showErrorToast: false },
        );
        setAuth(accessToken, updatedUser);
      } catch {
        // Navigation remains explicit even if profile persistence is unavailable.
      }
    }

    onLocaleChange?.();
    router.push(getLocalizedPathname(pathname, locale));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`언어 선택: ${LOCALE_LABELS[activeLocale].native}`}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary',
            className,
          )}
        >
          <Languages className="h-4 w-4 text-primary" aria-hidden="true" />
          <span aria-current="true">
            {LOCALE_LABELS[activeLocale].native}
          </span>
          <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {SUPPORTED_LOCALES.map((locale) => {
          const isActive = locale === activeLocale;
          return (
            <DropdownMenuItem
              key={locale}
              onSelect={() => void handleLocaleSelect(locale)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'min-h-10 cursor-pointer justify-between text-sm',
                isActive && 'font-semibold text-primary',
              )}
            >
              <span>{LOCALE_LABELS[locale].native}</span>
              {isActive && (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function getLocalizedPathname(
  pathname: string,
  locale: SupportedLocale,
) {
  const { pathnameWithoutLocale } = resolveLocaleFromPathname(pathname);
  if (locale === DEFAULT_LOCALE) return pathnameWithoutLocale;
  if (pathnameWithoutLocale === '/') return `/${locale}`;
  return `/${locale}${pathnameWithoutLocale}`;
}

export function setLocalePreferenceCookie(locale: SupportedLocale) {
  if (typeof document === 'undefined') return;

  document.cookie =
    `${PREFERRED_LOCALE_COOKIE}=${locale}; Max-Age=31536000; path=/; SameSite=Lax`;
}
