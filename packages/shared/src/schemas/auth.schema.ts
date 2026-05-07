import { z } from 'zod';
import {
  REQUIRED_CONSENT_ITEM_KEYS,
  consentCaptureItemSchema,
} from './consent.schema';

// Password validation: min 8 chars, must contain letter + number + special char
export const passwordSchema = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 합니다')
  .regex(/[a-zA-Z]/, '비밀번호에 영문자가 포함되어야 합니다')
  .regex(/[0-9]/, '비밀번호에 숫자가 포함되어야 합니다')
  .regex(/[!@#$%^&*(),.?":{}|<>]/, '비밀번호에 특수문자가 포함되어야 합니다');

// Login
export const loginSchema = z.object({
  email: z.string().email('올바른 이메일 주소를 입력해주세요'),
  password: z.string().min(1, '비밀번호를 입력해주세요'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Register Step 1: Email + Password
export const registerStep1Schema = z
  .object({
    email: z.string().email('올바른 이메일 주소를 입력해주세요'),
    password: passwordSchema,
    passwordConfirm: z.string().min(1, '비밀번호 확인을 입력해주세요'),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: '비밀번호가 일치하지 않습니다',
    path: ['passwordConfirm'],
  });

export type RegisterStep1Input = z.infer<typeof registerStep1Schema>;

const authConsentSourceFlowSchema = z.enum(['signup', 'social_completion']);

export const authConsentCaptureItemSchema = consentCaptureItemSchema.extend({
  required: z.boolean(),
  sourceFlow: authConsentSourceFlowSchema,
});

function createAuthConsentItemsSchema(sourceFlow: 'signup' | 'social_completion') {
  return z
    .array(
      authConsentCaptureItemSchema.superRefine((item, ctx) => {
        if (item.sourceFlow !== sourceFlow) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sourceFlow'],
            message: `${sourceFlow} consent source flow is required`,
          });
        }

        if (item.key === 'marketing' && item.required) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['required'],
            message: 'marketing consent must remain optional',
          });
        }

        if (item.key !== 'marketing' && !item.required) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['required'],
            message: `${item.key} consent must be marked required`,
          });
        }
      }),
    )
    .min(1, '동의 항목이 필요합니다')
    .superRefine((items, ctx) => {
      for (const key of REQUIRED_CONSENT_ITEM_KEYS) {
        const item = items.find((candidate) => candidate.key === key);

        if (!item) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['consentItems'],
            message: `${key} consent is required`,
          });
          continue;
        }

        if (!item.accepted) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['consentItems'],
            message: `${key} consent is required`,
          });
        }
      }
    });
}

export const signupConsentItemsSchema = createAuthConsentItemsSchema('signup');
export const socialCompletionConsentItemsSchema =
  createAuthConsentItemsSchema('social_completion');
export const signupConsentRowsSchema = signupConsentItemsSchema;
export const socialCompletionConsentRowsSchema = socialCompletionConsentItemsSchema;

export type AuthConsentCaptureItem = z.infer<typeof authConsentCaptureItemSchema>;

// Register Step 2: Terms Agreement (D-02)
export const registerStep2Schema = z.object({
  termsOfService: z.literal(true, {
    errorMap: () => ({ message: '이용약관에 동의해주세요' }),
  }),
  privacyPolicy: z.literal(true, {
    errorMap: () => ({ message: '개인정보처리방침에 동의해주세요' }),
  }),
  marketingConsent: z.boolean(),
  consentItems: signupConsentItemsSchema,
});

export type RegisterStep2Input = z.infer<typeof registerStep2Schema>;

// Register Step 3: Additional Info + SMS Verification (D-03)
export const registerStep3Schema = z.object({
  name: z.string().min(1, '이름을 입력해주세요').max(100, '이름은 100자 이내로 입력해주세요'),
  gender: z.enum(['male', 'female', 'unspecified'], {
    errorMap: () => ({ message: '성별을 선택해주세요' }),
  }),
  country: z.string().min(1, '국가를 선택해주세요').max(100),
  birthYear: z.string().regex(/^\d{4}$/, '올바른 출생연도를 입력해주세요'),
  birthMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, '올바른 출생월을 입력해주세요'),
  birthDay: z.string().regex(/^(0[1-9]|[12]\d|3[01])$/, '올바른 출생일을 입력해주세요'),
  phone: z.string().min(10, '올바른 전화번호를 입력해주세요').max(20),
  phoneVerificationToken: z.string().min(1, '전화번호 인증이 필요합니다'),
});

export type RegisterStep3Input = z.infer<typeof registerStep3Schema>;

// Password Reset Request
export const resetPasswordRequestSchema = z.object({
  email: z.string().email('올바른 이메일 주소를 입력해주세요'),
});

export type ResetPasswordRequestInput = z.infer<typeof resetPasswordRequestSchema>;

// Password Reset
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, '토큰이 필요합니다'),
    newPassword: passwordSchema,
    newPasswordConfirm: z.string().min(1, '비밀번호 확인을 입력해주세요'),
  })
  .refine((data) => data.newPassword === data.newPasswordConfirm, {
    message: '비밀번호가 일치하지 않습니다',
    path: ['newPasswordConfirm'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
