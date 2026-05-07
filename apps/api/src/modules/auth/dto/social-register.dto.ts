import { z } from 'zod';
import { socialCompletionConsentRowsSchema } from '@grabit/shared';

export const socialRegisterBodySchema = z.object({
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
  phoneVerificationToken: z.string().min(1, '전화번호 인증이 필요합니다'),
  termsOfService: z.literal(true, {
    errorMap: () => ({ message: '이용약관에 동의해주세요' }),
  }),
  privacyPolicy: z.literal(true, {
    errorMap: () => ({ message: '개인정보처리방침에 동의해주세요' }),
  }),
  marketingConsent: z.boolean(),
  consentItems: socialCompletionConsentRowsSchema,
});

export type SocialRegisterBody = z.infer<typeof socialRegisterBodySchema>;

export const completeSocialRegistrationSchema = z.object({
  registrationToken: z.string().min(1, '등록 토큰이 필요합니다'),
  ...socialRegisterBodySchema.shape,
});

export type CompleteSocialRegistrationBody = z.infer<typeof completeSocialRegistrationSchema>;
