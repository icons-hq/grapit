import { describe, expect, it } from 'vitest';

import { FLAG_NAMES, parseBooleanFlag, readFeatureFlags } from './flags';

describe('feature flag helpers', () => {
  it('defines BOOKING_ENABLED as the shared source-of-truth flag name', () => {
    expect(FLAG_NAMES.BOOKING_ENABLED).toBe('BOOKING_ENABLED');
  });

  it.each(['true', 'TRUE', '1', 'yes', 'YES', 'on', 'ON'])(
    'parses %s as true',
    (value) => {
      expect(parseBooleanFlag(value)).toBe(true);
    },
  );

  it.each(['false', 'FALSE', '0', 'no', 'NO', 'off', 'OFF', ''])(
    'parses %s as false',
    (value) => {
      expect(parseBooleanFlag(value)).toBe(false);
    },
  );

  it('defaults BOOKING_ENABLED to false when missing', () => {
    expect(readFeatureFlags({})).toEqual({ bookingEnabled: false });
    expect(readFeatureFlags({ BOOKING_ENABLED: undefined })).toEqual({ bookingEnabled: false });
  });

  it('reads BOOKING_ENABLED from the provided env record', () => {
    expect(readFeatureFlags({ BOOKING_ENABLED: 'yes' })).toEqual({ bookingEnabled: true });
    expect(readFeatureFlags({ BOOKING_ENABLED: 'off' })).toEqual({ bookingEnabled: false });
  });
});
