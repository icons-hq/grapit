import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { startPostgresContainer } from './helpers/postgres-container.js';
import type { AnalyticsBatch, AnalyticsEvent, AnalyticsTouch } from '@grabit/shared';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js';
import { AnalyticsService } from '../src/modules/analytics/analytics.service.js';
import { AnalyticsReportService } from '../src/modules/analytics/analytics-report.service.js';
import { AnalyticsMaintenance } from '../src/modules/analytics/analytics-maintenance.module.js';
import type { PgBossContract } from '../src/modules/jobs/pgboss.provider.js';

describe('first-party analytics / isolated PostgreSQL and Valkey', () => {
  let pg: StartedTestContainer; let valkey: StartedTestContainer; let pool: Pool; let redis: IORedis; let db: DrizzleDB;
  let service: AnalyticsService; let reports: AnalyticsReportService; let maintenance: AnalyticsMaintenance; let environment = true; let now: number;
  const boss = { isAvailable: true, processesJobs: true, createQueue: vi.fn(), work: vi.fn(), send: vi.fn().mockResolvedValue('job'), stop: vi.fn() };
  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'analytics_test' }); pg = postgres.container;
    pool = new Pool({ host: postgres.host, port: postgres.port, user: postgres.user, password: postgres.password, database: postgres.database });
    db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: 'src/database/migrations' });
    valkey = await new GenericContainer('valkey/valkey:8').withExposedPorts(6379).start();
    redis = new IORedis({ host: valkey.getHost(), port: valkey.getMappedPort(6379) });
  }, 180000);
  afterAll(async () => { await redis?.quit(); await pool?.end(); await pg?.stop(); await valkey?.stop(); });
  beforeEach(async () => {
    await pool.query('truncate analytics_settings, analytics_events, analytics_sessions, analytics_attribution, analytics_rollups, analytics_opt_outs, users, venues cascade');
    await redis.flushall(); now = Date.now(); environment = true;
    const flags = new FeatureFlagsService(() => ({ ANALYTICS_ENABLED: String(environment) }));
    service = new AnalyticsService(db, pool, flags, redis); reports = new AnalyticsReportService(db, service, redis); maintenance = new AnalyticsMaintenance(db, boss as unknown as PgBossContract);
    boss.send.mockClear(); await db.insert(schema.analyticsSettings).values({ id: 1, enabled: true, noticeVersion: 'analytics-v1' });
  });
  const touch = (source = 'instagram'): AnalyticsTouch => ({ landingPath: '/', referrerHost: 'instagram.com', source, medium: 'social', campaign: 'announcement', term: null, content: 'poster_a' });
  function batch(source = 'instagram', visitorId = randomUUID(), sessionId = randomUUID()): AnalyticsBatch {
    return { consentVersion: 'analytics-v1', consentedAt: new Date(now - 250000).toISOString(), visitorId, sessionId, touch: touch(source), device: 'mobile', browser: 'safari', os: 'ios', screen: 'small', language: 'ko',
      events: [{ id: randomUUID(), pageId: randomUUID(), name: 'page_view', path: '/', previousPath: null, at: new Date(now - 240000).toISOString(), props: {} }] };
  }
  const query = () => ({ since: new Date(now - 300000).toISOString(), until: new Date(Date.now() + 1000).toISOString(), granularity: 'hour' as const });
  async function member(createdAt: number, role = 'user') {
    const [u] = await db.insert(schema.users).values({ email: `${randomUUID()}@test.invalid`, name: 'Fixture', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', createdAt: new Date(createdAt), role }).returning();
    return { id: u!.id, email: u!.email, role };
  }
  it('drops ingestion when the environment or shared kill switch is off and deduplicates retries', async () => {
    const data = batch(); environment = false;
    expect(await service.collect(data)).toBe(false); expect((await service.config()).enabled).toBe(false);
    environment = true; await db.update(schema.analyticsSettings).set({ enabled: false });
    expect(await service.collect(data)).toBe(false);
    await db.update(schema.analyticsSettings).set({ enabled: true });
    expect(await service.collect(data)).toBe(true); expect(await service.collect(data)).toBe(true);
    expect((await db.select().from(schema.analyticsEvents))).toHaveLength(1);
    const report = await reports.report(query()); expect(report.summary.pageViews).toBe(1); expect(report.summary.visitors).toBe(1);
    const busy = new AnalyticsService(db, { waitingCount: 1, totalCount: 1, idleCount: 0 } as Pool, new FeatureFlagsService(() => ({ ANALYTICS_ENABLED: 'true' })), redis);
    expect(await busy.collect(batch())).toBe(false);
  });
  it('links only the authenticated user, freezes first/last signup attribution, and joins true payment facts', async () => {
    const first = batch(); await service.collect(first);
    const [venue] = await db.insert(schema.venues).values({ name: 'Fixture' }).returning();
    const [performance] = await db.insert(schema.performances).values({ title: 'Fixture show', genre: 'artist_celebrity', venueId: venue!.id, ageRating: 'all', startDate: new Date(now), endDate: new Date(now) }).returning();
    const [showtime] = await db.insert(schema.showtimes).values({ performanceId: performance!.id, dateTime: new Date(now + 86400000) }).returning();
    const next = batch('youtube', first.visitorId);
    const event = (name: AnalyticsEvent['name'], offset: number, path: string, props: AnalyticsEvent['props'] = {}): AnalyticsEvent => ({ id: randomUUID(), pageId: randomUUID(), name, path, previousPath: '/', at: new Date(now - offset).toISOString(), props });
    next.events = [event('page_view', 180000, '/'), event('performance_view', 178000, `/performance/${performance!.id}`, { performanceId: performance!.id }), event('signup_start', 177000, '/auth'),
      event('seat_select', 175000, `/booking/${performance!.id}`, { performanceId: performance!.id, count: 1 }), event('checkout_start', 170000, `/booking/${performance!.id}/confirm`, { performanceId: performance!.id })];
    await service.collect(next);
    const buyer = await member(now - 176000); await member(now - 160000); const other = await member(now - 86400000);
    expect(await service.identify(next, buyer)).toBe(true); expect(await service.identify(next, other)).toBe(false);
    for (const [status, paymentStatus] of [['CONFIRMED', 'DONE'], ['CANCELLED', 'CANCELED'], ['CANCELLED', 'PARTIAL_CANCELED'], ['FAILED', 'CANCELED']] as const) {
      const [r] = await db.insert(schema.reservations).values({ userId: buyer.id, showtimeId: showtime!.id, reservationNumber: randomUUID().slice(0, 25), totalAmount: 1000, status, cancelDeadline: new Date(now + 86400000) }).returning();
      await db.insert(schema.payments).values({ reservationId: r!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(), method: 'card', provider: 'CARD', amount: 1000, status: paymentStatus, paidAt: new Date(now - 165000), cancelledAt: status === 'CONFIRMED' ? null : new Date(now - 100000) });
    }
    const later = batch('naver', first.visitorId); await service.collect(later); await service.identify(later, buyer);
    const [attribution] = await db.select().from(schema.analyticsAttribution);
    expect(attribution?.firstTouch.source).toBe('instagram'); expect(attribution?.lastTouch.source).toBe('youtube');
    const report = await reports.report(query());
    expect(report.summary).toMatchObject({ visitors: 1, sessions: 3, signups: 2, paidOrders: 3, cancelledOrders: 2 });
    expect(report.funnel.map((r) => r.count)).toEqual([3, 1, 1, 1, 1]);
    expect(report.signupFunnel.map((r) => r.count)).toEqual([3, 1]);
    expect(report.attribution.find((a) => a.model === 'first')?.source).toBe('instagram');
    expect(JSON.stringify(report)).not.toMatch(/test.invalid|821000000000|Fixture"|userId|visitorId|sessionId/);
  });
  it('expires a session after inactivity and counts a returning browser once per period', async () => {
    const first = batch(); await service.collect(first);
    await db.update(schema.analyticsSessions).set({ lastSeenAt: new Date(now - 31 * 60000) }).where(eq(schema.analyticsSessions.id, first.sessionId));
    expect(await service.collect({ ...first, events: [{ ...first.events[0]!, id: randomUUID() }] })).toBe(false);
    const next = batch('direct', first.visitorId); next.events[0]!.at = new Date(now - 1000).toISOString();
    expect(await service.collect(next)).toBe(true);
    const report = await reports.report(query()); expect(report.summary).toMatchObject({ visitors: 1, sessions: 2, returningVisitors: 1, pageViews: 2 });
  });
  it('rolls up KST hours and days idempotently, with exact daily UV, and deletes expired data', async () => {
    const first = batch(); await service.collect(first);
    const next = batch('direct', first.visitorId); await service.collect(next);
    const midnight = Math.floor((now + 32400000) / 86400000) * 86400000 - 32400000;
    await db.update(schema.analyticsEvents).set({ occurredAt: new Date(midnight + 1000) }).where(eq(schema.analyticsEvents.id, first.events[0]!.id));
    await db.update(schema.analyticsEvents).set({ occurredAt: new Date(midnight + 3601000) }).where(eq(schema.analyticsEvents.id, next.events[0]!.id));
    await maintenance.run(); await maintenance.run();
    const daily = await db.select().from(schema.analyticsRollups).where(eq(schema.analyticsRollups.grain, 'day'));
    expect(daily.find((d) => d.bucket.getTime() === midnight)).toMatchObject({ visitors: 1, sessions: 2, pageViews: 2 });
    await db.update(schema.analyticsEvents).set({ occurredAt: new Date(now - 91 * 86400000) });
    await db.update(schema.analyticsSessions).set({ startedAt: new Date(now - 91 * 86400000) });
    await db.insert(schema.analyticsRollups).values({ grain: 'day', bucket: new Date(now - 366 * 86400000), visitors: 10, sessions: 10, pageViews: 10 });
    const result = await maintenance.run(); expect(result.deleted).toBe(2);
    expect(await db.select().from(schema.analyticsSessions)).toHaveLength(0);
    expect((await db.select().from(schema.analyticsRollups)).some((r) => r.bucket.getTime() < now - 365 * 86400000)).toBe(false);
  });
  it('withdraws raw events and account attribution and prevents delayed batches from recreating them', async () => {
    const data = batch(); await service.collect(data); const buyer = await member(now - 200000); await service.identify(data, buyer); await maintenance.run();
    await service.withdraw({ ...data, sessionId: randomUUID() }); await service.withdraw(data);
    expect(await db.select().from(schema.analyticsEvents)).toHaveLength(0); expect(await db.select().from(schema.analyticsSessions)).toHaveLength(0); expect(await db.select().from(schema.analyticsAttribution)).toHaveLength(0);
    expect(await service.collect(data)).toBe(false);
    const [marker] = await db.select().from(schema.analyticsOptOuts); expect(marker?.visitorHash).toHaveLength(64); expect(marker?.visitorHash).not.toBe(data.visitorId);
    await maintenance.run(); expect((await reports.report(query())).summary.visitors).toBe(0);
    expect((await db.execute(sql`select count(*)::int as count from users where id=${buyer.id}::uuid`)).rows[0]?.count).toBe(1);
  });
});
