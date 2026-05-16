'use client';

import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  resetPasswordRequestSchema,
  resetPasswordSchema,
  type ResetPasswordRequestInput,
  type ResetPasswordInput,
} from '@grabit/shared';
import { apiUrl } from '@/lib/api-url';
import { getFrontendOrigin } from '@/lib/frontend-origin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/auth/password-input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from '@/components/ui/form';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  if (token !== '') {
    return <ConfirmView key={token} token={token} />;
  }
  return <RequestView />;
}

function RequestView() {
  const [isSent, setIsSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<ResetPasswordRequestInput>({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(data: ResetPasswordRequestInput) {
    setIsLoading(true);
    try {
      await fetch(apiUrl('/api/v1/auth/password-reset/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...data, frontendOrigin: getFrontendOrigin() }),
      });
    } catch {
      // Always show success to prevent email enumeration
    } finally {
      setSentEmail(data.email);
      setIsSent(true);
      setIsLoading(false);
    }
  }

  if (isSent) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="space-y-3">
            <h1 className="text-heading font-semibold text-gray-900">
              비밀번호 재설정 메일 발송 완료
            </h1>
            <p className="text-base text-gray-700">
              {sentEmail}로 비밀번호 재설정 링크를 발송했습니다. 메일함을 확인해주세요.
            </p>
          </div>

          <Button asChild size="lg" className="w-full">
            <Link href="/auth">로그인으로 돌아가기</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-3">
          <h1 className="text-heading font-semibold text-gray-900">비밀번호 찾기</h1>
          <p className="text-base text-gray-700">
            가입 시 사용한 이메일을 입력하세요
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이메일</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="이메일을 입력해주세요"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  발송 중...
                </>
              ) : (
                '비밀번호 재설정 링크 발송'
              )}
            </Button>
          </form>
        </Form>

        <div className="text-center">
          <Link
            href="/auth"
            className="text-caption text-gray-500 hover:text-primary"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}

function ConfirmView({ token }: { token: string }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, newPassword: '', newPasswordConfirm: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  async function onSubmit(data: ResetPasswordInput) {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/v1/auth/password-reset/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (res.ok) {
        toast.success('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
        router.push('/auth');
        return;
      }

      if (res.status === 401) {
        setTokenError(true);
        return;
      }

      let message = '오류가 발생했습니다. 다시 시도해주세요.';
      if (res.status === 429) {
        message = '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
      }
      try {
        const errorData = (await res.json()) as { message?: string };
        if (res.status === 400 && errorData.message) {
          message = errorData.message;
        }
      } catch {
        // ignore JSON parse errors
      }
      toast.error(message);
    } catch {
      toast.error('오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }

  if (tokenError) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px] space-y-6">
          <div className="space-y-3">
            <h1 className="text-heading font-semibold text-gray-900">
              유효하지 않은 링크
            </h1>
            <p className="text-base text-gray-700">
              비밀번호 재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.
            </p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link href="/auth/reset-password">다시 요청하기</Link>
          </Button>
          <div className="text-center">
            <Link
              href="/auth"
              className="text-caption text-gray-500 hover:text-primary"
            >
              로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="space-y-3">
          <h1 className="text-heading font-semibold text-gray-900">새 비밀번호 설정</h1>
          <p className="text-base text-gray-700">
            새 비밀번호를 입력해주세요. 비밀번호는 8자 이상, 영문 + 숫자 + 특수문자를 포함해야 합니다.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    새 비밀번호 <span className="text-error">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="새 비밀번호를 입력해주세요"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>8자 이상, 영문+숫자+특수문자 포함</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPasswordConfirm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    새 비밀번호 확인 <span className="text-error">*</span>
                  </FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="새 비밀번호를 다시 입력해주세요"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  변경 중...
                </>
              ) : (
                '비밀번호 변경'
              )}
            </Button>
          </form>
        </Form>

        <div className="text-center">
          <Link
            href="/auth"
            className="text-caption text-gray-500 hover:text-primary"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}
