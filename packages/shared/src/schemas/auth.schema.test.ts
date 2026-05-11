import { describe, expect, it } from 'vitest';

import {
  registerStep2Schema,
} from './auth.schema';
import {
  REQUIRED_CONSENT_ITEM_KEYS,
  type ConsentItemKey,
} from './consent.schema';

function makeConsentItems(
  overrides: Partial<Record<ConsentItemKey, boolean>> = {},
  sourceFlow: 'signup' | 'social_completion' = 'signup',
) {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'marketing',
  ].map((key) => ({
    key,
    version: '2026-04-28',
    language: 'ko',
    accepted: overrides[key as ConsentItemKey] ?? key !== 'marketing',
    required: key !== 'marketing',
    sourceFlow,
  }));
}

describe('registerStep2Schema launch consent contract', () => {
  it('requires every launch-required consent item and allows optional marketing refusal', () => {
    const parsed = registerStep2Schema.parse({
      termsOfService: true,
      privacyPolicy: true,
      marketingConsent: false,
      consentItems: makeConsentItems(),
    });

    expect(parsed.consentItems.map((item) => item.key)).toEqual([
      ...REQUIRED_CONSENT_ITEM_KEYS,
      'marketing',
    ]);
    expect(parsed.consentItems.find((item) => item.key === 'marketing')).toMatchObject({
      accepted: false,
      required: false,
      sourceFlow: 'signup',
    });
  });

  it('rejects missing or refused required consent rows', () => {
    expect(() =>
      registerStep2Schema.parse({
        termsOfService: true,
        privacyPolicy: true,
        marketingConsent: false,
        consentItems: makeConsentItems().filter(
          (item) => item.key !== 'pipa_required',
        ),
      }),
    ).toThrow(/pipa_required/);

    expect(() =>
      registerStep2Schema.parse({
        termsOfService: true,
        privacyPolicy: true,
        marketingConsent: false,
        consentItems: makeConsentItems({ pipa_required: false }),
      }),
    ).toThrow(/pipa_required/);
  });
});
