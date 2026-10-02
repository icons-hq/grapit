import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client, Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { CacheService } from '../src/modules/performance/cache.service.js';
import { CatalogFreshnessService } from '../src/modules/performance/catalog-freshness.service.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { PerformanceViewCounter } from '../src/modules/performance/performance-view-counter.service.js';
import { TranslationService } from '../src/modules/translation/translation.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

/** Map-backed Redis double with the commands CacheService uses (GET/SET EX/DEL/KEYS). */
function createRedisDouble() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    keys: async (pattern: string) => {
      const matcher = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      return [...store.keys()].filter((key) => matcher.test(key));
    },
  };
}

// Never reads DATABASE_URL. Every test uses the disposable container created below.
describe('Catalog cache and view counts — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'catalog_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'catalog_test', max: 4 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function publishedPerformance(title = '2026 걸룰스 팬미팅') {
    const [performance] = await db.insert(schema.performances).values({ title, genre: 'artist_celebrity',
      ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id });
    return performance!;
  }

  async function storedViewCount(id: string) {
    const [row] = await db.select({ viewCount: schema.performances.viewCount, updatedAt: schema.performances.updatedAt })
      .from(schema.performances).where(eq(schema.performances.id, id));
    return row!;
  }

  function catalogService() {
    const redis = createRedisDouble();
    const cache = new CacheService(redis as never);
    const counter = new PerformanceViewCounter(db);
    return { cache, counter, catalog: new PerformanceService(db, cache, counter) };
  }

  it('serves public detail reads without writing the row and folds views into one batched UPDATE', async () => {
    const performance = await publishedPerformance();
    const before = await storedViewCount(performance.id);
    const { catalog, counter } = catalogService();

    const reads = await Promise.all(Array.from({ length: 40 }, () => catalog.findById(performance.id, 'ko')));

    expect(reads.every((detail) => detail?.id === performance.id)).toBe(true);
    expect(await storedViewCount(performance.id)).toEqual(before);

    const deleted = randomUUID();
    counter.record(deleted);
    await expect(counter.flush()).resolves.toBe(41);
    const after = await storedViewCount(performance.id);
    expect(after.viewCount).toBe(before.viewCount + 40);
    // Revision timestamps used by admin optimistic concurrency stay untouched.
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it('gives up quickly behind a held row lock and keeps the views for the next flush', async () => {
    const performance = await publishedPerformance();
    const counter = new PerformanceViewCounter(db);
    vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
    counter.record(performance.id);
    counter.record(performance.id);

    const blocker = await pool.connect();
    try {
      await blocker.query('begin');
      await blocker.query('select id from performances where id = $1 for update', [performance.id]);
      const startedAt = Date.now();
      await expect(counter.flush()).resolves.toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(2_900);
      expect(counter.pendingCount(performance.id)).toBe(2);
    } finally {
      await blocker.query('rollback');
      blocker.release();
    }

    await expect(counter.flush()).resolves.toBe(2);
    expect((await storedViewCount(performance.id)).viewCount).toBe(2);
  });

  it('flushes in one server-side round trip and leaves the pooled connection clean after a timeout', async () => {
    const performance = await publishedPerformance();
    // One connection, so every query below reuses the flush's session.
    const flushPool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'catalog_test', max: 1 });
    const closeFlushPool = createPostgresPoolCleanup(flushPool);
    try {
      const counter = new PerformanceViewCounter(drizzle(flushPool, { schema }));
      vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
      counter.record(performance.id);

      const blocker = await pool.connect();
      let flushRoundTrips = 0;
      try {
        await blocker.query('begin');
        await blocker.query('select id from performances where id = $1 for update', [performance.id]);
        const clientQuery = vi.spyOn(Client.prototype, 'query');
        try {
          await expect(counter.flush()).resolves.toBe(0);
          flushRoundTrips = clientQuery.mock.calls.length;
        } finally {
          clientQuery.mockRestore();
        }
      } finally {
        await blocker.query('rollback');
        blocker.release();
      }

      // No BEGIN/SET/UPDATE/COMMIT round trips: the server ran the whole flush
      // (and its rollback) inside one simple-protocol message.
      expect(flushRoundTrips).toBe(1);

      // SET LOCAL did not leak and no aborted transaction block stayed open.
      const settings = await flushPool.query<{ lock_timeout: string; statement_timeout: string; in_tx: boolean }>(
        `select current_setting('lock_timeout') as lock_timeout,
                current_setting('statement_timeout') as statement_timeout,
                now() <> statement_timestamp() as in_tx`,
      );
      expect(settings.rows[0]).toEqual({ lock_timeout: '0', statement_timeout: '0', in_tx: false });
      expect(counter.pendingCount(performance.id)).toBe(1);

      await expect(counter.flush()).resolves.toBe(1);
      expect((await storedViewCount(performance.id)).viewCount).toBe(1);
      const after = await flushPool.query<{ lock_timeout: string }>(`select current_setting('lock_timeout') as lock_timeout`);
      expect(after.rows[0]?.lock_timeout).toBe('0');
    } finally {
      await closeFlushPool();
    }
  });

  it('shows a newly published performance translation without waiting for the cache TTL', async () => {
    const performance = await publishedPerformance('오픈 공지 공연');
    const { catalog, cache } = catalogService();
    const translations = new TranslationService(
      db,
      { translateText: async (text: string) => ({ status: 'translated', text, targetLang: 'EN-US' }) } as never,
      new CatalogFreshnessService(cache),
    );
    const hash = createHash('sha256').update('오픈 공지 공연', 'utf8').digest('hex');
    const [source] = await db.insert(schema.translationSources).values({ entityType: 'performance',
      entityId: performance.id, field: 'title', sourceText: '오픈 공지 공연', contentHash: hash }).returning();
    const [draft] = await db.insert(schema.translationDrafts).values({ sourceId: source!.id, targetLocale: 'en',
      status: 'review', translatedText: 'Opening notice show', sourceContentHash: hash }).returning();

    expect((await catalog.findById(performance.id, 'en'))?.title).toBe('오픈 공지 공연');
    expect((await catalog.findByGenre('artist_celebrity', { page: 1, limit: 100, sort: 'latest', ended: false, locale: 'en' }))
      .data.find((card) => card.id === performance.id)?.title).toBe('오픈 공지 공연');

    await translations.publishDraft(draft!.id);

    expect((await catalog.findById(performance.id, 'en'))?.title).toBe('Opening notice show');
    expect((await catalog.findByGenre('artist_celebrity', { page: 1, limit: 100, sort: 'latest', ended: false, locale: 'en' }))
      .data.find((card) => card.id === performance.id)?.title).toBe('Opening notice show');
  });
});
