import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import type { StartedPostgres } from './helpers/postgres-container.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { AudienceService } from '../src/modules/analytics/audience.service.js';
import { CreativeReportService } from '../src/modules/analytics/creative-report.service.js';
import { AnalyticsMaintenance } from '../src/modules/analytics/analytics-maintenance.module.js';
import type { PgBossContract } from '../src/modules/jobs/pgboss.provider.js';

describe('audience profiles / isolated PostgreSQL', () => {
  let postgres: StartedPostgres; let pool: Pool; let db: DrizzleDB; let service: AudienceService; let report: CreativeReportService;
  let buyer: typeof schema.users.$inferSelect; let admin: typeof schema.users.$inferSelect; let performanceId: string; let showtimeId: string; let artist: string; let activity: string; let now: number;
  const at = (seconds: number) => new Date(now + seconds * 1000);
  beforeAll(async () => {
    postgres = await startPostgresContainer({ database: 'audience_test' });
    if (!['localhost', '127.0.0.1', '::1'].includes(postgres.host)) throw new Error('Isolated loopback DB required');
    pool = new Pool({ connectionString: postgres.connectionString }); db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    service = new AudienceService(db); report = new CreativeReportService(db);
    const tags = await service.tags(); artist = tags.find((t) => t.slug === 'namtanfilm')!.id; activity = tags.find((t) => t.slug === 'collecting-merch')!.id;
  });
  afterAll(async () => { await pool?.end(); await postgres?.container.stop(); });
  beforeEach(async () => {
    now = Date.now(); await pool.query('truncate users,performances,venues cascade');
    [buyer, admin] = await db.insert(schema.users).values([
      { email: 'buyer@test.invalid', name: 'Test buyer', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', createdAt: at(-300) },
      { email: 'admin@test.invalid', name: 'Test admin', phone: '+821000000001', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin' },
    ]).returning() as [typeof schema.users.$inferSelect, typeof schema.users.$inferSelect];
    const [venue] = await db.insert(schema.venues).values({ name: 'Test hall' }).returning();
    const [performance] = await db.insert(schema.performances).values({ title: 'Test show', genre: 'artist_celebrity', venueId: venue!.id, ageRating: 'all', startDate: at(86400), endDate: at(90000), publishState: 'published' }).returning();
    performanceId = performance!.id;
    const [showtime] = await db.insert(schema.showtimes).values({ performanceId, dateTime: at(86400) }).returning(); showtimeId = showtime!.id;
    await service.savePerformanceTags(performanceId, [artist], admin.id);
  });
  const preferences = (useBehavior = false) => ({ tagIds: [artist, activity], collectionConsent: true as const, consentVersion: 'interests-v1' as const, useBehavior });
  async function session(content: string, started: number, userId: string | null = buyer.id) {
    const [session] = await db.insert(schema.analyticsSessions).values({ id: randomUUID(), visitorId: randomUUID(), userId, startedAt: at(started), lastSeenAt: at(-10),
      consentVersion: 'analytics-v2-replay', consentedAt: at(started - 1), collectionConsent: true, overseasConsent: true,
      touch: { landingPath: '/', referrerHost: null, source: 'instagram', medium: 'social', campaign: 'launch', term: null, content },
      device: 'mobile', browser: 'safari', os: 'ios', screen: 'small', language: 'ko' }).returning(); return session!.id;
  }
  async function event(sessionId: string, name: string, seconds: number) {
    await db.insert(schema.analyticsEvents).values({ id: randomUUID(), pageId: randomUUID(), sessionId, name, path: `/performance/${performanceId}`, props: { performanceId }, occurredAt: at(seconds) });
  }
  it('stores explicit preferences separately from marketing permission and exposes current consent', async () => {
    expect(await service.preferences(buyer.id)).toMatchObject({ tagIds: [], consentedAt: null, marketingConsent: false });
    const saved = await service.savePreferences(buyer.id, preferences());
    expect(saved.tagIds.sort()).toEqual([artist, activity].sort()); expect(saved.behaviorSince).toBeNull();
    expect(Date.parse(saved.expiresAt!) - Date.parse(saved.updatedAt!)).toBe(90 * 86400000);
    expect((await service.profile(buyer.id)).inferred).toEqual([]);
    expect(await service.overview()).toMatchObject({ activeProfiles: 1, behaviorProfiles: 0, marketingProfiles: 0 });
    await db.update(schema.users).set({ marketingConsent: true }).where(eq(schema.users.id, buyer.id));
    expect((await service.profile(buyer.id)).marketingConsent).toBe(true);
    const list = await service.profiles({ page: 1, search: 'buyer@', marketingOnly: true, tagId: artist });
    expect(list.total).toBe(1); expect(list.rows[0]?.name).toBe('Test buyer');
    expect((await service.profiles({ page: 1, search: '%', marketingOnly: false })).total).toBe(0);
  });
  it('ignores pre-consent observations, de-duplicates reloads and excludes cancelled purchases', async () => {
    await service.savePreferences(buyer.id, preferences(true));
    await db.update(schema.audiencePreferences).set({ behaviorSince: at(-200) }).where(eq(schema.audiencePreferences.userId, buyer.id));
    const id = await session('poster', -400);
    await event(id, 'performance_view', -300); await event(id, 'performance_view', -150); await event(id, 'performance_view', -140);
    await db.insert(schema.performanceFavorites).values({ userId: buyer.id, performanceId, createdAt: at(-100) });
    for (const status of ['CONFIRMED', 'CANCELLED'] as const) {
      const [r] = await db.insert(schema.reservations).values({ userId: buyer.id, showtimeId, reservationNumber: randomUUID().slice(0, 25), totalAmount: 1000, status, cancelDeadline: at(86400) }).returning();
      await db.insert(schema.payments).values({ reservationId: r!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(), method: 'card', provider: 'CARD', amount: 1000, status: status === 'CONFIRMED' ? 'DONE' : 'CANCELED', paidAt: at(-50) });
    }
    const profile = await service.profile(buyer.id);
    expect(profile.inferred).toHaveLength(1); expect(profile.inferred[0]).toMatchObject({ tagId: artist, viewDays: 1, favorites: 1, purchases: 1, level: 'high' });
    expect(profile.purchaseStage).toBe('purchased');
    const before = (await service.preferences(buyer.id)).behaviorSince;
    await service.savePreferences(buyer.id, preferences(true)); expect((await service.preferences(buyer.id)).behaviorSince).toBe(before);
    await service.savePreferences(buyer.id, preferences(false)); expect((await service.profile(buyer.id)).inferred).toEqual([]);
    await service.savePreferences(buyer.id, preferences(true)); expect((await service.profile(buyer.id)).inferred).toEqual([]);
  });
  it('withdraws answers and inference immediately; expiry and closed accounts are unavailable', async () => {
    await service.savePreferences(buyer.id, preferences(true)); await service.withdraw(buyer.id);
    expect(await db.select().from(schema.audienceUserTags)).toHaveLength(0);
    await expect(service.profile(buyer.id)).rejects.toThrow('활성 관심 프로필');
    expect((await db.select().from(schema.audienceConsentEvents)).map((r) => r.action)).toEqual(['save', 'withdraw']);
    await service.savePreferences(buyer.id, preferences());
    await db.update(schema.audiencePreferences).set({ expiresAt: at(-1) });
    expect((await service.preferences(buyer.id)).tagIds).toEqual([]); expect((await service.overview()).activeProfiles).toBe(0);
    const boss = { send: vi.fn(), isAvailable: true } as unknown as PgBossContract;
    await new AnalyticsMaintenance(db, boss).run(); expect(await db.select().from(schema.audiencePreferences)).toHaveLength(0);
    await db.update(schema.users).set({ accountStatus: 'withdrawn' }).where(eq(schema.users.id, buyer.id));
    await expect(service.savePreferences(buyer.id, preferences())).rejects.toThrow('사용 가능한 회원');
  });
  it('validates selectable tags and persists audited catalogue mappings', async () => {
    await expect(service.savePreferences(buyer.id, { ...preferences(), tagIds: [randomUUID()] })).rejects.toThrow('관심 태그');
    const created = await service.saveTag({ slug: 'test-tag', kind: 'benefit', labels: { ko: '테스트', en: 'Test' }, active: false }, admin.id);
    await expect(service.savePreferences(buyer.id, { ...preferences(), tagIds: [created.id] })).rejects.toThrow('관심 태그');
    await expect(service.savePerformanceTags(randomUUID(), [artist], admin.id)).rejects.toThrow('공연');
    expect((await service.performances()).find((p) => p.id === performanceId)?.tagIds).toEqual([artist]);
    expect((await db.execute(sql`select count(*)::int as n from admin_audit_logs where resource_type='performance_interest_tags'`)).rows[0]?.n).toBe(1);
  });
  it('attributes each order to one latest matching creative and uses converted sessions for rates', async () => {
    const early = await session('artist-photo', -400); const late = await session('photo-benefit', -200);
    await event(early, 'checkout_start', -250); await event(late, 'checkout_start', -100); await event(late, 'favorite_add', -150);
    for (let index = 0; index < 2; index++) {
      const [r] = await db.insert(schema.reservations).values({ userId: buyer.id, showtimeId, reservationNumber: randomUUID().slice(0, 25), totalAmount: 1000, status: 'CONFIRMED', cancelDeadline: at(86400) }).returning();
      await db.insert(schema.payments).values({ reservationId: r!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(), method: 'card', provider: 'CARD', amount: 1000, status: 'DONE', paidAt: at(-50) });
    }
    const result = await report.report({ since: at(-600).toISOString(), until: at(1).toISOString() });
    expect(result.rows.find((r) => r.content === 'artist-photo')).toMatchObject({ paidOrders: 0, signupSessions: 1 });
    expect(result.rows.find((r) => r.content === 'photo-benefit')).toMatchObject({ sessions: 1, paidOrders: 2, paidSessions: 1, paymentRate: 100, favoriteSessions: 1, signupSessions: 0 });
    expect(JSON.stringify(result)).not.toMatch(/buyer@test|userId|visitorId|sessionId/);
  });
});
