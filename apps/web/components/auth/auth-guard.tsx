'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/use-auth-store';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getClientLocale } from '@/lib/i18n/client-copy';
import { resolveSafeReturnTo } from '@/lib/auth-return';

const WITHDRAWAL_REDIRECT_FLAG = 'grabit:withdrawalRedirect';

interface AuthGuardProps {
  children: React.ReactNode;
}

function getAuthRedirectPath() {
  const authPath = getLocalizedPathname('/auth', getClientLocale());
  try {
    if (window.sessionStorage.getItem(WITHDRAWAL_REDIRECT_FLAG) === '1') {
      window.sessionStorage.removeItem(WITHDRAWAL_REDIRECT_FLAG);
      return `${authPath}?withdrawn=1`;
    }
  } catch {
    // Fall back to the default auth route when session storage is unavailable.
  }

  const returnTo = resolveSafeReturnTo(`${window.location.pathname}${window.location.search}`);
  return returnTo ? `${authPath}?returnTo=${encodeURIComponent(returnTo)}` : authPath;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const { isInitialized, accessToken } = useAuthStore();

  useEffect(() => {
    if (isInitialized && !accessToken) {
      router.push(getAuthRedirectPath());
    }
  }, [isInitialized, accessToken, router]);

  if (!isInitialized) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessToken) {
    return null;
  }

  return <>{children}</>;
}
