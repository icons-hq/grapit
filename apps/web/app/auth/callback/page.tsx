'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { AuthResponse, RegisterStep2Input, RegisterStep3Input } from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { StepIndicator } from '@/components/auth/step-indicator';
import { SignupStep2 } from '@/components/auth/signup-step2';
import { SignupStep3 } from '@/components/auth/signup-step3';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';
import { getLocalizedPathname } from '@/components/i18n/locale-switcher';

const SOCIAL_ERROR_MESSAGES: Record<string, { title: string; detail: string }> = {
  oauth_denied: {
    title: '로그인이 취소되었습니다.',
    detail: '다시 로그인해주세요.',
  },
  oauth_failed: {
    title: '소셜 로그인에 실패했습니다.',
    detail: '잠시 후 다시 시도해주세요.',
  },
  token_expired: {
    title: '로그인 세션이 만료되었습니다.',
    detail: '다시 로그인해주세요.',
  },
  server_error: {
    title: '일시적인 오류가 발생했습니다.',
    detail: '잠시 후 다시 시도해주세요.',
  },
  account_conflict: {
    title: '이미 다른 계정에 연결된 소셜 계정입니다.',
    detail: '기존 계정으로 로그인해주세요.',
  },
};

function CallbackContent() {
  const router = useRouter();
  const authCopy = getAuthLaunchCopy(useLocale());
  const searchParams = useSearchParams();
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
  const [step2Data, setStep2Data] = useState<RegisterStep2Input | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorInfo, setErrorInfo] = useState<{ code: string; provider?: string } | null>(null);

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

    if (status === 'needs_registration' && regToken) {
      // New social user -- needs registration completion
      setRegistrationToken(regToken);
      setNeedsRegistration(true);
      return;
    }

    if (status !== 'authenticated') {
      // Invalid callback
      hasRedirectedRef.current = true;
      toast.error('잘못된 접근입니다.');
      router.push(getLocalizedPathname('/auth', authCopy.locale));
    }
    // status === 'authenticated' 분기는 아래 watch effect 에서 처리.
  }, [searchParams, router, authCopy.locale]);

  // status=authenticated 흐름: AuthInitializer 가 store 를 채울 때까지 대기 후 라우팅.
  useEffect(() => {
    if (hasRedirectedRef.current) return;

    const status = searchParams.get('status');
    if (status !== 'authenticated') return;

    if (user) {
      hasRedirectedRef.current = true;
      router.push(getLocalizedPathname('/', authCopy.locale));
      return;
    }
    if (isInitialized) {
      // AuthInitializer 가 끝났는데도 user 가 없다면 refresh 실패.
      hasRedirectedRef.current = true;
      toast.error('로그인에 실패했습니다.');
      router.push(getLocalizedPathname('/auth', authCopy.locale));
    }
  }, [user, isInitialized, searchParams, router, authCopy.locale]);

  function handleStep2Complete(data: RegisterStep2Input) {
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
        name: data.name,
        gender: data.gender,
        country: data.country,
        birthDate: `${data.birthYear}-${data.birthMonth}-${data.birthDay}`,
        phone: data.phone,
        phoneVerificationToken: data.phoneVerificationToken,
      };

      const res = await apiClient.post<AuthResponse>(
        '/api/v1/auth/social/complete-registration',
        payload,
      );
      setAuth(res.accessToken, res.user);
      toast.success(authCopy.form.signupComplete);
      router.push(getLocalizedPathname('/', authCopy.locale));
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
    const messages = SOCIAL_ERROR_MESSAGES[errorInfo.code] ?? SOCIAL_ERROR_MESSAGES['server_error']!;
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="flex max-w-[400px] flex-col items-center gap-4 px-4">
          <AlertCircle className="h-8 w-8 text-error" />
          <div className="text-center">
            <p className="text-base font-semibold text-gray-900">
              {messages.title}
            </p>
            <p className="mt-2 text-caption text-gray-600">
              {messages.detail}
            </p>
          </div>
          <Button
            size="lg"
            className="mt-2 w-full max-w-[280px]"
            onClick={() =>
              router.push(getLocalizedPathname('/auth', authCopy.locale))
            }
          >
            다시 로그인하기
          </Button>
        </div>
      </main>
    );
  }

  if (needsRegistration) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <h1 className="text-center text-heading font-semibold text-gray-900">
            추가 정보 입력
          </h1>

          <StepIndicator
            currentStep={currentStep}
            labels={['소셜 로그인', '약관 동의', '추가 정보']}
          />

          <div
            className="transition-transform duration-200 ease-out"
            key={currentStep}
          >
            {currentStep === 2 && (
              <SignupStep2
                onComplete={handleStep2Complete}
                onBack={() =>
                  router.push(getLocalizedPathname('/auth', authCopy.locale))
                }
                defaultValues={step2Data}
              />
            )}
            {currentStep === 3 && (
              <SignupStep3
                onComplete={handleStep3Complete}
                onBack={() => setCurrentStep(2)}
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
        <p className="text-base text-gray-500">로그인 처리 중...</p>
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
