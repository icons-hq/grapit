import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { ConsentService } from '../src/modules/consent/consent.service.js';
import { BookingService } from '../src/modules/booking/booking.service.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

type LockReaders = {
  assertShowtimeBookingOpen(id: string, actor: { id: string; role?: string; adminCapabilityBundle?: string | null; adminCapabilities?: string[] }): Promise<void>;
  assertSeatExistsInShowtimeSeatMap(id: string, seat: { floorKey: string; seatId: string; seatKey: string; runtimeSeatId: string }): Promise<void>;
  getSeatLockPolicy(id: string): Promise<{ maxTicketsPerUser: number; lockTtlSeconds: number }>;
};
type PrepareReaders = {
  getShowtimeBookingContext(id: string): Promise<{ performanceId: string; maxTicketsPerUser: number }>;
  getCanonicalSeatSelections(seats: { seatId: string; tierName: string; price: number }[], performanceId: string): Promise<{ seatId: string; price: number }[]>;
};

describe('booking metadata burst — same SQL contracts, fresh reads', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let locking: LockReaders;
  let preparing: PrepareReaders;
  let reads = 0;
  let counting = false;
  const performanceId = randomUUID();
  const showtimeId = randomUUID();
  const seatIds = Array.from({ length: 200 }, (_, index) => `A-${index + 1}`);
  const seat = (seatId: string) => ({ floorKey: '1F', seatId, seatKey: `1F:${seatId}`, runtimeSeatId: seatId });
  const selections = (seatId: string) => [{ seatId, tierName: 'untrusted', price: 1 }];

  beforeAll(async () => {
    const pg = await startPostgresContainer({ database: 'booking_metadata_burst' });
    container = pg.container;
    const pool = new Pool({ connectionString: pg.connectionString, max: 5 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema, logger: { logQuery(query) { if (counting && /^select\b/i.test(query)) reads += 1; } } });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    const date = new Date(Date.now() + 3600_000);
    await db.insert(schema.performances).values({ id: performanceId, title: 'Synthetic metadata test', genre: 'concert', ageRating: 'All', startDate: date, endDate: date, status: 'selling', publishState: 'published' });
    await db.insert(schema.showtimes).values({ id: showtimeId, performanceId, dateTime: date });
    await db.insert(schema.bookingPolicies).values({ performanceId, maxTicketsPerUser: 4, seatHoldMinutes: 6 });
    await db.insert(schema.priceTiers).values({ performanceId, tierName: 'VIP', price: 50000 });
    await db.insert(schema.seatMaps).values({ performanceId, svgUrl: 'https://example.test/seats.svg', totalSeats: 200, seatConfig: { tiers: [{ tierName: 'VIP', seatIds }] } });
    const booking = new BookingService({} as never, db, {} as never, {} as never);
    locking = booking as unknown as LockReaders;
    preparing = new ReservationService(db, {} as never, booking, {} as never, {} as never, {} as never, undefined, {} as never) as unknown as PrepareReaders;
  });
  afterAll(async () => { await closePool?.(); await container?.stop(); });

  it('does not repeat the same lock metadata SQL for every seat buyer', async () => {
    reads = 0; counting = true;
    const result = await Promise.all(seatIds.map(async (id) => {
      await locking.assertShowtimeBookingOpen(showtimeId, { id: randomUUID() });
      await locking.assertSeatExistsInShowtimeSeatMap(showtimeId, seat(id));
      return locking.getSeatLockPolicy(showtimeId);
    }));
    counting = false;
    expect(result.every((policy) => policy.maxTicketsPerUser === 4 && policy.lockTtlSeconds === 360)).toBe(true);
    expect(reads).toBeLessThanOrEqual(6);
  });

  it('bounds prepare metadata reads while resolving every distinct seat from authoritative prices', async () => {
    reads = 0; counting = true;
    const results = await Promise.all(seatIds.map(async (id) => {
      const context = await preparing.getShowtimeBookingContext(showtimeId);
      return preparing.getCanonicalSeatSelections(selections(id), context.performanceId);
    }));
    counting = false;
    expect(results.map((rows) => rows[0]!.seatId)).toEqual(seatIds);
    expect(results.every((rows) => rows[0]!.price === 50000)).toBe(true);
    expect(reads).toBeLessThanOrEqual(6);
  });

  it('coalesces consent prechecks but keeps transaction reads on their own executor', async () => {
    const consent = new ConsentService(db) as unknown as {
      loadActiveItems(executor: Pick<DrizzleDB, 'select'>): Promise<{ id: string }[]>;
    };
    reads = 0; counting = true;
    const rows = await Promise.all(Array.from({ length: 200 }, () => consent.loadActiveItems(db)));
    counting = false;
    expect(rows.every((items) => items.length > 0)).toBe(true);
    expect(reads).toBeLessThanOrEqual(2);
    const [template] = await db.select().from(schema.consentItems).where(eq(schema.consentItems.isActive, true)).limit(1);
    reads = 0; counting = true;
    await Promise.all(Array.from({ length: 4 }, (_, index) => db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.insert(schema.consentItems).values({ ...template!, id, version: `transaction-${index}` });
      const ownSnapshot = await consent.loadActiveItems(tx);
      expect(ownSnapshot.some((item) => item.id === id)).toBe(true);
    })));
    counting = false;
    expect(reads).toBe(4);
  });

  it('observes new price, seat map and policy data after previous readers complete', async () => {
    await db.update(schema.priceTiers).set({ price: 61000 }).where(eq(schema.priceTiers.performanceId, performanceId));
    await db.update(schema.bookingPolicies).set({ maxTicketsPerUser: 2, seatHoldMinutes: 3 }).where(eq(schema.bookingPolicies.performanceId, performanceId));
    await db.update(schema.seatMaps).set({ seatConfig: { tiers: [{ tierName: 'VIP', seatIds: ['A-1'] }] } }).where(eq(schema.seatMaps.performanceId, performanceId));
    await expect(preparing.getCanonicalSeatSelections(selections('A-1'), performanceId)).resolves.toMatchObject([{ price: 61000 }]);
    await expect(preparing.getCanonicalSeatSelections(selections('A-2'), performanceId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(locking.assertSeatExistsInShowtimeSeatMap(showtimeId, seat('A-2'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(locking.getSeatLockPolicy(showtimeId)).resolves.toMatchObject({ maxTicketsPerUser: 2, lockTtlSeconds: 180 });
  });

  it('never shares an admin visibility decision with a public buyer, and rechecks cutoff', async () => {
    await db.update(schema.performances).set({ publishState: 'draft' }).where(eq(schema.performances.id, performanceId));
    const result = await Promise.allSettled([
      locking.assertShowtimeBookingOpen(showtimeId, { id: randomUUID(), role: 'admin', adminCapabilityBundle: null, adminCapabilities: [] }),
      locking.assertShowtimeBookingOpen(showtimeId, { id: randomUUID(), role: 'user' }),
    ]);
    expect(result[0]!.status).toBe('fulfilled');
    expect(result[1]).toMatchObject({ status: 'rejected', reason: expect.any(ForbiddenException) });
    await db.update(schema.showtimes).set({ dateTime: new Date(Date.now() - 1000) }).where(eq(schema.showtimes.id, showtimeId));
    await expect(locking.assertShowtimeBookingOpen(showtimeId, { id: randomUUID(), role: 'admin', adminCapabilityBundle: null, adminCapabilities: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
