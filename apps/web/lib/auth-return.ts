import { resolveAuthReturnTo, type SupportedLocale } from '@grabit/shared';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';

export const resolveSafeReturnTo = resolveAuthReturnTo;

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
