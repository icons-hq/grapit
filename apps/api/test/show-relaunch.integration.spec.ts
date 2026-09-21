import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';
import { AdminSettlementReconciliationService } from '../src/modules/admin/admin-settlement-reconciliation.service.js';
import { PaymentCancellationFinalizerService } from '../src/modules/cancellation/payment-cancellation-finalizer.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { ReservationFinalizationService } from '../src/modules/reservation/reservation-finalization.service.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import { FieldCheckInService } from '../src/modules/field-operations/field-check-in.service.js';
import { BenefitRedemptionService } from '../src/modules/field-operations/benefit-redemption.service.js';
import { FieldMonitorService } from '../src/modules/field-operations/field-monitor.service.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { repairIncludedBenefits } from '../src/ops/included-benefit-repair.js';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { noActiveTicketItemOnSeat, isActiveSeatUniqueViolation } from '../src/database/seat-ownership.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../src/database/included-benefit-entitlements.js';
import { PaymentService } from '../src/modules/payment/payment.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { PendingPaymentExpirationWorker } from '../src/modules/jobs/pending-payment-expiration.worker.js';
import type { PrepareReservationRequest } from '@grabit/shared';

const { users, venues, performances, showtimes, reservations, reservationSeats, payments,
  ticketItems, seatInventories, ticketBenefitConfigurations, ticketBenefits, ticketBenefitEntitlements, tickets } = schema;

// Never reads DATABASE_URL. Every test uses the disposable container created below.
describe('Show relaunch — PostgreSQL transaction regressions', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let qr: QrTicketService;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'relaunch_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'relaunch_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    qr = new QrTicketService(db, new ConfigService({
      QR_TICKET_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'test-v1', FRONTEND_URL: 'https://example.test',
    }), new JwtService(), { sendTicketEmail: vi.fn() } as never, { isAvailable: false } as never);
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function fixture() {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Fixture',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01',
      isPhoneVerified: true, isEmailVerified: true }).returning();
    const [venue] = await db.insert(venues).values({ name: `Fixture-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Fixture', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser: 4 });
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id,
      dateTime: new Date('2099-01-01') }).returning();
    const [config] = await db.insert(ticketBenefitConfigurations).values({ showtimeId: showtime!.id, version: 1 }).returning();
    await db.insert(ticketBenefits).values({ configurationId: config!.id, identity: 'poster', kind: 'included',
      displayCopy: { ko: { name: '포스터', description: '기본 지급' }, en: { name: 'Poster', description: 'Included' }, th: { name: 'Poster', description: 'Included' }, 'zh-CN': { name: 'Poster', description: 'Included' } }, eligibleTierNames: ['VIP'] });
    return { userId: user!.id, showtimeId: showtime!.id, performanceId: performance!.id };
  }

  async function order(f: Awaited<ReturnType<typeof fixture>>, seatKey = '1F:A-1', status: 'PENDING_PAYMENT' | 'FAILED' = 'PENDING_PAYMENT') {
    const id = randomUUID();
    const [reservation] = await db.insert(reservations).values({ userId: f.userId, showtimeId: f.showtimeId,
      reservationNumber: id.slice(0, 28), tossOrderId: `GRP-${id}`, status, totalAmount: 52000,
      cancelDeadline: new Date('2098-12-31'), paymentDeadlineAt: new Date(Date.now() + 600000) }).returning();
    await db.insert(reservationSeats).values({ reservationId: reservation!.id, seatId: seatKey,
      tierName: 'VIP', price: 50000, row: 'A', number: '1' });
    return reservation!;
  }

  async function ticket(f: Awaited<ReturnType<typeof fixture>>, seatKey = '1F:A-1', status: 'active' | 'cancelled' | 'cancellation_pending' = 'active') {
    const r = await order(f, seatKey);
    const [p] = await db.insert(payments).values({ reservationId: r.id, paymentKey: randomUUID(),
      tossOrderId: r.tossOrderId!, method: 'CARD', amount: 52000, status: 'DONE' }).returning();
    return db.insert(ticketItems).values({ reservationId: r.id, paymentId: p!.id, showtimeId: f.showtimeId,
      seatId: seatKey, seatKey, floorKey: seatKey.split(':')[0]!, floorLabel: '층', tierName: 'VIP',
      row: 'A', number: '1', price: 50000, status }).returning();
  }

  it('recovers a buyer-owned prepared order before a Payment exists, without exposing it to another buyer', async () => {
    const f = await fixture();
    const reservation = await order(f, '2F:A-1');
    const service = new ReservationService(
      db, {} as never, {} as never, {} as never, {} as never, {} as never, qr,
    );

    const recovered = await service.getReservationByOrderId(reservation.tossOrderId!, f.userId);
    expect(recovered).toMatchObject({
      id: reservation.id,
      tossOrderId: reservation.tossOrderId,
      performanceId: f.performanceId,
      showtimeId: f.showtimeId,
      status: 'PENDING_PAYMENT',
      totalAmount: 52000,
      bookingPolicy: expect.objectContaining({ maxTicketsPerOrder: 4 }),
      paymentInfo: null,
      paymentDeadlineAt: reservation.paymentDeadlineAt!.toISOString(),
      seats: [expect.objectContaining({ seatKey: '2F:A-1', floorKey: '2F', price: 50000 })],
    });
    expect(await service.getReservationByOrderId(reservation.tossOrderId!, randomUUID())).toBeNull();
    expect(await service.getReservationByOrderId('nonexistent-order', f.userId)).toBeNull();
  });

  it('returns the prepared payment method and fixed foreign quote when restoring checkout', async () => {
    const f = await fixture();
    const reservation = await order(f);
    const method = {
      method: 'CARD' as const, provider: 'CARD' as const, currency: 'USD',
      overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test', agreedAt: '2026-09-21T06:00:00.000Z' },
    };
    await db.update(reservations).set({
      checkoutPaymentMethod: method,
      providerChargeCurrency: 'USD', providerChargeAmountMinor: 3536,
      providerChargeRate: '0.00068', providerChargeQuotedAt: new Date('2026-09-21T06:00:00.000Z'),
    }).where(eq(reservations.id, reservation.id));
    const service = new ReservationService(
      db, {} as never, {} as never, {} as never, {} as never, {} as never, qr,
    );
    expect(await service.getReservationByOrderId(reservation.tossOrderId!, f.userId)).toMatchObject({
      checkoutPaymentMethod: method,
      providerChargeQuote: { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36', rate: '0.00068', quotedAt: '2026-09-21T06:00:00.000Z' },
    });
  });

  async function checkoutFixture() {
    const f = await fixture();
    await db.insert(schema.priceTiers).values({ performanceId: f.performanceId, tierName: 'VIP', price: 50000 });
    await db.insert(schema.seatMaps).values({
      performanceId: f.performanceId, svgUrl: 'https://example.test/map.svg', floorKey: '1F', floorLabel: '1층',
      seatConfig: { tiers: [{ tierName: 'VIP', color: '#6d28d9', seatIds: ['A-1'] }] }, totalSeats: 1,
    });
    const locks = {
      assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      setOwnedSeatLockTtl: vi.fn().mockResolvedValue(undefined),
      extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    };
    const quote = { currency: 'USD' as const, amountMinor: 3536, amountDecimal: '35.36', rate: '0.00068', quotedAt: new Date().toISOString() };
    const quoteProvider = {
      getOverseasCardAvailability: () => ({ enabled: true }),
      createOverseasCardQuote: () => quote,
    };
    const service = new ReservationService(
      db, {} as never, locks as never, {} as never,
      { assertBookingEnabled: vi.fn() } as never,
      { assertRequiredConsents: vi.fn().mockResolvedValue(undefined), captureConsent: vi.fn().mockResolvedValue(undefined) } as never,
      qr, undefined, quoteProvider as never,
    );
    const providerService = new PaymentService(db, undefined, qr, undefined, quoteProvider as never, undefined, locks as never);
    const now = new Date().toISOString();
    const input: PrepareReservationRequest = {
      orderId: `GRP-${randomUUID()}`, showtimeId: f.showtimeId,
      seats: [{ seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: '1', price: 50000 }],
      amount: 52000, paymentMethod: { method: 'CARD', provider: 'CARD', currency: 'KRW' },
      consentItems: [{ key: 'terms', accepted: true, version: 'test', language: 'ko', sourceFlow: 'booking' }],
      queueAdmission: { queueSessionId: 'test', admissionToken: 'test', refreshFamilyId: 'test', deviceSlotKey: 'test', admittedAt: now, activeUntilAt: now, reentryGraceUntilAt: now },
      paymentDeadlineAt: now,
      bookingPolicy: { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 },
    };
    return { ...f, service, providerService, input, quote, locks };
  }

  it('persists the selected payment method when preparing a new checkout', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({
      id: prepared.reservationId, checkoutPaymentMethod: f.input.paymentMethod,
    });
  });

  it('can review a different payment method on the same order before opening the provider', async () => {
    const f = await checkoutFixture();
    const first = await f.service.prepareReservation(f.input, f.userId);
    const method = {
      method: 'CARD' as const, provider: 'CARD' as const, currency: 'USD',
      overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
    };
    const changed = await f.service.prepareReservation({ ...f.input, paymentMethod: method }, f.userId);
    expect(changed).toMatchObject({ reservationId: first.reservationId, checkoutEnabled: true, providerChargeQuote: f.quote });
    expect(await f.service.getReservationByOrderId(first.orderId, f.userId)).toMatchObject({ checkoutPaymentMethod: method });
  });

  it('locks the method and refuses a second provider handoff while its result is unknown', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    const branchInput = {
      orderId: prepared.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    };
    await f.providerService.prepareTossPaymentBranch(branchInput);
    await expect(f.service.prepareReservation({ ...f.input, paymentMethod: {
      method: 'CARD', provider: 'CARD', currency: 'USD',
      overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
    } }, f.userId)).rejects.toThrow('결제수단이 고정된 예매');
    expect(await f.service.prepareReservation(f.input, f.userId)).toMatchObject({ reservationId: prepared.reservationId });
    await expect(f.providerService.prepareTossPaymentBranch(branchInput)).rejects.toThrow('결제 상태');
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({ checkoutStartedAt: expect.any(String) });
  });

  it('allows only one of two tabs to hand the same order to the provider', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    const branchInput = {
      orderId: prepared.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    };
    const results = await Promise.allSettled([
      f.providerService.prepareTossPaymentBranch(branchInput),
      f.providerService.prepareTossPaymentBranch(branchInput),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({
      status: 'PENDING_PAYMENT', checkoutStartedAt: expect.any(String),
    });
  });

  it('cannot switch the method concurrently with handing the order to another provider route', async () => {
    const f = await checkoutFixture();
    await f.service.prepareReservation(f.input, f.userId);
    const results = await Promise.allSettled([
      f.providerService.prepareTossPaymentBranch({
        orderId: f.input.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
        successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
      }),
      f.service.prepareReservation({ ...f.input, paymentMethod: {
        method: 'CARD', provider: 'CARD', currency: 'USD',
        overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
      } }, f.userId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const restored = await f.service.getReservationByOrderId(f.input.orderId, f.userId);
    expect(restored?.checkoutPaymentMethod?.currency).toBe(results[0]!.status === 'fulfilled' ? 'KRW' : 'USD');
  });

  it('does not abandon a handed-off order whose provider result is still unknown', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    await f.providerService.prepareTossPaymentBranch({
      orderId: prepared.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    });
    await expect(f.service.cancelPendingReservation(prepared.reservationId, f.userId))
      .rejects.toThrow('결제 상태');
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({ status: 'PENDING_PAYMENT' });
  });

  it('does not treat an expired local deadline as proof that an unknown handoff was unpaid', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    await f.providerService.prepareTossPaymentBranch({
      orderId: prepared.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    });
    await db.update(reservations).set({ paymentDeadlineAt: new Date('2020-01-01') })
      .where(eq(reservations.id, prepared.reservationId));
    await expect(f.service.cancelPendingReservation(prepared.reservationId, f.userId))
      .rejects.toThrow('결제 상태');
    const worker = new PendingPaymentExpirationWorker(db, { unlockAllSeats: vi.fn() } as never);
    await worker.sweepExpiredPendingPayments();
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({ status: 'PENDING_PAYMENT' });
    await expect(f.service.prepareReservation(f.input, f.userId)).rejects.toThrow('결제 상태');
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({ status: 'PENDING_PAYMENT' });
  });

  it('keeps method changes available if seat-lock validation fails before provider handoff', async () => {
    const f = await checkoutFixture();
    const prepared = await f.service.prepareReservation(f.input, f.userId);
    f.locks.extendOwnedSeatLocks.mockRejectedValueOnce(new Error('Lock service unavailable'));
    await expect(f.providerService.prepareTossPaymentBranch({
      orderId: prepared.orderId, paymentMethod: f.input.paymentMethod, userId: f.userId,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    })).rejects.toThrow('Lock service unavailable');
    expect(await f.service.getReservationByOrderId(prepared.orderId, f.userId)).toMatchObject({ checkoutStartedAt: null });
  });

  it('allows only one active owner during simultaneous sales of the same seat', async () => {
    const f = await fixture();
    const attempts = await Promise.allSettled([ticket(f), ticket(f)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find((r) => r.status === 'rejected');
    expect(failed?.status === 'rejected' && isActiveSeatUniqueViolation(failed.reason)).toBe(true);
  });

  it('retains cancellation history while cancellation_pending still blocks resale', async () => {
    const f = await fixture();
    await ticket(f, '1F:A-1', 'cancelled');
    await ticket(f, '1F:A-1', 'cancellation_pending');
    await expect(ticket(f)).rejects.toSatisfy(isActiveSeatUniqueViolation);
    await expect(ticket(f, '2F:A-1')).resolves.toHaveLength(1);
    const otherShow = await fixture();
    await expect(ticket(otherShow)).resolves.toHaveLength(1);
  });

  it('an old cancellation cannot reopen the new owner seat or emit a returned available row', async () => {
    const f = await fixture();
    await ticket(f, '1F:A-1', 'cancelled');
    const [owner] = await ticket(f);
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: '1F:A-1',
      seatKey: '1F:A-1', floorKey: '1F', status: 'sold' });
    const release = () => db.update(seatInventories).set({ status: 'available' })
      .where(and(eq(seatInventories.showtimeId, f.showtimeId), noActiveTicketItemOnSeat())).returning();
    expect(await release()).toHaveLength(0);
    await db.update(ticketItems).set({ status: 'cancelled' }).where(eq(ticketItems.id, owner!.id));
    expect(await release()).toHaveLength(1);
  });

  it.each(['PENDING_PAYMENT', 'FAILED'] as const)('async DONE from %s creates one ticket, QR and included benefit, including replays', async (status) => {
    const f = await fixture();
    const r = await order(f, '1F:A-1', status);
    const service = new PaymentService(db, { broadcastSeatUpdate: vi.fn() } as never, qr);
    Object.assign(service, { bookingService: {
      acquirePaymentConfirmLock: async () => true, refreshPaymentConfirmLock: async () => true, releasePaymentConfirmLock: async () => {},
      acquireRecoverySeatLocks: vi.fn().mockResolvedValue({ acquired: true }), releaseRecoverySeatLocks: vi.fn(),
    } });
    const payload = { eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED', data: {
      paymentKey: `test-${randomUUID()}`, orderId: r.tossOrderId!, status: 'DONE',
      provider: 'ALIPAY_PLUS' as const, method: 'FOREIGN_EASY_PAY', currency: 'KRW', totalAmount: 52000,
    } };
    await service.upsertAsyncPaymentProgress(payload, 'DONE', 'payment_status_changed:done');
    await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID() }, 'DONE', 'payment_status_changed:done');
    for (const staleStatus of ['IN_PROGRESS', 'ABORTED', 'EXPIRED'] as const) {
      await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID(),
        data: { ...payload.data, status: staleStatus } }, staleStatus, 'stale_test');
    }
    expect((await db.select().from(payments).where(eq(payments.reservationId, r.id)))[0]!.status).toBe('DONE');
    const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, r.id));
    expect(items).toHaveLength(1);
    expect(await db.select().from(tickets).where(eq(tickets.reservationId, r.id))).toHaveLength(1);
    expect(await db.select().from(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, items[0]!.id))).toHaveLength(1);
    expect((await db.select().from(reservations).where(eq(reservations.id, r.id)))[0]!.status).toBe('CONFIRMED');
  });

  it('included benefit retries preserve redeemed entitlements and never grant a second copy', async () => {
    const f = await fixture();
    const items = await ticket(f);
    const sync = () => db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, items, new Date()));
    await sync();
    await db.update(ticketBenefitEntitlements).set({ state: 'redeemed', redeemedAt: new Date() })
      .where(eq(ticketBenefitEntitlements.ticketItemId, items[0]!.id));
    await sync();
    const entitlements = await db.select().from(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, items[0]!.id));
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]!.state).toBe('redeemed');
  });

  it.each(['dry-run', 'apply'] as const)('benefit repair %s rejects a nonexistent showtime instead of reporting zero missing rights', async (mode) => {
    await expect(repairIncludedBenefits(db, randomUUID(), mode === 'apply' ? 'a'.repeat(64) : undefined))
      .rejects.toThrow('BENEFIT_REPAIR_SHOWTIME_NOT_FOUND');
  });

  it('benefit repair is read-only by default, rejects drift, and applies only the reviewed missing rights', async () => {
    const f = await fixture();
    const items = await ticket(f);
    await db.update(reservations).set({ status: 'CONFIRMED' }).where(eq(reservations.id, items[0]!.reservationId));
    const before = await repairIncludedBenefits(db, f.showtimeId);
    expect(before).toMatchObject({ mode: 'dry-run', missingTickets: 1, missingEntitlements: 1, appliedEntitlements: 0 });
    expect(await db.select().from(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId))).toHaveLength(0);
    await expect(repairIncludedBenefits(db, f.showtimeId, 'invalid')).rejects.toThrow('BENEFIT_REPAIR_CANDIDATES_CHANGED');
    await expect(repairIncludedBenefits(db, f.showtimeId, before.hash)).resolves.toMatchObject({ appliedEntitlements: 1 });
    expect(await repairIncludedBenefits(db, f.showtimeId)).toMatchObject({ missingTickets: 0, missingEntitlements: 0 });
  });

  it.each(['PENDING_PAYMENT', 'FAILED'] as const)('concurrent DONE retries from %s never cancel the successfully issued payment', async (status) => {
    const f = await fixture();
    const r = await order(f, '1F:A-1', status);
    const paymentKey = `test-${randomUUID()}`;
    await db.insert(payments).values({ reservationId: r.id, paymentKey, tossOrderId: r.tossOrderId!,
      method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', amount: 52000, status: 'IN_PROGRESS' });
    const held = new Set<string>();
    const cancel = vi.fn().mockResolvedValue({ status: 'CANCELED' });
    const delayedDb = new Proxy(db, { get(target, key) {
      if (key === 'transaction') return async (...args: Parameters<DrizzleDB['transaction']>) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return target.transaction(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    let recoveryHeld = false;
    const service = new PaymentService(delayedDb, { broadcastSeatUpdate: vi.fn() } as never, qr);
    Object.assign(service, { tossClient: { cancelPayment: cancel }, bookingService: {
      acquirePaymentConfirmLock: async (orderId: string) => {
        if (held.has(orderId)) return false;
        held.add(orderId); return true;
      },
      refreshPaymentConfirmLock: async () => true,
      releasePaymentConfirmLock: async (orderId: string) => { held.delete(orderId); },
      acquireRecoverySeatLocks: async () => {
        if (recoveryHeld) return { acquired: false };
        recoveryHeld = true; return { acquired: true };
      }, releaseRecoverySeatLocks: async () => { recoveryHeld = false; },
    } });
    const payload = { eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED', data: {
      paymentKey, orderId: r.tossOrderId!, status: 'DONE', provider: 'ALIPAY_PLUS' as const,
      method: 'FOREIGN_EASY_PAY', currency: 'KRW', totalAmount: 52000,
    } };
    const results = await Promise.allSettled([
      service.upsertAsyncPaymentProgress(payload, 'DONE', 'payment_status_changed:done'),
      service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID() }, 'DONE', 'payment_status_changed:done'),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID() }, 'DONE', 'payment_status_changed:done');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, r.id))).toHaveLength(1);
    expect((await db.select().from(payments).where(eq(payments.reservationId, r.id)))[0]!.status).toBe('DONE');
  });

  it('different seats in one showtime can finalize concurrently without a showtime lock upgrade deadlock', async () => {
    const f = await fixture();
    const rows = await Promise.all([order(f, '1F:A-1'), order(f, '1F:A-2')]);
    const service = new PaymentService(db, { broadcastSeatUpdate: vi.fn() } as never, qr);
    Object.assign(service, { bookingService: {
      acquirePaymentConfirmLock: async () => true, refreshPaymentConfirmLock: async () => true,
      releasePaymentConfirmLock: async () => {},
    } });
    const calls = rows.map((r) => service.upsertAsyncPaymentProgress({
      eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED', data: {
        paymentKey: `test-${randomUUID()}`, orderId: r.tossOrderId!, status: 'DONE',
        provider: 'ALIPAY_PLUS', method: 'FOREIGN_EASY_PAY', currency: 'KRW', totalAmount: 52000,
      },
    }, 'DONE', 'payment_status_changed:done'));
    const results = await Promise.allSettled(calls);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  });

  it('async orders in different showtimes enforce the same performance-wide ticket limit', async () => {
    const f = await fixture();
    await db.update(schema.bookingPolicies).set({ maxTicketsPerUser: 1 }).where(eq(schema.bookingPolicies.performanceId, f.performanceId));
    const [otherShow] = await db.insert(showtimes).values({ performanceId: f.performanceId, dateTime: new Date('2099-01-02') }).returning();
    const orders = await Promise.all([order(f), order({ ...f, showtimeId: otherShow!.id })]);
    const cancel = vi.fn().mockResolvedValue({ status: 'CANCELED', balanceAmount: 0 });
    const service = new PaymentService(db, { broadcastSeatUpdate: vi.fn() } as never, qr);
    Object.assign(service, { tossClient: { cancelPayment: cancel }, bookingService: {
      acquirePaymentConfirmLock: async () => true, refreshPaymentConfirmLock: async () => true,
      releasePaymentConfirmLock: async () => {},
    } });
    await Promise.all(orders.map((r) => service.upsertAsyncPaymentProgress({
      eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED', data: {
        paymentKey: `test-${randomUUID()}`, orderId: r.tossOrderId!, status: 'DONE',
        provider: 'ALIPAY_PLUS', method: 'FOREIGN_EASY_PAY', currency: 'KRW', totalAmount: 52000,
      },
    }, 'DONE', 'payment_status_changed:done')));
    const issued = await db.select().from(ticketItems).where(inArray(ticketItems.reservationId, orders.map((r) => r.id)));
    expect(issued).toHaveLength(1);
    expect(cancel).toHaveBeenCalledWith(expect.any(String), '예매 매수 제한 초과로 인한 자동 취소', expect.any(Object));
  });

  it('async compensation IN_PROGRESS never reissues on DONE replay and converges on CANCELED', async () => {
    const f = await fixture();
    await db.update(schema.bookingPolicies).set({ maxTicketsPerUser: 1 }).where(eq(schema.bookingPolicies.performanceId, f.performanceId));
    const [owner] = await ticket(f);
    await db.update(reservations).set({ status: 'CONFIRMED' }).where(eq(reservations.id, owner!.reservationId));
    const r = await order(f, '1F:A-2');
    const service = new PaymentService(db, { broadcastSeatUpdate: vi.fn() } as never, qr);
    const cancel = vi.fn().mockResolvedValue({ status: 'DONE', cancels: [{ cancelStatus: 'IN_PROGRESS' }] });
    Object.assign(service, { tossClient: { cancelPayment: cancel }, bookingService: {
      acquirePaymentConfirmLock: async () => true, refreshPaymentConfirmLock: async () => true,
      releasePaymentConfirmLock: async () => {},
    } });
    const payload = { eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED', data: {
      paymentKey: `test-${randomUUID()}`, orderId: r.tossOrderId!, status: 'DONE',
      provider: 'ALIPAY_PLUS' as const, method: 'FOREIGN_EASY_PAY', currency: 'KRW', totalAmount: 52000,
    } };
    expect(await service.upsertAsyncPaymentProgress(payload, 'DONE', 'payment_status_changed:done')).toBe('DONE_CANCEL_PENDING');
    await db.update(ticketItems).set({ status: 'cancelled' }).where(eq(ticketItems.id, owner!.id));
    await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID() }, 'DONE', 'payment_status_changed:done');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, r.id))).toHaveLength(0);
    const sync = new ReservationFinalizationService(db, { cancelPayment: cancel } as never, {
      acquirePaymentConfirmLock: async () => true, refreshPaymentConfirmLock: async () => true,
      releasePaymentConfirmLock: async () => {}, extendOwnedSeatLocks: async () => {},
      assertOwnedSeatLocks: async () => {}, consumeOwnedSeatLocks: async () => ({ consumedSeatIds: [] }),
    } as never, { broadcastSeatUpdate: vi.fn() } as never, qr);
    await expect(sync.confirmAndCreateReservation({ orderId: r.tossOrderId!, paymentKey: payload.data.paymentKey, amount: 52000 }, f.userId))
      .rejects.toThrow('결제 취소가 처리 중입니다. 예매 내역에서 상태를 확인해주세요.');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, r.id))).toHaveLength(0);
    await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID(), data: { ...payload.data, status: 'CANCELED' } }, 'CANCELED', 'cancelled_webhook');
    expect((await db.select().from(payments).where(eq(payments.reservationId, r.id)))[0]!.status).toBe('CANCELED');
    expect((await db.select().from(reservations).where(eq(reservations.id, r.id)))[0]!.status).toBe('FAILED');
    await service.upsertAsyncPaymentProgress({ ...payload, eventId: randomUUID() }, 'DONE', 'payment_status_changed:done');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, r.id))).toHaveLength(0);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('ticket-item partial cancellation preserves local DONE and the remaining QR, manifest and revenue', async () => {
    const f = await fixture();
    const [cancelledItem] = await ticket(f);
    const [activeItem] = await db.insert(ticketItems).values({
      reservationId: cancelledItem!.reservationId, paymentId: cancelledItem!.paymentId,
      showtimeId: f.showtimeId, seatId: '1F:A-2', seatKey: '1F:A-2', floorKey: '1F',
      floorLabel: '1층', tierName: 'VIP', row: 'A', number: '2', price: 50000,
      serviceFee: 2000, status: 'active',
    }).returning();
    await db.update(ticketItems).set({ serviceFee: 2000 }).where(eq(ticketItems.id, cancelledItem!.id));
    const [reservation] = await db.update(reservations).set({ status: 'CONFIRMED', totalAmount: 104000 })
      .where(eq(reservations.id, cancelledItem!.reservationId)).returning();
    const [payment] = await db.update(payments).set({ amount: 104000, paidAt: new Date() })
      .where(eq(payments.id, cancelledItem!.paymentId)).returning();
    await db.insert(seatInventories).values([cancelledItem!, activeItem!].map((item) => ({
      showtimeId: f.showtimeId, seatId: item.seatId!, seatKey: item.seatKey,
      floorKey: item.floorKey, status: 'sold' as const,
    })));
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [cancelledItem!, activeItem!], new Date()));
    await qr.ensureIssuedTicketsForReservation({ reservationId: reservation!.id, paymentId: payment!.id });

    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    await finalizer.finalizeFullPaymentCancellation({
      context: { reservation: reservation!, payment: payment!, bookingPolicy: null,
        seats: [{ seatId: cancelledItem!.seatId!, floorKey: cancelledItem!.floorKey, seatKey: cancelledItem!.seatKey }] },
      source: 'ticket_item', reason: 'One seat cancelled',
      providerResponse: { status: 'PARTIAL_CANCELED', balanceAmount: 52000,
        cancels: [{ cancelAmount: 52000, cancelStatus: 'DONE' }] },
      ticketItemCancellation: { ticketItemId: cancelledItem!.id, cancellationFee: 0,
        serviceFeeRefund: 2000, refundableAmount: 52000 },
    });

    expect((await db.select().from(payments).where(eq(payments.id, payment!.id)))[0]!.status).toBe('DONE');
    expect((await db.select().from(reservations).where(eq(reservations.id, reservation!.id)))[0]!.status).toBe('CONFIRMED');
    expect(await qr.getOwnedTicketsForReservation(reservation!.id, f.userId)).toHaveLength(1);
    expect((await db.select().from(tickets).where(eq(tickets.ticketItemId, cancelledItem!.id)))[0]!.status).toBe('revoked');
    const admin = new AdminBookingService(db, {} as never, {} as never, { write: vi.fn() } as never);
    const result = await admin.getBookings({ performanceId: f.performanceId, showtimeId: f.showtimeId });
    expect(result.stats.totalRevenue).toBe(52000);
    expect(result.bookings[0]!.funnelStatus).toBe('PARTIAL_CANCELLED');
    expect(result.tierStats[0]!.soldSeats).toBe(1);
    const manifest = await admin.exportReservations({ actorUserId: f.userId,
      filters: { showtimeId: f.showtimeId, exportType: 'active_ticket_manifest', reason: 'Contract regression' } });
    expect(manifest.rowCount).toBe(1);
    const settlement = new AdminSettlementReconciliationService(db, { querySettlements: vi.fn().mockResolvedValue([]) } as never);
    expect((await settlement.getReconciliation({ eventId: f.performanceId })).siteSalesGrossAmount).toBe(52000);
  });

  it('concurrent scanners enter the account once, count tickets, keep buyer QR readable and redeem a benefit once', async () => {
    const f = await fixture();
    const items = (await Promise.all([ticket(f, '1F:A-1'), ticket(f, '1F:A-2')])).flat();
    for (const item of items) {
      await db.update(reservations).set({ status: 'CONFIRMED' }).where(eq(reservations.id, item.reservationId));
    }
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, items, new Date()));
    const credentials = await Promise.all(items.map(async (item) =>
      (await qr.ensureIssuedTicketsForReservation({ reservationId: item.reservationId, paymentId: item.paymentId }))[0]!));
    const field = new FieldCheckInService(db, qr, new AdminAuditService(db));
    const context = { scannerUserId: f.userId };
    const start = performance.now();
    const verification = await field.verify({ token: credentials[0]!.token, showtimeId: f.showtimeId }, context);
    expect(verification.processable).toBe(true);
    const results = await Promise.all(credentials.map((credential) => field.consume({
      token: credential.token, showtimeId: f.showtimeId, deviceAttemptId: randomUUID(), confirmed: true,
    }, context)));
    expect(results.filter((r) => r.outcome === 'entered')).toHaveLength(1);
    const summary = await new FieldMonitorService(db).getSummary({ eventId: f.performanceId, showtimeId: f.showtimeId });
    expect(summary.enteredCount).toBe(2);
    expect(summary.notEnteredCount).toBe(0);
    const afterEntry = await qr.ensureIssuedTicketsForReservation({ reservationId: items[0]!.reservationId, paymentId: items[0]!.paymentId });
    expect(afterEntry[0]!.token).toBeTruthy();
    const [entitlement] = await db.select().from(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, items[0]!.id));
    expect(entitlement!.state).toBe('active');
    const redemption = new BenefitRedemptionService(db, qr);
    const redemptions = await Promise.all([1, 2].map(() => redemption.redeem({
      token: credentials[0]!.token, showtimeId: f.showtimeId, benefitEntitlementId: entitlement!.id,
      deviceAttemptId: randomUUID(),
    }, context)));
    expect(redemptions.map((r) => r.outcome).sort()).toEqual(['duplicate', 'redeemed']);
    console.info(`Local PostgreSQL verify + concurrent account entry + read-back + concurrent redemption: ${Math.round(performance.now() - start)}ms (not production capacity evidence)`);
  });

  it('expiration leaves provider IN_PROGRESS and DONE handoffs untouched', async () => {
    const f = await fixture();
    const rows = await Promise.all([order(f), order(f, '1F:A-2'), order(f, '1F:A-3')]);
    for (const [i, status] of ['IN_PROGRESS', 'DONE'].entries()) {
      const r = rows[i]!;
      await db.insert(payments).values({ reservationId: r.id, paymentKey: randomUUID(),
        tossOrderId: r.tossOrderId!, method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', amount: 52000,
        status: status as 'IN_PROGRESS' | 'DONE' });
    }
    const booking = { unlockAllSeats: vi.fn() };
    const worker = new PendingPaymentExpirationWorker(db, booking as never);
    await worker.sweepExpiredPendingPayments(new Date(Date.now() + 900000));
    const statuses = await Promise.all(rows.map(async (r) =>
      (await db.select().from(reservations).where(eq(reservations.id, r.id)))[0]!.status));
    expect(statuses).toEqual(['PENDING_PAYMENT', 'PENDING_PAYMENT', 'FAILED']);
    expect(booking.unlockAllSeats).not.toHaveBeenCalled();
  });
});
