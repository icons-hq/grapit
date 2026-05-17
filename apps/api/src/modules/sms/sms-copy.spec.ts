import { describe, expect, it } from 'vitest';
import {
  authStatusCopy,
  formatSmsOtpMessage,
  SMS_COPY_LOCALES,
  smsOtpCopy,
} from './sms-copy.js';

const expectedLocales = ['ko', 'en', 'th', 'zh-CN'] as const;
const smsOtpKeys = [
  'template',
  'sent',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'expired',
  'invalidCode',
  'throttled',
  'systemError',
] as const;
const authStatusKeys = [
  'invalidCredentials',
  'emailUnverified',
  'verificationRequired',
  'deviceLimitNotice',
  'providerUnavailable',
] as const;

describe('launch SMS and auth copy contract', () => {
  const deprecatedLocale = ['j', 'a'].join('');

  it('exports exactly the active launch locales', () => {
    expect(SMS_COPY_LOCALES).toEqual(expectedLocales);
    expect(Object.keys(smsOtpCopy)).toEqual([...expectedLocales]);
    expect(Object.keys(authStatusCopy)).toEqual([...expectedLocales]);
    expect(smsOtpCopy).not.toHaveProperty(deprecatedLocale);
    expect(authStatusCopy).not.toHaveProperty(deprecatedLocale);
  });

  it.each(expectedLocales)('SMS OTP copy for %s contains every required key', (locale) => {
    expect(Object.keys(smsOtpCopy[locale])).toEqual([...smsOtpKeys]);

    for (const key of smsOtpKeys) {
      expect(smsOtpCopy[locale][key]).toEqual(expect.any(String));
      expect(smsOtpCopy[locale][key].trim()).not.toBe('');
    }

    expect(smsOtpCopy[locale].template).toContain('{{otp}}');
  });

  it.each(expectedLocales)('auth status/error copy for %s contains every required key', (locale) => {
    expect(Object.keys(authStatusCopy[locale])).toEqual([...authStatusKeys]);

    for (const key of authStatusKeys) {
      expect(authStatusCopy[locale][key]).toEqual(expect.any(String));
      expect(authStatusCopy[locale][key].trim()).not.toBe('');
    }
  });

  it.each(expectedLocales)('formatSmsOtpMessage injects OTP only into provider payload for %s', (locale) => {
    const message = formatSmsOtpMessage('123456', locale);

    expect(message).toContain('123456');
    expect(message).not.toContain('{{otp}}');
    expect(message.length).toBeGreaterThan(10);
  });

  it('formats Simplified Chinese OTP provider payload for the active Chinese locale', () => {
    expect(formatSmsOtpMessage('123456', 'zh-CN')).toContain('验证码 123456');
  });
});
