'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import { useLocale } from 'next-intl';
import type { UserProfile } from '@grabit/shared';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/use-auth-store';
import { getAuthLaunchCopy, resolveAuthLocale } from './auth-launch-copy';

type EmailVerificationState =
  | 'sent'
  | 'loading'
  | 'resendSuccess'
  | 'expired'
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
  const accessToken = useAuthStore((state) => state.accessToken);
  const setAuth = useAuthStore((state) => state.setAuth);
  const hasRequestedRef = useRef(false);
  const [state, setState] = useState<EmailVerificationState>(
    token || requestOnMount ? 'loading' : initialState,
  );

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
            setState(result.verified ? 'verified' : 'systemError');
            if (result.verified && accessToken) {
              void apiClient
                .get<UserProfile>('/api/v1/users/me', { showErrorToast: false })
                .then((user) => setAuth(accessToken, user))
                .catch(() => undefined);
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
  }, [accessToken, activeLocale, email, requestOnMount, setAuth, token]);

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
    state === 'expired' || state === 'throttled' || state === 'systemError';
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
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={handleResend}
          disabled={state === 'loading'}
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
      )}
    </div>
  );
}
