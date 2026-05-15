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
import {
  appendSearchParams,
  getLocalizedPathname,
  setLocalePreferenceCookie,
} from './locale-switcher';

type SupportedLocale = PublicSupportedLocale;

const DISMISSED_STORAGE_KEY = 'locale-suggestion-dismissed';
const SUGGESTION_COPY = {
  ko: '다른 언어로 볼까요?',
  en: 'View this page in English?',
  th: 'ดูหน้านี้เป็นภาษาไทยไหม?',
  'zh-CN': '要以简体中文查看此页面吗？',
  'zh-TW': '要以繁體中文查看此頁面嗎？',
} as const satisfies Record<SupportedLocale, string>;

const PUBLIC_LOCALE_LABELS = {
  ko: '한국어',
  en: 'English',
  th: 'ไทย',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
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

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISSED_STORAGE_KEY, 'true');
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
          {SUGGESTION_COPY[locale] ?? SUGGESTION_COPY.en}
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
            나중에
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

  if (window.sessionStorage.getItem(DISMISSED_STORAGE_KEY) === 'true') {
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
