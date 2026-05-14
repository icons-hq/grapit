import { DEFAULT_LOCALE, isSupportedLocale } from '@grabit/shared';
import { defineRouting } from 'next-intl/routing';
import type { SupportedLocale } from '@grabit/shared';

export const LOCALE_SUGGESTION_COOKIE = 'locale-suggestion';
export const PUBLIC_SUPPORTED_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;

export type PublicSupportedLocale =
  | Extract<SupportedLocale, 'ko' | 'en' | 'th' | 'zh-CN'>
  | 'zh-TW';

export const routing = defineRouting({
  locales: [...PUBLIC_SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: false,
});

export type LocalePathResolution = {
  locale: PublicSupportedLocale;
  pathnameWithoutLocale: string;
};

export function resolveLocaleFromPathname(pathname: string): LocalePathResolution {
  const normalizedPathname = normalizePathname(pathname);
  const [, maybeLocale, ...rest] = normalizedPathname.split('/');

  if (
    maybeLocale &&
    isPublicSupportedLocale(maybeLocale) &&
    maybeLocale !== DEFAULT_LOCALE
  ) {
    return {
      locale: maybeLocale,
      pathnameWithoutLocale: rest.length > 0 ? `/${rest.join('/')}` : '/',
    };
  }

  return {
    locale: DEFAULT_LOCALE,
    pathnameWithoutLocale: normalizedPathname,
  };
}

export function getSuggestedLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
  activeLocale: PublicSupportedLocale,
): PublicSupportedLocale | null {
  const preferredLocales = parseAcceptLanguage(acceptLanguage);

  for (const preferredLocale of preferredLocales) {
    const locale = normalizeLanguageTag(preferredLocale);

    if (locale === activeLocale) {
      return null;
    }

    if (locale) {
      return locale;
    }
  }

  return null;
}

function normalizePathname(pathname: string) {
  if (!pathname.startsWith('/')) return `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function parseAcceptLanguage(acceptLanguage: string | null | undefined) {
  if (!acceptLanguage) return [];

  return acceptLanguage
    .split(',')
    .map((item, index) => {
      const [tag, ...params] = item.trim().split(';');
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
        ?.slice(2);

      return {
        tag,
        index,
        quality: quality ? Number.parseFloat(quality) : 1,
      };
    })
    .filter((item) => item.tag && Number.isFinite(item.quality) && item.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((item) => item.tag);
}

export function isPublicSupportedLocale(value: string): value is PublicSupportedLocale {
  return (PUBLIC_SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function normalizeLanguageTag(tag: string): PublicSupportedLocale | null {
  const canonical = tag.trim();
  const lower = canonical.toLowerCase();

  if (isPublicSupportedLocale(canonical)) return canonical;
  if (lower === 'ko' || lower.startsWith('ko-')) return 'ko';
  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'th' || lower.startsWith('th-')) return 'th';

  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'zh-TW';
  if (lower.startsWith('zh-hant')) return 'zh-TW';
  if (lower === 'zh-cn' || lower === 'zh-sg') return 'zh-CN';
  if (lower.startsWith('zh-hans') || lower === 'zh') return 'zh-CN';
  if (isSupportedLocale(canonical)) return null;

  return null;
}
