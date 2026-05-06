import { describe, expect, it } from 'vitest';

import { registerBodySchema } from './register.dto.js';
import {
  completeSocialRegistrationSchema,
  socialRegisterBodySchema,
} from './social-register.dto.js';

type ConsentKey =
  | 'terms'
  | 'privacy'
  | 'pipa_required'
  | 'cross_border_transfer'
  | 'pdpa_notice'
  | 'pipl_notice'
  | 'marketing';

function makeConsentItems(sourceFlow: 'signup' | 'social_completion') {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'cross_border_transfer',
    'pdpa_notice',
    'pipl_notice',
    'marketing',
  ].map((key) => ({
    key,
    version: '2026-04-28',
    language: 'ko',
    accepted: key !== 'marketing',
    required: key !== 'marketing',
    sourceFlow,
  }));
}

const baseSocialBody = {
  name: 'Fan User',
  gender: 'female' as const,
  country: '대한민국',
  birthDate: '1995-01-02',
  phone: '+821012345678',
  phoneVerificationCode: '123456',
  termsOfService: true,
  privacyPolicy: true,
  marketingConsent: false,
};

describe('auth DTO consent contract', () => {
  it('accepts signup consent rows with item key, version, language, accepted/refused, required status, and signup source flow', () => {
    const parsed = registerBodySchema.parse({
      email: 'fan@example.com',
      password: 'Test1234!',
      ...baseSocialBody,
      consentItems: makeConsentItems('signup'),
    });

    expect(parsed.consentItems.find((item) => item.key === 'cross_border_transfer')).toMatchObject({
      version: '2026-04-28',
      language: 'ko',
      accepted: true,
      required: true,
      sourceFlow: 'signup',
    });
  });

  it('accepts social completion consent rows only with social_completion source flow', () => {
    const parsed = socialRegisterBodySchema.parse({
      ...baseSocialBody,
      consentItems: makeConsentItems('social_completion'),
    });

    expect(parsed.consentItems.every((item) => item.sourceFlow === 'social_completion')).toBe(true);
    expect(() =>
      completeSocialRegistrationSchema.parse({
        registrationToken: 'registration-token',
        ...baseSocialBody,
        consentItems: makeConsentItems('signup'),
      }),
    ).toThrow(/social_completion/);
  });

  it('rejects missing required consent rows', () => {
    expect(() =>
      registerBodySchema.parse({
        email: 'fan@example.com',
        password: 'Test1234!',
        ...baseSocialBody,
        consentItems: makeConsentItems('signup').filter(
          (item) => item.key !== ('pipl_notice' satisfies ConsentKey),
        ),
      }),
    ).toThrow(/pipl_notice/);
  });
});
