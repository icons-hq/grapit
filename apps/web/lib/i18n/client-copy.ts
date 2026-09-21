import { DEFAULT_LOCALE, type SupportedLocale } from '@grabit/shared';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { getVisibleCopy } from './visible-copy';

export function getClientLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  // The URL is the explicit display-language choice, including unprefixed Korean.
  return resolveLocaleFromPathname(window.location.pathname).locale;
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
