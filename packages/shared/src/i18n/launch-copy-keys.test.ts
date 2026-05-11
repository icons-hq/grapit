import { describe, expect, it } from 'vitest';

import {
  LAUNCH_COPY_KEYS,
  LAUNCH_COPY_LOCALES,
  LAUNCH_COPY_NAMESPACES,
} from './launch-copy-keys';

const expectedLocales = ['ko', 'en', 'th', 'zh-CN', 'ja'] as const;
const expectedNamespaces = [
  'nav',
  'home',
  'search',
  'performance',
  'booking',
  'auth.form',
  'auth.consent',
  'auth.emailVerification',
  'auth.otp',
  'auth.errors',
  'sms.otp',
] as const;

describe('launch copy key manifest', () => {
  it('requires exactly the five launch locales', () => {
    expect(LAUNCH_COPY_LOCALES).toEqual(expectedLocales);
  });

  it('requires every canary-visible launch namespace', () => {
    expect(LAUNCH_COPY_NAMESPACES).toEqual(expectedNamespaces);
    expect(Object.keys(LAUNCH_COPY_KEYS)).toEqual(expectedNamespaces);
  });

  it('lists required keys for every namespace in every launch locale', () => {
    for (const namespace of expectedNamespaces) {
      expect(Object.keys(LAUNCH_COPY_KEYS[namespace])).toEqual(expectedLocales);

      const localeKeySets = expectedLocales.map((locale) => {
        const keys = LAUNCH_COPY_KEYS[namespace][locale];

        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);

        return keys;
      });

      for (const keys of localeKeySets) {
        expect(keys).toEqual(localeKeySets[0]);
      }
    }
  });

  it('includes the critical visible surface launch copy keys', () => {
    expect(LAUNCH_COPY_KEYS.nav.ko).toEqual([
      'searchPlaceholder',
      'searchAriaLabel',
      'clearSearch',
      'moreGenres',
      'loginSignup',
      'mypage',
      'logout',
      'language',
      'category',
    ]);
    expect(LAUNCH_COPY_KEYS.home.ko).toEqual([
      'hot',
      'newOpen',
      'genreShortcuts',
      'more',
      'empty',
    ]);
    expect(LAUNCH_COPY_KEYS.search.ko).toEqual([
      'promptTitle',
      'promptBody',
      'resultTitle',
      'totalCount',
      'includeEnded',
      'loadError',
      'retry',
      'emptyHeading',
      'emptyBody',
    ]);
    expect(LAUNCH_COPY_KEYS.performance.ko).toEqual([
      'posterAltSuffix',
      'detailTab',
      'salesTab',
      'noDetail',
      'refundTitle',
      'refundItems',
      'loadError',
      'retry',
      'bookCta',
    ]);
    expect(LAUNCH_COPY_KEYS.booking.ko).toEqual(['disabled']);
    expect(LAUNCH_COPY_KEYS['auth.form'].ko).toEqual([
      'email',
      'password',
      'emailPlaceholder',
      'passwordPlaceholder',
      'passwordDescription',
      'passwordConfirm',
      'passwordConfirmPlaceholder',
      'loginButton',
      'loginLoading',
      'nextButton',
      'forgotPassword',
      'separator',
      'signupComplete',
      'under14Blocked',
      'temporaryError',
    ]);
    expect(LAUNCH_COPY_KEYS['auth.consent'].ko).toEqual([
      'selectAll',
      'required',
      'optional',
      'view',
      'previous',
      'next',
      'dialogDescriptionSuffix',
    ]);
  });

  it('preserves the critical auth/email/OTP/SMS launch copy keys', () => {
    expect(LAUNCH_COPY_KEYS['auth.emailVerification'].ko).toEqual([
      'sent',
      'resendCta',
      'resendLoading',
      'resendSuccess',
      'expired',
      'verified',
      'throttled',
      'systemError',
    ]);
    expect(LAUNCH_COPY_KEYS['auth.otp'].ko).toEqual([
      'sent',
      'resendCta',
      'resendLoading',
      'resendSuccess',
      'expired',
      'invalidCode',
      'throttled',
      'systemError',
    ]);
    expect(LAUNCH_COPY_KEYS['auth.errors'].ko).toEqual([
      'invalidCredentials',
      'emailUnverified',
      'verificationRequired',
      'providerUnavailable',
      'deviceLimitNotice',
    ]);
    expect(LAUNCH_COPY_KEYS['sms.otp'].ko).toEqual([
      'message',
      'rateLimited',
      'verified',
    ]);
  });
});
