import { resolveAuthReturnTo, type SupportedLocale } from '@grabit/shared';
import { getLocalizedPathname } from '@/lib/i18n/locale-path';

/**
 * Resolve a post-auth destination that router.push/replace and Link may navigate to.
 * The shared normalizer rejects external targets; in the browser we additionally
 * require that the resolved URL keeps the current origin so a future normalizer
 * regression cannot turn a returnTo into an external navigation.
 */
export function resolveSafeReturnTo(value: string | null | undefined): string | null {
  const returnTo = resolveAuthReturnTo(value);
  if (!returnTo || typeof window === 'undefined') return returnTo;
  try {
    return new URL(returnTo, window.location.origin).origin === window.location.origin ? returnTo : null;
  } catch {
    return null;
  }
}

export function resolveSafeReturnToFromSearch(search: string): string | null {
  return resolveSafeReturnTo(new URLSearchParams(search).get('returnTo'));
}

export function buildAuthRoute(
  route: '/auth' | '/auth/verify-email' | '/auth/reset-password',
  locale: SupportedLocale,
  options: { email?: string; verified?: boolean; emailDeliveryFailed?: boolean; returnTo?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (options.email) params.set('email', options.email);
  if (options.emailDeliveryFailed) params.set('delivery', 'failed');
  if (options.verified) params.set('verified', '1');
  const returnTo = resolveSafeReturnTo(options.returnTo);
  if (returnTo) params.set('returnTo', returnTo);
  return `${getLocalizedPathname(route, locale)}${params.size ? `?${params}` : ''}`;
}
