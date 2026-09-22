import { DEFAULT_LOCALE, resolveAuthReturnTo, type SupportedLocale } from '@grabit/shared';
import { resolveLocaleFromPathname } from '@/i18n/routing';

export function getLocalizedPathname(pathname: string, locale: SupportedLocale) {
  const { pathnameWithoutLocale } = resolveLocaleFromPathname(pathname);
  if (locale === DEFAULT_LOCALE) return pathnameWithoutLocale;
  return pathnameWithoutLocale === '/' ? `/${locale}` : `/${locale}${pathnameWithoutLocale}`;
}

export function appendSearchParams(pathname: string, query: string) {
  return query ? `${pathname}?${query}` : pathname;
}

export function getLocalizedNavigationPath(pathname: string, query: string, locale: SupportedLocale, depth = 0): string {
  const params = new URLSearchParams(query);
  if (params.has('returnTo')) {
    const safeReturn = depth < 3 ? resolveAuthReturnTo(params.get('returnTo')) : null;
    if (safeReturn) {
      const target = new URL(safeReturn, 'https://heygrabit.local');
      params.set('returnTo', `${getLocalizedNavigationPath(target.pathname, target.search, locale, depth + 1)}${target.hash}`);
    } else params.delete('returnTo');
  }
  return appendSearchParams(getLocalizedPathname(pathname, locale), params.toString());
}
