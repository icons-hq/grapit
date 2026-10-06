import { BadRequestException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  PUBLIC_SUPPORT_CONTENT_THROTTLE,
  PublicSupportContentController,
  publishedSupportContentQuerySchema,
} from './public-support-content.controller.js';

const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';
const DEFAULT_LIMIT_METADATA = 'THROTTLER:LIMITdefault';
const DEFAULT_TTL_METADATA = 'THROTTLER:TTLdefault';

describe('PublicSupportContentController', () => {
  it('stays public but keeps a per-client throttle instead of skipping it', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicSupportContentController))
      .toBe(true);
    expect(
      Reflect.getMetadata(DEFAULT_SKIP_METADATA, PublicSupportContentController),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        DEFAULT_SKIP_METADATA,
        PublicSupportContentController.prototype.listPublished,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(DEFAULT_LIMIT_METADATA, PublicSupportContentController),
    ).toBe(PUBLIC_SUPPORT_CONTENT_THROTTLE.limit);
    expect(
      Reflect.getMetadata(DEFAULT_TTL_METADATA, PublicSupportContentController),
    ).toBe(PUBLIC_SUPPORT_CONTENT_THROTTLE.ttl);
  });

  it('lets browsers reuse the response briefly without shared-cache storage', () => {
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        PublicSupportContentController.prototype.listPublished,
      ),
    ).toEqual([{ name: 'Cache-Control', value: 'private, max-age=30' }]);
  });

  it('rejects unsupported locales through its query validation schema', () => {
    const pipe = new ZodValidationPipe(publishedSupportContentQuerySchema);

    expect(() => pipe.transform({ locale: 'fr' })).toThrow(BadRequestException);
  });

  it('delegates validated locale filters to the support content service', async () => {
    const service = {
      listPublished: vi.fn().mockResolvedValue({ faqs: [], notices: [] }),
    };
    const controller = new PublicSupportContentController(service as never);

    await expect(controller.listPublished({ locale: 'en' })).resolves.toEqual({
      faqs: [],
      notices: [],
    });
    expect(service.listPublished).toHaveBeenCalledWith({ locale: 'en' });
  });
});
