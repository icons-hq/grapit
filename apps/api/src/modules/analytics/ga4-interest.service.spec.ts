import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import { Ga4InterestService } from './ga4-interest.service.js';

const api = vi.hoisted(() => ({ runReport: vi.fn() }));
vi.mock('@google-analytics/data', () => ({ BetaAnalyticsDataClient: class { runReport = api.runReport; } }));
const query = { since: '2026-11-01T15:00:00Z', until: '2026-11-05T15:00:00Z' };
describe('GA4 aggregate interest adapter', () => {
  let memory: Map<string, string>; let redis: IORedis;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-12T04:00:00Z')); api.runReport.mockReset(); memory = new Map(); redis = { get: vi.fn(async (key: string) => memory.get(key)), set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => { if (nx && memory.has(key)) return null; memory.set(key, value); return 'OK'; }), del: vi.fn(async (key: string) => { memory.delete(key); }) } as unknown as IORedis; });
  afterEach(() => vi.useRealTimers());
  it('does not query without a numeric property and does not activate Google before the notice is ready', async () => {
    const service = new Ga4InterestService(new ConfigService({ GA4_MEASUREMENT_ID: 'G-TESTABCD', GA4_ENABLED: 'true' }), redis);
    expect(service.publicConfig().enabled).toBe(false); expect((await service.report(query)).state).toBe('not_configured'); expect(api.runReport).not.toHaveBeenCalled();
  });
  it('preserves threshold metadata without fabricating counts or summing overlapping interests and shares its cache', async () => {
    api.runReport.mockResolvedValue([{ rowCount: 2, metadata: { subjectToThresholding: true, timeZone: 'Asia/Seoul' }, rows: [
      { dimensionValues: [{ value: 'Arts & Entertainment' }], metricValues: [{ value: '12' }] }, { dimensionValues: [{ value: 'Travel' }], metricValues: [{ value: '8' }] },
    ] }]);
    const service = new Ga4InterestService(new ConfigService({ GA4_PROPERTY_ID: '123456' }), redis);
    const result = await service.report(query); expect(result).toMatchObject({ state: 'ready', subjectToThresholding: true, rowCount: 2 });
    expect(result.rows.map((r) => r.activeUsers)).toEqual([12, 8]); expect(result).not.toHaveProperty('totalUsers');
    expect(api.runReport.mock.calls[0]?.[0]).toMatchObject({ property: 'properties/123456', dimensions: [{ name: 'brandingInterest' }], dateRanges: [{ startDate: '2026-11-02', endDate: '2026-11-05' }] });
    expect((await service.report(query)).cached).toBe(true); expect(api.runReport).toHaveBeenCalledOnce();
  });
  it('distinguishes empty results, denied access and throttling from a zero-interest profile', async () => {
    for (const [code, state] of [[7, 'permission_denied'], [8, 'quota_exceeded']] as const) {
      memory.clear(); api.runReport.mockRejectedValueOnce({ code, message: 'do-not-expose-provider-secret' });
      const result = await new Ga4InterestService(new ConfigService({ GA4_PROPERTY_ID: '123456' }), redis).report(query);
      expect(result.state).toBe(state); expect(JSON.stringify(result)).not.toContain('do-not-expose');
    }
    memory.clear(); api.runReport.mockResolvedValueOnce([{ metadata: { subjectToThresholding: true, emptyReason: 'No data available' }, rows: [] }]);
    expect(await new Ga4InterestService(new ConfigService({ GA4_PROPERTY_ID: '123456' }), redis).report(query)).toMatchObject({ state: 'empty', emptyReason: 'No data available' });
  });
});
