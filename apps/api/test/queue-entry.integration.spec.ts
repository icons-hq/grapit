import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { ForbiddenException, HttpException, type ExecutionContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema/index.js';
import {
  bookingPolicies,
  performances,
  refreshTokens,
  reservations,
  seatInventories,
  seatMaps,
  showtimes,
  users,
} from '../src/database/schema/index.js';
import { QueueService } from '../src/modules/queue/queue.service.js';
import { AdmissionGuard } from '../src/modules/queue/guards/admission.guard.js';
import type { QueueGateway } from '../src/modules/queue/queue.gateway.js';

/**
 * Queue entry gate against real Postgres 16 and Valkey 8.
 * Covers the SQL sellable-showtime cutoff (C1), that rejected entries never
 * create queue keys, remaining seats over the showtimes on sale, re-entry
 * after the active window (D2) with the real order-binding query, and the
 * AdmissionGuard rule of the provider handoff (`POST /payments/branch`).
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
    const postgres = await startPostgresContainer({ image: 'postgres:16', database: 'grabit_test' });
    pgContainer = postgres.container;

    redisContainer = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();

    pool = new Pool({
      host: postgres.host,
      port: postgres.port,
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
    await db.delete(reservations);
    await db.delete(users);
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

  it('allows entry while one showtime is still ahead and reports an unavailable wait without seats', async () => {
    const performanceId = await seedPerformance({
      showtimeOffsetsMs: [-3_600_000, 3_600_000],
    });

    const result = await service.enterPerformanceQueue({ performanceId, identity });

    // No seat map -> no remaining seats -> nobody can be admitted, so the
    // estimate is unavailable instead of "entering soon" (etaSeconds stays > 0
    // for clients that only read etaSeconds).
    expect(result.state).toBe('WAITING');
    expect(result.position).toBe(1);
    expect(result.remainingSeats).toBe(0);
    expect(result.etaUnavailable).toBe(true);
    expect(result.etaSeconds).toBeGreaterThan(0);

    // The estimate keeps no per-session state in Valkey.
    const keys = await queueKeysFor(performanceId);
    expect(keys.some((key) => key.includes(':eta-origin:'))).toBe(false);
  });

  async function seedSeatMap(performanceId: string, totalSeats: number): Promise<void> {
    await db.insert(seatMaps).values({
      performanceId,
      svgUrl: 'https://example.test/seat-map.svg',
      totalSeats,
    });
  }

  it('counts only the seats of showtimes still on sale (C1)', async () => {
    const performanceId = await seedPerformance({
      showtimeOffsetsMs: [-3_600_000, 3_600_000],
    });
    await seedSeatMap(performanceId, 2);
    const rows = await db.select().from(showtimes).where(eq(showtimes.performanceId, performanceId));
    const upcoming = rows.find((row) => row.dateTime.getTime() > Date.now());
    // The upcoming showtime is sold out; the started one still has 2 free seats.
    await db.insert(seatInventories).values(['A-1', 'A-2'].map((seatKey) => ({
      showtimeId: upcoming!.id,
      seatId: seatKey,
      seatKey,
      status: 'sold' as const,
    })));

    const result = await service.enterPerformanceQueue({ performanceId, identity });

    expect(result).toMatchObject({
      state: 'WAITING',
      remainingSeats: 0,
      etaUnavailable: true,
    });
  });

  it('keeps only payment recovery after the active window while a bound pending order is payable, then re-queues (D2)', async () => {
    const performanceId = await seedPerformance({ showtimeOffsetsMs: [86_400_000] });
    await seedSeatMap(performanceId, 10);
    const [showtime] = await db.select().from(showtimes)
      .where(eq(showtimes.performanceId, performanceId));
    const [buyer] = await db.insert(users).values({
      email: `${randomUUID()}@example.test`,
      name: 'Buyer',
      phone: '+821012345678',
      gender: 'unspecified',
      birthDate: '1990-01-01',
    }).returning();
    const buyerIdentity = {
      userId: buyer!.id,
      refreshTokenFamilyId: 'family-d2',
      deviceSlotId: 'family-d2',
    };

    const admitted = await service.enterPerformanceQueue({ performanceId, identity: buyerIdentity });
    expect(admitted.state).toBe('ADMITTED');

    // The active window ended a minute ago: rewrite only that field of the
    // stored record (Valkey keeps the real TTL).
    const sessionKey = `{queue:${performanceId}}:session:${admitted.queueSessionId}`;
    const record = JSON.parse((await redis.get(sessionKey))!) as Record<string, string>;
    const activeUntilAt = new Date(Date.now() - 60_000).toISOString();
    await redis.set(sessionKey, JSON.stringify({ ...record, activeUntilAt }), 'KEEPTTL');

    // A pending order prepared under this admission can still be paid.
    const orderId = `GRP-${randomUUID()}`;
    const [order] = await db.insert(reservations).values({
      userId: buyer!.id,
      showtimeId: showtime!.id,
      reservationNumber: randomUUID().slice(0, 28),
      tossOrderId: orderId,
      status: 'PENDING_PAYMENT',
      totalAmount: 52_000,
      cancelDeadline: new Date(Date.now() + 86_400_000),
      queueSessionId: admitted.queueSessionId,
      refreshFamilyId: buyerIdentity.refreshTokenFamilyId,
      deviceSlotKey: buyerIdentity.deviceSlotId,
      admittedAt: new Date(record['admittedAt']!),
      admissionActiveUntilAt: new Date(activeUntilAt),
      reentryGraceUntilAt: new Date(record['reentryGraceUntilAt']!),
      paymentDeadlineAt: new Date(Date.now() + 5 * 60_000),
    }).returning();

    const recovery = await service.enterPerformanceQueue({
      performanceId,
      identity: buyerIdentity,
      presentedAdmissionToken: admitted.admissionToken,
    });
    expect(recovery).toMatchObject({
      queueSessionId: admitted.queueSessionId,
      state: 'PAYMENT_RECOVERY',
      autoEnter: false,
      recoveryOrderId: orderId,
      activeUntilAt,
    });

    // The buyer cancels the order: the next entry is a new queue entry.
    await db.update(reservations).set({ status: 'CANCELLED' }).where(eq(reservations.id, order!.id));
    const rejoin = await service.enterPerformanceQueue({
      performanceId,
      identity: buyerIdentity,
      presentedAdmissionToken: recovery.admissionToken,
    });

    expect(rejoin.queueSessionId).not.toBe(admitted.queueSessionId);
    expect(rejoin.state).not.toBe('PAYMENT_RECOVERY');
    expect(rejoin).not.toHaveProperty('recoveryOrderId');
    expect(await redis.get(sessionKey)).toBeNull();
    expect(await redis.sismember(`{queue:${performanceId}}:active`, admitted.queueSessionId)).toBe(0);
  });

  it('admits the provider handoff of a prepared order only for the browser bound to it, after the window too', async () => {
    const performanceId = await seedPerformance({ showtimeOffsetsMs: [86_400_000] });
    await seedSeatMap(performanceId, 10);
    const [showtime] = await db.select().from(showtimes)
      .where(eq(showtimes.performanceId, performanceId));
    const [buyer] = await db.insert(users).values({
      email: `${randomUUID()}@example.test`,
      name: 'Buyer',
      phone: '+821012345679',
      gender: 'unspecified',
      birthDate: '1990-01-01',
    }).returning();
    // Two signed-in browsers of the same buyer: the PC that prepared the order
    // and a phone that opens "continue payment" from the reservation list.
    const refreshToken = async (family: string) => {
      const token = `refresh-${family}-${randomUUID()}`;
      await db.insert(refreshTokens).values({
        userId: buyer!.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        family,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      return token;
    };
    const pcRefresh = await refreshToken('family-pc');
    const phoneRefresh = await refreshToken('family-phone');
    const pcIdentity = {
      userId: buyer!.id,
      refreshTokenFamilyId: 'family-pc',
      deviceSlotId: 'family-pc',
    };

    const admitted = await service.enterPerformanceQueue({ performanceId, identity: pcIdentity });
    expect(admitted.state).toBe('ADMITTED');
    // The queue window has closed; only the order binding can authorise now.
    const sessionKey = `{queue:${performanceId}}:session:${admitted.queueSessionId}`;
    const record = JSON.parse((await redis.get(sessionKey))!) as Record<string, string>;
    const activeUntilAt = new Date(Date.now() - 60_000).toISOString();
    await redis.set(sessionKey, JSON.stringify({ ...record, activeUntilAt }), 'KEEPTTL');

    const orderId = `GRP-${randomUUID()}`;
    const [order] = await db.insert(reservations).values({
      userId: buyer!.id,
      showtimeId: showtime!.id,
      reservationNumber: randomUUID().slice(0, 28),
      tossOrderId: orderId,
      status: 'PENDING_PAYMENT',
      totalAmount: 52_000,
      cancelDeadline: new Date(Date.now() + 86_400_000),
      queueSessionId: admitted.queueSessionId,
      refreshFamilyId: pcIdentity.refreshTokenFamilyId,
      deviceSlotKey: pcIdentity.deviceSlotId,
      admittedAt: new Date(record['admittedAt']!),
      admissionActiveUntilAt: new Date(activeUntilAt),
      reentryGraceUntilAt: new Date(record['reentryGraceUntilAt']!),
      paymentDeadlineAt: new Date(Date.now() + 5 * 60_000),
    }).returning();

    const guard = new AdmissionGuard(service);
    const branchRequest = (cookies: Record<string, string>) => {
      const request = {
        user: { id: buyer!.id, role: 'user' },
        cookies,
        body: { orderId, paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' } },
        originalUrl: '/api/v1/payments/branch',
        queueAdmission: undefined as { queueSessionId: string; admissionToken: string } | undefined,
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      return { request, context };
    };

    // Another browser without an admission is refused with the queue 403
    // before any handoff (no checkoutStartedAt, deadline unchanged).
    const phone = branchRequest({ refreshToken: phoneRefresh });
    const refused = await rejection(guard.canActivate(phone.context));
    expect(refused).toBeInstanceOf(ForbiddenException);
    expect(refused.message).toBe('대기열 입장 인증이 필요합니다');

    // The browser that prepared it hands off without the expired admission cookie.
    const pc = branchRequest({ refreshToken: pcRefresh });
    await expect(guard.canActivate(pc.context)).resolves.toBe(true);
    expect(pc.request.queueAdmission).toMatchObject({
      queueSessionId: admitted.queueSessionId,
      admissionToken: 'order-bound',
    });

    // Like payment confirm, a live admission of the other browser for the same
    // performance is the fallback.
    const phoneAdmission = await service.enterPerformanceQueue({
      performanceId,
      identity: { userId: buyer!.id, refreshTokenFamilyId: 'family-phone', deviceSlotId: 'family-phone' },
    });
    expect(phoneAdmission.state).toBe('ADMITTED');
    const admittedPhone = branchRequest({
      refreshToken: phoneRefresh,
      grabit_queue_admission: phoneAdmission.admissionToken!,
    });
    await expect(guard.canActivate(admittedPhone.context)).resolves.toBe(true);
    expect(admittedPhone.request.queueAdmission?.queueSessionId).toBe(phoneAdmission.queueSessionId);

    const [unchanged] = await db.select().from(reservations).where(eq(reservations.id, order!.id));
    expect(unchanged).toMatchObject({
      status: 'PENDING_PAYMENT',
      checkoutStartedAt: null,
      paymentDeadlineAt: order!.paymentDeadlineAt,
    });
  });
});
