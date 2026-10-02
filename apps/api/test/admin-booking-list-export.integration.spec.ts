import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import * as schema from '../src/database/schema/index.js';
import {
  payments,
  performances,
  refunds,
  reservations,
  showtimes,
  ticketItems,
  users,
  venues,
} from '../src/database/schema/index.js';
import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';

/**
 * Admin booking list / raw export SQL against a real PostgreSQL 16.
 *
 * Unit specs mock the query builder, which hid a raw export that referenced
 * refunds.status without joining refunds (500 for every funnel filter).
 * This spec executes every funnel filter for both the list and the export,
 * and checks the bounded (statement_timeout) read path end to end.
 *
 * Run: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/admin-booking-list-export.integration.spec.ts
 */
describe('AdminBookingService list and raw export (integration)', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: NodePgDatabase<typeof schema>;
  let service: AdminBookingService;
  let actorId: string;
  let performanceId: string;
  let showtimeId: string;
  const expectedReservationNumbers: Record<string, string[]> = {
    SOLD: [],
    PAYMENT_PENDING: [],
    PAYMENT_PROCESSING: [],
    PAYMENT_FAILED: [],
    CANCEL_PROCESSING: [],
    PARTIAL_CANCELLED: [],
    CANCELLED: [],
  };

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'admin_booking_test' });
    container = postgres.container;
    pool = new Pool({
      host: postgres.host,
      port: postgres.port,
      user: 'postgres',
      password: 'test',
      database: 'admin_booking_test',
      max: 4,
    });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    actorId = randomUUID();
    await db.insert(users).values({
      id: actorId,
      email: `${actorId}@example.test`,
      name: 'Admin operator',
      phone: '+821000000000',
      gender: 'unspecified',
      birthDate: '1990-01-01',
      role: 'admin',
    });
    const buyerId = randomUUID();
    await db.insert(users).values({
      id: buyerId,
      email: `${buyerId}@example.test`,
      name: 'Buyer',
      phone: '+821011112222',
      gender: 'unspecified',
      birthDate: '1990-01-01',
      role: 'user',
    });
    const venueId = randomUUID();
    await db.insert(venues).values({ id: venueId, name: 'Integration Hall' });
    performanceId = randomUUID();
    await db.insert(performances).values({
      id: performanceId,
      title: 'Admin Booking Integration',
      genre: 'artist_celebrity',
      venueId,
      ageRating: '전체관람가',
      status: 'selling',
      startDate: new Date(Date.now() - 86400000),
      endDate: new Date(Date.now() + 30 * 86400000),
    });
    showtimeId = randomUUID();
    await db.insert(showtimes).values({
      id: showtimeId,
      performanceId,
      dateTime: new Date(Date.now() + 20 * 86400000),
    });

    let sequence = 0;
    async function seed(opts: {
      funnel: keyof typeof expectedReservationNumbers;
      reservationStatus: 'CONFIRMED' | 'CANCELLED' | 'PENDING_PAYMENT' | 'FAILED';
      paymentStatus?: 'READY' | 'IN_PROGRESS' | 'DONE' | 'CANCELED' | 'EXPIRED';
      refundStatus?: 'requested' | 'sent_to_pg' | 'completed' | 'failed';
      ticketStatuses?: Array<'active' | 'cancellation_pending' | 'cancelled'>;
    }) {
      sequence += 1;
      const reservationId = randomUUID();
      const reservationNumber = `R-INT-${String(sequence).padStart(3, '0')}`;
      await db.insert(reservations).values({
        id: reservationId,
        userId: buyerId,
        showtimeId,
        reservationNumber,
        status: opts.reservationStatus,
        totalAmount: 52000,
        cancelDeadline: new Date(Date.now() + 10 * 86400000),
        createdAt: new Date(Date.now() - sequence * 60000),
      });
      expectedReservationNumbers[opts.funnel]!.push(reservationNumber);
      if (!opts.paymentStatus) return;
      const paymentId = randomUUID();
      await db.insert(payments).values({
        id: paymentId,
        reservationId,
        paymentKey: `pk_${paymentId}`,
        tossOrderId: `order_${paymentId}`,
        method: 'CARD',
        amount: 52000,
        status: opts.paymentStatus,
        paidAt: opts.paymentStatus === 'DONE' || opts.paymentStatus === 'CANCELED' ? new Date() : null,
      });
      for (const [index, status] of (opts.ticketStatuses ?? []).entries()) {
        await db.insert(ticketItems).values({
          reservationId,
          paymentId,
          showtimeId,
          seatId: `1F:A-${sequence}-${index}`,
          seatKey: `1F:A-${sequence}-${index}`,
          floorKey: '1F',
          floorLabel: '1층',
          tierName: 'VIP',
          row: 'A',
          number: `${sequence}${index}`,
          price: 50000,
          serviceFee: 2000,
          status,
        });
      }
      if (opts.refundStatus) {
        await db.insert(refunds).values({
          reservationId,
          paymentId,
          status: opts.refundStatus,
          provider: 'toss_payments',
        });
      }
    }

    await seed({ funnel: 'SOLD', reservationStatus: 'CONFIRMED', paymentStatus: 'DONE', ticketStatuses: ['active'] });
    await seed({ funnel: 'PAYMENT_PENDING', reservationStatus: 'PENDING_PAYMENT', paymentStatus: 'READY' });
    await seed({ funnel: 'PAYMENT_PROCESSING', reservationStatus: 'PENDING_PAYMENT', paymentStatus: 'IN_PROGRESS' });
    await seed({ funnel: 'PAYMENT_FAILED', reservationStatus: 'FAILED' });
    await seed({ funnel: 'PAYMENT_FAILED', reservationStatus: 'PENDING_PAYMENT', paymentStatus: 'EXPIRED' });
    await seed({
      funnel: 'CANCEL_PROCESSING',
      reservationStatus: 'CONFIRMED',
      paymentStatus: 'DONE',
      refundStatus: 'sent_to_pg',
      ticketStatuses: ['cancellation_pending'],
    });
    await seed({
      funnel: 'PARTIAL_CANCELLED',
      reservationStatus: 'CONFIRMED',
      paymentStatus: 'DONE',
      ticketStatuses: ['active', 'cancelled'],
    });
    await seed({
      funnel: 'CANCELLED',
      reservationStatus: 'CANCELLED',
      paymentStatus: 'CANCELED',
      refundStatus: 'completed',
      ticketStatuses: ['cancelled'],
    });

    service = new AdminBookingService(
      db as never,
      {} as never,
      {} as never,
      { write: vi.fn().mockResolvedValue({ id: 'audit-1' }) } as never,
    );
  }, 180_000);

  afterAll(async () => {
    await closePool?.();
    await container?.stop();
  });

  it.each(Object.keys(expectedReservationNumbers))(
    'exports the raw reservation CSV filtered by funnel status %s without a SQL error',
    async (funnelStatus) => {
      const result = await service.exportReservations({
        actorUserId: actorId,
        filters: { funnelStatus: funnelStatus as never, exportType: 'raw_pii', reason: '실패·취소 고객 안내' },
      });

      const exportedNumbers = [...result.csv.matchAll(/"(R-INT-\d{3})"/g)].map((match) => match[1]);
      expect(new Set(exportedNumbers)).toEqual(new Set(expectedReservationNumbers[funnelStatus]));
    },
  );

  it.each(Object.keys(expectedReservationNumbers))(
    'lists bookings filtered by funnel status %s with matching totals',
    async (funnelStatus) => {
      const result = await service.getBookings({ funnelStatus, performanceId, showtimeId });

      expect(result.bookings.map((booking) => booking.reservationNumber).sort())
        .toEqual([...expectedReservationNumbers[funnelStatus]!].sort());
      expect(result.total).toBe(expectedReservationNumbers[funnelStatus]!.length);
      expect(result.bookings.every((booking) => booking.funnelStatus === funnelStatus)).toBe(true);
    },
  );

  it('runs the unfiltered list in a read-only transaction and returns every reservation', async () => {
    const result = await service.getBookings({});

    expect(result.total).toBe(8);
    expect(result.stats.cancelledCount).toBe(1);
    expect(result.stats.cancelProcessingCount).toBe(1);
  });

  it('cancels an admin aggregate that exceeds the statement timeout and answers 503', async () => {
    const slowService = new AdminBookingService(
      db as never,
      {} as never,
      {} as never,
      { write: vi.fn() } as never,
    );
    vi.spyOn(slowService as never, 'selectBookingStatsRow').mockImplementation((async (
      tx: { execute: (query: unknown) => Promise<unknown> },
    ) => {
      await tx.execute(sql`select pg_sleep(30)`);
      return undefined;
    }) as never);

    const startedAt = Date.now();
    await expect(slowService.getBookings({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(Date.now() - startedAt).toBeLessThan(15_000);

    // SET LOCAL ends with the rolled-back transaction: pooled connections keep
    // the server default and other queries are not bounded by the admin limit.
    const shown = await db.execute(sql`show statement_timeout`);
    expect((shown.rows[0] as { statement_timeout: string }).statement_timeout).toBe('0');
    await expect(service.getBookings({ funnelStatus: 'SOLD' })).resolves.toMatchObject({ total: 1 });
  }, 30_000);
});
