import { z } from 'zod';
import {
  resetPasswordRequestSchema,
  resetPasswordSchema,
} from '@grabit/shared/schemas/auth.schema.js';

export const resetPasswordRequestBodySchema = resetPasswordRequestSchema.extend({
  frontendOrigin: z.string().url().max(200).optional(),
});
export type ResetPasswordRequestBody = {
  email: string;
  frontendOrigin?: string;
};

export const resetPasswordBodySchema = resetPasswordSchema;
export type ResetPasswordBody = {
  token: string;
  newPassword: string;
  newPasswordConfirm: string;
};
