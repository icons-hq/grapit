import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { PerformanceController } from '../src/modules/performance/performance.controller.js';
import { SearchService } from '../src/modules/search/search.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

// Never reads DATABASE_URL. The disposable container below is the only database.
describe('Public catalog sale status — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'catalog_status_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'catalog_status_test', max: 4 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  it('lists performances by their booking start, not only by the stored sale status', async () => {
    const category = `status-${randomUUID()}`;
    const now = Date.now();
    const rows = {
      sellingBeforeStart: { status: 'selling', startsAt: new Date(now + 20_000), views: 1000 },
      sellingOpen: { status: 'selling', startsAt: new Date(now - 60_000), views: 3 },
      sellingNoPolicy: { status: 'selling', startsAt: undefined, views: 2 },
      closingBeforeStart: { status: 'closing_soon', startsAt: new Date(now + 3_600_000), views: 900 },
      upcomingOpened: { status: 'upcoming', startsAt: new Date(now - 60_000), views: 1 },
      upcomingScheduled: { status: 'upcoming', startsAt: new Date(now + 3_600_000), views: 0 },
      upcomingUnscheduled: { status: 'upcoming', startsAt: null, views: 0 },
      endedBeforeStart: { status: 'ended', startsAt: new Date(now + 20_000), views: 0 },
    } as const;
    const ids = {} as Record<keyof typeof rows, string>;
    for (const [key, row] of Object.entries(rows) as Array<[keyof typeof rows, (typeof rows)[keyof typeof rows]]>) {
      const [event] = await db.insert(schema.performances).values({ title: `${category} ${key}`, genre: 'artist_celebrity',
        subcategory: category, status: row.status, publishState: 'published', ageRating: 'All ages', viewCount: row.views,
        startDate: new Date('2099-02-01'), endDate: new Date('2099-02-01') }).returning();
      ids[key] = event!.id;
      if (row.startsAt !== undefined) {
        await db.insert(schema.bookingPolicies).values({ performanceId: event!.id, bookingStartsAt: row.startsAt });
      }
    }
    const cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const catalog = new PerformanceService(db, cache as never);
    const list = (status: 'selling' | 'upcoming' | 'ended') => catalog.findByGenre('artist_celebrity',
      { page: 1, limit: 20, sort: 'latest', ended: true, sub: category, status });

    const selling = await list('selling');
    expect(selling.data.map((card) => card.id).sort()).toEqual(
      [ids.sellingOpen, ids.sellingNoPolicy, ids.upcomingOpened].sort());
    expect(selling.data.every((card) => card.status === 'selling')).toBe(true);
    // The on-sale page must expire when the selling row waiting for its start opens, not at the default TTL.
    const sellingTtl = cache.set.mock.calls.at(-1)?.[2] as number;
    expect(sellingTtl).toBeGreaterThan(0);
    expect(sellingTtl).toBeLessThanOrEqual(20);

    const upcoming = await list('upcoming');
    expect(upcoming.data.map((card) => card.id).sort()).toEqual(
      [ids.sellingBeforeStart, ids.closingBeforeStart, ids.upcomingScheduled, ids.upcomingUnscheduled].sort());
    expect(upcoming.data.every((card) => card.status === 'upcoming')).toBe(true);

    const ended = await list('ended');
    expect(ended.data.map((card) => card.id)).toEqual([ids.endedBeforeStart]);

    const hot = await catalog.getHotPerformances();
    expect(hot.map((card) => card.id)).not.toContain(ids.sellingBeforeStart);
    expect(hot.map((card) => card.id)).not.toContain(ids.closingBeforeStart);
    expect(hot.every((card) => card.status === 'selling')).toBe(true);
    // The most viewed row opens in 20s; the hot list must expire then, not after the default TTL.
    const hotTtl = cache.set.mock.calls.at(-1)?.[2] as number;
    expect(hotTtl).toBeGreaterThan(0);
    expect(hotTtl).toBeLessThanOrEqual(20);

    const detail = new PerformanceController(catalog);
    expect((await detail.getPerformance(ids.sellingBeforeStart)).status).toBe('upcoming');
    expect((await detail.getPerformance(ids.closingBeforeStart)).status).toBe('upcoming');
    expect((await detail.getPerformance(ids.upcomingOpened)).status).toBe('selling');
    expect((await detail.getPerformance(ids.sellingOpen)).status).toBe('selling');

    const found = await new SearchService(db).search({ q: category, page: 1, limit: 20, ended: true });
    expect(found.data.find((card) => card.id === ids.sellingBeforeStart)?.status).toBe('upcoming');
    expect(found.data.find((card) => card.id === ids.upcomingOpened)?.status).toBe('selling');
  });
});
