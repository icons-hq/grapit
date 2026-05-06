import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { SmsService, type SendResult, type VerifyResult } from './sms.service.js';

export const sendCodeSchema = z.object({
  phone: z.string().regex(
    /^(01[016789]\d{7,8}|\+[1-9]\d{6,14})$/,
    '올바른 휴대폰 번호를 입력해주세요',
  ),
});

const verifyCodeSchema = z.object({
  phone: z.string().min(1, '전화번호를 입력해주세요'),
  code: z.string().length(6, '인증번호는 6자리입니다'),
});

type SendCodeBody = z.infer<typeof sendCodeSchema>;
type VerifyCodeBody = z.infer<typeof verifyCodeSchema>;

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  // D-06 IP axis: 20 req/h/IP. defense-in-depth 확장으로 IP axis도 rate limit 적용.
  // [Review #6: v6 ms 단위, 3_600_000ms = 1h, NOT 3600s]
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
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  // D-07 IP axis: 10 req/15min/IP. D-07은 phone 10/15min만 명시하나,
  // IP axis 10/15min은 defense-in-depth 확장: 단일 IP에서 다수 phone 번호를 돌려
  // phone axis를 우회하는 enumeration 공격을 IP 레벨에서 차단.
  // [Review #6: v6 ms 단위, 900_000ms = 15min, NOT 900s]
  @Post('verify-code')
  async verifyCode(
    @Body(new ZodValidationPipe(verifyCodeSchema)) dto: VerifyCodeBody,
  ): Promise<VerifyResult> {
    return this.smsService.verifyCode(dto.phone, dto.code);
  }
}
