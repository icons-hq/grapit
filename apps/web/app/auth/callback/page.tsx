'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type {
  AuthResponse,
  RegisterStep3Input,
  RegistrationPendingResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { useAuthStore } from '@/stores/use-auth-store';
import { StepIndicator } from '@/components/auth/step-indicator';
import { SignupStep2 } from '@/components/auth/signup-step2';
import type { SignupStep2SubmitData } from '@/components/auth/signup-step2';
import { SignupStep3 } from '@/components/auth/signup-step3';
import { EmailVerificationStatus } from '@/components/auth/email-verification-status';
import { getAuthLaunchCopy, type AuthLaunchCopy } from '@/components/auth/auth-launch-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';
import { buildAuthRoute, resolveSafeReturnToFromSearch } from '@/lib/auth-return';

const SOCIAL_ERROR_MESSAGE_KEYS: Record<string, keyof AuthLaunchCopy['socialErrors']> = {
  oauth_denied: 'oauthDenied',
  oauth_failed: 'oauthFailed',
  token_expired: 'tokenExpired',
  server_error: 'serverError',
  account_conflict: 'accountConflict',
};

function CallbackContent() {
  const router = useRouter();
  const authCopy = getAuthLaunchCopy(useLocale());
  const searchParams = useSearchParams();
  const returnTo = resolveSafeReturnToFromSearch(searchParams.toString());
  const loginPath = buildAuthRoute('/auth', authCopy.locale, { returnTo });
  const setAuth = useAuthStore((s) => s.setAuth);
  // status=authenticated 흐름에서는 root layout 의 AuthInitializer 가
  // POST /api/v1/auth/refresh + GET /api/v1/users/me 를 수행하고 store 를 채운다.
  // 콜백 페이지는 그 결과만 관측해 라우팅한다 — 직접 /auth/refresh 를 다시 호출하면
  // AuthInitializer 와 race 가 발생, refresh-token rotation 의 도난 탐지가 트리거되어
  // 패밀리 전체가 revoke 되고 401 이 반환된다.
  const user = useAuthStore((s) => s.user);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [registrationToken, setRegistrationToken] = useState('');
  const [currentStep, setCurrentStep] = useState<2 | 3>(2);
  const [step2Data, setStep2Data] = useState<SignupStep2SubmitData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step3Draft, setStep3Draft] = useState<Partial<RegisterStep3Input>>();
  const [errorInfo, setErrorInfo] = useState<{ code: string; provider?: string } | null>(null);
  const [emailVerificationEmail, setEmailVerificationEmail] = useState<string | null>(null);

  // searchParams 분기 결정은 마운트당 한 번만.
  const hasRunRef = useRef(false);
  // 라우팅도 한 번만 실행되어야 한다 (push 직후 user/isInitialized 변화로 재발사 방지).
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    const errorCode = searchParams.get('error');
    const provider = searchParams.get('provider');

    if (errorCode) {
      setErrorInfo({ code: errorCode, provider: provider ?? undefined });
      return;
    }

    const regToken = searchParams.get('registrationToken');
    const status = searchParams.get('status');
    const pendingEmail = searchParams.get('email');

    if (status === 'email_verification_required' && pendingEmail) {
      setEmailVerificationEmail(pendingEmail);
      router.replace(buildAuthRoute('/auth/verify-email', authCopy.locale, { email: pendingEmail, returnTo }));
      return;
    }

    if (status === 'needs_registration' && regToken) {
      // New social user -- needs registration completion
      setRegistrationToken(regToken);
      setNeedsRegistration(true);
      return;
    }

    if (status !== 'authenticated') {
      // Invalid callback
      hasRedirectedRef.current = true;
      toast.error(authCopy.callback.invalidAccess);
      router.push(loginPath);
    }
    // status === 'authenticated' 분기는 아래 watch effect 에서 처리.
  }, [searchParams, router, authCopy.locale, authCopy.callback.invalidAccess, loginPath, returnTo]);

  // status=authenticated 흐름: AuthInitializer 가 store 를 채울 때까지 대기 후 라우팅.
  useEffect(() => {
    if (hasRedirectedRef.current) return;

    const status = searchParams.get('status');
    if (status !== 'authenticated') return;

    if (user) {
      hasRedirectedRef.current = true;
      router.push(
        resolveSafeReturnToFromSearch(searchParams.toString()) ??
          getLocalizedPathname('/', authCopy.locale),
      );
      return;
    }
    if (isInitialized) {
      // AuthInitializer 가 끝났는데도 user 가 없다면 refresh 실패.
      hasRedirectedRef.current = true;
      toast.error(authCopy.socialErrors.oauthFailed);
      router.push(loginPath);
    }
  }, [user, isInitialized, searchParams, router, authCopy.locale, authCopy.socialErrors.oauthFailed, loginPath]);

  function handleStep2Complete(data: SignupStep2SubmitData) {
    setStep2Data(data);
    setCurrentStep(3);
  }

  async function handleStep3Complete(data: RegisterStep3Input) {
    if (!step2Data) return;

    setIsSubmitting(true);
    try {
      const payload = {
        registrationToken,
        termsOfService: step2Data.termsOfService,
        privacyPolicy: step2Data.privacyPolicy,
        marketingConsent: step2Data.marketingConsent,
        consentItems: step2Data.consentItems,
        name: data.name,
        gender: data.gender,
        country: data.country,
        birthDate: `${data.birthYear}-${data.birthMonth}-${data.birthDay}`,
        phone: data.phone,
        phoneVerificationToken: data.phoneVerificationToken,
        frontendOrigin: getFrontendOrigin(),
        locale: authCopy.locale,
      };

      const res = await apiClient.post<AuthResponse | RegistrationPendingResponse>(
        '/api/v1/auth/social/complete-registration',
        payload,
      );

      if ('emailVerificationRequired' in res) {
        setEmailVerificationEmail(res.email);
        router.replace(buildAuthRoute('/auth/verify-email', authCopy.locale, { email: res.email, emailDeliveryFailed: res.emailDeliveryFailed, returnTo }));
        if (res.emailDeliveryFailed) toast.error(authCopy.emailVerification.deliveryFailed);
        else toast.success(authCopy.form.signupComplete);
        return;
      }

      setAuth(res.accessToken, res.user);
      toast.success(authCopy.form.signupComplete);
      router.push(
        resolveSafeReturnToFromSearch(searchParams.toString()) ??
          getLocalizedPathname('/', authCopy.locale),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : authCopy.form.temporaryError;
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (errorInfo) {
    const message = authCopy.socialErrors[SOCIAL_ERROR_MESSAGE_KEYS[errorInfo.code] ?? 'serverError'];
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="flex max-w-[400px] flex-col items-center gap-4 px-4">
          <AlertCircle className="h-8 w-8 text-error" />
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">
              {message}
            </p>
          </div>
          <Button
            size="lg"
            className="mt-2 w-full max-w-[280px]"
            onClick={() =>
              router.push(loginPath)
            }
          >
            {authCopy.callback.retryButton}
          </Button>
        </div>
      </main>
    );
  }

  if (emailVerificationEmail) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          <EmailVerificationStatus returnTo={returnTo} email={emailVerificationEmail} />
        </div>
      </main>
    );
  }

  if (needsRegistration) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <h1 className="text-center text-heading font-semibold text-gray-900">
            {authCopy.signup.socialTitle}
          </h1>

          <StepIndicator
            currentStep={currentStep}
            ariaLabel={authCopy.signup.progressAriaLabel}
            labels={[
              authCopy.signup.socialStep,
              authCopy.signup.stepConsent,
              authCopy.signup.stepAdditional,
            ]}
          />

          <div
            className="transition-transform duration-200 ease-out"
            key={currentStep}
          >
            {currentStep === 2 && (
              <SignupStep2
                sourceFlow="social_completion"
                onComplete={handleStep2Complete}
                onBack={() =>
                  router.push(loginPath)
                }
                defaultValues={step2Data}
              />
            )}
            {currentStep === 3 && (
              <SignupStep3
                onComplete={handleStep3Complete}
                defaultValues={step3Draft}
                onBack={(draft) => { setStep3Draft(draft); setCurrentStep(2); }}
                isSubmitting={isSubmitting}
                phoneVerificationPurpose="social_registration"
              />
            )}
          </div>
        </div>
      </main>
    );
  }

  // 기본 상태: AuthInitializer 결과를 기다리거나 라우팅 직전. 로딩 UI 노출.
  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-base text-gray-500">{authCopy.callback.processing}</p>
      </div>
    </main>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
