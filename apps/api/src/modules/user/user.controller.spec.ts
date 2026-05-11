import { describe, it, expect } from 'vitest';
import { updateProfileSchema } from '@grabit/shared/schemas/user.schema.js';

describe('UserController preferred locale validation', () => {
  it('accepts a supported preferredLocale in profile update DTOs', () => {
    const parsed = updateProfileSchema.parse({ preferredLocale: 'ja' });

    expect(parsed.preferredLocale).toBe('ja');
  });

  it('rejects unsupported preferredLocale values before service persistence', () => {
    expect(() =>
      updateProfileSchema.parse({ preferredLocale: 'zh-TW' }),
    ).toThrow();
  });
});
