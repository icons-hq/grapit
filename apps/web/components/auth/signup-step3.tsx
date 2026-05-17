'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { COUNTRY_OPTIONS, type RegisterStep3Input } from '@grabit/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { PhoneVerification } from '@/components/auth/phone-verification';
import { getAuthLaunchCopy, type AuthLaunchCopy } from './auth-launch-copy';

interface SignupStep3Props {
  onComplete: (data: RegisterStep3Input) => void;
  onBack: () => void;
  isSubmitting: boolean;
  phoneVerificationPurpose?: 'signup' | 'social_registration';
}

const GENDER_OPTIONS = ['male', 'female', 'unspecified'] as const;
type SignupCopy = AuthLaunchCopy['signup'];

function createRegisterStep3Schema(copy: SignupCopy) {
  return z.object({
    name: z.string().min(1, copy.nameRequired).max(100, copy.nameMax),
    gender: z.enum(['male', 'female', 'unspecified'], {
      errorMap: () => ({ message: copy.genderRequired }),
    }),
    country: z.string().min(1, copy.countryRequired).max(100),
    birthYear: z.string().regex(/^\d{4}$/, copy.birthYearInvalid),
    birthMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, copy.birthMonthInvalid),
    birthDay: z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, copy.birthDayInvalid),
    phone: z.string().min(10, copy.phoneInvalid).max(20),
    phoneVerificationToken: z.string().min(1, copy.phoneVerificationRequired),
  });
}

function getGenderLabel(copy: SignupCopy, value: (typeof GENDER_OPTIONS)[number]) {
  const labels = {
    male: copy.genderMale,
    female: copy.genderFemale,
    unspecified: copy.genderUnspecified,
  } satisfies Record<(typeof GENDER_OPTIONS)[number], string>;

  return labels[value];
}

export function SignupStep3({
  onComplete,
  onBack,
  isSubmitting,
  phoneVerificationPurpose = 'signup',
}: SignupStep3Props) {
  const authCopy = getAuthLaunchCopy(useLocale());
  const signupCopy = authCopy.signup;
  const schema = useMemo(
    () => createRegisterStep3Schema(signupCopy),
    [signupCopy],
  );
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);

  const form = useForm<RegisterStep3Input>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      gender: undefined,
      country: 'KR',
      birthYear: '',
      birthMonth: '',
      birthDay: '',
      phone: '',
      phoneVerificationToken: '',
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const selectedGender = form.watch('gender');
  const phoneValue = form.watch('phone');

  function handlePhoneVerified(verificationToken: string) {
    setIsPhoneVerified(true);
    form.setValue('phoneVerificationToken', verificationToken, {
      shouldValidate: true,
    });
  }

  function onSubmit(data: RegisterStep3Input) {
    if (!isPhoneVerified) return;
    onComplete(data);
  }

  const isFormValid = form.formState.isValid && isPhoneVerified;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{signupCopy.nameLabel} <span className="text-error">*</span></FormLabel>
              <FormControl>
                <Input
                  placeholder={signupCopy.namePlaceholder}
                  autoComplete="name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Gender */}
        <FormField
          control={form.control}
          name="gender"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{signupCopy.genderLabel} <span className="text-error">*</span></FormLabel>
              <div className="flex gap-2">
                {GENDER_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => field.onChange(option)}
                    className={cn(
                      'flex h-10 flex-1 items-center justify-center rounded-lg border text-base transition-colors',
                      selectedGender === option
                        ? 'border-primary bg-primary/5 font-semibold text-primary'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300',
                    )}
                  >
                    {getGenderLabel(signupCopy, option)}
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Country */}
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{signupCopy.countryLabel} <span className="text-error">*</span></FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-11 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-base text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0"
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.value} value={country.value}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Birth date */}
        <div>
          <label className="text-base font-semibold leading-none text-gray-900">
            {signupCopy.birthDateLabel} <span className="text-error">*</span>
          </label>
          <div className="mt-2 flex gap-2">
            <FormField
              control={form.control}
              name="birthYear"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="YYYY"
                      aria-label={signupCopy.birthYearAriaLabel}
                      {...field}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        field.onChange(v.slice(0, 4));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="birthMonth"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      placeholder="MM"
                      aria-label={signupCopy.birthMonthAriaLabel}
                      {...field}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        field.onChange(v.slice(0, 2));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="birthDay"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      placeholder="DD"
                      aria-label={signupCopy.birthDayAriaLabel}
                      {...field}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        field.onChange(v.slice(0, 2));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Phone verification */}
        <div>
          <label className="text-base font-semibold leading-none text-gray-900">
            {signupCopy.phoneLabel} <span className="text-error">*</span>
          </label>
          <div className="mt-2">
            <PhoneVerification
              phone={phoneValue}
              onPhoneChange={(value) =>
                form.setValue('phone', value, { shouldValidate: true })
              }
              onVerified={handlePhoneVerified}
              isVerified={isPhoneVerified}
              error={form.formState.errors.phone?.message}
              purpose={phoneVerificationPurpose}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={onBack}
          >
            {signupCopy.previousButton}
          </Button>
          <Button
            type="submit"
            size="lg"
            className="flex-1"
            disabled={!isFormValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {signupCopy.submittingButton}
              </>
            ) : (
              signupCopy.submitButton
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
