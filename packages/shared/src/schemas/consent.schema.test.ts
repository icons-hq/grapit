import { describe, expect, it } from 'vitest';
import {
  ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT,
  ADMIN_CONSENT_AUDIT_MAX_LIMIT,
  BOOKING_CONSENT_ITEM_KEYS,
  CONSENT_DOCUMENT_VERSIONS,
  REQUIRED_CONSENT_ITEM_KEYS,
  consentAuditQuerySchema,
  consentCaptureRequestSchema,
  consentCaptureSchema,
  requiredConsentItemKeysFor,
  resolveConsentDocumentLanguage,
  type ConsentCaptureItem,
} from './consent.schema';

function makeConsentItems(): ConsentCaptureItem[] {
  return [
    'terms',
    'privacy',
    'pipa_required',
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

describe('consent document contract', () => {
  it('records privacy and PIPA rows against the privacy policy v1.2 effective date', () => {
    expect(CONSENT_DOCUMENT_VERSIONS).toEqual({
      terms: '2026-04-28',
      privacy: '2026-05-11',
      pipa_required: '2026-05-11',
      marketing: '2026-04-28',
    });
  });

  it('maps every locale to the legal document language actually rendered', () => {
    expect(resolveConsentDocumentLanguage('ko')).toBe('ko');
    expect(resolveConsentDocumentLanguage('en')).toBe('en');
    expect(resolveConsentDocumentLanguage('th')).toBe('en');
    expect(resolveConsentDocumentLanguage('zh-CN')).toBe('en');
  });

  it('requires only the rows booking shows, while signup keeps the full required set', () => {
    expect(BOOKING_CONSENT_ITEM_KEYS).toEqual(['terms', 'privacy']);
    expect(requiredConsentItemKeysFor('booking')).toEqual(['terms', 'privacy']);
    expect(requiredConsentItemKeysFor('signup')).toEqual(REQUIRED_CONSENT_ITEM_KEYS);
    expect(requiredConsentItemKeysFor('social_completion')).toEqual(REQUIRED_CONSENT_ITEM_KEYS);
    expect(requiredConsentItemKeysFor(undefined)).toEqual(REQUIRED_CONSENT_ITEM_KEYS);
  });

  it('accepts a booking capture without the unseen PIPA row but not a signup capture', () => {
    const base = {
      userId: 'user-1',
      birthDate: '1995-05-15',
      capturedAt: '2026-10-01T00:00:00.000Z',
      ipAddress: '203.0.113.10',
    };
    const bookingItems = makeConsentItems().filter((item) =>
      (BOOKING_CONSENT_ITEM_KEYS as readonly string[]).includes(item.key),
    );

    expect(consentCaptureSchema.safeParse({ ...base, sourceFlow: 'booking', items: bookingItems }).success)
      .toBe(true);
    expect(consentCaptureSchema.safeParse({ ...base, sourceFlow: 'signup', items: bookingItems }).success)
      .toBe(false);
  });
});

describe('admin consent audit query schema', () => {
  it('bounds every page with a default and maximum limit', () => {
    expect(consentAuditQuerySchema.parse({}).limit).toBe(ADMIN_CONSENT_AUDIT_DEFAULT_LIMIT);
    expect(consentAuditQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(consentAuditQuerySchema.safeParse({ limit: String(ADMIN_CONSENT_AUDIT_MAX_LIMIT + 1) }).success)
      .toBe(false);
    expect(consentAuditQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects an inverted period', () => {
    expect(consentAuditQuerySchema.safeParse({
      from: '2026-05-02T00:00:00.000Z',
      to: '2026-05-01T00:00:00.000Z',
    }).success).toBe(false);
  });
});
