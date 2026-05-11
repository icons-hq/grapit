import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PrewarmService } from './prewarm.service.js';

const prewarmScaleRequestSchema = z.object({
  minInstances: z.number().int().min(0),
});

const prewarmStepDownRequestSchema = z.object({
  minInstances: z.number().int().min(0).optional(),
});

type PrewarmScaleRequestBody = z.infer<typeof prewarmScaleRequestSchema>;
type PrewarmStepDownRequestBody = z.infer<typeof prewarmStepDownRequestSchema>;

@Public()
@Controller('internal/prewarm')
export class PrewarmController {
  constructor(private readonly prewarmService: PrewarmService) {}

  @Post('services/:serviceName')
  @HttpCode(HttpStatus.ACCEPTED)
  async scaleUpService(
    @Param('serviceName') serviceName: string,
    @Body(new ZodValidationPipe(prewarmScaleRequestSchema)) body: PrewarmScaleRequestBody,
    @Req() req: Request,
  ) {
    return this.prewarmService.scaleUp(serviceName, body.minInstances, req);
  }

  @Post('services/:serviceName/step-down')
  @HttpCode(HttpStatus.ACCEPTED)
  async stepDownService(
    @Param('serviceName') serviceName: string,
    @Body(new ZodValidationPipe(prewarmStepDownRequestSchema))
    body: PrewarmStepDownRequestBody,
    @Req() req: Request,
  ) {
    return this.prewarmService.stepDown(serviceName, body.minInstances, req);
  }
}
