'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type {
  RegisterStep1Input,
  RegisterStep2Input,
  RegisterStep3Input,
  RegisterResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/use-auth-store';
import { StepIndicator } from '@/components/auth/step-indicator';
import { SignupStep1 } from '@/components/auth/signup-step1';
import { SignupStep2 } from '@/components/auth/signup-step2';
import { SignupStep3 } from '@/components/auth/signup-step3';
import { EmailVerificationStatus } from '@/components/auth/email-verification-status';

const UNDER_14_BLOCK_MESSAGE = '만 14세 미만은 가입할 수 없습니다';

export function SignupForm() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [step1Data, setStep1Data] = useState<RegisterStep1Input | null>(null);
  const [step2Data, setStep2Data] = useState<RegisterStep2Input | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailVerificationEmail, setEmailVerificationEmail] = useState<
    string | null
  >(null);

  function handleStep1Complete(data: RegisterStep1Input) {
    setStep1Data(data);
    setCurrentStep(2);
  }

  function handleStep2Complete(data: RegisterStep2Input) {
    setStep2Data(data);
    setCurrentStep(3);
  }

  async function handleStep3Complete(data: RegisterStep3Input) {
    if (!step1Data || !step2Data) return;

    const birthDate = `${data.birthYear}-${data.birthMonth}-${data.birthDay}`;
    if (isUnderFourteen(birthDate)) {
      toast.error(UNDER_14_BLOCK_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    try {
      const consentRows = step2Data.consentItems;
      const payload = {
        email: step1Data.email,
        password: step1Data.password,
        termsOfService: step2Data.termsOfService,
        privacyPolicy: step2Data.privacyPolicy,
        marketingConsent: step2Data.marketingConsent,
        consentItems: consentRows,
        name: data.name,
        gender: data.gender,
        country: data.country,
        birthDate,
        phone: data.phone,
        phoneVerificationToken: data.phoneVerificationToken,
      };

      const res = await apiClient.post<RegisterResponse>(
        '/api/v1/auth/register',
        payload,
      );
      if ('accessToken' in res) {
        setAuth(res.accessToken, res.user);
      }
      setEmailVerificationEmail(step1Data.email);
      toast.success('회원가입이 완료되었습니다. 이메일 인증을 진행해주세요.');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {emailVerificationEmail ? (
        <EmailVerificationStatus email={emailVerificationEmail} />
      ) : (
        <>
          <StepIndicator currentStep={currentStep} />

          <div
            className="transition-transform duration-200 ease-out"
            key={currentStep}
          >
            {currentStep === 1 && (
              <SignupStep1
                onComplete={handleStep1Complete}
                defaultValues={step1Data}
              />
            )}
            {currentStep === 2 && (
              <SignupStep2
                onComplete={handleStep2Complete}
                onBack={() => setCurrentStep(1)}
                defaultValues={step2Data}
              />
            )}
            {currentStep === 3 && (
              <SignupStep3
                onComplete={handleStep3Complete}
                onBack={() => setCurrentStep(2)}
                isSubmitting={isSubmitting}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function isUnderFourteen(birthDate: string, at: Date = new Date()): boolean {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) {
    return false;
  }

  const fourteenthBirthday = new Date(birth);
  fourteenthBirthday.setUTCFullYear(fourteenthBirthday.getUTCFullYear() + 14);

  return at < fourteenthBirthday;
}
