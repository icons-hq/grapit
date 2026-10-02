import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { TossPaymentError } from '../src/modules/payment/toss-payments.client.js';
import { RefundService } from '../src/modules/refund/refund.service.js';
import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';
import { PaymentCancellationFinalizerService, JOB_ENQUEUE_FAILED } from '../src/modules/cancellation/payment-cancellation-finalizer.service.js';
import { HeldCancelledSeatRecoveryWorker } from '../src/modules/cancellation/held-cancelled-seat-recovery.worker.js';
import { RefundCancelRetryWorker } from '../src/modules/jobs/refund-cancel-retry.worker.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

const { users, venues, performances, showtimes, reservations, reservationSeats, payments, refunds,
  ticketItems, seatInventories, tickets } = schema;

type ProviderSnapshot = {
  paymentKey: string;
  orderId: string;
  status: string;
  currency: string;
  totalAmount: number;
  balanceAmount: number;
  isPartialCancelable: boolean;
  cancels: Array<{ cancelAmount: number; cancelReason: string; cancelStatus: string; canceledAt: string; transactionKey: string }>;
};

/** A provider double that behaves like Toss: a completed cancel lowers the balance and appends a receipt. */
function provider(snapshot: ProviderSnapshot, behavior: { fail?: () => Error | null } = {}) {
  return {
    queryPayment: vi.fn(async () => structuredClone(snapshot)),
    cancelPayment: vi.fn(async (_key: string, reason: string, options: { cancelAmount?: number }) => {
      const failure = behavior.fail?.();
      if (failure) throw failure;
      const amount = options.cancelAmount ?? snapshot.balanceAmount;
      snapshot.balanceAmount -= amount;
      snapshot.status = snapshot.balanceAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED';
      snapshot.cancels.push({ cancelAmount: amount, cancelReason: reason, cancelStatus: 'DONE',
        canceledAt: new Date().toISOString(), transactionKey: randomUUID() });
      return structuredClone(snapshot);
    }),
  };
}

describe('Refund and cancellation recovery — PostgreSQL', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let qr: QrTicketService;
  let adminId: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'refund_recovery_test' })
      .withExposedPorts(5432).start();
    const pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'refund_recovery_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    qr = new QrTicketService(db, new ConfigService({
      QR_TICKET_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'test-v1', FRONTEND_URL: 'https://example.test',
    }), new JwtService(), { sendTicketEmail: vi.fn() } as never, { isAvailable: false } as never);
    const [admin] = await db.insert(users).values({ email: `admin-${randomUUID()}@example.test`, name: 'Operator',
      phone: '+821000000001', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin' }).returning();
    adminId = admin!.id;
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function purchase(options: {
    price?: number;
    showtimeAt?: Date;
    cancelDeadline?: Date;
    bookedAt?: Date;
    /** Provider approval time; defaults to the booking (reservation creation) time. */
    paidAt?: Date;
    issueQr?: boolean;
    seatInventory?: boolean;
  } = {}) {
    const id = randomUUID();
    const price = options.price ?? 50000;
    const bookedAt = options.bookedAt ?? new Date(Date.now() - 2 * 86400000);
    const showtimeAt = options.showtimeAt ?? new Date(Date.now() + 30 * 86400000);
    const [user] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Buyer', phone: '+821000000000',
      gender: 'unspecified', birthDate: '1990-01-01', isPhoneVerified: true, isEmailVerified: true }).returning();
    const [venue] = await db.insert(venues).values({ name: `Venue-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Recovery', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: showtimeAt, endDate: showtimeAt }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser: 4,
      cancelledSeatHoldMinMinutes: 1, cancelledSeatHoldMaxMinutes: 1 });
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id, dateTime: showtimeAt }).returning();
    const amount = (price + 2000) * 2;
    const [reservation] = await db.insert(reservations).values({ userId: user!.id, showtimeId: showtime!.id,
      reservationNumber: id.slice(0, 28), tossOrderId: `GRP-${id}`, status: 'CONFIRMED', totalAmount: amount,
      cancelDeadline: options.cancelDeadline ?? new Date(showtimeAt.getTime() - 86400000), createdAt: bookedAt }).returning();
    const [payment] = await db.insert(payments).values({ reservationId: reservation!.id, paymentKey: `pay_${id}`,
      tossOrderId: reservation!.tossOrderId!, method: 'CARD', amount, status: 'DONE', paidAt: options.paidAt ?? bookedAt }).returning();
    const items = [];
    for (const [index, seatKey] of ['1F:A-1', '1F:A-2'].entries()) {
      await db.insert(reservationSeats).values({ reservationId: reservation!.id, seatId: seatKey, tierName: 'VIP',
        price, row: 'A', number: String(index + 1) });
      const [item] = await db.insert(ticketItems).values({ reservationId: reservation!.id, paymentId: payment!.id,
        showtimeId: showtime!.id, seatId: seatKey, seatKey, floorKey: '1F', floorLabel: '1층', tierName: 'VIP',
        row: 'A', number: String(index + 1), price, serviceFee: 2000, createdAt: bookedAt }).returning();
      items.push(item!);
      if (options.seatInventory !== false) {
        await db.insert(seatInventories).values({ showtimeId: showtime!.id, seatId: seatKey, seatKey, floorKey: '1F',
          status: 'sold', soldAt: bookedAt });
      }
    }
    if (options.issueQr !== false) {
      await qr.ensureIssuedTicketsForReservation({ reservationId: reservation!.id, paymentId: payment!.id });
    }
    const snapshot: ProviderSnapshot = { paymentKey: payment!.paymentKey, orderId: reservation!.tossOrderId!, status: 'DONE',
      currency: 'KRW', totalAmount: amount, balanceAmount: amount, isPartialCancelable: true, cancels: [] };
    return { userId: user!.id, reservation: reservation!, payment: payment!, showtime: showtime!, items, snapshot };
  }

  const finalizer = (pgBoss: unknown = { isAvailable: false }) =>
    new PaymentCancellationFinalizerService(db, pgBoss as never);

  async function seat(showtimeId: string, seatKey: string) {
    const [row] = await db.select().from(seatInventories)
      .where(and(eq(seatInventories.showtimeId, showtimeId), eq(seatInventories.seatKey, seatKey)));
    return row!;
  }

  async function refundOf(reservationId: string) {
    const [row] = await db.select().from(refunds).where(eq(refunds.reservationId, reservationId));
    return row!;
  }

  it('finalizes a provider-completed refund for ticket items whose QR credential was never issued (#79)', async () => {
    const f = await purchase({ issueQr: false });
    const toss = provider(f.snapshot);

    const result = await new RefundService(db, toss as never, finalizer()).requestRefund(f.reservation.id, f.userId, 'No QR yet');

    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, f.reservation.id));
    expect(reservation!.status).toBe('CANCELLED');
    const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, f.reservation.id));
    expect(items.every((item) => item.status === 'cancelled')).toBe(true);
    expect((await seat(f.showtime.id, '1F:A-1')).status).toBe('held_cancelled');
  });

  it('keeps an earlier seat cancellation intact when a quote-less provider full cancel arrives (#81)', async () => {
    const f = await purchase();
    const earlierCancelledAt = new Date(Date.now() - 3600000);
    const [first, second] = f.items;
    await db.update(ticketItems).set({ status: 'cancelled', cancelledAt: earlierCancelledAt, cancelReason: 'seat',
      cancellationFee: 4000, serviceFeeRefund: 0, refundableAmount: 46000, reopenState: 'available' })
      .where(eq(ticketItems.id, first!.id));
    await db.update(tickets).set({ status: 'revoked', revokedAt: earlierCancelledAt }).where(eq(tickets.ticketItemId, first!.id));
    // The first seat was released and is now being bought by someone else.
    await db.update(seatInventories).set({ status: 'locked', soldAt: null })
      .where(and(eq(seatInventories.showtimeId, f.showtime.id), eq(seatInventories.seatKey, '1F:A-1')));

    await finalizer().finalizeFullPaymentCancellation({
      source: 'cancel_webhook',
      context: { reservation: { id: f.reservation.id, showtimeId: f.showtime.id },
        payment: { id: f.payment.id, paymentKey: f.payment.paymentKey }, bookingPolicy: null,
        seats: [{ seatId: '1F:A-1' }, { seatId: '1F:A-2' }] },
      reason: 'PG console cancel',
      // The console refunded the whole remaining balance: seat B (52,000) plus seat A's retained 6,000.
      providerResponse: { status: 'CANCELED', currency: 'KRW', totalAmount: 104000, balanceAmount: 0 },
    });

    const [cancelledFirst] = await db.select().from(ticketItems).where(eq(ticketItems.id, first!.id));
    expect(cancelledFirst).toMatchObject({ cancellationFee: 4000, refundableAmount: 46000, cancelReason: 'seat' });
    expect(cancelledFirst!.cancelledAt).toEqual(earlierCancelledAt);
    const [firstTicket] = await db.select().from(tickets).where(eq(tickets.ticketItemId, first!.id));
    expect(firstTicket!.revokedAt).toEqual(earlierCancelledAt);
    const [cancelledSecond] = await db.select().from(ticketItems).where(eq(ticketItems.id, second!.id));
    // Refund totals follow the provider: 46,000 + 58,000 = 104,000 KRW actually returned.
    expect(cancelledSecond).toMatchObject({ status: 'cancelled', refundableAmount: 58000, cancellationFee: 0, serviceFeeRefund: 2000 });
    const [payment] = await db.select().from(payments).where(eq(payments.id, f.payment.id));
    expect((payment!.providerMetadata as Record<string, unknown>).quotelessCancellationReconciliation).toMatchObject({
      status: 'ATTRIBUTED', providerCancelAmount: 58000, faceValueAmount: 52000, differenceAmount: 6000,
      attributedTicketItemId: second!.id,
    });
    expect((await seat(f.showtime.id, '1F:A-1')).status).toBe('locked');
    expect((await seat(f.showtime.id, '1F:A-2')).status).toBe('held_cancelled');
  });

  it('writes the release job id in the cancellation transaction and recovers seats whose job never ran (#24)', async () => {
    const sent = await purchase();
    const sentJobs: string[] = [];
    const okBoss = { isAvailable: true, send: vi.fn(async (_name: string, _payload: unknown, options: { id: string }) => {
      // The job id must already be committed when the job is created.
      expect((await seat(sent.showtime.id, '1F:A-1')).reopenJobId).toBe(options.id);
      sentJobs.push(options.id);
      return options.id;
    }) };
    await new RefundService(db, provider(sent.snapshot) as never, finalizer(okBoss)).requestRefund(sent.reservation.id, sent.userId, 'ok');
    expect((await seat(sent.showtime.id, '1F:A-1')).reopenJobId).toBe(sentJobs[0]);

    const lost = await purchase();
    const brokenBoss = { isAvailable: true, send: vi.fn().mockRejectedValue(new Error('connection refused')) };
    await new RefundService(db, provider(lost.snapshot) as never, finalizer(brokenBoss)).requestRefund(lost.reservation.id, lost.userId, 'lost');
    expect((await seat(lost.showtime.id, '1F:A-1'))).toMatchObject({ status: 'held_cancelled', reopenJobId: JOB_ENQUEUE_FAILED });

    // Imminent showtime and a seat already resold to another active ticket item stay untouched.
    const imminent = await purchase({ showtimeAt: new Date(Date.now() + 3 * 60000), cancelDeadline: new Date(Date.now() + 60000) });
    await finalizer().finalizeFullPaymentCancellation({ source: 'cancel_webhook',
      context: { reservation: { id: imminent.reservation.id, showtimeId: imminent.showtime.id },
        payment: { id: imminent.payment.id, paymentKey: imminent.payment.paymentKey }, bookingPolicy: null,
        seats: [{ seatId: '1F:A-1' }, { seatId: '1F:A-2' }] },
      reason: 'imminent', providerResponse: { status: 'CANCELED', balanceAmount: 0 } });

    const worker = new HeldCancelledSeatRecoveryWorker(db);
    await worker.releaseExpiredHeldSeats(new Date(Date.now() - 60000));
    expect((await seat(lost.showtime.id, '1F:A-1')).status).toBe('held_cancelled');

    const result = await worker.releaseExpiredHeldSeats(new Date(Date.now() + 30 * 60000));
    expect(result.releasedSeats).toBeGreaterThanOrEqual(2);
    expect((await seat(lost.showtime.id, '1F:A-1'))).toMatchObject({ status: 'available', reopenJobId: null });
    expect((await seat(lost.showtime.id, '1F:A-2')).status).toBe('available');
    const lostItems = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, lost.reservation.id));
    expect(lostItems.every((item) => item.reopenState === 'available')).toBe(true);
    expect((await seat(imminent.showtime.id, '1F:A-1')).status).toBe('held_cancelled');
  });

  it('runs a duplicated retry attempt once and re-drives a refund whose job was lost (#53)', async () => {
    const f = await purchase();
    let releaseCancel!: () => void;
    const toss = provider(f.snapshot);
    const fail5xx = { current: true };
    const service = new RefundService(db, { ...toss, cancelPayment: vi.fn(async (...args: Parameters<typeof toss.cancelPayment>) => {
      if (fail5xx.current) throw new TossPaymentError('FAILED_INTERNAL_SYSTEM_PROCESSING', '내부 시스템 처리 작업이 실패했습니다');
      return toss.cancelPayment(...args);
    }) } as never, finalizer(), { isAvailable: true, send: vi.fn(async () => randomUUID()) } as never);
    const pending = await service.requestRefund(f.reservation.id, f.userId, '5xx');
    expect(pending.refundTimeline?.currentState).toBe('SENT_TO_PG');
    const refund = await refundOf(f.reservation.id);
    expect(refund.status).toBe('sent_to_pg');

    fail5xx.current = false;
    const slowToss = { queryPayment: toss.queryPayment, cancelPayment: vi.fn(async (...args: Parameters<typeof toss.cancelPayment>) => {
      await new Promise<void>((resolve) => { releaseCancel = resolve; });
      return toss.cancelPayment(...args);
    }) };
    const worker = new RefundCancelRetryWorker(db, slowToss as never, finalizer());
    const first = worker.handleJob({ refundId: refund.id, attempt: 1 });
    await vi.waitFor(() => expect(slowToss.cancelPayment).toHaveBeenCalledTimes(1));
    expect(await worker.handleJob({ refundId: refund.id, attempt: 1 })).toEqual({ status: 'stale_job' });
    releaseCancel();
    expect(await first).toEqual({ status: 'completed' });
    expect(slowToss.cancelPayment).toHaveBeenCalledTimes(1);

    // A second refund whose job was never enqueued is found by the stale sweep and completed inline.
    const g = await purchase();
    const gToss = provider(g.snapshot, { fail: () => new TossPaymentError('COMMON_ERROR', '일시적인 오류') });
    await new RefundService(db, gToss as never, finalizer()).requestRefund(g.reservation.id, g.userId, 'lost job');
    const gRefund = await refundOf(g.reservation.id);
    expect(gRefund.status).toBe('sent_to_pg');
    const recovered = new RefundCancelRetryWorker(db, provider(g.snapshot) as never, finalizer());
    expect((await recovered.recoverStaleRefunds(new Date())).found).toBe(0);
    const later = new Date(Date.now() + 60 * 60000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later);
    try {
      expect(await recovered.recoverStaleRefunds(later)).toMatchObject({ found: 1, attempted: 1 });
    } finally {
      vi.useRealTimers();
    }
    expect((await refundOf(g.reservation.id)).status).toBe('completed');
  });

  it('lets an admin resume a failed refund whose rights are still revoked (#53)', async () => {
    const f = await purchase();
    const toss = provider(f.snapshot, { fail: () => new TossPaymentError('FAILED_REFUND_PROCESS', '은행 응답 지연') });
    const service = new RefundService(db, toss as never, finalizer());
    await service.requestRefund(f.reservation.id, f.userId, 'stuck');
    // Legacy state produced by the former three-attempt budget.
    await db.update(refunds).set({ status: 'failed', resultCode: 'RETRY_EXHAUSTED', retryCount: 3, failedAt: new Date() })
      .where(eq(refunds.reservationId, f.reservation.id));
    expect((await service.requestRefund(f.reservation.id, f.userId, 'again')).idempotent).toBe(true);
    // The admin preview offers this attempt for recovery with its stored quote instead of blocking it.
    expect(await service.getAdminRefundPreview(f.reservation.id)).toMatchObject({
      canRequestRefund: false,
      adminRecoveryAvailable: true,
      blockedReason: null,
      cancellationQuote: { refundableAmount: 100000 },
    });

    const healthy = provider(f.snapshot);
    let releaseCancel!: () => void;
    const blockingHealthy = { queryPayment: healthy.queryPayment, cancelPayment: vi.fn(async (...args: Parameters<typeof healthy.cancelPayment>) => {
      await new Promise<void>((resolve) => { releaseCancel = resolve; });
      return healthy.cancelPayment(...args);
    }) };
    const admin = new RefundService(db, blockingHealthy as never, finalizer()).requestAdminRefund(f.reservation.id, adminId, '재처리');
    await vi.waitFor(() => expect(blockingHealthy.cancelPayment).toHaveBeenCalledTimes(1));

    // While the admin attempt is in flight, another instance's stale sweep must not run the same refund.
    const reopened = await refundOf(f.reservation.id);
    expect(reopened).toMatchObject({ status: 'sent_to_pg', retryCount: 4 });
    const sweeper = new RefundCancelRetryWorker(db, healthy as never, finalizer());
    expect(await sweeper.recoverStaleRefunds(new Date(Date.now() + 15 * 60000))).toEqual({ found: 0, attempted: 0 });
    // A stray job for the attempt before the admin recovery is rejected as stale.
    expect(await sweeper.handleJob({ refundId: reopened.id, attempt: 4 })).toEqual({ status: 'stale_job' });

    releaseCancel();
    const result = await admin;
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect(healthy.cancelPayment).toHaveBeenCalledTimes(1);
    expect(blockingHealthy.cancelPayment.mock.calls[0]?.[1]).toBe(toss.cancelPayment.mock.calls[0]?.[1]);
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, f.reservation.id));
    expect(reservation!.status).toBe('CANCELLED');
  });

  it('reports a PG-rejected admin refund to the admin as rights restored (u03 x u14 contract)', async () => {
    const f = await purchase();
    // A definite provider rejection that left the balance untouched: RefundService restores the rights.
    const toss = provider(f.snapshot, {
      fail: () => new TossPaymentError('NOT_CANCELABLE_PAYMENT', '취소할 수 없는 결제입니다', 400),
    });
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const adminBooking = new AdminBookingService(
      db,
      { broadcastSeatUpdate: vi.fn() } as never,
      new RefundService(db, toss as never, finalizer()),
      audit as never,
    );

    const result = await adminBooking.refundBooking(f.reservation.id, adminId, 'PG 거절');

    // u14 reads rights_restored from RefundService's FAILED + canRequestRefund response.
    expect(result).toMatchObject({ outcome: 'rights_restored', currentState: 'FAILED' });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: 'refund.admin_refund',
      status: 'failed',
      after: { refund: expect.objectContaining({ outcome: 'rights_restored' }) },
    }));
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, f.reservation.id));
    expect(reservation!.status).toBe('CONFIRMED');
    const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, f.reservation.id));
    expect(items.every((item) => item.status === 'active')).toBe(true);
    expect(f.snapshot.balanceAmount).toBe(f.payment.amount);
  });

  it('refuses a refund before revoking anything when the provider balance disagrees with the ledger (#80)', async () => {
    const f = await purchase();
    f.snapshot.balanceAmount -= 52000; // refunded out of band, never recorded locally
    const toss = provider(f.snapshot);

    await expect(new RefundService(db, toss as never, finalizer()).requestAdminRefund(f.reservation.id, adminId, '잔액 불일치'))
      .rejects.toThrow('결제사 환불 잔액이 예매 기록과 다릅니다');

    expect(await db.select().from(refunds).where(eq(refunds.reservationId, f.reservation.id))).toHaveLength(0);
    const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, f.reservation.id));
    expect(items.every((item) => item.status === 'active')).toBe(true);
    const credentials = await db.select().from(tickets).where(eq(tickets.reservationId, f.reservation.id));
    expect(credentials.every((ticket) => ticket.status === 'active')).toBe(true);
    expect(toss.cancelPayment).not.toHaveBeenCalled();
  });

  it('refuses an admin refund with 503 and revokes nothing while the PG payment cannot be queried (#80, fail closed)', async () => {
    const f = await purchase();
    const toss = provider(f.snapshot);
    toss.queryPayment.mockRejectedValue(new Error('fetch failed'));
    const service = new RefundService(db, toss as never, finalizer());

    const preview = await service.getAdminRefundPreview(f.reservation.id);
    expect(preview).toMatchObject({ canRequestRefund: false, providerCheckUnavailable: true,
      blockedReason: '결제사 결제 상태를 확인하지 못했습니다. 잠시 후 미리보기를 다시 조회해주세요.' });

    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const adminBooking = new AdminBookingService(db, { broadcastSeatUpdate: vi.fn() } as never, service, audit as never);
    const request = adminBooking.refundBooking(f.reservation.id, adminId, 'PG 장애 중 환불', {
      expectedRefundableAmount: preview.cancellationQuote!.refundableAmount,
    });
    await expect(request).rejects.toMatchObject({ status: 503 });
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'refund.admin_refund', status: 'failed' }));

    expect(toss.cancelPayment).not.toHaveBeenCalled();
    expect(await db.select().from(refunds).where(eq(refunds.reservationId, f.reservation.id))).toHaveLength(0);
    const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, f.reservation.id));
    expect(items.every((item) => item.status === 'active')).toBe(true);
    const credentials = await db.select().from(tickets).where(eq(tickets.reservationId, f.reservation.id));
    expect(credentials.length).toBeGreaterThan(0);
    expect(credentials.every((ticket) => ticket.status === 'active')).toBe(true);

    // Once the PG answers again the same refund goes through.
    toss.queryPayment.mockImplementation(async () => structuredClone(f.snapshot));
    const result = await adminBooking.refundBooking(f.reservation.id, adminId, 'PG 복구 후 환불', {
      expectedRefundableAmount: preview.cancellationQuote!.refundableAmount,
    });
    expect(result.outcome).toBe('completed');
  });

  it('cancels a 0 KRW tier locally for both full and single-seat cancellation (#82)', async () => {
    const full = await purchase({ price: 0 });
    const toss = provider(full.snapshot);
    const result = await new RefundService(db, toss as never, finalizer()).requestRefund(full.reservation.id, full.userId, '초대권 취소');
    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect(toss.cancelPayment).not.toHaveBeenCalled();
    expect(await refundOf(full.reservation.id)).toMatchObject({ status: 'completed', resultCode: 'NO_PROVIDER_REFUND' });
    const [payment] = await db.select().from(payments).where(eq(payments.id, full.payment.id));
    expect(payment!.status).toBe('DONE');
    const [reservation] = await db.select().from(reservations).where(eq(reservations.id, full.reservation.id));
    expect(reservation!.status).toBe('CANCELLED');

    const single = await purchase({ price: 0 });
    const singleToss = provider(single.snapshot);
    const gateway = { broadcastSeatUpdate: vi.fn() };
    const buyer = new ReservationService(db, singleToss as never, {} as never, gateway as never, {} as never, {} as never,
      qr, undefined, undefined, finalizer());
    const preview = await buyer.getTicketItemCancellationPreview(single.reservation.id, single.items[0]!.id, single.userId);
    expect(preview).toMatchObject({ refundableAmount: 0, canRequestRefund: true, providerRefund: { amountMinor: 0 } });
    await buyer.cancelTicketItem(single.reservation.id, single.items[0]!.id, single.userId, '한 좌석 취소');
    const [cancelled] = await db.select().from(ticketItems).where(eq(ticketItems.id, single.items[0]!.id));
    expect(cancelled).toMatchObject({ status: 'cancelled', refundableAmount: 0, cancellationCommand: null });
    expect((await seat(single.showtime.id, '1F:A-1')).status).toBe('available');
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith(single.showtime.id, '1F:A-1', 'available');
    expect(singleToss.cancelPayment).not.toHaveBeenCalled();
    expect(singleToss.queryPayment).not.toHaveBeenCalled();
  });

  it('allows only the admin full refund override after the cancellation window, on the show day (#23)', async () => {
    const showtimeAt = new Date(Date.now() + 3 * 3600000);
    const f = await purchase({ showtimeAt, cancelDeadline: new Date(Date.now() - 3600000) });
    const toss = provider(f.snapshot);
    const service = new RefundService(db, toss as never, finalizer());

    await expect(service.requestRefund(f.reservation.id, f.userId, 'late')).rejects.toThrow('취소 마감시간이 지났습니다');
    await expect(service.requestAdminRefund(f.reservation.id, adminId, 'default', {}))
      .rejects.toThrow('전액 환불(override)');
    const result = await service.requestAdminRefund(f.reservation.id, adminId, '공연 취소', { fullRefundOverride: true });

    expect(result.refundTimeline?.currentState).toBe('COMPLETED');
    expect(toss.cancelPayment).toHaveBeenCalledWith(f.payment.paymentKey, expect.any(String), expect.not.objectContaining({ cancelAmount: expect.anything() }));
    expect(f.snapshot.balanceAmount).toBe(0);
  });

  it('restores rights past the idempotency window and refunds only after the admin reviews the new quote (#53)', async () => {
    const f = await purchase();
    const toss = provider(f.snapshot, { fail: () => new TossPaymentError('FAILED_REFUND_PROCESS', '은행 응답 지연') });
    const service = new RefundService(db, toss as never, finalizer());
    await service.requestRefund(f.reservation.id, f.userId, 'stuck');
    await db.update(refunds).set({ status: 'failed', resultCode: 'RETRY_EXHAUSTED', retryCount: 3, failedAt: new Date() })
      .where(eq(refunds.reservationId, f.reservation.id));
    const storedQuote = (await refundOf(f.reservation.id)).providerMetadata as { cancellationQuote: { refundableAmount: number } };
    expect(storedQuote.cancellationQuote.refundableAmount).toBe(100000);

    // 16 days later: the frozen command can no longer be resent and the fee schedule has moved on.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 16 * 86400000));
    try {
      const healthy = provider(f.snapshot);
      const admin = new RefundService(db, healthy as never, finalizer());

      await expect(admin.requestAdminRefund(f.reservation.id, adminId, '재처리'))
        .rejects.toThrow('환불 미리보기를 다시 확인한 뒤 환불을 요청해주세요');
      expect(healthy.cancelPayment).not.toHaveBeenCalled();
      const restored = await refundOf(f.reservation.id);
      expect(restored).toMatchObject({ status: 'failed', resultCode: 'REFUND_RETRY_WINDOW_EXPIRED' });
      expect((restored.providerMetadata as Record<string, unknown>).rightsRestoredAt).toEqual(expect.any(String));
      const items = await db.select().from(ticketItems).where(eq(ticketItems.reservationId, f.reservation.id));
      expect(items.every((item) => item.status === 'active')).toBe(true);
      const credentials = await db.select().from(tickets).where(eq(tickets.reservationId, f.reservation.id));
      expect(credentials.every((ticket) => ticket.status === 'active')).toBe(true);

      // The refreshed preview shows the fee now due (booking day 8+): 2 x (50,000 - 4,000).
      const preview = await admin.getAdminRefundPreview(f.reservation.id);
      expect(preview).toMatchObject({ canRequestRefund: true, cancellationQuote: { refundableAmount: 92000 } });
      const result = await admin.requestAdminRefund(f.reservation.id, adminId, '재처리', { expectedRefundableAmount: 92000 });
      expect(result.refundTimeline?.currentState).toBe('COMPLETED');
      expect(healthy.cancelPayment).toHaveBeenCalledTimes(1);
      expect(healthy.cancelPayment.mock.calls[0]?.[2]).toMatchObject({ cancelAmount: 92000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the payment approval day for a single-seat cancellation across midnight (#83)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T15:10:00.000Z')); // 2026-07-02 00:10 KST
    try {
      const f = await purchase({
        bookedAt: new Date('2026-07-01T14:57:00.000Z'), // seat selected 2026-07-01 23:57 KST
        paidAt: new Date('2026-07-01T15:03:00.000Z'), // approved 2026-07-02 00:03 KST
        showtimeAt: new Date('2026-08-01T10:00:00.000Z'),
      });
      const toss = provider(f.snapshot);
      const buyer = new ReservationService(db, toss as never, {} as never, { broadcastSeatUpdate: vi.fn() } as never,
        {} as never, {} as never, qr, undefined, undefined, finalizer());

      const preview = await buyer.getTicketItemCancellationPreview(f.reservation.id, f.items[0]!.id, f.userId);
      expect(preview).toMatchObject({ refundableAmount: 52000, cancellationQuote: { policyCodes: ['SAME_DAY_BEFORE_MIDNIGHT'] } });

      await buyer.cancelTicketItem(f.reservation.id, f.items[0]!.id, f.userId, '당일 취소');
      const [cancelled] = await db.select().from(ticketItems).where(eq(ticketItems.id, f.items[0]!.id));
      expect(cancelled).toMatchObject({ status: 'cancelled', cancellationFee: 0, serviceFeeRefund: 2000, refundableAmount: 52000 });
      expect(toss.cancelPayment).toHaveBeenCalledWith(f.payment.paymentKey, expect.any(String),
        expect.objectContaining({ cancelAmount: 52000 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off a stale refund the sweep cannot move so it does not starve the others (#53)', async () => {
    const f = await purchase();
    await new RefundService(db, provider(f.snapshot, { fail: () => new TossPaymentError('COMMON_ERROR', '일시적인 오류') }) as never,
      finalizer()).requestRefund(f.reservation.id, f.userId, 'poison');
    const refund = await refundOf(f.reservation.id);
    expect(refund.status).toBe('sent_to_pg');
    const worker = new RefundCancelRetryWorker(db, provider(f.snapshot) as never, finalizer());
    const handleSpy = vi.spyOn(worker, 'handleJob').mockRejectedValue(new Error('poison row'));
    const runsFor = () => handleSpy.mock.calls.filter(([payload]) => payload.refundId === refund.id).length;

    const firstSweepAt = new Date(Date.now() + 15 * 60000);
    await worker.recoverStaleRefunds(firstSweepAt);
    expect(runsFor()).toBe(1);
    await worker.recoverStaleRefunds(firstSweepAt);
    expect(runsFor()).toBe(1);
    const deferred = await refundOf(f.reservation.id);
    expect((deferred.providerMetadata as { refundCancelRetry: { nextAttemptAt: string } }).refundCancelRetry.nextAttemptAt)
      .toBe(new Date(firstSweepAt.getTime() + 30 * 60000).toISOString());

    await worker.recoverStaleRefunds(new Date(firstSweepAt.getTime() + 41 * 60000));
    expect(runsFor()).toBe(2);

    // Leave no non-terminal refund behind for other cases.
    handleSpy.mockRestore();
    await db.update(refunds).set({ status: 'failed' }).where(eq(refunds.id, refund.id));
  });
});
