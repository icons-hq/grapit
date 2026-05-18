import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../constants/locales';

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, '이름을 입력해주세요')
    .max(50, '이름은 50자 이내로 입력해주세요')
    .optional(),
  phone: z
    .string()
    .min(10, '올바른 전화번호를 입력해주세요')
    .max(20)
    .optional(),
  phoneVerificationToken: z.string().min(1, '전화번호 인증이 필요합니다').optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES).optional(),
  marketingConsent: z.boolean().optional(),
});

export const accountWithdrawalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  confirmed: z.literal(true, {
    errorMap: () => ({ message: '회원 탈퇴 확인이 필요합니다' }),
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AccountWithdrawalInput = z.infer<typeof accountWithdrawalSchema>;
