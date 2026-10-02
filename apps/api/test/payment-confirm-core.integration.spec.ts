import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PaymentMethod } from '@grabit/shared';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { TossPaymentError } from '../src/modules/payment/toss-payments.client.js';
import { ReservationFinalizationService } from '../src/modules/reservation/reservation-finalization.service.js';
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

  afterAll(async () => { await closePool?.(); await container?.stop(); });

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

  function finalization(toss: Record<string, unknown>) {
    const bookingService = {
      acquirePaymentConfirmLock: vi.fn().mockResolvedValue(true),
      refreshPaymentConfirmLock: vi.fn().mockResolvedValue(true),
      releasePaymentConfirmLock: vi.fn().mockResolvedValue(undefined),
      extendOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      assertOwnedSeatLocks: vi.fn().mockResolvedValue(undefined),
      consumeOwnedSeatLocks: vi.fn().mockResolvedValue({ consumedSeatIds: [] }),
    };
    const quoteService = {
      parseProviderDecimalToMinor: (value: string) => Math.round(Number(value) * 100),
    };
    return new ReservationFinalizationService(db, toss as never, bookingService as never,
      { broadcastSeatUpdate: vi.fn() } as never, undefined, quoteService as never);
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

  it('cancels an earlier PayPal approval found when a retry hits an expired hold, writing nothing', async () => {
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
    expect(await db.select().from(payments).where(eq(payments.reservationId, reservation.id))).toHaveLength(0);
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
});
