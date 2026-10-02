import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentMethod } from '@grabit/shared';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { TossPaymentError } from '../src/modules/payment/toss-payments.client.js';
import {
  loadPgBossConstructor,
  markBossAvailable,
  type PgBossContract,
} from '../src/modules/jobs/pgboss.provider.js';
import { PaymentConfirmReconcileWorker } from '../src/modules/reservation/payment-confirm-reconcile.worker.js';
import {
  PAYMENT_CONFIRM_RECONCILE_JOB,
  ReservationFinalizationService,
  type PaymentConfirmReconcileJobPayload,
} from '../src/modules/reservation/reservation-finalization.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

const {
  users, venues, performances, showtimes, reservations, reservationSeats, payments, ticketItems,
  reservationPaymentFailureDiagnostics,
} = schema;

// Audit #1, #2, #17, #18, #73: the confirm core against real PostgreSQL. Never reads
// DATABASE_URL; every test uses the disposable container created below.
describe('Payment confirm core — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let boss: (PgBossContract & { start(): Promise<void>; stop(options?: Record<string, unknown>): Promise<void> }) | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'confirm_core_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'confirm_core_test', max: 4 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
  }, 120000);

  afterAll(async () => {
    await boss?.stop({ graceful: false });
    await closePool?.();
    await container?.stop();
  });

  /** A real pg-boss on the disposable database (never DATABASE_URL). */
  async function startBoss() {
    const PgBoss = loadPgBossConstructor();
    const instance = new PgBoss({
      connectionString: `postgres://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/confirm_core_test`,
    });
    instance.on?.('error', () => {});
    await instance.start();
    boss = markBossAvailable(instance, true) as typeof boss;
    return boss!;
  }

  const PAYPAL_CHECKOUT = { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' } as const;

  function paypalPayment(paymentKey: string, orderId: string, overrides: Record<string, unknown> = {}) {
    return { paymentKey, orderId, status: 'DONE', currency: 'USD', method: '해외간편결제', totalAmount: 35.36,
      approvedAt: new Date().toISOString(), ...overrides };
  }

  function reconcilePayload(orderId: string, paymentKey: string): PaymentConfirmReconcileJobPayload {
    return {
      orderId,
      paymentKey,
      expectation: { route: 'PAYPAL', currency: 'USD', amountMinor: 3536 },
      providerCharge: { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36', rate: '0.00068',
        quotedAt: new Date().toISOString() },
      reason: 'provider_confirm_unresolved',
      attempt: 1,
    };
  }

  async function endClientWindows(reservationId: string) {
    const ended = new Date(Date.now() - 5 * 60_000);
    await db.update(reservations).set({ admissionActiveUntilAt: ended, paymentDeadlineAt: ended })
      .where(eq(reservations.id, reservationId));
  }

  async function pendingOrder(options: {
    showtimeAt: Date;
    checkoutPaymentMethod?: PaymentMethod;
    providerChargeAmountMinor?: number;
    admissionActiveUntilAt?: Date;
  }) {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Fixture',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01',
      isPhoneVerified: true, isEmailVerified: true }).returning();
    const [venue] = await db.insert(venues).values({ name: `Fixture-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Fixture', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2026-01-01'), endDate: new Date('2099-01-02') }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser: 4 });
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id,
      dateTime: options.showtimeAt }).returning();
    const [reservation] = await db.insert(reservations).values({ userId: user!.id, showtimeId: showtime!.id,
      reservationNumber: id.slice(0, 28), tossOrderId: `GRP-${id}`, status: 'PENDING_PAYMENT',
      totalAmount: 52000, cancelDeadline: new Date('2098-12-31'),
      paymentDeadlineAt: new Date(Date.now() + 600000),
      admissionActiveUntilAt: options.admissionActiveUntilAt ?? new Date(Date.now() + 600000),
      checkoutPaymentMethod: options.checkoutPaymentMethod ?? { method: 'CARD', provider: 'CARD', currency: 'KRW' },
      checkoutStartedAt: new Date(),
      ...(options.providerChargeAmountMinor
        ? {
            providerChargeCurrency: 'USD',
            providerChargeAmountMinor: options.providerChargeAmountMinor,
            providerChargeRate: '0.00068',
            providerChargeQuotedAt: new Date(),
          }
        : {}),
    }).returning();
    await db.insert(reservationSeats).values({ reservationId: reservation!.id, seatId: '1F:A-1',
      tierName: 'VIP', price: 50000, row: 'A', number: '1' });
    return { userId: user!.id, reservation: reservation! };
  }

  function finalization(toss: Record<string, unknown>, pgBoss?: PgBossContract) {
    const bookingService = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
      // Provider Handoff release guard (audit #9), recorded under the confirm lease.
      markPaymentConfirmAttempted: vi.fn().mockResolvedValue(undefined),
      extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      consumeOwnedSeatLocks: vi.fn().mockResolvedValue({ consumedSeatIds: [] }),
    };
    const quoteService = {
      parseProviderDecimalToMinor: (value: string) => Math.round(Number(value) * 100),
    };
    return new ReservationFinalizationService(db, toss as never, bookingService as never,
      { broadcastSeatUpdate: vi.fn() } as never, undefined, quoteService as never, pgBoss);
  }

  it('rejects a started showtime before calling Toss confirm', async () => {
    const { userId, reservation } = await pendingOrder({ showtimeAt: new Date(Date.now() - 60_000) });
    const paymentKey = `pay-${randomUUID()}`;
    // Authenticated but never confirmed: the provider proves it is unapproved.
    const toss = {
      confirmPayment: vi.fn(),
      queryPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId,
        status: 'IN_PROGRESS', currency: 'KRW', method: '카드', totalAmount: 52000 }),
      cancelPayment: vi.fn(),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, amount: 52000 }, userId,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(toss.confirmPayment).not.toHaveBeenCalled();
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id))).toHaveLength(0);
  });

  it('issues a validated domestic approval in one transaction', async () => {
    const { userId, reservation } = await pendingOrder({ showtimeAt: new Date('2099-01-01') });
    const paymentKey = `pay-${randomUUID()}`;
    const toss = {
      confirmPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId, status: 'DONE',
        currency: 'KRW', method: '카드', totalAmount: 52000, approvedAt: new Date().toISOString() }),
      queryPayment: vi.fn(),
      cancelPayment: vi.fn(),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, amount: 52000 }, userId,
    )).resolves.toEqual({ reservationId: reservation.id });

    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('CONFIRMED');
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ status: 'DONE', amount: 52000, currency: 'KRW', paymentKey }]);
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(1);
    expect(toss.cancelPayment).not.toHaveBeenCalled();
  });

  it('cancels a PayPal approval settled in KRW and writes nothing', async () => {
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      checkoutPaymentMethod: { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' },
      providerChargeAmountMinor: 3536,
    });
    const paymentKey = `pay-${randomUUID()}`;
    const toss = {
      confirmPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId, status: 'DONE',
        currency: 'KRW', method: '카드', totalAmount: 35.36, approvedAt: new Date().toISOString() }),
      queryPayment: vi.fn(),
      cancelPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId,
        status: 'CANCELED', totalAmount: 35.36, cancels: [{ cancelStatus: 'DONE' }] }),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, provider: 'PAYPAL', providerChargeAmount: '35.36' }, userId,
    )).rejects.toThrow('결제 승인 정보가 주문과 일치하지 않아');

    expect(toss.cancelPayment).toHaveBeenCalledOnce();
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id))).toHaveLength(0);
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(0);
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('PENDING_PAYMENT');
  });

  it('records a provider-verified ABORTED confirm like the terminal webhook', async () => {
    const { userId, reservation } = await pendingOrder({ showtimeAt: new Date('2099-01-01') });
    const paymentKey = `pay-${randomUUID()}`;
    const rejection = new TossPaymentError('REJECT_CARD_COMPANY', '카드사 거절', 403);
    const toss = {
      confirmPayment: vi.fn().mockRejectedValue(rejection),
      queryPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId, status: 'ABORTED',
        currency: 'KRW', method: '카드', totalAmount: 52000 }),
      cancelPayment: vi.fn(),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, amount: 52000 }, userId,
    )).rejects.toBe(rejection);

    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ status: 'ABORTED', asyncStatus: 'confirm_rejected', paidAt: null, paymentKey }]);
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('FAILED');
    expect(await db.select().from(reservationPaymentFailureDiagnostics)
      .where(eq(reservationPaymentFailureDiagnostics.reservationId, reservation.id)))
      .toMatchObject([{ diagnosticCode: 'PAYMENT_ABORTED', diagnosticSource: 'payment_confirm' }]);
    expect(toss.cancelPayment).not.toHaveBeenCalled();
  });

  it('cancels an earlier PayPal approval found when a retry hits an expired hold and records the compensation', async () => {
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      checkoutPaymentMethod: { method: 'FOREIGN_EASY_PAY', provider: 'PAYPAL', currency: 'USD' },
      providerChargeAmountMinor: 3536,
      admissionActiveUntilAt: new Date(Date.now() - 60_000),
    });
    const paymentKey = `pay-${randomUUID()}`;
    // An earlier attempt was approved and ended in a 503 before recording anything.
    const toss = {
      confirmPayment: vi.fn(),
      queryPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId, status: 'DONE',
        currency: 'USD', method: '해외간편결제', totalAmount: 35.36, approvedAt: new Date().toISOString() }),
      cancelPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId,
        status: 'CANCELED', totalAmount: 35.36, cancels: [{ cancelStatus: 'DONE' }] }),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, provider: 'PAYPAL', providerChargeAmount: '35.36' }, userId,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(toss.confirmPayment).not.toHaveBeenCalled();
    expect(toss.cancelPayment).toHaveBeenCalledOnce();
    expect(toss.cancelPayment).toHaveBeenCalledWith(paymentKey, '결제 유효 시간 초과로 인한 자동 취소',
      expect.anything());
    // The approval was claimed with a cancel_pending row before the cancel, so
    // a late DONE webhook cannot issue it, and the completed cancel is recorded.
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ paymentKey, status: 'CANCELED', asyncStatus: 'compensation_cancelled', provider: 'PAYPAL',
        providerChargeCurrency: 'USD', providerChargeAmountMinor: 3536 }]);
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('FAILED');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(0);
  });

  it('records a provider-expired payment found at an expired hold like the terminal webhook', async () => {
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      admissionActiveUntilAt: new Date(Date.now() - 60_000),
    });
    const paymentKey = `pay-${randomUUID()}`;
    const toss = {
      confirmPayment: vi.fn(),
      queryPayment: vi.fn().mockResolvedValue({ paymentKey, orderId: reservation.tossOrderId, status: 'EXPIRED',
        currency: 'KRW', method: '카드', totalAmount: 52000 }),
      cancelPayment: vi.fn(),
    };

    await expect(finalization(toss).confirmAndCreateReservation(
      { paymentKey, orderId: reservation.tossOrderId!, amount: 52000 }, userId,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ status: 'EXPIRED', asyncStatus: 'confirm_rejected', paidAt: null, paymentKey }]);
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('FAILED');
    expect(await db.select().from(reservationPaymentFailureDiagnostics)
      .where(eq(reservationPaymentFailureDiagnostics.reservationId, reservation.id)))
      .toMatchObject([{ diagnosticCode: 'PAYMENT_EXPIRED', diagnosticSource: 'payment_confirm' }]);
    expect(toss.confirmPayment).not.toHaveBeenCalled();
    expect(toss.cancelPayment).not.toHaveBeenCalled();
  });
  it('converges a 503 PayPal approval through the pg-boss reconcile job without any client retry (#18)', async () => {
    const pgBoss = await startBoss();
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      checkoutPaymentMethod: PAYPAL_CHECKOUT,
      providerChargeAmountMinor: 3536,
    });
    const orderId = reservation.tossOrderId!;
    const paymentKey = `pay-${randomUUID()}`;
    // Toss approves, but neither the confirm response nor the lookup arrives.
    const toss = {
      confirmPayment: vi.fn().mockRejectedValue(new TossPaymentError('PROVIDER_TIMEOUT', 'timeout')),
      queryPayment: vi.fn()
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValue(paypalPayment(paymentKey, orderId)),
      cancelPayment: vi.fn().mockResolvedValue(paypalPayment(paymentKey, orderId, {
        status: 'CANCELED', cancels: [{ cancelStatus: 'DONE' }] })),
    };
    const service = finalization(toss, pgBoss);
    const dto = { paymentKey, orderId, provider: 'PAYPAL' as const, providerChargeAmount: '35.36' };

    await expect(service.confirmAndCreateReservation(dto, userId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    // A second unknown outcome for the same approval keeps one queued job.
    await expect(service.confirmAndCreateReservation(dto, userId)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const queued = await pool.query(
      'SELECT state, singleton_key, start_after > now() AS delayed FROM pgboss.job WHERE name = $1',
      [PAYMENT_CONFIRM_RECONCILE_JOB],
    );
    expect(queued.rows).toEqual([{ state: 'created', singleton_key: `${orderId}:${paymentKey}`, delayed: true }]);
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id))).toHaveLength(0);

    // The client never comes back. Time passes: its windows end and the job is due.
    await endClientWindows(reservation.id);
    await pool.query('UPDATE pgboss.job SET start_after = now() WHERE name = $1', [PAYMENT_CONFIRM_RECONCILE_JOB]);
    await new PaymentConfirmReconcileWorker(service, pgBoss).onModuleInit();

    await vi.waitFor(async () => {
      const [payment] = await db.select().from(payments).where(eq(payments.reservationId, reservation.id));
      expect(payment).toMatchObject({ paymentKey, status: 'CANCELED', asyncStatus: 'compensation_cancelled' });
    }, { timeout: 30_000, interval: 250 });

    expect(toss.confirmPayment).toHaveBeenCalledTimes(2);
    expect(toss.cancelPayment).toHaveBeenCalledOnce();
    expect(toss.cancelPayment).toHaveBeenCalledWith(paymentKey, '결제 유효 시간 초과로 인한 자동 취소',
      expect.objectContaining({ idempotencyKey: expect.stringContaining('payment-confirm-reconcile-cancel:') }));
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('FAILED');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(0);
    expect(await db.select().from(reservationPaymentFailureDiagnostics)
      .where(eq(reservationPaymentFailureDiagnostics.reservationId, reservation.id)))
      .toMatchObject([{ diagnosticCode: 'CONFIRM_APPROVAL_COMPENSATED', diagnosticSource: 'payment_confirm_reconcile' }]);
    await vi.waitFor(async () => {
      const done = await pool.query('SELECT state FROM pgboss.job WHERE name = $1', [PAYMENT_CONFIRM_RECONCILE_JOB]);
      expect(done.rows).toEqual([{ state: 'completed' }]);
    }, { timeout: 10_000, interval: 250 });
  });

  it('never cancels the committed payment and refunds only another approval of the same order', async () => {
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      checkoutPaymentMethod: PAYPAL_CHECKOUT,
      providerChargeAmountMinor: 3536,
    });
    const orderId = reservation.tossOrderId!;
    const paymentKey = `pay-${randomUUID()}`;
    const duplicateKey = `pay-${randomUUID()}`;
    const toss = {
      confirmPayment: vi.fn().mockResolvedValue(paypalPayment(paymentKey, orderId)),
      queryPayment: vi.fn((key: string) => Promise.resolve(paypalPayment(key, orderId))),
      cancelPayment: vi.fn((key: string) => Promise.resolve(paypalPayment(key, orderId, {
        status: 'CANCELED', cancels: [{ cancelStatus: 'DONE' }] }))),
    };
    const service = finalization(toss);
    await expect(service.confirmAndCreateReservation(
      { paymentKey, orderId, provider: 'PAYPAL', providerChargeAmount: '35.36' }, userId,
    )).resolves.toEqual({ reservationId: reservation.id });
    await endClientWindows(reservation.id);

    await expect(service.reconcileUnresolvedConfirm(reconcilePayload(orderId, paymentKey)))
      .resolves.toEqual({ status: 'resolved', resolution: 'recorded' });
    expect(toss.cancelPayment).not.toHaveBeenCalled();

    await expect(service.reconcileUnresolvedConfirm(reconcilePayload(orderId, duplicateKey)))
      .resolves.toEqual({ status: 'resolved', resolution: 'duplicate_cancelled' });
    expect(toss.cancelPayment).toHaveBeenCalledOnce();
    expect(toss.cancelPayment).toHaveBeenCalledWith(duplicateKey, '중복 결제로 인한 자동 취소', expect.anything());
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ paymentKey, status: 'DONE', asyncStatus: 'sync' }]);
    const [stored] = await db.select().from(reservations).where(eq(reservations.id, reservation.id));
    expect(stored!.status).toBe('CONFIRMED');
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(1);
  });

  it('keeps a claimed order unissuable while its cancel is in progress', async () => {
    const { userId, reservation } = await pendingOrder({
      showtimeAt: new Date('2099-01-01'),
      checkoutPaymentMethod: PAYPAL_CHECKOUT,
      providerChargeAmountMinor: 3536,
      admissionActiveUntilAt: new Date(Date.now() - 60_000),
    });
    const orderId = reservation.tossOrderId!;
    const paymentKey = `pay-${randomUUID()}`;
    const toss = {
      confirmPayment: vi.fn(),
      queryPayment: vi.fn().mockResolvedValue(paypalPayment(paymentKey, orderId)),
      // PayPal accepts the cancel asynchronously.
      cancelPayment: vi.fn().mockResolvedValue(paypalPayment(paymentKey, orderId, {
        cancels: [{ cancelStatus: 'IN_PROGRESS' }] })),
    };
    const service = finalization(toss);
    await endClientWindows(reservation.id);

    await expect(service.reconcileUnresolvedConfirm(reconcilePayload(orderId, paymentKey)))
      .resolves.toMatchObject({ status: 'retry', reason: 'compensation_cancel_pending' });
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id)))
      .toMatchObject([{ paymentKey, status: 'DONE', asyncStatus: 'cancel_pending' }]);

    // A late client confirm cannot issue the claimed approval.
    await expect(service.confirmAndCreateReservation(
      { paymentKey, orderId, provider: 'PAYPAL', providerChargeAmount: '35.36' }, userId,
    )).rejects.toBeInstanceOf(ConflictException);
    // The next run sees the cancel in progress and does not send another.
    toss.queryPayment.mockResolvedValue(paypalPayment(paymentKey, orderId, { cancels: [{ cancelStatus: 'IN_PROGRESS' }] }));
    await expect(service.reconcileUnresolvedConfirm(reconcilePayload(orderId, paymentKey)))
      .resolves.toMatchObject({ status: 'retry', reason: 'provider_cancel_in_progress' });
    expect(toss.cancelPayment).toHaveBeenCalledOnce();
    expect(toss.confirmPayment).not.toHaveBeenCalled();
    expect(await db.select().from(ticketItems).where(eq(ticketItems.reservationId, reservation.id))).toHaveLength(0);
  });
});
