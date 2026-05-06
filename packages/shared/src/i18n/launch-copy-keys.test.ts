import { describe, expect, it } from 'vitest';

import {
  LAUNCH_COPY_KEYS,
  LAUNCH_COPY_LOCALES,
  LAUNCH_COPY_NAMESPACES,
} from './launch-copy-keys';

const expectedLocales = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;
const expectedNamespaces = [
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
  'sms.otp',
] as const;

describe('launch copy key manifest', () => {
  it('requires exactly the five launch locales', () => {
    expect(LAUNCH_COPY_LOCALES).toEqual(expectedLocales);
  });

  it('requires auth/email/OTP/SMS namespaces only', () => {
    expect(LAUNCH_COPY_NAMESPACES).toEqual(expectedNamespaces);
    expect(Object.keys(LAUNCH_COPY_KEYS)).toEqual(expectedNamespaces);
  });

  it('lists required keys for every namespace in every launch locale', () => {
    for (const namespace of expectedNamespaces) {
      expect(Object.keys(LAUNCH_COPY_KEYS[namespace])).toEqual(expectedLocales);

      const localeKeySets = expectedLocales.map((locale) => {
        const keys = LAUNCH_COPY_KEYS[namespace][locale];

        expect(keys.length).toBeGreaterThan(0);
        expect(keys).toEqual([...keys].sort());
        expect(new Set(keys).size).toBe(keys.length);

        return keys;
      });

      for (const keys of localeKeySets) {
        expect(keys).toEqual(localeKeySets[0]);
      }
    }
  });

  it('includes the critical auth/email/OTP/SMS launch copy keys', () => {
    expect(LAUNCH_COPY_KEYS['auth.emailVerification'].ko).toEqual([
      'expired',
      'resendCta',
      'resendLoading',
      'resendSuccess',
      'sent',
      'verified',
    ]);
    expect(LAUNCH_COPY_KEYS['auth.otp'].ko).toEqual([
      'sendCta',
      'sending',
      'verifyCta',
      'verified',
    ]);
    expect(LAUNCH_COPY_KEYS['auth.errors'].ko).toEqual([
      'expiredOtp',
      'generic',
      'invalidOtp',
      'rateLimited',
      'unsupportedCountry',
    ]);
    expect(LAUNCH_COPY_KEYS['sms.otp'].ko).toEqual([
      'message',
      'rateLimited',
      'verified',
    ]);
  });
});
