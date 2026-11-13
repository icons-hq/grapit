import { describe, expect, it } from 'vitest';
import { audiencePreferencesInputSchema, audienceTagInputSchema, normalizeGa4Path, isAdultForGoogleInterests } from './audience.schema';
const id = '00000000-0000-4000-8000-000000000001';
describe('audience contracts', () => {
  it('requires purpose-specific consent and rejects identity injection or unbounded selections', () => {
    const input = { tagIds: [id], consentVersion: 'interests-v1', collectionConsent: true, useBehavior: false };
    expect(audiencePreferencesInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ userId: id }, { consentVersion: 'analytics-v2-replay' }, { collectionConsent: false }, { tagIds: [id, id] }, { useBehavior: undefined }]) expect(audiencePreferencesInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('allows bounded multilingual catalogue tags but not arbitrary user attributes', () => {
    expect(audienceTagInputSchema.safeParse({ slug: 'fan-events', kind: 'activity', labels: { ko: '팬 이벤트', en: 'Fan events' } }).success).toBe(true);
    expect(audienceTagInputSchema.safeParse({ slug: 'fan-events', kind: 'health', labels: { ko: '질환', en: 'Condition' } }).success).toBe(false);
  });
  it('excludes account, order, query, search and auth data from Google paths', () => {
    for (const path of ['/admin/audience', '/mypage/interests', `/booking/${id}`, '/auth', '/auth/verify-email', '/search', '/payment/success', '/legal/analytics', '/wishlist', '/recent']) expect(normalizeGa4Path(path)).toBeNull();
    expect(normalizeGa4Path(`/th/performance/${id}?token=secret`)).toBe(`/performance/${id}`);
    expect(normalizeGa4Path('/en/categories/')).toBe('/categories');
  });
  it('keeps known under-18 accounts out even when the browser has an earlier adult choice', () => {
    const now = Date.parse('2026-11-11T15:00:00Z');
    expect(isAdultForGoogleInterests('2008-11-12', now)).toBe(true);
    expect(isAdultForGoogleInterests('2008-11-13', now)).toBe(false);
    expect(isAdultForGoogleInterests('2000-02-31', now)).toBe(false);
    expect(isAdultForGoogleInterests(undefined, now)).toBe(false);
  });
});
