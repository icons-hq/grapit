'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { toast } from 'sonner';
import type {
  RegisterStep1Input,
  RegisterStep3Input,
  RegisterResponse,
} from '@grabit/shared';
import { apiClient } from '@/lib/api-client';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { useAuthStore } from '@/stores/use-auth-store';
import { StepIndicator } from '@/components/auth/step-indicator';
import { SignupStep1 } from '@/components/auth/signup-step1';
import { SignupStep2 } from '@/components/auth/signup-step2';
import type { SignupStep2SubmitData } from '@/components/auth/signup-step2';
import { SignupStep3 } from '@/components/auth/signup-step3';
import { EmailVerificationStatus } from '@/components/auth/email-verification-status';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';

export function SignupForm() {
  const authCopy = getAuthLaunchCopy(useLocale());
  const setAuth = useAuthStore((s) => s.setAuth);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [step1Data, setStep1Data] = useState<RegisterStep1Input | null>(null);
  const [step2Data, setStep2Data] = useState<SignupStep2SubmitData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailVerificationEmail, setEmailVerificationEmail] = useState<
    string | null
  >(null);

  function handleStep1Complete(data: RegisterStep1Input) {
    setStep1Data(data);
    setCurrentStep(2);
  }

  function handleStep2Complete(data: SignupStep2SubmitData) {
    setStep2Data(data);
    setCurrentStep(3);
  }

  async function handleStep3Complete(data: RegisterStep3Input) {
    if (!step1Data || !step2Data) return;

    const birthDate = `${data.birthYear}-${data.birthMonth}-${data.birthDay}`;
    if (isUnderFourteen(birthDate)) {
      toast.error(authCopy.form.under14Blocked);
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
        locale: authCopy.locale,
        frontendOrigin: getFrontendOrigin(),
      };

      const res = await apiClient.post<RegisterResponse>(
        '/api/v1/auth/register',
        payload,
      );
      if ('accessToken' in res) {
        setAuth(res.accessToken, res.user);
      }
      setEmailVerificationEmail(step1Data.email);
      toast.success(authCopy.form.signupComplete);
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

  return (
    <div className="space-y-6">
      {emailVerificationEmail ? (
        <EmailVerificationStatus email={emailVerificationEmail} />
      ) : (
        <>
          <StepIndicator
            currentStep={currentStep}
            ariaLabel={authCopy.signup.progressAriaLabel}
            labels={[
              authCopy.signup.stepCredentials,
              authCopy.signup.stepConsent,
              authCopy.signup.stepAdditional,
            ]}
          />

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
