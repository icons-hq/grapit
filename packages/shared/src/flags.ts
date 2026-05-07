export const FLAG_NAMES = {
  BOOKING_ENABLED: 'BOOKING_ENABLED',
} as const;

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

export function parseBooleanFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return defaultValue;
}

export function readFeatureFlags(env: Record<string, string | undefined>): { bookingEnabled: boolean } {
  return {
    bookingEnabled: parseBooleanFlag(env[FLAG_NAMES.BOOKING_ENABLED], false),
  };
}
