import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { StartedTestContainer } from 'testcontainers';
import { startPostgresContainer } from './helpers/postgres-container.js';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { loadSignupMonitoring } from '../src/modules/admin/signup-monitoring.js';

describe('signup monitoring / isolated PostgreSQL', () => {
  let container: StartedTestContainer; let pool: Pool; let db: DrizzleDB;
  const now = new Date('2026-11-11T06:00:00Z');
  beforeAll(async () => {
    const pg = await startPostgresContainer({ database: 'signup_monitoring_test' });
    container = pg.container;
    pool = new Pool({ host: pg.host, port: pg.port, user: pg.user, password: pg.password, database: pg.database });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
  }, 180000);
  afterAll(async () => { await pool?.end(); await container?.stop(); });
  beforeEach(async () => { await pool.query('truncate users, venues cascade'); });
  async function member(at: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, email: `${id}@test.invalid`, name: 'Test', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', passwordHash: 'test-only', createdAt: new Date(at), ...overrides });
    return id;
  }
  it('counts half-open KST windows, includes withdrawn, excludes merged/admin and returns aggregates only', async () => {
    await member('2026-11-09T23:59:59.999Z');
    await member('2026-11-10T00:00:00Z');
    await member('2026-11-10T14:59:59.999Z');
    await member('2026-11-10T15:00:00Z', { isEmailVerified: true, isPhoneVerified: true, marketingConsent: true });
    await member('2026-11-11T05:59:59.999Z', { accountStatus: 'withdrawn', country: 'TH', preferredLocale: 'th' });
    await member('2026-11-11T06:00:00Z');
    await member('2026-11-11T03:00:00Z', { accountStatus: 'merged' });
    await member('2026-11-11T03:00:00Z', { role: 'admin' });
    const report = await loadSignupMonitoring(db, { period: 'today' }, now);
    expect(report.summary).toEqual({ signups: 2, previousSignups: 2, change: 0, changeRate: 0, emailVerified: 1, phoneVerified: 1, marketingConsented: 1, firstPaidMembers: 0, firstPaidRate: 0 });
    expect(report.hourly).toHaveLength(15);
    expect(report.hourly[0]).toEqual({ hour: '2026-11-11 00:00', signups: 1 });
    expect(report.hourly[14]?.signups).toBe(1);
    expect(report.countries).toEqual([{ value: 'KR', count: 1, rate: 50 }, { value: 'TH', count: 1, rate: 50 }]);
    expect(JSON.stringify(report)).not.toMatch(/test.invalid|Test|821000000000|password|userId/);
  });
  it('selects one earliest signup provider, treats later linking separately and counts each paying member once', async () => {
    const id = await member('2026-11-11T04:00:00Z', { passwordHash: null });
    const emailId = await member('2026-11-11T04:00:00Z');
    for (const [userId, provider, time] of [[id, 'kakao', '04:00:00'], [id, 'google', '04:00:30'], [emailId, 'naver', '05:00:00']]) {
      await db.insert(schema.socialAccounts).values({ userId: userId!, provider: provider!, providerId: randomUUID(), createdAt: new Date(`2026-11-11T${time}Z`) });
    }
    const [venue] = await db.insert(schema.venues).values({ name: 'Test' }).returning();
    const [performance] = await db.insert(schema.performances).values({ title: 'Test', genre: 'artist_celebrity', venueId: venue!.id, ageRating: 'all', startDate: now, endDate: now }).returning();
    const [showtime] = await db.insert(schema.showtimes).values({ performanceId: performance!.id, dateTime: now }).returning();
    for (const [userId, status, paymentStatus, paidAt] of [[id, 'CONFIRMED', 'DONE', '05:00:00'], [id, 'CANCELLED', 'CANCELED', '05:10:00'], [emailId, 'FAILED', 'CANCELED', '05:20:00'], [emailId, 'CONFIRMED', 'DONE', '07:00:00']] as const) {
      const [reservation] = await db.insert(schema.reservations).values({ userId, showtimeId: showtime!.id, reservationNumber: randomUUID().slice(0, 25), totalAmount: 1000, status, cancelDeadline: now }).returning();
      await db.insert(schema.payments).values({ reservationId: reservation!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(), method: 'card', provider: 'CARD', amount: 1000, status: paymentStatus, paidAt: new Date(`2026-11-11T${paidAt}Z`) });
    }
    const report = await loadSignupMonitoring(db, { period: 'announcement', since: '2026-11-11T04:00:00Z' }, now);
    expect(report.summary.firstPaidMembers).toBe(1);
    expect(report.summary.firstPaidRate).toBe(50);
    expect(report.summary.changeRate).toBeNull();
    expect(report.providers).toEqual([{ value: 'email', count: 1, rate: 50 }, { value: 'kakao', count: 1, rate: 50 }]);
  });
  it('returns zero-filled hourly buckets with no users', async () => {
    const report = await loadSignupMonitoring(db, { period: '24h' }, now);
    expect(report.summary.signups).toBe(0);
    expect(report.summary.firstPaidRate).toBe(0);
    expect(report.hourly).toHaveLength(24);
    expect(report.hourly.every((h) => h.signups === 0)).toBe(true);
    expect(report.providers).toEqual([]);
  });
});
