import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  SMS_VERIFICATION_PURPOSES,
  SmsService,
  type SendResult,
  type VerifyResult,
} from './sms.service.js';

export const sendCodeSchema = z.object({
  phone: z.string().regex(
    /^(01[016789]\d{7,8}|\+[1-9]\d{6,14})$/,
    '올바른 휴대폰 번호를 입력해주세요',
  ),
});

const verifyCodeSchema = z.object({
  phone: z.string().min(1, '전화번호를 입력해주세요'),
  code: z.string().length(6, '인증번호는 6자리입니다'),
  purpose: z.enum(SMS_VERIFICATION_PURPOSES).default('signup'),
});

type SendCodeBody = z.infer<typeof sendCodeSchema>;
type VerifyCodeBody = z.infer<typeof verifyCodeSchema>;

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  // Hotfix 260517: signup SMS must not be blocked by shared IP traffic.
  @Post('send-code')
  async sendCode(
    @Body(new ZodValidationPipe(sendCodeSchema)) dto: SendCodeBody,
  ): Promise<SendResult> {
    return this.smsService.sendVerificationCode(dto.phone);
  }

  /**
   * Verify an SMS OTP.
   *
   * SECURITY: A `{ verified: true }` response is NOT by itself proof that the
   * calling client owns the phone number for every downstream action. The
   * service verifies the submitted OTP and does not short-circuit on the
   * `sms:verified` flag here; downstream consumers (signup, password-reset)
   * still must correlate this response with the session that initiated the
   * original `/send-code` call.
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  // Hotfix 260517: signup SMS must not be blocked by shared IP traffic.
  @Post('verify-code')
  async verifyCode(
    @Body(new ZodValidationPipe(verifyCodeSchema)) dto: VerifyCodeBody,
  ): Promise<VerifyResult> {
    return this.smsService.verifyCode(dto.phone, dto.code, dto.purpose);
  }
}
