import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  AdminSupportContentService,
  SUPPORT_CONTENT_LOCALES,
  type PublishedSupportContentFilters,
} from './admin-support-content.service.js';

export const publishedSupportContentQuerySchema = z.object({
  locale: z.enum(SUPPORT_CONTENT_LOCALES),
});

@Public()
@SkipThrottle()
@Controller('support-content')
export class PublicSupportContentController {
  constructor(private readonly service: AdminSupportContentService) {}

  @Get()
  listPublished(
    @Query(new ZodValidationPipe(publishedSupportContentQuerySchema))
    query: PublishedSupportContentFilters,
  ) {
    return this.service.listPublished(query);
  }
}
