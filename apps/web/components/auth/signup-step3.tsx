'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { registerStep3Schema, type RegisterStep3Input } from '@grabit/shared';
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

interface SignupStep3Props {
  onComplete: (data: RegisterStep3Input) => void;
  onBack: () => void;
  isSubmitting: boolean;
  phoneVerificationPurpose?: 'signup' | 'social_registration';
}

const GENDER_OPTIONS = [
  { value: 'male' as const, label: '남성' },
  { value: 'female' as const, label: '여성' },
  { value: 'unspecified' as const, label: '선택안함' },
];

const COUNTRIES = [
  '대한민국',
  '미국',
  '일본',
  '중국',
  '영국',
  '캐나다',
  '호주',
  '기타',
];

export function SignupStep3({
  onComplete,
  onBack,
  isSubmitting,
  phoneVerificationPurpose = 'signup',
}: SignupStep3Props) {
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);

  const form = useForm<RegisterStep3Input>({
    resolver: zodResolver(registerStep3Schema),
    defaultValues: {
      name: '',
      gender: undefined,
      country: '대한민국',
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
              <FormLabel>이름 <span className="text-error">*</span></FormLabel>
              <FormControl>
                <Input
                  placeholder="이름을 입력해주세요"
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
              <FormLabel>성별 <span className="text-error">*</span></FormLabel>
              <div className="flex gap-2">
                {GENDER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => field.onChange(option.value)}
                    className={cn(
                      'flex h-10 flex-1 items-center justify-center rounded-lg border text-base transition-colors',
                      selectedGender === option.value
                        ? 'border-primary bg-primary/5 font-semibold text-primary'
                        : 'border-gray-200 text-gray-700 hover:border-gray-300',
                    )}
                  >
                    {option.label}
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
              <FormLabel>국가 <span className="text-error">*</span></FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-11 w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-base text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
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
            생년월일 <span className="text-error">*</span>
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
            전화번호 <span className="text-error">*</span>
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
            이전
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
                처리 중...
              </>
            ) : (
              '가입 완료'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
