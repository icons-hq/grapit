import { Controller, Get, Header, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  AdminSupportContentService,
  PUBLIC_SUPPORT_CONTENT_CACHE_TTL_SECONDS,
  SUPPORT_CONTENT_LOCALES,
  type PublishedSupportContentFilters,
} from './admin-support-content.service.js';

export const publishedSupportContentQuerySchema = z.object({
  locale: z.enum(SUPPORT_CONTENT_LOCALES),
});

/**
 * Per-tracker limit for the unauthenticated support content read. Higher than
 * the global default so shared NAT/carrier IPs can still open /support, while
 * a single client can no longer drive unbounded reads.
 */
export const PUBLIC_SUPPORT_CONTENT_THROTTLE = {
  limit: 120,
  ttl: 60_000,
} as const;

@Public()
@Throttle({ default: PUBLIC_SUPPORT_CONTENT_THROTTLE })
@Controller('support-content')
export class PublicSupportContentController {
  constructor(private readonly service: AdminSupportContentService) {}

  @Get()
  // Browser-only cache: a shared cache could not be purged when an urgent
  // notice is published or archived, so CDN/proxy caching stays off.
  @Header(
    'Cache-Control',
    `private, max-age=${PUBLIC_SUPPORT_CONTENT_CACHE_TTL_SECONDS}`,
  )
  listPublished(
    @Query(new ZodValidationPipe(publishedSupportContentQuerySchema))
    query: PublishedSupportContentFilters,
  ) {
    return this.service.listPublished(query);
  }
}
