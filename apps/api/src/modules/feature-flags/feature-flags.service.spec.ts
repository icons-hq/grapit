import { describe, expect, it } from 'vitest';
import { FLAG_NAMES } from '@grabit/shared';
import { FeatureFlagsService } from './feature-flags.service.js';

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
});
