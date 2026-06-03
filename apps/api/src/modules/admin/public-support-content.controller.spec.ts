import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  PublicSupportContentController,
  publishedSupportContentQuerySchema,
} from './public-support-content.controller.js';

const DEFAULT_SKIP_METADATA = 'THROTTLER:SKIPdefault';

describe('PublicSupportContentController', () => {
  it('marks public support content reads public and throttle-skipped', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicSupportContentController))
      .toBe(true);
    expect(
      Reflect.getMetadata(DEFAULT_SKIP_METADATA, PublicSupportContentController),
    ).toBe(true);
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
