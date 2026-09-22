import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldError, Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { getAuthLaunchCopy } from '@/components/auth/auth-launch-copy';

/** Keep the shared credential rules; translate only their flat form errors. */
export function authFormResolver<TSchema extends z.ZodTypeAny>(schema: TSchema, locale: string): Resolver<z.infer<TSchema>> {
  const resolve = zodResolver(schema);
  const copy = getAuthLaunchCopy(locale).validation;
  const messages: Record<string, string> = {
    '올바른 이메일 주소를 입력해주세요': copy.email,
    '비밀번호를 입력해주세요': copy.password,
    '비밀번호 확인을 입력해주세요': copy.confirm,
    '비밀번호가 일치하지 않습니다': copy.mismatch,
    '비밀번호는 8자 이상이어야 합니다': copy.rules,
    '비밀번호에 영문자가 포함되어야 합니다': copy.rules,
    '비밀번호에 숫자가 포함되어야 합니다': copy.rules,
    '비밀번호에 특수문자가 포함되어야 합니다': copy.rules,
    '토큰이 필요합니다': copy.link,
  };
  return async (values, context, options) => {
    const result = await resolve(values, context, options);
    for (const error of Object.values(result.errors) as FieldError[]) {
      if (error?.message && messages[error.message]) error.message = messages[error.message];
    }
    return result;
  };
}
