import { z } from 'zod';
import { signupConsentRowsSchema } from '@grabit/shared';

export const registerBodySchema = z.object({
  email: z.string().email('올바른 이메일 주소를 입력해주세요'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(/[a-zA-Z]/, '비밀번호에 영문자가 포함되어야 합니다')
    .regex(/[0-9]/, '비밀번호에 숫자가 포함되어야 합니다')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, '비밀번호에 특수문자가 포함되어야 합니다'),
  name: z
    .string()
    .min(1, '이름을 입력해주세요')
    .max(50, '이름은 50자 이내로 입력해주세요'),
  gender: z.enum(['male', 'female', 'unspecified'], {
    errorMap: () => ({ message: '성별을 선택해주세요' }),
  }),
  country: z.string().min(1, '국가를 선택해주세요'),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '올바른 생년월일 형식이 아닙니다 (YYYY-MM-DD)'),
  phone: z.string().min(10, '올바른 전화번호를 입력해주세요').max(20),
  phoneVerificationCode: z.string().length(6, '인증번호 6자리를 입력해주세요'),
  termsOfService: z.literal(true, {
    errorMap: () => ({ message: '이용약관에 동의해주세요' }),
  }),
  privacyPolicy: z.literal(true, {
    errorMap: () => ({ message: '개인정보처리방침에 동의해주세요' }),
  }),
  marketingConsent: z.boolean(),
  consentItems: signupConsentRowsSchema,
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
