'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { loginSchema, type LoginInput, type AuthResponse } from '@grabit/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { apiUrl } from '@/lib/api-url';
import { useAuthStore } from '@/stores/use-auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/auth/password-input';
import { SocialLoginButton } from '@/components/auth/social-login-button';
import {
  getAuthLaunchCopy,
  type AuthLaunchCopy,
} from '@/components/auth/auth-launch-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import Link from 'next/link';

const SOCIAL_LOGIN_ERRORS: Record<string, string> = {
  oauth_denied: '소셜 로그인이 취소되었습니다.',
  oauth_failed: '소셜 로그인에 실패했습니다. 다시 시도해주세요.',
  token_expired: '로그인 세션이 만료되었습니다. 다시 시도해주세요.',
  server_error: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
  account_conflict: '이미 다른 계정에 연결된 소셜 계정입니다.',
};

function getPostLoginDestination(res: AuthResponse, locale: AuthLaunchCopy['locale']) {
  if (res.user.isEmailVerified) {
    return getLocalizedPathname('/', locale);
  }

  const pathname = getLocalizedPathname('/auth/verify-email', locale);
  return `${pathname}?email=${encodeURIComponent(res.user.email)}`;
}

function SocialErrorMessage() {
  const searchParams = useSearchParams();
  const socialError = searchParams.get('error');

  if (!socialError || !SOCIAL_LOGIN_ERRORS[socialError]) {
    return null;
  }

  return (
    <p className="text-caption text-error animate-in fade-in duration-150">
      {SOCIAL_LOGIN_ERRORS[socialError]}
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const locale = useLocale();
  const authCopy = getAuthLaunchCopy(locale);
  const setAuth = useAuthStore((s) => s.setAuth);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(data: LoginInput) {
    setIsLoading(true);
    setLoginError(null);
    setStatusMessage(null);

    try {
      const res = await apiClient.post<AuthResponse>('/api/v1/auth/login', data);
      setAuth(res.accessToken, res.user);
      if (res.deviceLimitNotice) {
        setStatusMessage(authCopy.errors.deviceLimitNotice);
        toast.info(authCopy.errors.deviceLimitNotice);
      }
      router.push(getPostLoginDestination(res, authCopy.locale));
    } catch (error) {
      if (error instanceof ApiClientError && error.statusCode === 401) {
        setLoginError(authCopy.errors.invalidCredentials);
      } else if (error instanceof ApiClientError && error.statusCode === 403) {
        setLoginError(authCopy.errors.emailUnverified);
      } else if (error instanceof ApiClientError && error.statusCode === 428) {
        setLoginError(authCopy.errors.verificationRequired);
      } else if (error instanceof ApiClientError && error.statusCode === 503) {
        setLoginError(authCopy.errors.providerUnavailable);
      } else {
        setLoginError(authCopy.form.temporaryError);
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleSocialLogin(provider: 'kakao' | 'naver' | 'google') {
    setSocialLoading(provider);
    window.location.href = apiUrl(`/api/v1/auth/social/${provider}`);
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {authCopy.form.email} <span className="text-error">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder={authCopy.form.emailPlaceholder}
                    autoComplete="email"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {authCopy.form.password} <span className="text-error">*</span>
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder={authCopy.form.passwordPlaceholder}
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {loginError && (
            <p
              role="alert"
              className="text-caption text-error animate-in fade-in duration-150"
            >
              {loginError}
            </p>
          )}

          {statusMessage && (
            <p
              role="status"
              aria-live="polite"
              className="text-caption text-success animate-in fade-in duration-150"
            >
              {statusMessage}
            </p>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {authCopy.form.loginLoading}
                </>
              ) : (
                authCopy.form.loginButton
              )}
            </Button>
          </div>
        </form>
      </Form>

      <div className="flex justify-end">
        <Link
          href={getLocalizedPathname('/auth/reset-password', authCopy.locale)}
          className="text-caption text-gray-500 hover:text-primary"
        >
          {authCopy.form.forgotPassword}
        </Link>
      </div>

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-caption text-gray-400">
          {authCopy.form.separator}
        </span>
      </div>

      <Suspense fallback={null}>
        <SocialErrorMessage />
      </Suspense>

      <div className="space-y-3">
        <SocialLoginButton
          provider="kakao"
          onClick={() => handleSocialLogin('kakao')}
          isLoading={socialLoading === 'kakao'}
        />
        <SocialLoginButton
          provider="naver"
          onClick={() => handleSocialLogin('naver')}
          isLoading={socialLoading === 'naver'}
        />
        <SocialLoginButton
          provider="google"
          onClick={() => handleSocialLogin('google')}
          isLoading={socialLoading === 'google'}
        />
      </div>
    </div>
  );
}
