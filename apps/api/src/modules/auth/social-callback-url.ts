import type { Request } from 'express';
import {
  DEFAULT_LOCALE,
  LOCALE_PREFIXES,
  isSupportedLocale,
} from '@grabit/shared/constants/index.js';
import type { SupportedLocale } from '@grabit/shared/types/i18n.types.js';

type SocialLocaleQueryKey = 'locale' | 'state';

export function resolveSocialCallbackLocale(value: unknown): SupportedLocale | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string' || !isSupportedLocale(rawValue)) {
    return null;
  }
  return rawValue;
}

export function getSocialCallbackLocaleFromRequest(
  req: Request,
  queryKey: SocialLocaleQueryKey,
): SupportedLocale | null {
  return resolveSocialCallbackLocale(
    (req.query as Record<string, unknown> | undefined)?.[queryKey],
  );
}

export function buildSocialCallbackUrl(
  frontendUrl: string,
  locale: SupportedLocale | null,
  params: Record<string, string>,
): string {
  const localePrefix =
    locale && locale !== DEFAULT_LOCALE ? LOCALE_PREFIXES[locale] : '';
  const url = new URL(`${localePrefix}/auth/callback`, frontendUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
