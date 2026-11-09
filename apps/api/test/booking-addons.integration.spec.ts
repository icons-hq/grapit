import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { finalizeReservationAddons, releaseUnboundAddonHolds, reservationAddonTotal, selectAddonHoldsForOrder } from '../src/database/booking-addon-inventory.js';
import { BookingAddonsService, type AddonActor } from '../src/modules/booking-addons/booking-addons.service.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import type { PrepareReservationRequest } from '@grabit/shared';
import { restoreCancellationPendingBenefitEntitlements } from '../src/database/benefit-entitlement-restoration.js';
import { PaymentCancellationFinalizerService } from '../src/modules/cancellation/payment-cancellation-finalizer.service.js';
import { RefundService } from '../src/modules/refund/refund.service.js';
import { BenefitRunnerService } from '../src/modules/admin/benefit-runner.service.js';
import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';
import { FinanceLedgerService } from '../src/modules/admin/finance-ledger.service.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

const copy = Object.fromEntries(['ko', 'en', 'zh-CN', 'th'].map((lang) => [lang, { name: 'PHOTO 2:1 add-on', description: 'Paid option' }])) as never;
const seat = (number: number, tierName = 'SVIP') => ({ seatId: `A-${number}`, seatKey: `1F:A-${number}`, floorKey: '1F', floorLabel: '1층', tierName, row: 'A', number: String(number), price: 380000 });

// All writes target this disposable container. Never reads DATABASE_URL or production credentials.
describe('Paid addon inventory — real PostgreSQL contention and payment boundaries', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  beforeAll(async () => {
    const pg = await startPostgresContainer({ database: 'booking_addons_test' });
    container = pg.container;
    pool = new Pool({ host: pg.host, port: pg.port, database: 'booking_addons_test', user: 'postgres', password: 'test', max: 16 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
  }, 120000);
  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function fixture(capacity = 1, count = 2) {
    const [performance] = await db.insert(schema.performances).values({ title: randomUUID(), genre: 'artist_celebrity',
      ageRating: '만 15세 이상', startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02'),
      status: 'upcoming', publishState: 'draft' }).returning();
    const [showtime] = await db.insert(schema.showtimes).values({ performanceId: performance!.id, dateTime: new Date('2099-01-01') }).returning();
    await db.insert(schema.priceTiers).values({ performanceId: performance!.id, tierName: 'SVIP', price: 380000 });
    await db.insert(schema.seatMaps).values({ performanceId: performance!.id, floorKey: '1F', svgUrl: 'https://example.test/map.svg',
      seatConfig: { tiers: [{ tierName: 'SVIP', seatIds: Array.from({ length: count }, (_, i) => `A-${i + 1}`) }, { tierName: 'VIP', seatIds: ['B-1'] }] } });
    const actors: AddonActor[] = [];
    const locks = new Map<string, string[]>();
    for (let i = 0; i < count; i++) {
      const [user] = await db.insert(schema.users).values({ email: `${randomUUID()}@example.test`, name: 'Addon test',
        phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin', isEmailVerified: true, isPhoneVerified: true }).returning();
      actors.push({ id: user!.id, role: 'admin', adminCapabilityBundle: null, adminCapabilities: [], isEmailVerified: true, isPhoneVerified: true });
      locks.set(user!.id, [seat(i + 1).seatKey, '1F:B-1']);
    }
    const booking = {
      assertShowtimeBookingOpen: vi.fn().mockResolvedValue(undefined),
      assertOwnedSeatLocks: vi.fn(async (userId: string, _showtimeId: string, keys: string[]) => {
        if (!keys.every((key) => locks.get(userId)?.includes(key))) throw new ConflictException('Seat lock expired');
      }),
      getMyLocks: vi.fn(async (userId: string) => ({ seatIds: locks.get(userId) ?? [], expiresAt: Date.now() + 600000 })),
      setOwnedSeatLockTtl: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = { publishAddonStockChanged: vi.fn().mockResolvedValue(true) };
    const service = new BookingAddonsService(db, booking as never, gateway as never, { assertBookingEnabled: vi.fn() } as never);
    const snapshot = await service.save(showtime!.id, { identity: 'photo', displayCopy: copy, price: 150000,
      capacity, eligibleTierNames: ['SVIP'], active: true, sortOrder: 0 }, actors[0]!);
    return { service, gateway, booking, actors, locks, performanceId: performance!.id, showtimeId: showtime!.id, addonId: snapshot.addons[0]!.id };
  }
  async function pending(f: Awaited<ReturnType<typeof fixture>>, index: number) {
    const [order] = await db.insert(schema.reservations).values({ userId: f.actors[index]!.id, showtimeId: f.showtimeId,
      reservationNumber: randomUUID().slice(0, 28), tossOrderId: randomUUID(), totalAmount: 532000, addonAmount: 150000,
      paymentDeadlineAt: new Date(Date.now() + 420000), cancelDeadline: new Date('2098-12-31') }).returning();
    const selections = [{ addonId: f.addonId, seatKey: seat(index + 1).seatKey }];
    await db.insert(schema.reservationSeats).values({ reservationId: order!.id, seatId: seat(index + 1).seatKey,
      tierName: 'SVIP', price: 380000, row: 'A', number: String(index + 1) });
    await db.transaction((tx) => selectAddonHoldsForOrder(tx, { userId: f.actors[index]!.id, showtimeId: f.showtimeId,
      selections, seats: [seat(index + 1)], reservationId: order!.id, expectedTotal: 150000 }));
    return order!;
  }
  async function issue(order: typeof schema.reservations.$inferSelect, index: number) {
    return db.transaction(async (tx) => {
      await tx.update(schema.reservations).set({ status: 'CONFIRMED' }).where(eq(schema.reservations.id, order.id));
      const [payment] = await tx.insert(schema.payments).values({ reservationId: order.id, paymentKey: randomUUID(),
        tossOrderId: order.tossOrderId!, method: 'CARD', amount: order.totalAmount, status: 'DONE', paidAt: new Date() }).returning();
      const [ticket] = await tx.insert(schema.ticketItems).values({ ...seat(index + 1), reservationId: order.id,
        paymentId: payment!.id, showtimeId: order.showtimeId }).returning();
      await finalizeReservationAddons(tx, order.id);
      return ticket!;
    });
  }

  it('awards the last unit to exactly one of 20 simultaneous buyers', async () => {
    const f = await fixture(1, 20);
    const results = await Promise.allSettled(f.actors.map((actor, i) => f.service.setHold(f.showtimeId, f.addonId, seat(i + 1).seatKey, true, actor)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(19);
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]).toMatchObject({ available: 0, held: 1, sold: 0 });
  });
  it('is idempotent on selection retry and immediately restores a deselected unit', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await Promise.all([1, 2, 3].map(() => f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor)));
    expect((await f.service.snapshot(f.showtimeId, actor)).selections).toHaveLength(1);
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, false, actor);
    expect((await f.service.snapshot(f.showtimeId, actor)).addons[0]?.available).toBe(1);
    const event = f.gateway.publishAddonStockChanged.mock.calls.at(-1)?.[1];
    expect(event).toMatchObject({ showtimeId: f.showtimeId, revision: expect.any(Number), stocks: [{ id: f.addonId, available: 1, held: 0 }] });
    expect(JSON.stringify(event)).not.toContain(actor.id);
    expect(JSON.stringify(event)).not.toContain(seat(1).seatKey);
  });
  it('rejects an ineligible tier or another buyer’s seat without consuming stock', async () => {
    const f = await fixture();
    await expect(f.service.setHold(f.showtimeId, f.addonId, '1F:B-1', true, f.actors[0]!)).rejects.toThrow();
    await expect(f.service.setHold(f.showtimeId, f.addonId, seat(2).seatKey, true, f.actors[0]!)).rejects.toThrow();
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(1);
  });
  it('releases an expired unbound hold but keeps a pending payment allocation past its original TTL', async () => {
    const f = await fixture();
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!);
    await db.execute(sql`UPDATE booking_addon_holds SET expires_at = now() - interval '1 minute' WHERE addon_id = ${f.addonId}`);
    await f.service.setHold(f.showtimeId, f.addonId, seat(2).seatKey, true, f.actors[1]!);
    const order = await pending(f, 1);
    await db.execute(sql`UPDATE booking_addon_holds SET expires_at = now() - interval '1 minute' WHERE reservation_id = ${order.id}`);
    await expect(f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!)).rejects.toThrow();
    await releaseUnboundAddonHolds(db, f.actors[1]!.id, f.showtimeId, seat(2).seatKey);
    expect(await reservationAddonTotal(db, order.id)).toBe(150000);
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(0);
  });
  it('binds exact selections, issues one paid entitlement and restores stock only after ticket cancellation', async () => {
    const f = await fixture();
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!);
    const order = await pending(f, 0);
    await expect(reservationAddonTotal(db, order.id, [])).rejects.toThrow();
    const ticket = await issue(order, 0);
    await db.transaction((tx) => finalizeReservationAddons(tx, order.id));
    expect(await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, ticket.id)))
      .toMatchObject([{ source: 'purchase', benefitKind: 'paid', state: 'active' }]);
    expect((await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.id, ticket.id)))[0]?.addonAmount).toBe(150000);
    await db.update(schema.ticketItems).set({ status: 'cancellation_pending' }).where(eq(schema.ticketItems.id, ticket.id));
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(0);
    await db.update(schema.ticketItems).set({ status: 'cancelled' }).where(eq(schema.ticketItems.id, ticket.id));
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(1);
  });
  it('refuses a late approval after a failed order’s unit was resold, rolling back its ticket', async () => {
    const f = await fixture();
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!);
    const first = await pending(f, 0);
    await db.update(schema.reservations).set({ status: 'FAILED' }).where(eq(schema.reservations.id, first.id));
    await f.service.setHold(f.showtimeId, f.addonId, seat(2).seatKey, true, f.actors[1]!);
    const second = await pending(f, 1);
    await issue(second, 1);
    await expect(issue(first, 0)).rejects.toThrow('재고');
    expect(await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.reservationId, first.id))).toHaveLength(0);
    expect((await db.select().from(schema.reservations).where(eq(schema.reservations.id, first.id)))[0]?.status).toBe('FAILED');
  });
  it('keeps draft stock private from ordinary buyers and restricted administrators', async () => {
    const f = await fixture();
    await expect(f.service.snapshot(f.showtimeId, { ...f.actors[0]!, role: 'user' })).rejects.toThrow();
    await expect(f.service.snapshot(f.showtimeId, { ...f.actors[0]!, adminCapabilityBundle: 'scanner' })).rejects.toThrow();
  });

  it.each([false, true])('removes an unused private performance with addon settings (unbound hold: %s)', async (hasHold) => {
    const f = await fixture(); const actor = f.actors[0]!;
    if (hasHold) await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    const admin = new AdminService(db, { invalidatePerformance: vi.fn() } as never, { write: vi.fn() } as never);
    await admin.deletePerformance(f.performanceId, { actorUserId: actor.id });
    expect(await db.select().from(schema.bookingAddons).where(eq(schema.bookingAddons.id, f.addonId))).toHaveLength(0);
    expect(await db.select().from(schema.bookingAddonHolds).where(eq(schema.bookingAddonHolds.addonId, f.addonId))).toHaveLength(0);
  });

  it('preserves configured products and their bound allocations when a purchase prevents deletion', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    const order = await pending(f, 0);
    const admin = new AdminService(db, { invalidatePerformance: vi.fn() } as never, { write: vi.fn() } as never);
    await expect(admin.deletePerformance(f.performanceId, { actorUserId: actor.id })).rejects.toThrow('운영 이력');
    await expect(db.delete(schema.bookingAddons).where(eq(schema.bookingAddons.id, f.addonId))).rejects.toThrow();
    expect(await reservationAddonTotal(db, order.id)).toBe(150000);
  });

  it('removes addon settings when an unused showtime is removed from a retained performance', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    const [kept] = await db.insert(schema.showtimes).values({ performanceId: f.performanceId, dateTime: new Date('2099-01-02T06:00:00Z') }).returning();
    const admin = new AdminService(db, { invalidatePerformance: vi.fn() } as never, { write: vi.fn() } as never);
    await admin.updatePerformance(f.performanceId, { showtimes: [{ showtimeId: kept!.id, dateTime: '2099-01-02T15:00:00' }] }, { actorUserId: actor.id });
    expect(await db.select().from(schema.showtimes).where(eq(schema.showtimes.performanceId, f.performanceId))).toMatchObject([{ id: kept!.id }]);
    expect(await db.select().from(schema.bookingAddons).where(eq(schema.bookingAddons.id, f.addonId))).toHaveLength(0);
    expect(await db.select().from(schema.bookingAddonHolds).where(eq(schema.bookingAddonHolds.addonId, f.addonId))).toHaveLength(0);
  });

  it('allows releasing a held option after its product is paused but refuses a new selection', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    await f.service.save(f.showtimeId, { identity: 'photo', displayCopy: copy, price: 150000, capacity: 1,
      eligibleTierNames: ['SVIP'], active: false, sortOrder: 0 }, actor);
    await expect(f.service.setHold(f.showtimeId, f.addonId, seat(2).seatKey, true, f.actors[1]!)).rejects.toThrow();
    const released = await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, false, actor);
    expect(released.selections).toHaveLength(0);
    expect(released.addons[0]).toMatchObject({ available: 1, active: false });
  });

  it('prepares and resumes the combined checkout atomically, rejecting changed selections and already-bound holds', async () => {
    const f = await fixture();
    const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    const service = new ReservationService(db, {} as never, f.booking as never, {} as never,
      { assertBookingEnabled: vi.fn() } as never,
      { assertRequiredConsents: vi.fn(), captureConsent: vi.fn() } as never);
    const now = new Date().toISOString();
    const input: PrepareReservationRequest = { orderId: `GRP-${randomUUID()}`, showtimeId: f.showtimeId,
      seats: [seat(1)], addons: [{ addonId: f.addonId, seatKey: seat(1).seatKey }], amount: 532000,
      paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
      consentItems: [{ key: 'terms', accepted: true, version: 'test', language: 'ko', sourceFlow: 'booking' }],
      queueAdmission: { queueSessionId: 'test', admissionToken: 'test', refreshFamilyId: 'test', deviceSlotKey: 'test', admittedAt: now, activeUntilAt: now, reentryGraceUntilAt: now },
      paymentDeadlineAt: now,
      bookingPolicy: { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 } };
    const prepared = await service.prepareReservation(input, actor);
    expect(await service.prepareReservation(input, actor)).toMatchObject({ reservationId: prepared.reservationId });
    const recovered = await service.getReservationByOrderId(input.orderId, actor.id);
    expect(recovered).toMatchObject({ totalAmount: 532000,
      addons: [{ addonId: f.addonId, seatKey: seat(1).seatKey, price: 150000 }] });
    await expect(service.prepareReservation({ ...input, addons: [], amount: 382000 }, actor)).rejects.toThrow('애드온');
    await expect(service.prepareReservation({ ...input, orderId: `GRP-${randomUUID()}` }, actor)).rejects.toThrow('선점');
    expect(await db.select().from(schema.reservations).where(eq(schema.reservations.userId, actor.id))).toHaveLength(1);
  });

  it('restores a purchased benefit after a rejected cancellation even if its product is now inactive', async () => {
    const f = await fixture();
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!);
    const order = await pending(f, 0);
    const ticket = await issue(order, 0);
    await db.update(schema.bookingAddons).set({ active: false }).where(eq(schema.bookingAddons.id, f.addonId));
    await db.update(schema.ticketBenefitEntitlements).set({ state: 'inactive', inactiveReason: 'cancellation_pending' })
      .where(eq(schema.ticketBenefitEntitlements.ticketItemId, ticket.id));
    await db.transaction((tx) => restoreCancellationPendingBenefitEntitlements(tx as DrizzleDB, [ticket.id], new Date()));
    expect(await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, ticket.id)))
      .toMatchObject([{ source: 'purchase', state: 'active', inactiveReason: null }]);
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(0);
  });

  it('exports purchased benefits with the existing entitlement report', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    await issue(await pending(f, 0), 0);
    const result = await new BenefitRunnerService(db, {} as never, { write: vi.fn() } as never)
      .exportEntitlements(f.showtimeId, { actorUserId: actor.id });
    expect(result.rowCount).toBe(1);
    expect(result.csv).toContain('purchase');
    expect(result.csv).toContain('paid');
  });

  it('counts paid options in admin revenue, ticket exports and the finance ledger', async () => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    await issue(await pending(f, 0), 0);
    const audit = { write: vi.fn() };
    const admin = new AdminBookingService(db, {} as never, {} as never, audit as never);
    const bookings = await admin.getBookings({ performanceId: f.performanceId, showtimeId: f.showtimeId });
    expect(bookings.stats.totalRevenue).toBe(532000);
    expect(bookings.tierStats[0]?.activeRevenue).toBe(532000);
    const exported = await admin.exportReservations({ actorUserId: actor.id,
      filters: { showtimeId: f.showtimeId, exportType: 'raw_pii', reason: 'Addon regression' } });
    expect(exported.csv).toContain('"Add-on Amount"');
    expect(exported.csv).toContain('"380000","2000","532000"');
    expect(exported.csv).toContain('"150000"');
    const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const ledger = await new FinanceLedgerService(db, {} as never, audit as never).getLedger({ eventId: f.performanceId,
      showtimeId: f.showtimeId, dateFrom: today, dateTo: today, dateBasis: 'paid_at', asOf: new Date().toISOString(),
      includeProvider: 'false', providerDateBasis: 'paidOutDate' });
    expect(ledger.summary.remainingTicketKrw).toBe(532000);
    expect(ledger.rows[0]?.tickets[0]).toMatchObject({ priceKrw: 380000, addonKrw: 150000, serviceFeeKrw: 2000 });
  });

  it.each(['seat', 'reservation'] as const)('refunds the paid option with its %s and releases stock only after success', async (scope) => {
    const f = await fixture(); const actor = f.actors[0]!;
    await f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, actor);
    const order = await pending(f, 0); const ticket = await issue(order, 0);
    await db.insert(schema.seatInventories).values({ showtimeId: f.showtimeId, seatId: ticket.seatId,
      seatKey: ticket.seatKey, floorKey: ticket.floorKey, status: 'sold' });
    const cancelPayment = vi.fn().mockImplementation(async (_key, reason) => {
      expect((await f.service.snapshot(f.showtimeId, actor)).addons[0]?.available).toBe(0);
      return { status: 'CANCELED', totalAmount: 532000, balanceAmount: 0,
        cancels: [{ cancelReason: reason, cancelAmount: 532000, cancelStatus: 'DONE', transactionKey: randomUUID() }] };
    });
    const provider = { cancelPayment, queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', totalAmount: 532000, balanceAmount: 532000, isPartialCancelable: true }) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    if (scope === 'seat') {
      const service = new ReservationService(db, provider as never, {} as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, finalizer);
      const preview = await service.getTicketItemCancellationPreview(order.id, ticket.id, actor.id);
      expect(preview.cancellationQuote).toMatchObject({ ticketSubtotal: 380000, addonSubtotal: 150000, refundableAmount: 532000 });
      await service.cancelTicketItem(order.id, ticket.id, actor.id, 'Cancel ticket and option');
    } else {
      const result = await new RefundService(db, provider as never, finalizer).requestRefund(order.id, actor.id, 'Cancel ticket and option');
      expect(result.cancellationQuote).toMatchObject({ ticketSubtotal: 380000, addonSubtotal: 150000, refundableAmount: 532000 });
    }
    expect(cancelPayment).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.id, ticket.id)))[0])
      .toMatchObject({ status: 'cancelled', refundableAmount: 532000 });
    expect((await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, ticket.id)))[0]?.state).toBe('inactive');
    expect((await f.service.snapshot(f.showtimeId, actor)).addons[0]?.available).toBe(1);
  });

  it('refuses a hold released concurrently with the seat and allows event operators to save a private configuration', async () => {
    const f = await fixture();
    f.booking.assertOwnedSeatLocks.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ConflictException('Seat released'));
    await expect(f.service.setHold(f.showtimeId, f.addonId, seat(1).seatKey, true, f.actors[0]!)).rejects.toThrow('Seat released');
    expect((await f.service.snapshot(f.showtimeId, f.actors[0]!)).addons[0]?.available).toBe(1);
    await expect(f.service.save(f.showtimeId, { identity: 'photo', displayCopy: copy, price: 150000,
      capacity: 2, eligibleTierNames: ['SVIP'], active: true, sortOrder: 0 }, { ...f.actors[0]!, adminCapabilityBundle: 'operator' }))
      .resolves.toMatchObject({ addons: [{ capacity: 2 }] });
  });
});
