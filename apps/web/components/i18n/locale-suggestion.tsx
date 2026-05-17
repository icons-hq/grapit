'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  LOCALE_SUGGESTION_COOKIE,
  type PublicSupportedLocale,
  isPublicSupportedLocale,
  resolveLocaleFromPathname,
} from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import {
  appendSearchParams,
  getLocalizedPathname,
  setLocalePreferenceCookie,
} from './locale-switcher';

type SupportedLocale = PublicSupportedLocale;

const DISMISSED_STORAGE_KEY = 'locale-suggestion-dismissed';
const PUBLIC_LOCALE_LABELS = {
  ko: '한국어',
  en: 'English',
  th: 'ไทย',
  'zh-CN': '简体中文',
} as const satisfies Record<SupportedLocale, string>;

export function LocaleSuggestion({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeLocale = resolveLocaleFromPathname(pathname).locale;
  const [suggestedLocale, setSuggestedLocale] =
    React.useState<SupportedLocale | null>(null);

  React.useEffect(() => {
    const locale = readSuggestedLocale();
    setSuggestedLocale(locale === activeLocale ? null : locale);
  }, [activeLocale]);

  if (!suggestedLocale) return null;
  const locale = suggestedLocale;
  const copy = getVisibleCopy(locale).locale;

  function dismiss() {
    const storage = getSessionStorage();
    if (storage) {
      storage.setItem(DISMISSED_STORAGE_KEY, 'true');
    }
    setSuggestedLocale(null);
  }

  function chooseLocale() {
    setLocalePreferenceCookie(locale);
    dismiss();
    router.push(
      appendSearchParams(
        getLocalizedPathname(pathname, locale),
        searchParams.toString(),
      ),
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'border-b border-primary/20 bg-info-surface px-4 py-3 text-info',
        className,
      )}
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {copy.suggestion}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={chooseLocale}
            className="min-h-10 rounded-md bg-primary px-3 text-sm font-semibold text-white"
          >
            {PUBLIC_LOCALE_LABELS[locale]}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-10 items-center gap-1 rounded-md px-3 text-sm font-semibold text-info hover:bg-white/60"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {copy.dismiss}
          </button>
        </div>
      </div>
    </div>
  );
}

function readSuggestedLocale(): SupportedLocale | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }

  if (getSessionStorage()?.getItem(DISMISSED_STORAGE_KEY) === 'true') {
    return null;
  }

  const value = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${LOCALE_SUGGESTION_COOKIE}=`))
    ?.split('=')[1];

  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return isPublicSupportedLocale(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
