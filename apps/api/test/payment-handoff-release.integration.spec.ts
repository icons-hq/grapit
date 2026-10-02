import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CHECKOUT_CONFIGURABLE_PAYMENT_METHODS } from '@grabit/shared';
import type { PaymentMethod, PrepareReservationRequest } from '@grabit/shared';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import {
  BookingService,
  PAYMENT_CONFIRM_ATTEMPT_MARKER_TTL,
} from '../src/modules/booking/booking.service.js';
import { PaymentService } from '../src/modules/payment/payment.service.js';
import {
  ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS,
  ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT,
  AbandonedPaymentHandoffService,
} from '../src/modules/payment/abandoned-payment-handoff.service.js';
import { PAYMENT_HANDOFF_RELEASE_WINDOW_MS } from '../src/modules/payment/payment-handoff-policy.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import {
  PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE,
  ReservationFinalizationService,
} from '../src/modules/reservation/reservation-finalization.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { PendingPaymentExpirationWorker } from '../src/modules/jobs/pending-payment-expiration.worker.js';
import type { TossTransactionRow } from '../src/modules/payment/toss-payments.client.js';

const { users, venues, performances, showtimes, reservations, payments, reservationPaymentFailureDiagnostics } = schema;
const CARD: PaymentMethod = { method: 'CARD', provider: 'CARD', currency: 'KRW' };

// Never reads DATABASE_URL or REDIS_URL. Every test uses the disposable containers below.
describe('Provider handoff release and abandoned handoff review — PostgreSQL + Valkey', () => {
  let container: StartedTestContainer;
  let valkey: StartedTestContainer;
  let redis: IORedis;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let qr: QrTicketService;
  let booking: BookingService;
  /**
   * Seat locks are outside this spec. The confirm lease, the confirm-attempt marker
   * and the review state run on real Valkey through BookingService.
   */
  const locks = {
    assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    setOwnedSeatLockTtl: vi.fn().mockResolvedValue(undefined),
    extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    consumeOwnedSeatLocks: vi.fn().mockResolvedValue({ consumedSeatIds: [] }),
    acquirePaymentConfirmLock: (orderId: string, token: string) => booking.acquirePaymentConfirmLock(orderId, token),
    refreshPaymentConfirmLock: (orderId: string, token: string, ttl?: number) =>
      booking.refreshPaymentConfirmLock(orderId, token, ttl),
    releasePaymentConfirmLock: (orderId: string, token: string) => booking.releasePaymentConfirmLock(orderId, token),
    markPaymentConfirmAttempted: (orderId: string) => booking.markPaymentConfirmAttempted(orderId),
    hasPaymentConfirmAttempt: (orderId: string) => booking.hasPaymentConfirmAttempt(orderId),
  };
  /** Orders the provider ledger reports; anything else has no transaction. */
  const providerOrders = new Set<string>();
  const toss = {
    getTransactionLookupScopes: vi.fn(() => ['default']),
    queryTransactions: vi.fn(async (): Promise<TossTransactionRow[]> => [...providerOrders]
      .map((orderId, index) => ({ transactionKey: `tx-${index}`, orderId, status: 'DONE' }))),
  };

  beforeAll(async () => {
    [container, valkey] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'handoff_test' })
        .withExposedPorts(5432).start(),
      new GenericContainer('valkey/valkey:8-alpine').withExposedPorts(6379).start(),
    ]);
    redis = new IORedis({ host: valkey.getHost(), port: valkey.getMappedPort(6379), maxRetriesPerRequest: 3 });
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'handoff_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    booking = new BookingService(redis, db, {} as never, {} as never);
    qr = new QrTicketService(db, new ConfigService({
      QR_TICKET_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'test-v1', FRONTEND_URL: 'https://example.test',
    }), new JwtService(), { sendTicketEmail: vi.fn() } as never, { isAvailable: false } as never);
  }, 120000);

  afterAll(async () => {
    await redis?.quit();
    await closePool?.();
    await Promise.all([container?.stop(), valkey?.stop()]);
  });

  beforeEach(async () => {
    // Each case reviews only its own handoffs: earlier cases' open orders are closed.
    await db.update(reservations).set({ status: 'FAILED' }).where(eq(reservations.status, 'PENDING_PAYMENT'));
    await redis.flushdb();
    providerOrders.clear();
    toss.queryTransactions.mockClear();
  });

  async function heldConfirmLeases() {
    return redis.keys('{payment-confirm}:*');
  }

  async function checkout(paymentMethod: PrepareReservationRequest['paymentMethod'] = CARD) {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Fixture',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01',
      isPhoneVerified: true, isEmailVerified: true }).returning();
    const [venue] = await db.insert(venues).values({ name: `Fixture-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Fixture', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    // Every checkout category is allowed so prepare's policy gate (audit #70) admits each fixture method.
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser: 4,
      allowedPaymentMethods: [...CHECKOUT_CONFIGURABLE_PAYMENT_METHODS] });
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id,
      dateTime: new Date('2099-01-01') }).returning();
    await db.insert(schema.priceTiers).values({ performanceId: performance!.id, tierName: 'VIP', price: 50000 });
    await db.insert(schema.seatMaps).values({
      performanceId: performance!.id, svgUrl: 'https://example.test/map.svg', floorKey: '1F', floorLabel: '1층',
      seatConfig: { tiers: [{ tierName: 'VIP', color: '#6d28d9', seatIds: ['A-1'] }] }, totalSeats: 1,
    });
    const reservationService = new ReservationService(
      db, {} as never, locks as never, {} as never,
      { assertBookingEnabled: vi.fn() } as never,
      { assertRequiredConsents: vi.fn().mockResolvedValue(undefined), captureConsent: vi.fn().mockResolvedValue(undefined) } as never,
      qr,
    );
    const paymentService = new PaymentService(db, undefined, qr, undefined, undefined, undefined, locks as never);
    const now = new Date().toISOString();
    const input: PrepareReservationRequest = {
      orderId: `GRP-${randomUUID()}`, showtimeId: showtime!.id,
      seats: [{ seatId: 'A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: '1', price: 50000 }],
      amount: 52000, paymentMethod,
      consentItems: [{ key: 'terms', accepted: true, version: 'test', language: 'ko', sourceFlow: 'booking' }],
      queueAdmission: { queueSessionId: 'test', admissionToken: 'test', refreshFamilyId: 'test', deviceSlotKey: 'test', admittedAt: now, activeUntilAt: now, reentryGraceUntilAt: now },
      paymentDeadlineAt: now,
      bookingPolicy: { maxTicketsPerOrder: 4, cancellationChangePolicy: 'CANCEL_ONLY', sameGradeChangeEnabled: false, paymentWindowMinutes: 7, seatHoldMinutes: 10 },
    };
    const prepared = await reservationService.prepareReservation(input, user!.id);
    const branch = {
      orderId: prepared.orderId, paymentMethod, userId: user!.id,
      successUrl: 'https://example.test/complete', failUrl: 'https://example.test/confirm',
    };
    return { userId: user!.id, showtimeId: showtime!.id, prepared, reservationService, paymentService, branch };
  }

  async function readReservation(id: string) {
    return (await db.select().from(reservations).where(eq(reservations.id, id)))[0]!;
  }

  /** Bulk handoff rows for one buyer, older than any fixture checkout. */
  async function insertStaleHandoffs(
    owner: { userId: string; showtimeId: string },
    count: number,
    checkoutPaymentMethod: PaymentMethod | null,
    minutesAgo: number,
  ) {
    const rows = Array.from({ length: count }, (_, index) => ({
      userId: owner.userId,
      showtimeId: owner.showtimeId,
      reservationNumber: `R${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tossOrderId: `GRP-STALE-${randomUUID()}`,
      status: 'PENDING_PAYMENT' as const,
      totalAmount: 52000,
      cancelDeadline: new Date('2099-01-01'),
      checkoutPaymentMethod,
      createdAt: new Date(Date.now() - (minutesAgo + 12) * 60_000),
      checkoutStartedAt: new Date(Date.now() - (minutesAgo + 10) * 60_000),
      paymentDeadlineAt: new Date(Date.now() - (minutesAgo - index / 100) * 60_000),
    }));
    return db.insert(reservations).values(rows).returning({ id: reservations.id, tossOrderId: reservations.tossOrderId });
  }

  it('reopens a card order whose SDK rejected before checkout opened, so the same order can retry or be abandoned', async () => {
    const f = await checkout();
    await f.paymentService.prepareTossPaymentBranch(f.branch);
    await expect(f.reservationService.cancelPendingReservation(f.prepared.reservationId, f.userId))
      .rejects.toThrow('결제 상태');

    await expect(f.paymentService.releaseTossPaymentHandoff({ orderId: f.prepared.orderId, userId: f.userId }))
      .resolves.toMatchObject({ orderId: f.prepared.orderId, released: true });
    expect(await f.reservationService.getReservationByOrderId(f.prepared.orderId, f.userId))
      .toMatchObject({ status: 'PENDING_PAYMENT', checkoutStartedAt: null });
    expect(await heldConfirmLeases()).toEqual([]);

    // The same order hands off again (no second order), and can then be released again.
    await f.paymentService.prepareTossPaymentBranch(f.branch);
    expect((await readReservation(f.prepared.reservationId)).checkoutStartedAt).toBeInstanceOf(Date);
    await f.paymentService.releaseTossPaymentHandoff({ orderId: f.prepared.orderId, userId: f.userId });
    await f.reservationService.cancelPendingReservation(f.prepared.reservationId, f.userId);
    expect((await readReservation(f.prepared.reservationId)).status).toBe('CANCELLED');
  });

  it('keeps the handoff after a confirm ended without a Payment row, even though its lease is gone', async () => {
    const f = await checkout();
    await f.paymentService.prepareTossPaymentBranch(f.branch);
    const markerKey = `{payment-confirm-attempt}:${f.prepared.orderId}`;
    const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const confirmPayment = vi.fn(async () => {
      // The attempt is recorded before the provider is asked to approve.
      expect(await redis.get(markerKey)).toBe('1');
      throw timeout();
    });
    // The same-key lookup that resolves an unknown confirm outcome (audit #18) also times out.
    const queryPayment = vi.fn(async () => {
      throw timeout();
    });
    const finalization = new ReservationFinalizationService(
      db, { confirmPayment, queryPayment, cancelPayment: vi.fn() } as never, locks as never,
      { broadcastSeatUpdate: vi.fn() } as never, qr,
    );

    // The outcome stays unknown: a retryable 503 without a Payment row or a cancel.
    await expect(finalization.confirmAndCreateReservation(
      { orderId: f.prepared.orderId, paymentKey: `test-${randomUUID()}`, amount: 52000 },
      f.userId,
    )).rejects.toThrow(PAYMENT_CONFIRM_OUTCOME_PENDING_MESSAGE);
    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(await heldConfirmLeases()).toEqual([]);
    expect(await db.select().from(payments).where(eq(payments.reservationId, f.prepared.reservationId))).toEqual([]);
    const handoffAgeMs = Date.now() - (await readReservation(f.prepared.reservationId)).checkoutStartedAt!.getTime();
    expect(handoffAgeMs).toBeLessThan(PAYMENT_HANDOFF_RELEASE_WINDOW_MS);
    const markerTtl = await redis.ttl(markerKey);
    expect(markerTtl).toBeGreaterThan(PAYMENT_HANDOFF_RELEASE_WINDOW_MS / 1000);
    expect(markerTtl).toBeLessThanOrEqual(PAYMENT_CONFIRM_ATTEMPT_MARKER_TTL);

    await expect(f.paymentService.releaseTossPaymentHandoff({ orderId: f.prepared.orderId, userId: f.userId }))
      .rejects.toThrow('결제 상태를 확인 중입니다');
    const kept = await readReservation(f.prepared.reservationId);
    expect(kept).toMatchObject({ status: 'PENDING_PAYMENT' });
    expect(kept.checkoutStartedAt).toBeInstanceOf(Date);
    await expect(f.reservationService.cancelPendingReservation(f.prepared.reservationId, f.userId))
      .rejects.toThrow('결제 상태');
  });

  it('keeps the handoff when a provider payment row exists, a confirm holds the lease, or the window passed', async () => {
    const withPayment = await checkout();
    await withPayment.paymentService.prepareTossPaymentBranch(withPayment.branch);
    await db.insert(payments).values({ reservationId: withPayment.prepared.reservationId, paymentKey: randomUUID(),
      tossOrderId: withPayment.prepared.orderId, method: 'CARD', amount: 52000, status: 'READY' });
    await expect(withPayment.paymentService.releaseTossPaymentHandoff({
      orderId: withPayment.prepared.orderId, userId: withPayment.userId,
    })).rejects.toThrow('결제 상태');
    expect((await readReservation(withPayment.prepared.reservationId)).checkoutStartedAt).toBeInstanceOf(Date);

    const confirming = await checkout();
    await confirming.paymentService.prepareTossPaymentBranch(confirming.branch);
    const leaseKey = `{payment-confirm}:${confirming.prepared.orderId}`;
    await redis.set(leaseKey, 'confirm-in-flight', 'EX', 60);
    await expect(confirming.paymentService.releaseTossPaymentHandoff({
      orderId: confirming.prepared.orderId, userId: confirming.userId,
    })).rejects.toThrow('결제 확인이 이미 진행 중입니다.');
    expect(await redis.get(leaseKey)).toBe('confirm-in-flight');
    expect((await readReservation(confirming.prepared.reservationId)).checkoutStartedAt).toBeInstanceOf(Date);

    const stale = await checkout();
    await stale.paymentService.prepareTossPaymentBranch(stale.branch);
    await db.update(reservations).set({ checkoutStartedAt: new Date(Date.now() - 120_000) })
      .where(eq(reservations.id, stale.prepared.reservationId));
    await expect(stale.paymentService.releaseTossPaymentHandoff({ orderId: stale.prepared.orderId, userId: stale.userId }))
      .rejects.toThrow('결제 상태');

    await expect(stale.paymentService.releaseTossPaymentHandoff({ orderId: stale.prepared.orderId, userId: randomUUID() }))
      .rejects.toThrow('예매 정보를 찾을 수 없습니다');
  });

  it('fails an abandoned handoff only with provider ledger evidence, and leaves every unknown one in review', async () => {
    const abandoned = await checkout();
    const charged = await checkout();
    const recent = await checkout();
    const withPayment = await checkout();
    for (const f of [abandoned, charged, recent, withPayment]) {
      await f.paymentService.prepareTossPaymentBranch(f.branch);
    }
    const longAgo = { checkoutStartedAt: new Date(Date.now() - 80 * 60_000), paymentDeadlineAt: new Date(Date.now() - 70 * 60_000) };
    for (const f of [abandoned, charged, withPayment]) {
      await db.update(reservations).set(longAgo).where(eq(reservations.id, f.prepared.reservationId));
    }
    await db.update(reservations).set({ paymentDeadlineAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(reservations.id, recent.prepared.reservationId));
    await db.insert(payments).values({ reservationId: withPayment.prepared.reservationId, paymentKey: randomUUID(),
      tossOrderId: withPayment.prepared.orderId, method: 'CARD', amount: 52000, status: 'IN_PROGRESS' });
    providerOrders.add(charged.prepared.orderId);

    const worker = new PendingPaymentExpirationWorker(
      db,
      {} as never,
      undefined,
      new AbandonedPaymentHandoffService(db, toss as never, locks as never, redis),
    );
    await worker.sweepExpiredPendingPayments();

    expect((await readReservation(abandoned.prepared.reservationId)).status).toBe('FAILED');
    const [diagnostic] = await db.select().from(reservationPaymentFailureDiagnostics)
      .where(eq(reservationPaymentFailureDiagnostics.reservationId, abandoned.prepared.reservationId));
    expect(diagnostic).toMatchObject({
      diagnosticCode: 'PAYMENT_HANDOFF_ABANDONED',
      providerCheckStatus: 'no_provider_transaction',
      tossOrderId: abandoned.prepared.orderId,
    });
    expect((await readReservation(charged.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
    expect((await readReservation(recent.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
    expect((await readReservation(withPayment.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
    expect(await heldConfirmLeases()).toEqual([]);
    // The charged order is alerted once, then deferred for a day on shared state.
    const chargedBackoff = await redis.ttl(`{payment-handoff-review}:deferred:${charged.prepared.reservationId}`);
    expect(chargedBackoff).toBeGreaterThan(ABANDONED_PAYMENT_HANDOFF_FOUND_BACKOFF_SECONDS - 60);

    // A provider lookup outage is never evidence.
    const outage = await checkout();
    await outage.paymentService.prepareTossPaymentBranch(outage.branch);
    await db.update(reservations).set(longAgo).where(eq(reservations.id, outage.prepared.reservationId));
    toss.queryTransactions.mockRejectedValueOnce(new Error('UNAUTHORIZED_KEY'));
    await worker.sweepExpiredPendingPayments();
    expect((await readReservation(outage.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
    expect(await redis.get(`{payment-handoff-review}:deferred:${outage.prepared.reservationId}`)).toBe('inconclusive');
  });

  it('reaches a new orphan behind unresolvable handoffs without re-querying them every sweep', async () => {
    const orphan = await checkout();
    await orphan.paymentService.prepareTossPaymentBranch(orphan.branch);
    await db.update(reservations).set({
      checkoutStartedAt: new Date(Date.now() - 80 * 60_000),
      paymentDeadlineAt: new Date(Date.now() - 70 * 60_000),
    }).where(eq(reservations.id, orphan.prepared.reservationId));

    // Rows the review can never conclude, all older than the orphan: more asynchronous
    // wallets and legacy rows than one scan holds, and more charged orders than one batch.
    await insertStaleHandoffs(orphan, 110, {
      method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'USD', pendingUrlRequired: true,
    }, 200);
    await insertStaleHandoffs(orphan, 10, null, 190);
    const charged = await insertStaleHandoffs(orphan, ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT + 5, CARD, 180);
    for (const row of charged) providerOrders.add(row.tossOrderId!);

    const service = new AbandonedPaymentHandoffService(db, toss as never, locks as never, redis);
    const critical = vi.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(service.sweepAbandonedPaymentHandoffs()).resolves.toEqual({
      reviewedReservations: ABANDONED_PAYMENT_HANDOFF_REVIEW_LIMIT,
      failedReservations: 0,
    });
    await expect(service.sweepAbandonedPaymentHandoffs()).resolves.toEqual({
      reviewedReservations: 6,
      failedReservations: 1,
    });
    expect((await readReservation(orphan.prepared.reservationId)).status).toBe('FAILED');
    expect(critical).toHaveBeenCalledTimes(charged.length);

    // Everything left is deferred: later sweeps neither query the provider nor re-alert.
    toss.queryTransactions.mockClear();
    await service.sweepAbandonedPaymentHandoffs();
    await service.sweepAbandonedPaymentHandoffs();
    expect(toss.queryTransactions).not.toHaveBeenCalled();
    expect(critical).toHaveBeenCalledTimes(charged.length);
    expect(await heldConfirmLeases()).toEqual([]);
  });

  it('leaves an asynchronous wallet handoff for the provider webhook', async () => {
    const wallet = await checkout({
      method: 'FOREIGN_EASY_PAY', provider: 'TRUEMONEY', currency: 'THB', pendingUrlRequired: true,
      overseasPaymentConsent: { required: true, agreed: true, agreementVersion: 'test' },
    });
    await db.update(reservations).set({
      checkoutStartedAt: new Date(Date.now() - 80 * 60_000),
      paymentDeadlineAt: new Date(Date.now() - 70 * 60_000),
    }).where(eq(reservations.id, wallet.prepared.reservationId));
    await expect(wallet.paymentService.releaseTossPaymentHandoff({ orderId: wallet.prepared.orderId, userId: wallet.userId }))
      .rejects.toThrow('결제 상태');

    const service = new AbandonedPaymentHandoffService(db, toss as never, locks as never, redis);
    await service.sweepAbandonedPaymentHandoffs();
    expect((await readReservation(wallet.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
  });
});
