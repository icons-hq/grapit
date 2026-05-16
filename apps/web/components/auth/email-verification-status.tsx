'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { UserProfile } from '@grabit/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/use-auth-store';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { getAuthLaunchCopy, resolveAuthLocale } from './auth-launch-copy';

type EmailVerificationState =
  | 'sent'
  | 'loading'
  | 'resendSuccess'
  | 'expired'
  | 'invalidCode'
  | 'verified'
  | 'throttled'
  | 'systemError';

interface EmailVerificationStatusProps {
  email: string;
  token?: string;
  initialState?: Exclude<EmailVerificationState, 'loading' | 'resendSuccess'>;
  requestOnMount?: boolean;
  locale?: string;
}

function mapEmailVerificationError(error: unknown): EmailVerificationState {
  if (error instanceof ApiClientError) {
    if (error.statusCode === 429) return 'throttled';
    if (error.statusCode === 410 || error.statusCode === 422) return 'expired';
    if (error.statusCode === 400 || error.statusCode === 401) return 'invalidCode';
  }
  return 'systemError';
}

export function EmailVerificationStatus({
  email,
  token,
  initialState = 'sent',
  requestOnMount = false,
  locale,
}: EmailVerificationStatusProps) {
  const contextLocale = useLocale();
  const activeLocale = resolveAuthLocale(locale ?? contextLocale);
  const copy = getAuthLaunchCopy(activeLocale).emailVerification;
  const router = useRouter();
  const accessToken = useAuthStore((state) => state.accessToken);
  const setAuth = useAuthStore((state) => state.setAuth);
  const hasRequestedRef = useRef(false);
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [state, setState] = useState<EmailVerificationState>(
    token || requestOnMount ? 'loading' : initialState,
  );

  const refreshCurrentUser = useCallback(async () => {
    if (!accessToken) return;

    try {
      const user = await apiClient.get<UserProfile>('/api/v1/users/me', {
        showErrorToast: false,
      });
      setAuth(accessToken, user);
    } catch {
      // Verification already succeeded; navigation should not be blocked by profile refresh.
    }
  }, [accessToken, setAuth]);

  const completeVerification = useCallback(async () => {
    setState('verified');
    await refreshCurrentUser();
    router.replace(getLocalizedPathname('/', activeLocale));
  }, [activeLocale, refreshCurrentUser, router]);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;
    let cancelled = false;

    if (token) {
      void (async () => {
        try {
          const result = await apiClient.post<{ verified: boolean }>(
            '/api/v1/auth/email-verification/verify',
            { token },
            { showErrorToast: false },
          );
          if (!cancelled) {
            if (result.verified) {
              await completeVerification();
            } else {
              setState('systemError');
            }
          }
        } catch (error) {
          if (!cancelled) {
            setState(mapEmailVerificationError(error));
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    if (requestOnMount) {
      void (async () => {
        if (!email) return;

        try {
          await apiClient.post(
            '/api/v1/auth/email-verification/request',
            { email, locale: activeLocale, frontendOrigin: getFrontendOrigin() },
            { showErrorToast: false },
          );
          if (!cancelled) {
            setState('sent');
          }
        } catch (error) {
          if (!cancelled) {
            setState(mapEmailVerificationError(error));
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [activeLocale, completeVerification, email, requestOnMount, token]);

  async function handleVerifyCode() {
    if (!email || code.length !== 6) return;

    setIsVerifying(true);
    try {
      const result = await apiClient.post<{ verified: boolean }>(
        '/api/v1/auth/email-verification/verify',
        { email, code },
        { showErrorToast: false },
      );
      if (result.verified) {
        await completeVerification();
      } else {
        setState('systemError');
      }
    } catch (error) {
      setState(mapEmailVerificationError(error));
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleResend() {
    if (!email) return;

    setState('loading');
    try {
      await apiClient.post(
        '/api/v1/auth/email-verification/resend',
        { email, locale: activeLocale, frontendOrigin: getFrontendOrigin() },
        { showErrorToast: false },
      );
      setState('resendSuccess');
    } catch (error) {
      setState(mapEmailVerificationError(error));
    }
  }

  const isAlert =
    state === 'expired' ||
    state === 'invalidCode' ||
    state === 'throttled' ||
    state === 'systemError';
  const statusText =
    state === 'loading'
      ? copy.resendLoading
      : state === 'resendSuccess'
        ? copy.resendSuccess
        : copy[state];

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {state === 'verified' ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        ) : state === 'loading' ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : (
          <MailWarning className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        )}
        <p
          role={isAlert ? 'alert' : 'status'}
          aria-live={isAlert ? undefined : 'polite'}
          className={
            isAlert
              ? 'text-caption text-error'
              : state === 'verified'
                ? 'text-caption text-success'
                : 'text-caption text-gray-700'
          }
        >
          {statusText}
        </p>
      </div>

      {state !== 'verified' && email && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-label={copy.codeAriaLabel}
              placeholder={copy.codePlaceholder}
              value={code}
              onChange={(event) => {
                const nextCode = event.target.value.replace(/[^0-9]/g, '');
                setCode(nextCode.slice(0, 6));
              }}
              disabled={state === 'loading' || isVerifying}
              className="flex-1"
            />
            <Button
              type="button"
              size="lg"
              onClick={handleVerifyCode}
              disabled={code.length !== 6 || state === 'loading' || isVerifying}
              className="shrink-0"
            >
              {isVerifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                copy.verifyCta
              )}
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handleResend}
            disabled={state === 'loading'}
            className="w-full"
          >
            {state === 'loading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {copy.resendLoading}
              </>
            ) : (
              copy.resendCta
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
