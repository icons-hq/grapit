'use client';

import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  registerStep1Schema,
  type EmailAvailabilityResponse,
  type RegisterStep1Input,
} from '@grabit/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form';
import { PasswordInput } from '@/components/auth/password-input';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';
import { apiClient } from '@/lib/api-client';

interface SignupStep1Props {
  onComplete: (data: RegisterStep1Input) => void;
  defaultValues: RegisterStep1Input | null;
}

const EMAIL_AVAILABILITY_ERROR = '이미 사용 중인 이메일입니다';

export function SignupStep1({ onComplete, defaultValues }: SignupStep1Props) {
  const authCopy = getAuthLaunchCopy(useLocale());
  const emailAvailabilityCacheRef = useRef<{
    email: string;
    available: boolean;
  } | null>(null);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const form = useForm<RegisterStep1Input>({
    resolver: zodResolver(registerStep1Schema),
    defaultValues: defaultValues ?? {
      email: '',
      password: '',
      passwordConfirm: '',
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  function clearAvailabilityError() {
    if (form.getFieldState('email').error?.type === 'availability') {
      form.clearErrors('email');
    }
  }

  async function checkEmailAvailability(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return false;

    const cached = emailAvailabilityCacheRef.current;
    if (cached?.email === normalizedEmail) {
      if (!cached.available) {
        form.setError('email', {
          type: 'availability',
          message: EMAIL_AVAILABILITY_ERROR,
        });
      } else {
        clearAvailabilityError();
      }

      return cached.available;
    }

    setIsCheckingEmail(true);
    try {
      const result = await apiClient.get<EmailAvailabilityResponse>(
        `/api/v1/auth/email-availability?email=${encodeURIComponent(normalizedEmail)}`,
        { showErrorToast: false },
      );

      emailAvailabilityCacheRef.current = {
        email: normalizedEmail,
        available: result.available,
      };

      if (form.getValues('email').trim().toLowerCase() !== normalizedEmail) {
        return true;
      }

      if (!result.available) {
        form.setError('email', {
          type: 'availability',
          message: EMAIL_AVAILABILITY_ERROR,
        });
        return false;
      }

      clearAvailabilityError();
      return true;
    } catch {
      return true;
    } finally {
      setIsCheckingEmail(false);
    }
  }

  async function onSubmit(data: RegisterStep1Input) {
    const available = await checkEmailAvailability(data.email);
    if (!available) return;

    onComplete(data);
  }

  return (
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
                  onChange={(event) => {
                    field.onChange(event);
                    clearAvailabilityError();
                  }}
                  onBlur={async () => {
                    field.onBlur();
                    const isEmailValid = await form.trigger('email');
                    if (isEmailValid) {
                      await checkEmailAvailability(form.getValues('email'));
                    }
                  }}
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
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormDescription>{authCopy.form.passwordDescription}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="passwordConfirm"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {authCopy.form.passwordConfirm} <span className="text-error">*</span>
              </FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder={authCopy.form.passwordConfirmPlaceholder}
                  autoComplete="new-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isCheckingEmail}
          >
            {authCopy.form.nextButton}
          </Button>
        </div>
      </form>
    </Form>
  );
}
