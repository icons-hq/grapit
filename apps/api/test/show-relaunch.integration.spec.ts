import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';
import { AdminSettlementReconciliationService } from '../src/modules/admin/admin-settlement-reconciliation.service.js';
import { TossPaymentError } from '../src/modules/payment/toss-payments.client.js';
import { RefundService } from '../src/modules/refund/refund.service.js';
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
import { CancelledSeatReleaseWorker } from '../src/modules/jobs/cancelled-seat-release.worker.js';
import { RefundCancelRetryWorker } from '../src/modules/jobs/refund-cancel-retry.worker.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { SearchService } from '../src/modules/search/search.service.js';
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

  it('filters the public catalog before pagination and returns real ticket prices and booking dates', async () => {
    const category = `catalog-${randomUUID()}`;
    const ids: string[] = [];
    for (const [status, startsAt, publishState] of [
      ['upcoming', '2020-01-01', 'published'],
      ['upcoming', '2099-01-01', 'published'],
      ['ended', null, 'published'],
      ['selling', null, 'draft'],
    ] as const) {
      const [event] = await db.insert(performances).values({ title: category, genre: 'artist_celebrity',
        subcategory: category, status, publishState, ageRating: 'All ages', startDate: new Date('2099-02-01'), endDate: new Date('2099-02-01') }).returning();
      ids.push(event!.id);
      await db.insert(schema.bookingPolicies).values({ performanceId: event!.id, bookingStartsAt: startsAt ? new Date(startsAt) : null });
      await db.insert(schema.priceTiers).values([
        { performanceId: event!.id, tierName: 'VIP', price: 120000 },
        { performanceId: event!.id, tierName: 'R', price: 85000 },
      ]);
    }
    const catalogCache = { get: vi.fn().mockResolvedValue(null), set: vi.fn() };
    const catalog = new PerformanceService(db, catalogCache as never);
    const selling = await catalog.findByGenre('artist_celebrity', { page: 1, limit: 1, sort: 'latest', ended: true, sub: category, status: 'selling' });
    expect(selling.total).toBe(1);
    expect(selling.data).toMatchObject([{ id: ids[0], status: 'selling', minPrice: 85000, bookingStartsAt: '2020-01-01T00:00:00.000Z' }]);
    const upcoming = await catalog.findByGenre('artist_celebrity', { page: 1, limit: 1, sort: 'latest', ended: true, sub: category, status: 'upcoming' });
    expect(upcoming.total).toBe(1);
    expect(upcoming.data[0]?.id).toBe(ids[1]);
    const ended = await catalog.findByGenre('artist_celebrity', { page: 1, limit: 1, sort: 'latest', ended: true, sub: category, status: 'ended' });
    expect(ended.total).toBe(1);
    expect(ended.data[0]?.id).toBe(ids[2]);
    const found = await new SearchService(db).search({ q: category, page: 1, limit: 20, ended: true });
    expect(found.total).toBe(3);
    expect(found.data.find((event) => event.id === ids[0])).toMatchObject({ status: 'selling', minPrice: 85000 });
    await db.update(schema.bookingPolicies).set({ bookingStartsAt: new Date(Date.now() + 20000) }).where(eq(schema.bookingPolicies.performanceId, ids[1]!));
    await catalog.findByGenre('artist_celebrity', { page: 1, limit: 1, sort: 'latest', ended: true, sub: category, status: 'selling' });
    const ttl = catalogCache.set.mock.calls.at(-1)?.[2] as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(20);
  });

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

  async function cancellationPurchase() {
    const f = await fixture();
    const [first] = await ticket(f);
    const [second] = await db.insert(ticketItems).values({ reservationId: first!.reservationId,
      paymentId: first!.paymentId, showtimeId: f.showtimeId, seatId: '1F:A-2', seatKey: '1F:A-2',
      floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: '2', price: 50000, serviceFee: 2000 }).returning();
    await db.update(reservations).set({ status: 'CONFIRMED', totalAmount: 104000 }).where(eq(reservations.id, first!.reservationId));
    await db.update(payments).set({ amount: 104000 }).where(eq(payments.id, first!.paymentId));
    await qr.ensureIssuedTicketsForReservation({ reservationId: first!.reservationId, paymentId: first!.paymentId });
    return { ...f, first: first!, second: second! };
  }

  function buyerCancellations(provider: unknown) {
    return new ReservationService(db, provider as never, {} as never, {} as never, {} as never, {} as never,
      qr, undefined, undefined, new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
  }

  it('restores the selected QR and benefits when the provider does not support a partial cancellation', async () => {
    const f = await cancellationPurchase();
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.first, f.second], new Date()));
    const cancel = vi.fn();
    const service = buyerCancellations({ cancelPayment: cancel, queryPayment: vi.fn().mockResolvedValue({
      status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: false }) });
    await expect(service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancel one'))
      .rejects.toThrow('부분취소를 지원하지 않습니다');
    const detail = await service.getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.every((item) => item.status === 'ACTIVE' && item.cancellation === null)).toBe(true);
    expect(detail.ticketItems.flatMap((item) => item.benefitEntitlements).every((benefit) => benefit.state === 'active')).toBe(true);
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(2);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['other_owner', 'entered', 'redeemed', 'expired', 'deadline', 'cancelled_payment'] as const)(
    'rejects a seat cancellation with %s before any provider action', async (caseName) => {
      const f = await cancellationPurchase();
      if (caseName === 'entered') await db.update(ticketItems).set({ admissionState: 'entered' }).where(eq(ticketItems.id, f.first.id));
      if (caseName === 'expired') await db.update(ticketItems).set({ status: 'expired' }).where(eq(ticketItems.id, f.first.id));
      if (caseName === 'deadline') await db.update(reservations).set({ cancelDeadline: new Date(Date.now() - 1000) }).where(eq(reservations.id, f.first.reservationId));
      if (caseName === 'cancelled_payment') await db.update(payments).set({ status: 'CANCELED' }).where(eq(payments.id, f.first.paymentId));
      if (caseName === 'redeemed') {
        await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.first], new Date()));
        await db.update(ticketBenefitEntitlements).set({ state: 'redeemed' }).where(eq(ticketBenefitEntitlements.ticketItemId, f.first.id));
      }
      const provider = { queryPayment: vi.fn(), cancelPayment: vi.fn() };
      await expect(buyerCancellations(provider).cancelTicketItem(f.first.reservationId, f.first.id,
        caseName === 'other_owner' ? randomUUID() : f.userId, 'Cancellation')).rejects.toThrow();
      expect(provider.queryPayment).not.toHaveBeenCalled();
      expect(provider.cancelPayment).not.toHaveBeenCalled();
    },
  );

  it.each(['TRANSFER', 'ALIPAY_PLUS'] as const)('keeps %s refunds pending, then reconciles the same command without sending again', async (method) => {
    const f = await cancellationPurchase();
    const foreign = method === 'ALIPAY_PLUS';
    await db.update(payments).set({ method: foreign ? 'FOREIGN_EASY_PAY' : 'TRANSFER', provider: foreign ? 'ALIPAY_PLUS' : 'CARD',
      currency: foreign ? 'USD' : 'KRW', providerChargeCurrency: foreign ? 'USD' : null,
      providerChargeAmountMinor: foreign ? 7072 : null }).where(eq(payments.id, f.first.paymentId));
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: f.first.seatId,
      seatKey: f.first.seatKey, floorKey: f.first.floorKey, status: 'sold' });
    const providerState = { status: 'DONE', totalAmount: foreign ? 70.72 : 104000, balanceAmount: foreign ? 70.72 : 104000,
      isPartialCancelable: true, cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; cancelRequestId?: string }> };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      providerState.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason,
        cancelStatus: 'IN_PROGRESS', cancelRequestId: options.cancelRequestId });
      return structuredClone(providerState);
    });
    const service = buyerCancellations({ cancelPayment: cancel, queryPayment: vi.fn().mockImplementation(async () => structuredClone(providerState)) });
    const pending = await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Original');
    expect(pending.refundTimeline?.currentState).toBe('PROCESSING_AT_PG');
    expect(pending.cancellationRecovery).toEqual({ kind: 'ticket', ticketItemId: f.first.id });
    await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Retry');
    expect(cancel).toHaveBeenCalledTimes(1);
    providerState.cancels[0]!.cancelStatus = 'DONE';
    providerState.status = 'PARTIAL_CANCELED'; providerState.balanceAmount = foreign ? 35.36 : 52000;
    const complete = await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Retry again');
    expect(complete.ticketItems.find((item) => item.id === f.first.id)?.cancellation?.refundStatus).toBe('COMPLETED');
    expect(complete.ticketItems.find((item) => item.id === f.second.id)?.status).toBe('ACTIVE');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['PAYPAL', 'OVERSEAS_CARD', 'ALIPAY_PLUS'] as const)('recovers a frozen %s seat refund through the payment-status webhook', async (route) => {
    const f = await cancellationPurchase();
    await db.update(payments).set({ method: route === 'OVERSEAS_CARD' ? 'CARD' : 'FOREIGN_EASY_PAY',
      provider: route === 'OVERSEAS_CARD' ? 'CARD' : route, currency: 'USD', providerChargeCurrency: 'USD',
      providerChargeAmountMinor: 7072, providerMetadata: { secretKeyScope: route === 'OVERSEAS_CARD' ? 'overseas-card' : route === 'ALIPAY_PLUS' ? 'foreign-easy-pay' : 'default' } })
      .where(eq(payments.id, f.first.paymentId));
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: f.first.seatId,
      seatKey: f.first.seatKey, floorKey: f.first.floorKey, status: 'sold' });
    const [payment] = await db.select().from(payments).where(eq(payments.id, f.first.paymentId));
    const snapshot = { paymentKey: payment!.paymentKey, orderId: payment!.tossOrderId, status: 'DONE',
      totalAmount: 70.72, balanceAmount: 70.72, isPartialCancelable: true,
      cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; cancelRequestId?: string; canceledAt: string; transactionKey: string }> };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      snapshot.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason, cancelStatus: 'IN_PROGRESS',
        cancelRequestId: options.cancelRequestId, canceledAt: new Date().toISOString(), transactionKey: randomUUID() });
      return structuredClone(snapshot);
    });
    const provider = { queryPayment: vi.fn().mockImplementation(async () => structuredClone(snapshot)), cancelPayment: cancel };
    await buyerCancellations(provider).cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancel selected seat');
    expect(cancel.mock.calls[0]?.[2]).toMatchObject({ cancelAmount: 35.36, currency: 'USD',
      secretKeyScope: route === 'OVERSEAS_CARD' ? 'overseas-card' : route === 'ALIPAY_PLUS' ? 'foreign-easy-pay' : 'default' });
    snapshot.cancels[0]!.cancelStatus = 'DONE'; snapshot.status = 'PARTIAL_CANCELED'; snapshot.balanceAmount = 35.36;
    const paymentService = new PaymentService(db, undefined, qr, provider as never, undefined,
      new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    expect(await paymentService.finalizePaymentStatusPartialCancelWebhook({ eventId: randomUUID(),
      eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: snapshot.paymentKey, orderId: snapshot.orderId,
        status: 'PARTIAL_CANCELED', totalAmount: 70.72 } }, snapshot)).toBe('finalized');
    const detail = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.find((item) => item.id === f.first.id)?.cancellation).toMatchObject({
      refundStatus: 'COMPLETED', providerRefund: { currency: 'USD', amountMinor: 3536 } });
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['accepted then response lost', 'rejected without a balance change'] as const)('reconciles domestic cancellation when %s without confusing an older equal refund', async (mode) => {
    const f = await cancellationPurchase();
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: f.first.seatId,
      seatKey: f.first.seatKey, floorKey: f.first.floorKey, status: 'sold' });
    const snapshot = { status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true,
      cancels: [{ cancelAmount: 52000, cancelReason: 'Cancellation', cancelStatus: 'DONE' }] };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      if (mode === 'accepted then response lost') {
        snapshot.status = 'PARTIAL_CANCELED'; snapshot.balanceAmount = 52000;
        snapshot.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason, cancelStatus: 'DONE' });
        throw new TossPaymentError('NETWORK_ERROR', 'Response lost');
      }
      throw new TossPaymentError('INVALID_REQUEST', 'Rejected');
    });
    const provider = { queryPayment: vi.fn().mockImplementation(async () => structuredClone(snapshot)), cancelPayment: cancel };
    const service = buyerCancellations(provider);
    if (mode === 'accepted then response lost') {
      const detail = await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancellation');
      expect(detail.ticketItems.find((item) => item.id === f.first.id)?.status).toBe('CANCELLED');
      await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Replay');
    } else {
      await expect(service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancellation')).rejects.toThrow();
      expect((await service.getReservationDetail(f.first.reservationId, f.userId)).ticketItems.every((item) => item.status === 'ACTIVE')).toBe(true);
    }
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('recovers a provider-completed cancellation after database failure without sending another refund', async () => {
    const f = await cancellationPurchase();
    const provider = { status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true,
      cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; transactionKey: string }> };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      provider.status = 'PARTIAL_CANCELED'; provider.balanceAmount = 52000;
      provider.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason,
        cancelStatus: 'DONE', transactionKey: randomUUID() });
      return structuredClone(provider);
    });
    const service = new ReservationService(db, { queryPayment: vi.fn().mockImplementation(async () => structuredClone(provider)),
      cancelPayment: cancel } as never, {} as never, {} as never, {} as never, {} as never,
      qr, undefined, undefined, new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    // A missing inventory fixture deliberately makes the DB finalizer roll back after the PG succeeds.
    await expect(service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Original reason')).rejects.toThrow();
    expect((await service.getReservationDetail(f.first.reservationId, f.userId)).ticketItems
      .find((item) => item.id === f.first.id)?.status).toBe('CANCELLATION_PENDING');
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: f.first.seatId,
      floorKey: f.first.floorKey, seatKey: f.first.seatKey, status: 'sold' });
    await db.update(reservations).set({ createdAt: new Date(Date.now() - 10 * 86400000) }).where(eq(reservations.id, f.first.reservationId));
    const recovered = await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Different retry reason');
    expect(recovered.ticketItems.find((item) => item.id === f.first.id)?.cancellation)
      .toMatchObject({ cancelReason: 'Original reason', refundableAmount: 52000, refundStatus: 'COMPLETED' });
    expect(recovered.ticketItems.find((item) => item.id === f.second.id)?.status).toBe('ACTIVE');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(1);
  });

  it('does not send a cancellation when the provider balance cannot be verified', async () => {
    const f = await cancellationPurchase();
    const cancel = vi.fn().mockRejectedValue(new Error('Should not be sent'));
    const service = new ReservationService(db, { queryPayment: vi.fn().mockRejectedValue(new Error('Provider offline')),
      cancelPayment: cancel } as never, {} as never, {} as never, {} as never, {} as never,
      qr, undefined, undefined, new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    await expect(service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancellation')).rejects.toThrow();
    expect(cancel).not.toHaveBeenCalled();
    const detail = await service.getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.find((item) => item.id === f.first.id)?.status).toBe('CANCELLATION_PENDING');
    expect(detail.ticketItems.find((item) => item.id === f.second.id)?.status).toBe('ACTIVE');
  });

  it('refuses whole-reservation refunds when a selected ticket benefit has already been redeemed', async () => {
    const f = await cancellationPurchase();
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.first, f.second], new Date()));
    await db.update(ticketBenefitEntitlements).set({ state: 'redeemed', redeemedAt: new Date(), redeemedByUserId: f.userId })
      .where(eq(ticketBenefitEntitlements.ticketItemId, f.first.id));
    const cancel = vi.fn().mockResolvedValue({ status: 'CANCELED', totalAmount: 104000, balanceAmount: 0 });
    const service = new RefundService(db, { cancelPayment: cancel } as never,
      new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    await expect(service.requestRefund(f.first.reservationId, f.userId, 'Whole booking cancellation'))
      .rejects.toThrow('특전을 수령한 티켓');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('previews one selected seat with its KRW policy amount, provider currency and remaining ticket', async () => {
    const f = await cancellationPurchase();
    await db.update(payments).set({ currency: 'USD', providerChargeCurrency: 'USD', providerChargeAmountMinor: 7071,
      providerMetadata: { secretKeyScope: 'overseas-card' } }).where(eq(payments.id, f.first.paymentId));
    const service = new ReservationService(db, { queryPayment: vi.fn().mockResolvedValue({ status: 'DONE',
      totalAmount: 70.71, balanceAmount: 70.71, isPartialCancelable: true }) } as never,
      {} as never, {} as never, {} as never, {} as never, qr);
    const preview = await service.getTicketItemCancellationPreview(f.first.reservationId, f.first.id, f.userId);
    expect(preview).toMatchObject({ canRequestRefund: true, refundableAmount: 52000,
      selectedTicketItemId: f.first.id, remainingTicketItemIds: [f.second.id],
      providerRefund: { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36' } });
    expect(preview.cancellationQuote?.items).toMatchObject([{ ticketItemId: f.first.id, cancellationFee: 0, serviceFeeRefund: 2000 }]);
    await expect(service.getTicketItemCancellationPreview(f.first.reservationId, f.first.id, randomUUID())).rejects.toThrow();
  });

  it('requires the buyer to review a changed refund amount before contacting the payment provider', async () => {
    const f = await cancellationPurchase();
    const cancel = vi.fn().mockResolvedValue({ status: 'CANCELED', totalAmount: 104000, balanceAmount: 0 });
    const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockResolvedValue({ status: 'DONE',
      totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true }) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    const service = new ReservationService(db, provider as never, {} as never, {} as never, {} as never, {} as never,
      qr, undefined, undefined, finalizer);
    await expect(service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancellation',
      { expectedRefundableAmount: 40000, expectedProviderRefundAmountMinor: 40000 })).rejects.toThrow('환불 금액이 변경');
    await expect(new RefundService(db, provider as never, finalizer).requestRefund(f.first.reservationId, f.userId,
      'Whole cancellation', { expectedRefundableAmount: 80000 })).rejects.toThrow('환불 금액이 변경');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('persists and completes one full-refund command while preserving the original transaction amount', async () => {
    const f = await cancellationPurchase();
    await db.insert(seatInventories).values([f.first, f.second].map((item) => ({ showtimeId: f.showtimeId,
      seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
    const cancel = vi.fn().mockImplementation(async (_key, reason) => ({ status: 'CANCELED', totalAmount: 104000,
      balanceAmount: 0, cancels: [{ cancelReason: reason, cancelAmount: 104000, cancelStatus: 'DONE', transactionKey: randomUUID() }] }));
    const service = new RefundService(db, { cancelPayment: cancel, queryPayment: vi.fn().mockResolvedValue({ status: 'DONE',
      totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true }) } as never,
      new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    const result = await service.requestRefund(f.first.reservationId, f.userId, 'Whole cancellation',
      { expectedRefundableAmount: 104000, expectedProviderRefundAmountMinor: 104000 });
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect(result.providerRefund).toMatchObject({ currency: 'KRW', amountMinor: 104000 });
    expect(result.cancellationQuote?.originalPaymentAmount).toBe(104000);
    const retry = await service.requestRefund(f.first.reservationId, f.userId, 'Retry');
    expect(retry.idempotent).toBe(true);
    expect(retry.refundTimeline?.currentState).toBe('COMPLETED');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('restores all rights after a definite full-refund rejection and permits a fresh reviewed attempt', async () => {
    const f = await cancellationPurchase();
    await db.update(reservations).set({ createdAt: new Date(Date.now() - 2 * 86400000) }).where(eq(reservations.id, f.first.reservationId));
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.first, f.second], new Date()));
    await db.insert(seatInventories).values([f.first, f.second].map((item) => ({ showtimeId: f.showtimeId,
      seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
    let partialAllowed = false;
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => ({ status: 'PARTIAL_CANCELED', totalAmount: 104000,
      balanceAmount: 4000, cancels: [{ cancelReason: reason, cancelAmount: options.cancelAmount,
        cancelStatus: 'DONE', canceledAt: new Date().toISOString(), transactionKey: randomUUID() }] }));
    const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockImplementation(async () => ({ status: 'DONE',
      totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: partialAllowed })) };
    const service = new RefundService(db, provider as never, new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    const rejected = await service.requestRefund(f.first.reservationId, f.userId, 'Cancellation');
    expect(rejected.refundTimeline?.currentState).toBe('FAILED');
    const restored = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(restored.refundTimeline).toBeNull();
    expect(restored.ticketItems.every((item) => item.status === 'ACTIVE' && item.cancellation === null)).toBe(true);
    expect(restored.ticketItems.flatMap((item) => item.benefitEntitlements).every((item) => item.state === 'active')).toBe(true);
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(2);
    expect(cancel).not.toHaveBeenCalled();
    partialAllowed = true;
    const retried = await service.requestRefund(f.first.reservationId, f.userId, 'Reviewed retry', { expectedRefundableAmount: 100000 });
    expect(retried.refundTimeline?.currentState).toBe('COMPLETED');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(['worker', 'webhook'] as const)('recovers a fee-retaining full refund through %s after PG completion precedes the DB failure timestamp', async (mode) => {
    const f = await cancellationPurchase();
    const now = new Date();
    await db.update(reservations).set({ createdAt: new Date(now.getTime() - 2 * 86400000) }).where(eq(reservations.id, f.first.reservationId));
    const original = await buyerCancellations({}).getReservationDetail(f.first.reservationId, f.userId);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
    try {
      const snapshot = { paymentKey: original.paymentKey!, orderId: original.tossOrderId!, status: 'DONE',
        totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true,
        cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; canceledAt: string; transactionKey: string }> };
      const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
        snapshot.status = 'PARTIAL_CANCELED'; snapshot.balanceAmount = 4000;
        snapshot.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason, cancelStatus: 'DONE',
          canceledAt: new Date(now.getTime() + 1000).toISOString(), transactionKey: randomUUID() });
        vi.setSystemTime(new Date(now.getTime() + 2000));
        return structuredClone(snapshot);
      });
      const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockImplementation(async () => structuredClone(snapshot)) };
      const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
      const send = vi.fn(async (_name: string, _payload: { refundId: string }) => randomUUID());
      const service = new RefundService(db, provider as never, finalizer, { isAvailable: true, send } as never);
      const pending = await service.requestRefund(f.first.reservationId, f.userId, 'Fee-retaining cancellation');
      expect(pending.refundTimeline?.currentState).toBe('SENT_TO_PG');
      await db.insert(seatInventories).values([f.first, f.second].map((item) => ({ showtimeId: f.showtimeId,
        seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
      if (mode === 'worker') {
        const job = send.mock.calls[0]![1];
        expect(await new RefundCancelRetryWorker(db, provider as never, finalizer).handleJob(job)).toMatchObject({ status: 'completed' });
      } else {
        const paymentService = new PaymentService(db, undefined, qr, provider as never, undefined, finalizer);
        expect(await paymentService.finalizePaymentStatusPartialCancelWebhook({ eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED',
          createdAt: new Date().toISOString(), data: { paymentKey: snapshot.paymentKey, orderId: snapshot.orderId,
            status: 'PARTIAL_CANCELED', totalAmount: 104000 } }, snapshot)).toBe('finalized');
      }
      expect(cancel).toHaveBeenCalledTimes(1);
      expect((await service.getRefundPreview(f.first.reservationId, f.userId)).refundTimeline?.currentState).toBe('COMPLETED');
    } finally { vi.useRealTimers(); }
  });

  it('keeps a frozen full refund with an in-progress receipt pending without another POST or retry exhaustion', async () => {
    const f = await cancellationPurchase();
    await db.update(reservations).set({ createdAt: new Date(Date.now() - 2 * 86400000) }).where(eq(reservations.id, f.first.reservationId));
    const snapshot = { status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true,
      cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string }> };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      snapshot.cancels.push({ cancelAmount: options.cancelAmount, cancelReason: reason, cancelStatus: 'IN_PROGRESS' });
      return structuredClone(snapshot);
    });
    const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockImplementation(async () => structuredClone(snapshot)) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    await new RefundService(db, provider as never, finalizer).requestRefund(f.first.reservationId, f.userId, 'Cancellation');
    const pending = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(pending.cancellationRecovery).toEqual({ kind: 'reservation' });
    expect(pending.ticketItems.every((item) => item.cancellation?.refundStatus === 'PROCESSING_AT_PG')).toBe(true);
    const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.reservationId, f.first.reservationId));
    const worker = new RefundCancelRetryWorker(db, provider as never, finalizer);
    await worker.handleJob({ refundId: refund!.id, attempt: 1 });
    expect(cancel).toHaveBeenCalledTimes(1);
    await db.update(schema.refunds).set({ retryCount: 3 }).where(eq(schema.refunds.id, refund!.id));
    await worker.handleJob({ refundId: refund!.id, attempt: 4 });
    expect((await db.select().from(schema.refunds).where(eq(schema.refunds.id, refund!.id)))[0]?.status).toBe('processing_at_pg');
  });

  it.each(['one seat', 'last seat'] as const)('keeps a rejected full refund separate from a later %s cancellation webhook', async (selection) => {
    const f = await cancellationPurchase();
    await db.update(payments).set({ method: 'FOREIGN_EASY_PAY', provider: 'ALIPAY_PLUS', currency: 'USD',
      providerChargeCurrency: 'USD', providerChargeAmountMinor: 7072 }).where(eq(payments.id, f.first.paymentId));
    await db.insert(seatInventories).values([f.first, f.second].map((item) => ({ showtimeId: f.showtimeId,
      seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
    const [payment] = await db.select().from(payments).where(eq(payments.id, f.first.paymentId));
    const snapshot = { paymentKey: payment!.paymentKey, orderId: payment!.tossOrderId, currency: 'USD', status: 'DONE',
      totalAmount: 70.72, balanceAmount: 70.72, isPartialCancelable: true,
      cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; cancelRequestId: string; canceledAt: string }> };
    let behavior: 'reject' | 'complete' | 'pending' = 'reject';
    const provider = { queryPayment: vi.fn().mockImplementation(async () => structuredClone(snapshot)),
      cancelPayment: vi.fn().mockImplementation(async (_key, reason, options) => {
        if (behavior === 'reject') throw new TossPaymentError('INVALID_REQUEST', 'Rejected');
        const amount = options.cancelAmount ?? snapshot.balanceAmount;
        snapshot.cancels.push({ cancelAmount: amount, cancelReason: reason, cancelStatus: behavior === 'complete' ? 'DONE' : 'IN_PROGRESS',
          cancelRequestId: options.cancelRequestId, canceledAt: new Date().toISOString() });
        if (behavior === 'complete') { snapshot.balanceAmount = Math.round((snapshot.balanceAmount - amount) * 100) / 100;
          snapshot.status = snapshot.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED'; }
        return structuredClone(snapshot);
      }) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    await new RefundService(db, provider as never, finalizer).requestRefund(f.first.reservationId, f.userId, 'Rejected full request');
    const service = buyerCancellations(provider);
    if (selection === 'last seat') { behavior = 'complete'; await service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'First seat'); }
    behavior = 'pending';
    const target = selection === 'one seat' ? f.first : f.second;
    try { await service.cancelTicketItem(target.reservationId, target.id, f.userId, 'New seat request'); } catch {
      expect(selection).toBe('last seat');
    }
    const receipt = snapshot.cancels.at(-1)!; receipt.cancelStatus = 'DONE';
    snapshot.balanceAmount = Math.round((snapshot.balanceAmount - receipt.cancelAmount) * 100) / 100;
    snapshot.status = snapshot.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';
    const paymentsService = new PaymentService(db, undefined, qr, provider as never, undefined, finalizer);
    expect(await paymentsService.finalizeConfirmedCancelWebhook({ eventId: randomUUID(), eventType: 'CANCEL_STATUS_CHANGED',
      data: { paymentKey: snapshot.paymentKey, orderId: snapshot.orderId, totalAmount: 70.72,
        status: 'DONE', cancelRequestId: receipt.cancelRequestId } }, snapshot)).toBe('finalized');
    expect((await db.select().from(schema.refunds).where(eq(schema.refunds.reservationId, f.first.reservationId)))[0]?.status).toBe('failed');
    const detail = await service.getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.find((item) => item.id === target.id)?.status).toBe('CANCELLED');
    expect(detail.refundProviderAmount?.amountMinor).toBe(selection === 'one seat' ? 3536 : 7072);
  });

  it.each(['network error', 'in-progress response'] as const)('keeps webhook completion after a late %s from the original full cancellation', async (lateResponse) => {
    const f = await cancellationPurchase();
    await db.update(reservations).set({ createdAt: new Date(Date.now() - 2 * 86400000) }).where(eq(reservations.id, f.first.reservationId));
    await db.insert(seatInventories).values([f.first, f.second].map((item) => ({ showtimeId: f.showtimeId,
      seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
    const [payment] = await db.select().from(payments).where(eq(payments.id, f.first.paymentId));
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    const paymentService = new PaymentService(db, undefined, qr, {} as never, undefined, finalizer);
    const provider = {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true }),
      cancelPayment: vi.fn().mockImplementation(async (_key, reason, options) => {
        const snapshot = { paymentKey: payment!.paymentKey, orderId: payment!.tossOrderId, totalAmount: 104000,
          balanceAmount: 4000, status: 'PARTIAL_CANCELED', cancels: [{ cancelAmount: options.cancelAmount,
            cancelReason: reason, cancelStatus: 'DONE', canceledAt: new Date().toISOString(), transactionKey: randomUUID() }] };
        expect(await paymentService.finalizePaymentStatusPartialCancelWebhook({ eventId: randomUUID(), eventType: 'PAYMENT_STATUS_CHANGED',
          data: { paymentKey: payment!.paymentKey, orderId: payment!.tossOrderId, totalAmount: 104000, status: 'PARTIAL_CANCELED' } }, snapshot)).toBe('finalized');
        if (lateResponse === 'network error') throw new TossPaymentError('NETWORK_ERROR', 'Late response lost');
        return { ...snapshot, status: 'DONE', balanceAmount: 104000, cancels: snapshot.cancels.map((cancel) => ({ ...cancel, cancelStatus: 'IN_PROGRESS' })) };
      }),
    };
    const result = await new RefundService(db, provider as never, finalizer).requestRefund(f.first.reservationId, f.userId, 'Cancellation');
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect((await db.select().from(schema.refunds).where(eq(schema.refunds.reservationId, f.first.reservationId)))[0]?.status).toBe('completed');
  });

  it.each(['expired command', 'changed balance'] as const)('does not repeat a full refund with %s', async (mode) => {
    const f = await cancellationPurchase();
    const cancel = vi.fn().mockRejectedValue(new Error('Must not send without verified balance'));
    const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockRejectedValue(new Error('Provider offline')) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    const send = vi.fn(async () => randomUUID());
    const service = new RefundService(db, provider as never, finalizer, { isAvailable: true, send } as never);
    await service.requestRefund(f.first.reservationId, f.userId, 'Cancellation');
    const pendingDetail = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(pendingDetail.ticketItems.every((item) => item.cancellation?.reopenState === 'NOT_REQUIRED')).toBe(true);
    const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.reservationId, f.first.reservationId));
    if (mode === 'expired command') await db.update(schema.refunds).set({ requestedAt: new Date(Date.now() - 16 * 86400000) })
      .where(eq(schema.refunds.id, refund!.id));
    provider.queryPayment.mockResolvedValue({ status: 'DONE', totalAmount: 104000,
      balanceAmount: mode === 'changed balance' ? 100000 : 104000, isPartialCancelable: true } as never);
    await new RefundCancelRetryWorker(db, provider as never, finalizer).handleJob({ refundId: refund!.id, attempt: 1 });
    expect(cancel).not.toHaveBeenCalled();
    expect((await db.select().from(schema.refunds).where(eq(schema.refunds.id, refund!.id)))[0])
      .toMatchObject({ status: 'failed', customerServiceCtaVisible: true });
    const detail = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.every((item) => item.status === 'CANCELLATION_PENDING')).toBe(true);
  });

  it('restores buyer rights after the retry worker proves a rejected refund changed no provider balance', async () => {
    const f = await cancellationPurchase();
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.first, f.second], new Date()));
    const cancel = vi.fn().mockRejectedValue(new TossPaymentError('INVALID_REQUEST', 'Rejected'));
    const provider = { cancelPayment: cancel, queryPayment: vi.fn().mockRejectedValue(new Error('Provider offline')) };
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    const service = new RefundService(db, provider as never, finalizer);
    await service.requestRefund(f.first.reservationId, f.userId, 'Cancellation');
    const [refund] = await db.select().from(schema.refunds).where(eq(schema.refunds.reservationId, f.first.reservationId));
    provider.queryPayment.mockResolvedValue({ status: 'DONE', totalAmount: 104000, balanceAmount: 104000,
      isPartialCancelable: true, cancels: [] } as never);
    await new RefundCancelRetryWorker(db, provider as never, finalizer).handleJob({ refundId: refund!.id, attempt: 1 });
    const detail = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.every((item) => item.status === 'ACTIVE')).toBe(true);
    expect(detail.ticketItems.flatMap((item) => item.benefitEntitlements).every((item) => item.state === 'active')).toBe(true);
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(2);
  });

  it('keeps a rejected partial refund pending when the follow-up provider query is unavailable', async () => {
    const f = await cancellationPurchase();
    const provider = { cancelPayment: vi.fn().mockRejectedValue(new TossPaymentError('INVALID_REQUEST', 'Rejected')),
      queryPayment: vi.fn().mockResolvedValueOnce({ status: 'DONE', totalAmount: 104000, balanceAmount: 104000,
        isPartialCancelable: true }).mockRejectedValue(new Error('Provider offline')) };
    await expect(buyerCancellations(provider).cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'Cancellation')).rejects.toThrow();
    const detail = await buyerCancellations(provider).getReservationDetail(f.first.reservationId, f.userId);
    expect(detail.ticketItems.find((item) => item.id === f.first.id)?.status).toBe('CANCELLATION_PENDING');
    expect(await qr.getOwnedTicketsForReservation(f.first.reservationId, f.userId)).toHaveLength(1);
  });

  it('serializes two seat cancellations while allowing the remaining ticket to stay valid', async () => {
    const f = await cancellationPurchase();
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId, seatId: f.first.seatId,
      seatKey: f.first.seatKey, floorKey: f.first.floorKey, status: 'sold' });
    let started!: () => void;
    let finish!: () => void;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const providerContinue = new Promise<void>((resolve) => { finish = resolve; });
    const cancel = vi.fn().mockImplementation(async (_key, reason) => {
      started(); await providerContinue;
      return { status: 'PARTIAL_CANCELED', totalAmount: 104000, balanceAmount: 52000,
        cancels: [{ cancelReason: reason, cancelAmount: 52000, cancelStatus: 'DONE' }] };
    });
    const service = new ReservationService(db, { cancelPayment: cancel, queryPayment: vi.fn().mockResolvedValue({ status: 'DONE',
      totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: true }) } as never,
      {} as never, {} as never, {} as never, {} as never, qr, undefined, undefined,
      new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    const first = service.cancelTicketItem(f.first.reservationId, f.first.id, f.userId, 'First');
    await providerStarted;
    try {
      await expect(service.cancelTicketItem(f.second.reservationId, f.second.id, f.userId, 'Second'))
        .rejects.toThrow('다른 좌석의 취소가 처리 중');
    } finally { finish(); }
    const result = await first;
    expect(result.ticketItems.find((item) => item.id === f.second.id)?.status).toBe('ACTIVE');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

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

  it('cancels the last ticket while retaining the cancellation and booking fees at the provider', async () => {
    const f = await fixture();
    const [item] = await ticket(f);
    await db.update(reservations).set({ status: 'CONFIRMED',
      createdAt: new Date(Date.now() - 10 * 86400000) })
      .where(eq(reservations.id, item!.reservationId));
    await db.insert(seatInventories).values({ showtimeId: f.showtimeId,
      seatId: item!.seatId, seatKey: item!.seatKey, floorKey: item!.floorKey, status: 'sold' });
    await qr.ensureIssuedTicketsForReservation({ reservationId: item!.reservationId, paymentId: item!.paymentId });
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      expect(options.cancelAmount).toBe(46000);
      return { status: 'PARTIAL_CANCELED', totalAmount: 52000, balanceAmount: 6000,
        cancels: [{ cancelAmount: 46000, cancelReason: reason, cancelStatus: 'DONE' }] };
    });
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: false } as never);
    const service = new ReservationService(db, {
      queryPayment: vi.fn().mockResolvedValue({ status: 'DONE', totalAmount: 52000,
        balanceAmount: 52000, isPartialCancelable: true, cancels: [] }), cancelPayment: cancel,
    } as never, {} as never, { broadcastSeatUpdate: vi.fn() } as never,
    {} as never, {} as never, qr, undefined, undefined, finalizer);
    const detail = await service.cancelTicketItem(item!.reservationId, item!.id, f.userId, 'One ticket cancellation');
    expect(detail.status).toBe('CANCELLED');
    expect(detail.paymentInfo?.status).toBe('PARTIAL_CANCELED');
    expect(detail.refundProviderAmount).toEqual({ currency: 'KRW', amountMinor: 46000, amountDecimal: '46000' });
    expect(detail.refundTimeline?.currentState).toBe('COMPLETED');
    expect(detail.ticketItems?.[0]?.cancellation).toMatchObject({ refundStatus: 'COMPLETED', reopenState: 'HELD_CANCELLED' });
    expect(detail.ticketEmailDelivery.canSend).toBe(false);
    expect(detail.totalAmount).toBe(52000);
    expect(detail.qrTicket).toMatchObject({ status: 'REVOKED', token: '' });
    await expect(qr.getOwnedTicketsForReservation(item!.reservationId, f.userId))
      .rejects.toThrow('QR 티켓을 찾을 수 없습니다');
    await new CancelledSeatReleaseWorker(db).handleJob({ reservationId: item!.reservationId,
      showtimeId: f.showtimeId, releaseAt: new Date().toISOString(),
      seatIdentities: [{ seatId: item!.seatId, floorKey: item!.floorKey, seatKey: item!.seatKey }],
    }, 'JOB_ENQUEUE_FAILED');
    expect((await service.getReservationDetail(item!.reservationId, f.userId)).ticketItems[0]?.cancellation?.reopenState).toBe('AVAILABLE');
  });

  it('successive foreign ticket cancellations retain frozen minor amounts and refund exactly the original charge', async () => {
    const f = await fixture();
    const [first] = await ticket(f);
    await db.update(reservations).set({ status: 'CONFIRMED', totalAmount: 9000 })
      .where(eq(reservations.id, first!.reservationId));
    await db.update(payments).set({ amount: 9000, currency: 'USD',
      providerMetadata: { secretKeyScope: 'overseas-card' },
      providerChargeCurrency: 'USD', providerChargeAmountMinor: 100 })
      .where(eq(payments.id, first!.paymentId));
    await db.update(ticketItems).set({ price: 1000, serviceFee: 2000 }).where(eq(ticketItems.id, first!.id));
    const rest = await db.insert(ticketItems).values([2, 3].map((number) => ({
      reservationId: first!.reservationId, paymentId: first!.paymentId, showtimeId: f.showtimeId,
      seatId: `1F:A-${number}`, seatKey: `1F:A-${number}`, floorKey: '1F', floorLabel: '1층',
      tierName: 'VIP', row: 'A', number: String(number), price: 1000, serviceFee: 2000,
    }))).returning();
    const items = [first!, ...rest];
    await db.insert(seatInventories).values(items.map((item) => ({ showtimeId: f.showtimeId,
      seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
    await qr.ensureIssuedTicketsForReservation({ reservationId: first!.reservationId, paymentId: first!.paymentId });
    const provider = { status: 'DONE', totalAmount: 1, balanceAmount: 1, isPartialCancelable: true,
      cancels: [] as Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; transactionKey: string }> };
    const cancel = vi.fn().mockImplementation(async (_key, reason, options) => {
      const amount = options.cancelAmount ?? provider.balanceAmount;
      provider.balanceAmount = Math.round((provider.balanceAmount - amount) * 100) / 100;
      provider.status = provider.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';
      provider.cancels.push({ cancelAmount: amount, cancelReason: reason, cancelStatus: 'DONE', transactionKey: randomUUID() });
      return structuredClone(provider);
    });
    const queuedKeys = new Set<string>();
    const finalizer = new PaymentCancellationFinalizerService(db, { isAvailable: true,
      send: vi.fn(async (_name, _payload, options) => {
        if (queuedKeys.has(options.singletonKey)) return null;
        queuedKeys.add(options.singletonKey); return options.id;
      }),
    } as never);
    const service = new ReservationService(db, { queryPayment: vi.fn().mockImplementation(async () => structuredClone(provider)),
      cancelPayment: cancel } as never, {} as never, {} as never, {} as never, {} as never,
      qr, undefined, undefined, finalizer);
    for (const item of items) await service.cancelTicketItem(item.reservationId, item.id, f.userId, 'Cancel one seat');
    expect(provider.cancels.map((cancel) => cancel.cancelAmount)).toEqual([0.33, 0.34, 0.33]);
    expect(provider.balanceAmount).toBe(0);
    expect(queuedKeys.size).toBe(3);
    const detail = await service.getReservationDetail(first!.reservationId, f.userId);
    expect(detail.status).toBe('CANCELLED');
    expect(detail.paymentInfo?.status).toBe('CANCELED');
    expect(detail.refundProviderAmount).toEqual({ currency: 'USD', amountMinor: 100, amountDecimal: '1.00' });
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
