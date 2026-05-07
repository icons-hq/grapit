import { describe, expect, it } from 'vitest';
import {
  consentCaptureRequestSchema,
  type ConsentCaptureItem,
} from './consent.schema';

function makeConsentItems(): ConsentCaptureItem[] {
  return [
    'terms',
    'privacy',
    'pipa_required',
    'cross_border_transfer',
    'pdpa_notice',
    'pipl_notice',
    'marketing',
  ].map((key) => ({
    key: key as ConsentCaptureItem['key'],
    version: '2026-04-28',
    language: 'ko',
    accepted: true,
  }));
}

describe('consent capture request schema', () => {
  it('does not expose client-controlled capturedAt in public capture requests', () => {
    const parsed = consentCaptureRequestSchema.parse({
      birthDate: '1995-05-15',
      capturedAt: '2000-01-01T00:00:00.000Z',
      sourceFlow: 'signup',
      items: makeConsentItems(),
    });

    expect(parsed).toEqual({
      birthDate: '1995-05-15',
      sourceFlow: 'signup',
      items: makeConsentItems(),
    });
    expect(parsed).not.toHaveProperty('capturedAt');
  });
});
