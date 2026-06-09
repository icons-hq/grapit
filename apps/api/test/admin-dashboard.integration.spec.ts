import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema/index.js';
import {
  reservations,
  showtimes,
  performances,
  venues,
  reservationSeats,
  payments,
  ticketItems,
  users,
} from '../src/database/schema/index.js';
import { AdminDashboardService } from '../src/modules/admin/admin-dashboard.service.js';
import { CacheService } from '../src/modules/performance/cache.service.js';

/**
 * AdminDashboardService integration test — real Postgres 16 + Valkey 8 via testcontainers.
 *
 * RED Wave 1 spec: 2개 핵심 integration 테스트
 *  - revenue-daily: 30d period → 최대 30개 일별 bucket (빈 날짜 포함, review MEDIUM 6)
 *  - top10: 최근 30d CONFIRMED 예매 기준 공연 랭킹 (최대 10개, count desc)
 *
 * Plan 01 Wave 1: service는 skeleton → 두 테스트 모두 `Error: Not implemented`로 RED.
 * Plan 02 Task 02-01이 service를 구현하면 GREEN으로 전환.
 *
 * 실행: pnpm --filter @grabit/api test:integration -- admin-dashboard.integration
 */
describe('AdminDashboardService (integration)', () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let redis: IORedis;
  let service: AdminDashboardService;

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
    db = drizzle(pool, { schema });

    // Apply real Drizzle migrations so schema matches production exactly.
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    redis = new IORedis({
      host: redisContainer.getHost(),
      port: redisContainer.getMappedPort(6379),
      maxRetriesPerRequest: 3,
    });

    const cache = new CacheService(redis as never);
    // service constructor takes DrizzleDB + CacheService — `as never` confined to integration wiring.
    service = new AdminDashboardService(db as never, cache);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await redis?.quit();
    await pgContainer?.stop();
    await redisContainer?.stop();
  });

  beforeEach(async () => {
    // Clean all tables between tests. Child → parent order respects FKs.
    await db.delete(reservationSeats);
    await db.delete(ticketItems);
    await db.delete(payments);
    await db.delete(reservations);
    await db.delete(showtimes);
    await db.delete(performances);
    await db.delete(venues);
    await db.delete(users);
    await redis.flushall();
  });

  async function seedVenuePerformanceShowtime(overrides: {
    title?: string;
    genre?: 'artist_celebrity' | 'ip_popup';
    showtimeOffsetMs?: number;
  } = {}) {
    const venueId = randomUUID();
    await db.insert(venues).values({
      id: venueId,
      name: `Venue-${venueId.slice(0, 8)}`,
    });
    const performanceId = randomUUID();
    await db.insert(performances).values({
      id: performanceId,
      title: overrides.title ?? 'Test Performance',
      genre: overrides.genre ?? 'artist_celebrity',
      venueId,
      ageRating: '전체관람가',
      status: 'selling',
      startDate: new Date(Date.now() - 30 * 86400000),
      endDate: new Date(Date.now() + 30 * 86400000),
    });
    const showtimeId = randomUUID();
    await db.insert(showtimes).values({
      id: showtimeId,
      performanceId,
      dateTime: new Date(Date.now() + (overrides.showtimeOffsetMs ?? 86400000)),
    });
    return { venueId, performanceId, showtimeId };
  }

  async function seedUser() {
    const userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `user-${userId.slice(0, 8)}@test.com`,
      name: `User ${userId.slice(0, 4)}`,
      phone: `+82010${Math.floor(Math.random() * 100000000)
        .toString()
        .padStart(8, '0')}`,
      gender: 'unspecified',
      birthDate: '1990-01-01',
      role: 'user',
    });
    return userId;
  }

  async function seedReservation(opts: {
    userId: string;
    showtimeId: string;
    status: 'CONFIRMED' | 'CANCELLED' | 'PENDING_PAYMENT' | 'FAILED';
    totalAmount: number;
    createdAt?: Date;
  }) {
    const reservationId = randomUUID();
    await db.insert(reservations).values({
      id: reservationId,
      userId: opts.userId,
      showtimeId: opts.showtimeId,
      reservationNumber: `R${Date.now()}${Math.floor(Math.random() * 10000)}`,
      status: opts.status,
      totalAmount: opts.totalAmount,
      cancelDeadline: new Date(Date.now() + 86400000),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    return reservationId;
  }

  async function seedPayment(opts: {
    reservationId: string;
    amount: number;
    status: 'READY' | 'IN_PROGRESS' | 'DONE' | 'CANCELED' | 'ABORTED' | 'EXPIRED';
    paidAt?: Date;
    cancelledAt?: Date;
  }) {
    const paymentId = randomUUID();
    await db.insert(payments).values({
      id: paymentId,
      reservationId: opts.reservationId,
      paymentKey: `pk_${paymentId}`,
      tossOrderId: `order_${paymentId}`,
      method: 'card',
      provider: 'CARD',
      amount: opts.amount,
      status: opts.status,
      ...(opts.paidAt ? { paidAt: opts.paidAt } : {}),
      ...(opts.cancelledAt ? { cancelledAt: opts.cancelledAt } : {}),
    });
    return paymentId;
  }

  async function seedTicketItem(opts: {
    reservationId: string;
    paymentId: string;
    showtimeId: string;
    status: 'active' | 'cancellation_pending' | 'cancelled' | 'expired';
    refundableAmount: number;
    cancelledAt?: Date;
    seatKey: string;
  }) {
    await db.insert(ticketItems).values({
      id: randomUUID(),
      reservationId: opts.reservationId,
      paymentId: opts.paymentId,
      showtimeId: opts.showtimeId,
      seatId: opts.seatKey,
      seatKey: opts.seatKey,
      floorKey: '1F',
      floorLabel: '1층',
      tierName: 'R',
      row: 'A',
      number: opts.seatKey,
      price: 50000,
      serviceFee: 2000,
      status: opts.status,
      refundableAmount: opts.refundableAmount,
      ...(opts.cancelledAt ? { cancelledAt: opts.cancelledAt } : {}),
    });
  }

  it('summary: counts completed booking revenue and completed cancellation events only', async () => {
    const { showtimeId } = await seedVenuePerformanceShowtime();
    const userId = await seedUser();
    const today = new Date();

    const confirmedReservationId = await seedReservation({
      userId,
      showtimeId,
      status: 'CONFIRMED',
      totalAmount: 120000,
      createdAt: today,
    });
    await seedPayment({
      reservationId: confirmedReservationId,
      amount: 120000,
      status: 'DONE',
      paidAt: today,
    });

    const pendingReservationId = await seedReservation({
      userId,
      showtimeId,
      status: 'PENDING_PAYMENT',
      totalAmount: 90000,
      createdAt: today,
    });
    await seedPayment({
      reservationId: pendingReservationId,
      amount: 90000,
      status: 'READY',
    });

    const partialCancelReservationId = await seedReservation({
      userId,
      showtimeId,
      status: 'CONFIRMED',
      totalAmount: 150000,
      createdAt: today,
    });
    const partialCancelPaymentId = await seedPayment({
      reservationId: partialCancelReservationId,
      amount: 150000,
      status: 'DONE',
      paidAt: today,
    });
    await seedTicketItem({
      reservationId: partialCancelReservationId,
      paymentId: partialCancelPaymentId,
      showtimeId,
      status: 'cancelled',
      refundableAmount: 45000,
      cancelledAt: today,
      seatKey: 'A-1',
    });
    await seedTicketItem({
      reservationId: partialCancelReservationId,
      paymentId: partialCancelPaymentId,
      showtimeId,
      status: 'cancellation_pending',
      refundableAmount: 30000,
      cancelledAt: today,
      seatKey: 'A-2',
    });

    const legacyCancelReservationId = await seedReservation({
      userId,
      showtimeId,
      status: 'CANCELLED',
      totalAmount: 70000,
      createdAt: today,
    });
    await seedPayment({
      reservationId: legacyCancelReservationId,
      amount: 70000,
      status: 'CANCELED',
      cancelledAt: today,
    });

    const sameDayFullCancelReservationId = await seedReservation({
      userId,
      showtimeId,
      status: 'CANCELLED',
      totalAmount: 80000,
      createdAt: today,
    });
    await seedPayment({
      reservationId: sameDayFullCancelReservationId,
      amount: 80000,
      status: 'CANCELED',
      paidAt: today,
      cancelledAt: today,
    });

    const result = await service.getSummary();

    expect(result).toEqual({
      todayBookings: 3,
      todayCancellationEvents: 3,
      todayGrossRevenue: 350000,
      todayNegativeCancellationRevenue: -195000,
      todayNetRevenue: 155000,
    });
  });

  it('revenue-daily: returns up to 30 daily buckets for 30d period', async () => {
    const { showtimeId } = await seedVenuePerformanceShowtime();
    const userId = await seedUser();

    // seed 3 CONFIRMED reservations at day -1, -10, -20 (all within 30d window)
    const now = Date.now();
    await seedReservation({
      userId,
      showtimeId,
      status: 'CONFIRMED',
      totalAmount: 50000,
      createdAt: new Date(now - 1 * 86400000),
    });
    await seedReservation({
      userId,
      showtimeId,
      status: 'CONFIRMED',
      totalAmount: 70000,
      createdAt: new Date(now - 10 * 86400000),
    });
    await seedReservation({
      userId,
      showtimeId,
      status: 'CONFIRMED',
      totalAmount: 30000,
      createdAt: new Date(now - 20 * 86400000),
    });

    const result = await service.getRevenueTrend('30d');
    expect(Array.isArray(result)).toBe(true);
    // review MEDIUM 6: bucket skeleton으로 빈 날짜 채움 → 30d는 30개 bucket
    expect(result.length).toBe(30);
    // bucket 포맷 YYYY-MM-DD 검증
    expect(result[0]?.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('top10: returns up to 10 performances ordered by booking count desc (last 30d CONFIRMED)', async () => {
    // Performance A: 3 CONFIRMED reservations
    // Performance B: 1 CONFIRMED reservation
    const a = await seedVenuePerformanceShowtime({ title: 'Performance A', genre: 'artist_celebrity' });
    const b = await seedVenuePerformanceShowtime({ title: 'Performance B', genre: 'ip_popup' });
    const userId = await seedUser();
    const now = Date.now();

    for (let i = 0; i < 3; i++) {
      await seedReservation({
        userId,
        showtimeId: a.showtimeId,
        status: 'CONFIRMED',
        totalAmount: 50000,
        createdAt: new Date(now - i * 86400000),
      });
    }
    await seedReservation({
      userId,
      showtimeId: b.showtimeId,
      status: 'CONFIRMED',
      totalAmount: 40000,
      createdAt: new Date(now - 1 * 86400000),
    });

    const result = await service.getTopPerformances();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(10);
    if (result.length >= 2) {
      expect(result[0]!.bookingCount).toBeGreaterThanOrEqual(result[1]!.bookingCount);
    }
  });
});
