import type { Request } from 'express';
import {
  DEFAULT_LOCALE,
  LOCALE_PREFIXES,
  isSupportedLocale,
} from '@grabit/shared/constants/index.js';
import type { SupportedLocale } from '@grabit/shared/types/i18n.types.js';

type SocialLocaleQueryKey = 'locale' | 'state';
type SocialCallbackStateQueryKey = 'state';

type SocialCallbackState = {
  locale: SupportedLocale | null;
  returnTo: string | null;
};

const LOCAL_RETURN_ORIGIN = 'https://heygrabit.local';

export function resolveSocialCallbackLocale(value: unknown): SupportedLocale | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string') {
    return null;
  }
  if (isSupportedLocale(rawValue)) {
    return rawValue;
  }

  const locale = new URLSearchParams(rawValue).get('locale');
  return locale && isSupportedLocale(locale) ? locale : null;
}

export function resolveSafeSocialReturnTo(value: unknown): string | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\0')) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, LOCAL_RETURN_ORIGIN);
    if (parsed.origin !== LOCAL_RETURN_ORIGIN) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function resolveSocialCallbackState(value: unknown): SocialCallbackState {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string') {
    return { locale: null, returnTo: null };
  }

  if (isSupportedLocale(rawValue)) {
    return { locale: rawValue, returnTo: null };
  }

  const params = new URLSearchParams(rawValue);
  const locale = resolveSocialCallbackLocale(params.get('locale'));
  const returnTo = resolveSafeSocialReturnTo(params.get('returnTo'));
  return { locale, returnTo };
}

export function getSocialCallbackLocaleFromRequest(
  req: Request,
  queryKey: SocialLocaleQueryKey,
): SupportedLocale | null {
  return resolveSocialCallbackLocale(
    (req.query as Record<string, unknown> | undefined)?.[queryKey],
  );
}

export function getSocialCallbackStateFromRequest(
  req: Request,
  queryKey: SocialCallbackStateQueryKey,
): SocialCallbackState {
  return resolveSocialCallbackState(
    (req.query as Record<string, unknown> | undefined)?.[queryKey],
  );
}

export function buildSocialOAuthState(
  locale: unknown,
  returnTo: unknown,
): string | undefined {
  const resolvedLocale = resolveSocialCallbackLocale(locale);
  const resolvedReturnTo = resolveSafeSocialReturnTo(returnTo);

  if (!resolvedReturnTo) {
    return resolvedLocale ?? undefined;
  }

  const params = new URLSearchParams();
  if (resolvedLocale) {
    params.set('locale', resolvedLocale);
  }
  params.set('returnTo', resolvedReturnTo);
  return params.toString();
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
