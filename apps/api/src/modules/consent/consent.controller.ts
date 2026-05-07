import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  consentCaptureRequestSchema,
  SUPPORTED_LOCALES,
  type ConsentCaptureRequest,
} from '@grabit/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { resolveTrustedRequestIp } from '../../common/request-ip.js';
import { ConsentService } from './consent.service.js';

const consentItemsQuerySchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).default('ko'),
});

@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Public()
  @Get('items')
  async getActiveItems(
    @Query(new ZodValidationPipe(consentItemsQuerySchema))
    query: z.infer<typeof consentItemsQuerySchema>,
  ) {
    return this.consentService.getActiveConsentItems(query.locale);
  }

  @Post('capture')
  async captureConsent(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(consentCaptureRequestSchema))
    body: ConsentCaptureRequest,
    @Req() req: Request,
  ) {
    await this.consentService.captureConsent(user.id, body, {
      ipAddress: resolveTrustedRequestIp(req),
      userAgent: req.get('user-agent'),
    });

    return { captured: true };
  }
}
