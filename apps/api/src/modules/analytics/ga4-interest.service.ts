import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type IORedis from 'ioredis';
import type { BetaAnalyticsDataClient } from '@google-analytics/data';
import { GA4_CONSENT_VERSION, type AudienceQuery, type Ga4Config, type Ga4InterestReport } from '@grabit/shared';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';

const CACHE_SECONDS = 1800;
const dateInKst = (time: number) => new Date(time + 9 * 3600000).toISOString().slice(0, 10);

@Injectable()
export class Ga4InterestService {
  private client?: BetaAnalyticsDataClient;
  constructor(@Inject(ConfigService) private readonly config: ConfigService, @Inject(REDIS_CLIENT) private readonly redis: IORedis) {}

  publicConfig(): Ga4Config {
    const measurementId = this.config.get<string>('GA4_MEASUREMENT_ID')?.trim() ?? '';
    const transferCountries = (this.config.get<string>('GA4_TRANSFER_COUNTRIES') ?? '').split(',').map((c) => c.trim()).filter((c) => /^[A-Z]{2}$/.test(c));
    const configured = /^G-[A-Z0-9]{4,20}$/.test(measurementId) && !!this.propertyId();
    const enabled = configured && transferCountries.length > 0 && this.config.get<string>('GA4_ENABLED') === 'true'
      && this.config.get<string>('GA4_NOTICE_READY') === 'true';
    return { enabled, measurementId: configured ? measurementId : null, noticeVersion: GA4_CONSENT_VERSION, transferCountries: [...new Set(transferCountries)] };
  }

  async report(query: AudienceQuery): Promise<Ga4InterestReport> {
    if (Date.parse(query.since) >= Date.now() || Date.parse(query.since) < Date.now() - 90 * 86400000) throw new BadRequestException('최근 90일 이내의 과거 구간을 선택해주세요');
    const propertyId = this.propertyId();
    const startDate = dateInKst(Date.parse(query.since));
    const endDate = dateInKst(Math.min(Date.parse(query.until), Date.now()) - 1);
    const base: Ga4InterestReport = { state: 'not_configured', propertyId, startDate, endDate, fetchedAt: null, cached: false,
      subjectToThresholding: false, dataLossFromOtherRow: false, sampled: false, emptyReason: null, timeZone: null, rowCount: 0, rows: [] };
    if (!propertyId) return base;
    const key = `analytics:ga4:interests:v1:${propertyId}:${startDate}:${endDate}`;
    // Shared cache and lock bound calls across API instances (120 thresholded
    // requests/property/hour). If Valkey is unavailable, do not bypass the guard.
    try {
      const cached = await this.redis.get(key);
      if (cached) return { ...JSON.parse(cached) as Ga4InterestReport, cached: true };
      const acquired = await this.redis.set(`${key}:lock`, '1', 'EX', 30, 'NX');
      if (!acquired) return { ...base, state: 'refreshing' };
    } catch { return { ...base, state: 'unavailable' }; }
    try {
      if (!this.client) {
        const { BetaAnalyticsDataClient } = await import('@google-analytics/data');
        this.client = new BetaAnalyticsDataClient({ scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });
      }
      const [response] = await this.client.runReport({
        property: `properties/${propertyId}`, dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'brandingInterest' }], metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }], limit: 25, returnPropertyQuota: true,
      }, { timeout: 10_000, retry: null });
      const metadata = response.metadata;
      const rows = (response.rows ?? []).map((row) => ({ interest: row.dimensionValues?.[0]?.value ?? '(not set)', activeUsers: Number(row.metricValues?.[0]?.value ?? 0) }))
        .filter((row) => Number.isSafeInteger(row.activeUsers) && row.activeUsers >= 0);
      const result: Ga4InterestReport = { ...base, state: rows.length ? 'ready' : 'empty', rows, fetchedAt: new Date().toISOString(),
        subjectToThresholding: metadata?.subjectToThresholding === true, dataLossFromOtherRow: metadata?.dataLossFromOtherRow === true,
        sampled: !!metadata?.samplingMetadatas?.length, emptyReason: metadata?.emptyReason || null,
        timeZone: metadata?.timeZone || null, rowCount: response.rowCount ?? rows.length };
      await this.redis.set(key, JSON.stringify(result), 'EX', CACHE_SECONDS);
      return result;
    } catch (error) {
      const code = (error as { code?: number }).code;
      const result: Ga4InterestReport = { ...base, state: code === 7 || code === 16 ? 'permission_denied' : code === 8 || code === 429 ? 'quota_exceeded' : 'unavailable' };
      await this.redis.set(key, JSON.stringify(result), 'EX', 60).catch(() => undefined);
      return result;
    } finally { await this.redis.del(`${key}:lock`).catch(() => undefined); }
  }

  private propertyId() {
    const value = this.config.get<string>('GA4_PROPERTY_ID')?.trim() ?? '';
    return /^\d{1,20}$/.test(value) ? value : null;
  }
}
