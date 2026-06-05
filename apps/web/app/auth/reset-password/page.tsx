'use client';

import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  resetPasswordRequestSchema,
  resetPasswordSchema,
  type ResetPasswordRequestInput,
  type ResetPasswordInput,
} from '@grabit/shared';
import { apiUrl } from '@/lib/api-url';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getVisibleCopy } from '@/lib/i18n/visible-copy';
import { getClientLocale } from '@/lib/i18n/client-copy';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  if (token !== '') {
    return <ConfirmView key={token} token={token} />;
  }
  return <RequestView />;
}

function RequestView() {
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).resetPassword;
  const [isSent, setIsSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<ResetPasswordRequestInput>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(data: ResetPasswordRequestInput) {
    setIsLoading(true);
    try {
      await fetch(apiUrl('/api/v1/auth/password-reset/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...data, frontendOrigin: getFrontendOrigin() }),
      });
    } catch {
      // Always show success to prevent email enumeration
    } finally {
      setSentEmail(data.email);
      setIsSent(true);
      setIsLoading(false);
    }
  }

  if (isSent) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="space-y-3">
            <h1 className="text-heading font-semibold text-gray-900">
              {copy.sentTitle}
            </h1>
            <p className="text-base text-gray-700">
              {copy.sentBody.replace('{email}', sentEmail)}
            </p>
          </div>

          <Button asChild size="lg" className="w-full">
            <Link href={getLocalizedPathname('/auth', locale)}>{copy.backToLogin}</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-3">
          <h1 className="text-heading font-semibold text-gray-900">{copy.requestTitle}</h1>
          <p className="text-base text-gray-700">
            {copy.requestBody}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{copy.email}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={copy.emailPlaceholder}
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {copy.sending}
                </>
              ) : (
                copy.requestCta
              )}
            </Button>
          </form>
        </Form>

        <div className="text-center">
          <Link
            href={getLocalizedPathname('/auth', locale)}
            className="text-caption text-gray-500 hover:text-primary"
          >
            {copy.backToLogin}
          </Link>
        </div>
      </div>
    </main>
  );
}

function ConfirmView({ token }: { token: string }) {
  const router = useRouter();
  const locale = getClientLocale();
  const copy = getVisibleCopy(locale).resetPassword;
  const [isLoading, setIsLoading] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, newPassword: '', newPasswordConfirm: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(data: ResetPasswordInput) {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/v1/auth/password-reset/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (res.ok) {
        toast.success(copy.successToast);
        router.push(getLocalizedPathname('/auth', locale));
        return;
      }

      if (res.status === 401) {
        setTokenError(true);
        return;
      }

      let message = getVisibleCopy(locale).commonErrors.default;
      if (res.status === 429) {
        message = copy.tooManyRequests;
      }
      try {
        const errorData = (await res.json()) as { message?: string };
        if (res.status === 400 && errorData.message) {
          message = errorData.message;
        }
      } catch {
        // ignore JSON parse errors
      }
      toast.error(message);
    } catch {
      toast.error(getVisibleCopy(locale).commonErrors.default);
    } finally {
      setIsLoading(false);
    }
  }

  if (tokenError) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="space-y-3">
            <h1 className="text-heading font-semibold text-gray-900">
              {copy.invalidTitle}
            </h1>
            <p className="text-base text-gray-700">
              {copy.invalidBody}
            </p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href={getLocalizedPathname('/auth/reset-password', locale)}>{copy.requestAgain}</Link>
          </Button>
          <div className="text-center">
            <Link
              href={getLocalizedPathname('/auth', locale)}
              className="text-caption text-gray-500 hover:text-primary"
            >
              {copy.backToLogin}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-3">
          <h1 className="text-heading font-semibold text-gray-900">{copy.confirmTitle}</h1>
          <p className="text-base text-gray-700">
            {copy.confirmBody}
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {copy.newPassword} <span className="text-error">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={copy.newPasswordPlaceholder}
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{copy.passwordRule}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPasswordConfirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {copy.newPasswordConfirm} <span className="text-error">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder={copy.newPasswordConfirmPlaceholder}
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {copy.changing}
                </>
              ) : (
                copy.changeCta
              )}
            </Button>
          </form>
        </Form>

        <div className="text-center">
          <Link
            href={getLocalizedPathname('/auth', locale)}
            className="text-caption text-gray-500 hover:text-primary"
          >
            {copy.backToLogin}
          </Link>
        </div>
      </div>
    </main>
  );
}
