import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '@grabit/shared';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { getVisibleCopy } from './visible-copy';

export function getClientLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  const pathLocale = resolveLocaleFromPathname(window.location.pathname).locale;
  if (pathLocale !== DEFAULT_LOCALE) return pathLocale;

  const cookieLocale = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('NEXT_LOCALE='))
    ?.split('=')[1];

  return cookieLocale && isSupportedLocale(cookieLocale)
    ? cookieLocale
    : DEFAULT_LOCALE;
}

export function getClientVisibleCopy() {
  return getVisibleCopy(getClientLocale());
}

export function formatCopy(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ''),
  );
}
