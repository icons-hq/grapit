'use client';

import { useForm } from 'react-hook-form';
import { useLocale } from 'next-intl';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerStep1Schema, type RegisterStep1Input } from '@grabit/shared';
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

interface SignupStep1Props {
  onComplete: (data: RegisterStep1Input) => void;
  defaultValues: RegisterStep1Input | null;
}

export function SignupStep1({ onComplete, defaultValues }: SignupStep1Props) {
  const authCopy = getAuthLaunchCopy(useLocale());
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

  function onSubmit(data: RegisterStep1Input) {
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
          <Button type="submit" size="lg" className="w-full">
            {authCopy.form.nextButton}
          </Button>
        </div>
      </form>
    </Form>
  );
}
