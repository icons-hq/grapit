import { describe, it, expect } from 'vitest';
import { updateProfileSchema } from '@grabit/shared/schemas/user.schema.js';

describe('UserController preferred locale validation', () => {
  it('accepts a supported preferredLocale in profile update DTOs', () => {
    const parsed = updateProfileSchema.parse({ preferredLocale: 'zh-TW' });

    expect(parsed.preferredLocale).toBe('zh-TW');
  });

  it('rejects unsupported preferredLocale values before service persistence', () => {
    const unsupportedLocale = ['j', 'a'].join('');

    expect(() =>
      updateProfileSchema.parse({ preferredLocale: unsupportedLocale }),
    ).toThrow();
  });
});
