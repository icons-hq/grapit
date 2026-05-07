import { describe, expect, it } from 'vitest';
import { emailVerificationCopy } from './email-verification.copy.js';

const SUPPORTED_LOCALES = ['ko', 'en', 'th', 'zh-CN', 'zh-TW'] as const;
const REQUIRED_KEYS = [
  'subject',
  'bodyIntro',
  'verifyCta',
  'resendCta',
  'resendLoading',
  'resendSuccess',
  'expired',
  'verified',
  'throttled',
  'systemError',
] as const;

describe('emailVerificationCopy', () => {
  it('contains exactly the five launch locales', () => {
    expect(Object.keys(emailVerificationCopy).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('contains all required transactional copy keys for every launch locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(emailVerificationCopy[locale]).sort()).toEqual([...REQUIRED_KEYS].sort());
      for (const key of REQUIRED_KEYS) {
        expect(emailVerificationCopy[locale][key]).toEqual(expect.any(String));
        expect(emailVerificationCopy[locale][key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('includes the Korean resend and expired-link copy required for launch auth UX', () => {
    expect(emailVerificationCopy.ko.resendCta).toBe('인증 메일 다시 보내기');
    expect(emailVerificationCopy.ko.resendLoading).toBe('다시 보내는 중...');
    expect(emailVerificationCopy.ko.resendSuccess).toBe('인증 메일을 다시 보냈습니다');
    expect(emailVerificationCopy.ko.expired).toBe('인증 링크가 만료되었습니다. 새 인증 메일을 요청해주세요.');
  });
});
