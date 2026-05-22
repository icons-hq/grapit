'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useAuthStore } from '@/stores/use-auth-store';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LoginForm } from '@/components/auth/login-form';
import { SignupForm } from '@/components/auth/signup-form';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';
import { resolveSafeReturnToFromSearch } from '@/lib/auth-return';

export default function AuthPage() {
  const router = useRouter();
  const locale = useLocale();
  const authCopy = getAuthLaunchCopy(locale);
  const { isInitialized, accessToken, user } = useAuthStore();

  // Redirect if already authenticated
  useEffect(() => {
    if (isInitialized && accessToken) {
      if (user?.isEmailVerified === false) {
        const pathname = getLocalizedPathname('/auth/verify-email', authCopy.locale);
        router.push(`${pathname}?email=${encodeURIComponent(user.email)}`);
        return;
      }

      const returnTo =
        typeof window === 'undefined'
          ? null
          : resolveSafeReturnToFromSearch(window.location.search);
      router.push(returnTo ?? getLocalizedPathname('/', authCopy.locale));
    }
  }, [isInitialized, accessToken, user, router, authCopy.locale]);

  if (isInitialized && accessToken) {
    return null;
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="login">{authCopy.tabs.login}</TabsTrigger>
            <TabsTrigger value="signup">{authCopy.tabs.signup}</TabsTrigger>
          </TabsList>
          <TabsContent
            value="login"
            className="animate-in fade-in duration-150 ease-in-out"
          >
            <LoginForm />
          </TabsContent>
          <TabsContent
            value="signup"
            className="animate-in fade-in duration-150 ease-in-out"
          >
            <SignupForm />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
