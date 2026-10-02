import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrepareReservationRequest } from '@grabit/shared';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { PaymentService } from '../src/modules/payment/payment.service.js';
import { AbandonedPaymentHandoffService } from '../src/modules/payment/abandoned-payment-handoff.service.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { PendingPaymentExpirationWorker } from '../src/modules/jobs/pending-payment-expiration.worker.js';
import type { TossTransactionRow } from '../src/modules/payment/toss-payments.client.js';

const { users, venues, performances, showtimes, reservations, payments, reservationPaymentFailureDiagnostics } = schema;

// Never reads DATABASE_URL. Every test uses the disposable container created below.
describe('Provider handoff release and abandoned handoff review — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let qr: QrTicketService;
  /** In-memory confirm leases with the same SET NX / owner-checked release semantics. */
  const leases = new Map<string, string>();
  const locks = {
    assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    setOwnedSeatLockTtl: vi.fn().mockResolvedValue(undefined),
    extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
    acquirePaymentConfirmLock: vi.fn(async (orderId: string, token: string) => {
      if (leases.has(orderId)) return false;
      leases.set(orderId, token);
      return true;
    }),
    releasePaymentConfirmLock: vi.fn(async (orderId: string, token: string) => {
      if (leases.get(orderId) === token) leases.delete(orderId);
    }),
  };
  /** Orders the provider ledger reports; anything else has no transaction. */
  const providerOrders = new Set<string>();
  const toss = {
    queryTransactions: vi.fn(async (): Promise<TossTransactionRow[]> => [...providerOrders]
      .map((orderId, index) => ({ transactionKey: `tx-${index}`, orderId, status: 'DONE' }))),
  };

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'handoff_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'handoff_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    qr = new QrTicketService(db, new ConfigService({
      QR_TICKET_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'test-v1', FRONTEND_URL: 'https://example.test',
    }), new JwtService(), { sendTicketEmail: vi.fn() } as never, { isAvailable: false } as never);
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function checkout(paymentMethod: PrepareReservationRequest['paymentMethod'] = { method: 'CARD', provider: 'CARD', currency: 'KRW' }) {
    const id = randomUUID();
    const [user] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Fixture',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01',
      isPhoneVerified: true, isEmailVerified: true }).returning();
    const [venue] = await db.insert(venues).values({ name: `Fixture-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Fixture', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser: 4 });
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
    return { userId: user!.id, prepared, reservationService, paymentService, branch };
  }

  async function readReservation(id: string) {
    return (await db.select().from(reservations).where(eq(reservations.id, id)))[0]!;
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
    expect(leases.size).toBe(0);

    // The same order hands off again (no second order), and can then be released again.
    await f.paymentService.prepareTossPaymentBranch(f.branch);
    expect((await readReservation(f.prepared.reservationId)).checkoutStartedAt).toBeInstanceOf(Date);
    await f.paymentService.releaseTossPaymentHandoff({ orderId: f.prepared.orderId, userId: f.userId });
    await f.reservationService.cancelPendingReservation(f.prepared.reservationId, f.userId);
    expect((await readReservation(f.prepared.reservationId)).status).toBe('CANCELLED');
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
    leases.set(confirming.prepared.orderId, 'confirm-in-flight');
    await expect(confirming.paymentService.releaseTossPaymentHandoff({
      orderId: confirming.prepared.orderId, userId: confirming.userId,
    })).rejects.toThrow('결제 확인이 이미 진행 중입니다.');
    expect(leases.get(confirming.prepared.orderId)).toBe('confirm-in-flight');
    leases.delete(confirming.prepared.orderId);
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
      new AbandonedPaymentHandoffService(db, toss as never, locks as never),
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
    expect(leases.size).toBe(0);

    // A provider lookup outage is never evidence.
    const outage = await checkout();
    await outage.paymentService.prepareTossPaymentBranch(outage.branch);
    await db.update(reservations).set(longAgo).where(eq(reservations.id, outage.prepared.reservationId));
    toss.queryTransactions.mockRejectedValueOnce(new Error('UNAUTHORIZED_KEY'));
    toss.queryTransactions.mockRejectedValueOnce(new Error('UNAUTHORIZED_KEY'));
    await worker.sweepExpiredPendingPayments();
    expect((await readReservation(outage.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
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

    const service = new AbandonedPaymentHandoffService(db, toss as never, locks as never);
    await service.sweepAbandonedPaymentHandoffs();
    expect((await readReservation(wallet.prepared.reservationId)).status).toBe('PENDING_PAYMENT');
  });
});
