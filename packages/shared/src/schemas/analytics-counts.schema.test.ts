import { describe, expect, it } from 'vitest';
import { analyticsCountPage, analyticsCountsSchema } from './analytics-counts.schema';
describe('identifier-free usage counts', () => {
  it('accepts only bounded screen-category counters', () => {
    const batch = { counts: [{ page: 'home', name: 'page_view', count: 1 }] };
    expect(analyticsCountsSchema.safeParse(batch).success).toBe(true);
    for (const extra of [{ visitorId: 'anything' }, { path: '/?email=private' }, { timestamp: Date.now() }]) expect(analyticsCountsSchema.safeParse({ ...batch, ...extra }).success).toBe(false);
    expect(analyticsCountsSchema.safeParse({ counts: [{ ...batch.counts[0], memberId: 'private' }] }).success).toBe(false);
    expect(analyticsCountsSchema.safeParse({ counts: Array(2).fill({ page: 'home', name: 'page_view', count: 20 }) }).success).toBe(false);
  });
  it('excludes sensitive and legal routes including locale prefixes and removes all public identifiers', () => {
    for (const path of ['/admin', '/en/admin/users', '/th/mypage', '/zh-CN/payment/return', '/auth/callback', '/legal/analytics']) expect(analyticsCountPage(path)).toBeNull();
    expect(analyticsCountPage('/performance/00000000-0000-4000-8000-000000000001?token=secret')).toBe('performance');
    expect(analyticsCountPage('/search?q=private')).toBe('search');
  });
});
