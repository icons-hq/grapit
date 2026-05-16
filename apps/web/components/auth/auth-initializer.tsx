'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { initializeAuth } from '@/lib/auth';
import { resolveLocaleFromPathname } from '@/i18n/routing';
import { useAuthStore } from '@/stores/use-auth-store';
import { resolveAuthLocale } from '@/components/auth/auth-launch-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';

export function AuthInitializer() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = resolveAuthLocale(useLocale());
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  useEffect(() => {
    void initializeAuth();
  }, []);

  useEffect(() => {
    if (!isInitialized || !user || user.isEmailVerified) {
      return;
    }

    const { pathnameWithoutLocale } = resolveLocaleFromPathname(pathname ?? '/');
    if (pathnameWithoutLocale === '/auth/verify-email') {
      return;
    }

    const verifyPath = getLocalizedPathname('/auth/verify-email', locale);
    router.push(`${verifyPath}?email=${encodeURIComponent(user.email)}`);
  }, [isInitialized, locale, pathname, router, user]);

  return null;
}
