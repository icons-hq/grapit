import { describe, expect, it } from 'vitest';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import { FLAG_NAMES } from '@grabit/shared';
import { FeatureFlagsModule } from './feature-flags.module.js';
import {
  FEATURE_FLAGS_ENV_PROVIDER,
  FeatureFlagsService,
} from './feature-flags.service.js';

describe('FeatureFlagsService', () => {
  it('returns false when BOOKING_ENABLED is missing', () => {
    const service = new FeatureFlagsService(() => ({}));

    expect(service.getFlags().bookingEnabled).toBe(false);
  });

  it.each([
    ['true'],
    ['1'],
    ['yes'],
    ['on'],
  ])('parses %s as booking enabled', (value) => {
    const service = new FeatureFlagsService(() => ({
      [FLAG_NAMES.BOOKING_ENABLED]: value,
    }));

    expect(service.getFlags().bookingEnabled).toBe(true);
  });

  it.each([
    ['false'],
    ['0'],
    ['no'],
    ['off'],
    [''],
  ])('parses %s as booking disabled', (value) => {
    const service = new FeatureFlagsService(() => ({
      [FLAG_NAMES.BOOKING_ENABLED]: value,
    }));

    expect(service.getFlags().bookingEnabled).toBe(false);
  });

  it('ignores client-public booking flag names in API runtime parsing', () => {
    const publicBookingFlagName = `NEXT_PUBLIC_${FLAG_NAMES.BOOKING_ENABLED}`;
    const service = new FeatureFlagsService(() => ({
      [publicBookingFlagName]: 'true',
    }));

    expect(service.getFlags().bookingEnabled).toBe(false);
  });

  it('compiles in a Nest module with the default runtime env provider', async () => {
    const originalBookingEnabled = process.env[FLAG_NAMES.BOOKING_ENABLED];
    process.env[FLAG_NAMES.BOOKING_ENABLED] = 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [FeatureFlagsModule],
    }).compile();

    try {
      const service = moduleRef.get(FeatureFlagsService);

      expect(service.getFlags().bookingEnabled).toBe(true);
    } finally {
      if (originalBookingEnabled === undefined) {
        delete process.env[FLAG_NAMES.BOOKING_ENABLED];
      } else {
        process.env[FLAG_NAMES.BOOKING_ENABLED] = originalBookingEnabled;
      }
      await moduleRef.close();
    }
  });

  it('uses an explicit env provider token instead of Function metadata for Nest DI', () => {
    const selfDeclaredDeps = Reflect.getMetadata(
      SELF_DECLARED_DEPS_METADATA,
      FeatureFlagsService,
    ) as Array<{ index: number; param: unknown }> | undefined;

    expect(selfDeclaredDeps ?? []).toContainEqual({
      index: 0,
      param: FEATURE_FLAGS_ENV_PROVIDER,
    });
  });
});
