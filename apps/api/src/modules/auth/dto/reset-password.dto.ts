import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@grabit/shared/constants/index.js';
import {
  resetPasswordRequestSchema,
  resetPasswordSchema,
} from '@grabit/shared/schemas/auth.schema.js';

export const resetPasswordRequestBodySchema = resetPasswordRequestSchema.extend({
  frontendOrigin: z.string().url().max(200).optional(),
  locale: z.enum(SUPPORTED_LOCALES).optional(),
  returnTo: z.string().max(2048).optional(),
});
export type ResetPasswordRequestBody = z.infer<typeof resetPasswordRequestBodySchema>;

export const resetPasswordBodySchema = resetPasswordSchema;
export type ResetPasswordBody = {
  token: string;
  newPassword: string;
  newPasswordConfirm: string;
};
