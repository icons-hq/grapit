import { describe, expect, it } from 'vitest';
import { analyticsBatchSchema, analyticsEventSchema, normalizeAnalyticsPath, sanitizeAnalyticsCampaign } from './analytics.schema';
const id = '00000000-0000-4000-8000-000000000001';
describe('analytics minimization contract', () => {
  it('removes query/hash and excludes all private and credential routes', () => {
    expect(normalizeAnalyticsPath('/?ticket=secret&email=a@example.com#payment')).toBe('/');
    for (const path of ['/admin', '/field/scan', '/mypage/booking/private-id', '/auth/callback', '/payment/return', '/booking/not-a-public-uuid']) expect(normalizeAnalyticsPath(path)).toBeNull();
    expect(normalizeAnalyticsPath('/performance/' + id + '?paymentKey=secret')).toBe('/performance/' + id);
  });
  it('allows campaign labels including dates, but drops email/phone/full URL values', () => {
    expect(sanitizeAnalyticsCampaign('launch_20261111')).toBe('launch_20261111');
    for (const value of ['a@example.com', '01012345678', 'https://private.test', 'a?token=private']) expect(sanitizeAnalyticsCampaign(value)).toBeNull();
  });
  it('rejects client completion facts, foreign props, unsanitized paths and oversized batches', () => {
    const event = { id, pageId: id, name: 'page_view', path: '/', previousPath: null, at: new Date().toISOString(), props: {} };
    expect(analyticsEventSchema.safeParse(event).success).toBe(true);
    expect(analyticsEventSchema.safeParse({ ...event, name: 'purchase' }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...event, props: { email: 'secret' } }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...event, path: '/?token=secret' }).success).toBe(false);
    expect(analyticsEventSchema.safeParse({ ...event, name: 'checkout_start' }).success).toBe(false);
    expect(analyticsBatchSchema.safeParse({ events: Array(21).fill(event) }).success).toBe(false);
  });
});
