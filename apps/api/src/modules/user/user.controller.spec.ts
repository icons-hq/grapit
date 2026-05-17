import { describe, it, expect } from 'vitest';
import { updateProfileSchema } from '@grabit/shared/schemas/user.schema.js';

describe('UserController preferred locale validation', () => {
  it('accepts a supported preferredLocale in profile update DTOs', () => {
    const parsed = updateProfileSchema.parse({
      preferredLocale: 'zh-CN',
      marketingConsent: true,
    });

    expect(parsed.preferredLocale).toBe('zh-CN');
    expect(parsed.marketingConsent).toBe(true);
  });

  it('rejects unsupported preferredLocale values before service persistence', () => {
    const staleLocale = ['zh', 'TW'].join('-');

    expect(() =>
      updateProfileSchema.parse({ preferredLocale: staleLocale }),
    ).toThrow();
  });
});
