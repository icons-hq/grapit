import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { HttpException } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema/index.js';
import { bookingPolicies, performances, showtimes } from '../src/database/schema/index.js';
import { QueueService } from '../src/modules/queue/queue.service.js';
import type { QueueGateway } from '../src/modules/queue/queue.gateway.js';

/**
 * Queue entry gate + wait estimate against real Postgres 16 and Valkey 8.
 * Covers the SQL sellable-showtime cutoff (C1) and that rejected entries never
 * create queue keys.
 *
 * 실행: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/queue-entry.integration.spec.ts
 */
describe('QueueService entry gate (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: NodePgDatabase<typeof schema>;
  let redis: IORedis;
  let service: QueueService;

  const identity = {
    userId: randomUUID(),
    refreshTokenFamilyId: 'family-1',
    deviceSlotId: 'family-1',
  };

  beforeAll(async () => {
    pgContainer = await new GenericContainer('postgres:16')
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_PASSWORD: 'test',
        POSTGRES_USER: 'postgres',
        POSTGRES_DB: 'grabit_test',
      })
      .start();

    redisContainer = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();

    pool = new Pool({
      host: pgContainer.getHost(),
      port: pgContainer.getMappedPort(5432),
      user: 'postgres',
      password: 'test',
      database: 'grabit_test',
    });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    redis = new IORedis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
      maxRetriesPerRequest: 3,
    });

    const gateway = {
      emitAdmitted: vi.fn(),
      emitExpired: vi.fn(),
      emitPosition: vi.fn(),
    } as unknown as QueueGateway;
    service = new QueueService(redis as never, db as never, gateway);
  }, 180_000);

  afterAll(async () => {
    await closePool?.();
    await redis?.quit();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    await db.delete(showtimes);
    await db.delete(bookingPolicies);
    await db.delete(performances);
    await redis.flushall();
  });

  async function seedPerformance(options: {
    showtimeOffsetsMs: number[];
    publishState?: 'draft' | 'published';
    status?: 'upcoming' | 'selling' | 'ended';
    bookingStartsAt?: Date | null;
  }): Promise<string> {
    const performanceId = randomUUID();
    await db.insert(performances).values({
      id: performanceId,
      title: 'Queue Gate Performance',
      genre: 'concert',
      ageRating: '전체관람가',
      status: options.status ?? 'selling',
      publishState: options.publishState ?? 'published',
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
    });
    if (options.bookingStartsAt !== undefined) {
      await db.insert(bookingPolicies).values({
        performanceId,
        bookingStartsAt: options.bookingStartsAt,
      });
    }
    for (const offset of options.showtimeOffsetsMs) {
      await db.insert(showtimes).values({
        performanceId,
        dateTime: new Date(Date.now() + offset),
      });
    }
    return performanceId;
  }

  async function rejection(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof HttpException) return error;
      throw error;
    }
    throw new Error('expected rejection');
  }

  async function queueKeysFor(performanceId: string): Promise<string[]> {
    return redis.keys(`{queue:${performanceId}}*`);
  }

  it('returns 404 for an unknown performance id and creates no queue keys', async () => {
    const unknownId = randomUUID();

    const error = await rejection(
      service.enterPerformanceQueue({ performanceId: unknownId, identity }),
    );

    expect(error.getStatus()).toBe(404);
    expect(await queueKeysFor(unknownId)).toEqual([]);
    expect(await redis.dbsize()).toBe(0);
  });

  it('hides unpublished performances from public entry', async () => {
    const performanceId = await seedPerformance({
      showtimeOffsetsMs: [3_600_000],
      publishState: 'draft',
    });

    const error = await rejection(
      service.enterPerformanceQueue({ performanceId, identity }),
    );

    expect(error.getStatus()).toBe(404);
    expect(await queueKeysFor(performanceId)).toEqual([]);
  });

  it.each([undefined, 'admin'])(
    'blocks entry once every showtime has started, including admins (role: %s)',
    async (actorRole) => {
      const performanceId = await seedPerformance({
        showtimeOffsetsMs: [-2 * 3_600_000, -1_000],
      });

      const error = await rejection(
        service.enterPerformanceQueue({
          performanceId,
          identity,
          actorRole,
          bypassQueue: actorRole === 'admin',
        }),
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe('이미 시작된 회차는 예매할 수 없습니다.');
      expect(await queueKeysFor(performanceId)).toEqual([]);
    },
  );

  it('returns the booking start and server time when public booking is not open yet', async () => {
    const bookingStartsAt = new Date(Date.now() + 5 * 60_000);
    bookingStartsAt.setMilliseconds(0);
    const performanceId = await seedPerformance({
      showtimeOffsetsMs: [86_400_000],
      bookingStartsAt,
    });

    const error = await rejection(
      service.enterPerformanceQueue({ performanceId, identity }),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({
      errorCode: 'BOOKING_NOT_OPEN',
      bookingStartsAt: bookingStartsAt.toISOString(),
    });
    expect(await queueKeysFor(performanceId)).toEqual([]);
  });

  it('allows entry while one showtime is still ahead and starts a pending wait estimate', async () => {
    const performanceId = await seedPerformance({
      showtimeOffsetsMs: [-3_600_000, 3_600_000],
    });

    const result = await service.enterPerformanceQueue({ performanceId, identity });

    // No seat map -> no remaining seats -> the session keeps waiting.
    expect(result.state).toBe('WAITING');
    expect(result.position).toBe(1);
    expect(result.etaPending).toBe(true);
    expect(result.etaSeconds).toBe(0);

    const originKey = `{queue:${performanceId}}:eta-origin:${result.queueSessionId}`;
    expect(JSON.parse((await redis.get(originKey)) ?? 'null')).toMatchObject({ rank: 0 });
    const ttl = await redis.ttl(originKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7_200);
  });
});
