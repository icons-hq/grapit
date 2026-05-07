import type { MetadataRoute } from 'next';
import { DEFAULT_LOCALE, LOCALE_PREFIXES, SUPPORTED_LOCALES } from '@grabit/shared';
import type { SupportedLocale } from '@grabit/shared';

const SITE_URL = 'https://heygrabit.com';
const LAST_MODIFIED = new Date('2026-05-06T00:00:00.000Z');

const PUBLIC_SITEMAP_PATHS = [
  '/',
  '/legal/terms',
  '/legal/privacy',
  '/legal/marketing',
] as const;

const HREFLANG_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const satisfies typeof SUPPORTED_LOCALES;

export type LocalizedAlternates = Record<SupportedLocale, string>;

export function getLocalizedUrl(pathname: string, locale: SupportedLocale) {
  const normalizedPathname = normalizePathname(pathname);

  if (locale === DEFAULT_LOCALE) {
    return `${SITE_URL}${normalizedPathname}`;
  }

  const prefix = LOCALE_PREFIXES[locale];
  return normalizedPathname === '/'
    ? `${SITE_URL}${prefix}`
    : `${SITE_URL}${prefix}${normalizedPathname}`;
}

export function buildLocalizedAlternates(pathname: string): LocalizedAlternates {
  return Object.fromEntries(
    HREFLANG_LOCALES.map((locale) => [locale, getLocalizedUrl(pathname, locale)]),
  ) as LocalizedAlternates;
}

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_SITEMAP_PATHS.map((pathname) => ({
    url: getLocalizedUrl(pathname, DEFAULT_LOCALE),
    lastModified: LAST_MODIFIED,
    alternates: {
      languages: buildLocalizedAlternates(pathname),
    },
  }));
}

function normalizePathname(pathname: string) {
  if (!pathname.startsWith('/')) return `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}
