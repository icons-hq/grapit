import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import * as schema from '../src/database/schema/index.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import {
  countBuyerActiveTicketsForPerformance,
  getTicketLimitSnapshot,
  lockTicketLimitScope,
} from '../src/database/ticket-limit.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../src/database/included-benefit-entitlements.js';
import { restoreCancellationPendingBenefitEntitlements } from '../src/database/benefit-entitlement-restoration.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { ReservationService } from '../src/modules/reservation/reservation.service.js';
import { RefundService } from '../src/modules/refund/refund.service.js';
import { PaymentCancellationFinalizerService } from '../src/modules/cancellation/payment-cancellation-finalizer.service.js';

const {
  users, venues, performances, showtimes, reservations, payments, ticketItems,
  ticketBenefitConfigurations, ticketBenefits, ticketBenefitRuns, ticketBenefitEntitlements,
} = schema;

const COPY = {
  ko: { name: '혜택', description: '혜택' },
  en: { name: 'Benefit', description: 'Benefit' },
  th: { name: 'Benefit', description: 'Benefit' },
  'zh-CN': { name: 'Benefit', description: 'Benefit' },
};

// Never reads DATABASE_URL. Every test uses the disposable container created below.
describe('Reservation gates — PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let qr: QrTicketService;
  let adminId: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'reservation_gates_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'reservation_gates_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    qr = new QrTicketService(db, new ConfigService({
      QR_TICKET_SECRET: 'isolated-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'test-v1', FRONTEND_URL: 'https://example.test',
    }), new JwtService(), { sendTicketEmail: vi.fn() } as never, { isAvailable: false } as never);
    adminId = (await user('+821099990000', true)).id;
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function user(phone: string, isPhoneVerified: boolean) {
    const id = randomUUID();
    const [created] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Buyer', phone,
      gender: 'unspecified', birthDate: '1990-01-01', isPhoneVerified, isEmailVerified: true }).returning();
    return created!;
  }

  async function performanceWithShowtime(maxTicketsPerUser = 1) {
    const [venue] = await db.insert(venues).values({ name: `Venue-${randomUUID()}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Gate fixture', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    await db.insert(schema.bookingPolicies).values({ performanceId: performance!.id, maxTicketsPerUser });
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id,
      dateTime: new Date('2099-01-01T10:00:00.000Z') }).returning();
    return { performanceId: performance!.id, showtimeId: showtime!.id };
  }

  async function confirmedPurchase(userId: string, showtimeId: string, seatKeys: string[], options: {
    createdAt?: Date;
  } = {}) {
    const id = randomUUID();
    const amount = seatKeys.length * 52000;
    const [reservation] = await db.insert(reservations).values({ userId, showtimeId,
      reservationNumber: id.slice(0, 28), tossOrderId: `GRP-${id}`, status: 'CONFIRMED', totalAmount: amount,
      cancelDeadline: new Date('2098-12-31'), createdAt: options.createdAt ?? new Date() }).returning();
    const [payment] = await db.insert(payments).values({ reservationId: reservation!.id, paymentKey: randomUUID(),
      tossOrderId: reservation!.tossOrderId!, method: 'CARD', amount, status: 'DONE' }).returning();
    const items = await db.insert(ticketItems).values(seatKeys.map((seatKey, index) => ({
      reservationId: reservation!.id, paymentId: payment!.id, showtimeId, seatId: seatKey, seatKey,
      floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: String(index + 1),
      price: 50000, serviceFee: 2000,
    }))).returning();
    await qr.ensureIssuedTicketsForReservation({ reservationId: reservation!.id, paymentId: payment!.id });
    return { reservationId: reservation!.id, paymentId: payment!.id, items };
  }

  function rendered(query: SQL) {
    return new PgDialect().sqlToQuery(query);
  }

  describe('per-person ticket limit by verified phone (audit #62)', () => {
    it('sums confirmed tickets across accounts that verified the same phone in different formats', async () => {
      const { performanceId, showtimeId } = await performanceWithShowtime(1);
      const first = await user('+821055551234', true);
      const sameNumberLocal = await user('010-5555-1234', true);
      const sameNumberTrunk = await user('+82 (0)10 5555 1234', true);
      const unverifiedSameNumber = await user('01055551234', false);
      const otherNumberSameSuffix = await user('+66855551234', true);
      await confirmedPurchase(first.id, showtimeId, ['1F:A-1']);

      await expect(countBuyerActiveTicketsForPerformance(db, sameNumberLocal.id, performanceId)).resolves.toBe(1);
      await expect(countBuyerActiveTicketsForPerformance(db, sameNumberTrunk.id, performanceId)).resolves.toBe(1);
      await expect(countBuyerActiveTicketsForPerformance(db, unverifiedSameNumber.id, performanceId)).resolves.toBe(0);
      await expect(countBuyerActiveTicketsForPerformance(db, otherNumberSameSuffix.id, performanceId)).resolves.toBe(0);
      await expect(getTicketLimitSnapshot(db, sameNumberLocal.id, randomUUID(), showtimeId))
        .resolves.toEqual({ performanceId, maxTicketsPerUser: 1, activeTicketCount: 1 });
    });

    it('excludes the reservation being confirmed and other performances', async () => {
      const { performanceId, showtimeId } = await performanceWithShowtime(2);
      const other = await performanceWithShowtime(2);
      const buyer = await user('+821066661234', true);
      const linked = await user('010-6666-1234', true);
      const own = await confirmedPurchase(buyer.id, showtimeId, ['1F:B-1']);
      await confirmedPurchase(linked.id, other.showtimeId, ['1F:B-1']);

      await expect(getTicketLimitSnapshot(db, buyer.id, own.reservationId, showtimeId))
        .resolves.toEqual({ performanceId, maxTicketsPerUser: 2, activeTicketCount: 0 });
      await expect(countBuyerActiveTicketsForPerformance(db, linked.id, performanceId)).resolves.toBe(1);
    });

    it('serializes confirm-time limit checks of every account sharing a verified phone', async () => {
      const { performanceId } = await performanceWithShowtime(1);
      const first = await user('+821077771234', true);
      const second = await user('010-7777-1234', true);
      const unverified = await user('+821077771234', false);
      const executor = (client: import('pg').PoolClient) => ({
        execute: async (query: SQL) => {
          const { sql, params } = rendered(query);
          return client.query(sql, params);
        },
      });
      const holder = await pool.connect();
      const contender = await pool.connect();
      const independent = await pool.connect();
      try {
        await holder.query('BEGIN');
        await lockTicketLimitScope(executor(holder) as never, first.id, performanceId);

        await contender.query('BEGIN');
        await contender.query("SET LOCAL lock_timeout = '300ms'");
        await expect(lockTicketLimitScope(executor(contender) as never, second.id, performanceId))
          .rejects.toMatchObject({ code: '55P03' });

        await independent.query('BEGIN');
        await independent.query("SET LOCAL lock_timeout = '300ms'");
        await expect(lockTicketLimitScope(executor(independent) as never, unverified.id, performanceId))
          .resolves.toBeUndefined();
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        await contender.query('ROLLBACK').catch(() => undefined);
        await independent.query('ROLLBACK').catch(() => undefined);
        holder.release();
        contender.release();
        independent.release();
      }
    });

    it('looks linked accounts up through idx_users_verified_phone_suffix', async () => {
      const { performanceId } = await performanceWithShowtime(1);
      const buyer = await user('+821088881234', true);
      let captured: SQL | undefined;
      await countBuyerActiveTicketsForPerformance({
        execute: async (query: SQL) => { captured = query; return db.execute(query); },
      } as never, buyer.id, performanceId);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        const { sql, params } = rendered(captured!);
        const plan = await client.query(`EXPLAIN ${sql}`, params);
        expect(plan.rows.map((row) => String(row['QUERY PLAN'])).join('\n'))
          .toContain('idx_users_verified_phone_suffix');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });

  describe('benefit restoration after a rejected cancellation (audit #84)', () => {
    async function benefitPurchase(options: { createdAt?: Date } = {}) {
      const { showtimeId } = await performanceWithShowtime(4);
      const [configuration] = await db.insert(ticketBenefitConfigurations).values({ showtimeId, version: 1 }).returning();
      await db.insert(ticketBenefits).values({ configurationId: configuration!.id, identity: 'poster',
        kind: 'included', displayCopy: COPY, eligibleTierNames: ['VIP'] });
      const buyer = await user(`+8210${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, true);
      const purchase = await confirmedPurchase(buyer.id, showtimeId, ['1F:C-1', '1F:C-2'], options);
      await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(
        tx, showtimeId, purchase.items, new Date(),
      ));
      const [run] = await db.insert(ticketBenefitRuns).values({ showtimeId, mode: 'live', status: 'completed',
        configurationSnapshot: {}, seedRef: 'run-1', randomSeedInternal: 'run-1', actorUserId: adminId,
        confirmedAt: new Date(Date.now() - 60_000), createdAt: new Date(Date.now() - 60_000) }).returning();
      await db.insert(ticketBenefitEntitlements).values(purchase.items.map((item) => ({
        showtimeId, ticketItemId: item.id, benefitIdentity: 'photo', benefitKind: 'limited' as const,
        displayCopySnapshot: COPY, source: 'live_run' as const, runId: run!.id, state: 'active' as const,
      })));
      return { showtimeId, buyer, ...purchase, firstItem: purchase.items[0]!, secondItem: purchase.items[1]! };
    }

    /** What runLive + a configuration save do while the item is cancellation_pending. */
    async function replaceBenefitsWhilePending(showtimeId: string, activeItemId: string) {
      const now = new Date();
      const [run] = await db.insert(ticketBenefitRuns).values({ showtimeId, mode: 'live', status: 'completed',
        configurationSnapshot: {}, seedRef: 'run-2', randomSeedInternal: 'run-2', actorUserId: adminId,
        confirmedAt: now, createdAt: now }).returning();
      await db.update(ticketBenefitEntitlements).set({ state: 'inactive', inactiveReason: 'replaced_by_live_run' })
        .where(and(eq(ticketBenefitEntitlements.showtimeId, showtimeId),
          eq(ticketBenefitEntitlements.benefitKind, 'limited'), eq(ticketBenefitEntitlements.state, 'active')));
      await db.insert(ticketBenefitEntitlements).values({ showtimeId, ticketItemId: activeItemId,
        benefitIdentity: 'photo', benefitKind: 'limited', displayCopySnapshot: COPY, source: 'live_run',
        runId: run!.id, state: 'active' });
      const [configuration] = await db.insert(ticketBenefitConfigurations).values({ showtimeId, version: 2 }).returning();
      await db.insert(ticketBenefits).values({ configurationId: configuration!.id, identity: 'sticker',
        kind: 'included', displayCopy: COPY, eligibleTierNames: ['VIP'] });
    }

    async function rightsOf(ticketItemId: string) {
      return db.select({
        identity: ticketBenefitEntitlements.benefitIdentity,
        kind: ticketBenefitEntitlements.benefitKind,
        state: ticketBenefitEntitlements.state,
        inactiveReason: ticketBenefitEntitlements.inactiveReason,
      }).from(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, ticketItemId));
    }

    function buyerCancellations(provider: unknown) {
      return new ReservationService(db, provider as never, {} as never, {} as never, {} as never, {} as never,
        qr, undefined, undefined, new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));
    }

    it('restores still-current rights unchanged', async () => {
      const f = await benefitPurchase();
      await db.update(ticketBenefitEntitlements).set({ state: 'inactive', inactiveReason: 'cancellation_pending' })
        .where(eq(ticketBenefitEntitlements.ticketItemId, f.firstItem.id));

      await db.transaction((tx) => restoreCancellationPendingBenefitEntitlements(tx, [f.firstItem.id], new Date()));

      expect(await rightsOf(f.firstItem.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ identity: 'poster', state: 'active', inactiveReason: null }),
        expect.objectContaining({ identity: 'photo', state: 'active', inactiveReason: null }),
      ]));
    });

    it('keeps replaced and removed rights inactive and adds new included rights on a single-item rollback', async () => {
      const f = await benefitPurchase();
      let changed = false;
      const service = buyerCancellations({
        cancelPayment: vi.fn(),
        queryPayment: vi.fn().mockImplementation(async () => {
          if (!changed) {
            changed = true;
            await replaceBenefitsWhilePending(f.showtimeId, f.secondItem.id);
          }
          return { status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: false };
        }),
      });

      await expect(service.cancelTicketItem(f.reservationId, f.firstItem.id, f.buyer.id, 'Cancel one'))
        .rejects.toThrow('부분취소를 지원하지 않습니다');

      const rights = await rightsOf(f.firstItem.id);
      expect(rights).toEqual(expect.arrayContaining([
        expect.objectContaining({ identity: 'photo', state: 'inactive', inactiveReason: 'replaced_by_live_run' }),
        expect.objectContaining({ identity: 'poster', state: 'inactive', inactiveReason: 'configuration_changed' }),
        expect.objectContaining({ identity: 'sticker', state: 'active' }),
      ]));
      const activeLimited = await db.select({ id: ticketBenefitEntitlements.id }).from(ticketBenefitEntitlements)
        .where(and(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId),
          eq(ticketBenefitEntitlements.benefitKind, 'limited'), eq(ticketBenefitEntitlements.state, 'active')));
      expect(activeLimited).toHaveLength(1);
      const [item] = await db.select({ status: ticketItems.status }).from(ticketItems)
        .where(eq(ticketItems.id, f.firstItem.id));
      expect(item?.status).toBe('active');
    });

    it('applies the same validation when a whole-reservation refund is definitively rejected', async () => {
      const f = await benefitPurchase({ createdAt: new Date(Date.now() - 2 * 86400000) });
      await db.insert(schema.seatInventories).values(f.items.map((item) => ({ showtimeId: f.showtimeId,
        seatId: item.seatId, seatKey: item.seatKey, floorKey: item.floorKey, status: 'sold' as const })));
      let changed = false;
      const otherBuyer = await user(`+8210${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, true);
      const other = await confirmedPurchase(otherBuyer.id, f.showtimeId, ['1F:D-1']);
      const provider = {
        cancelPayment: vi.fn(),
        queryPayment: vi.fn().mockImplementation(async () => {
          if (!changed) {
            changed = true;
            await replaceBenefitsWhilePending(f.showtimeId, other.items[0]!.id);
          }
          return { status: 'DONE', totalAmount: 104000, balanceAmount: 104000, isPartialCancelable: false };
        }),
      };
      const refunds = new RefundService(db, provider as never,
        new PaymentCancellationFinalizerService(db, { isAvailable: false } as never));

      const rejected = await refunds.requestRefund(f.reservationId, f.buyer.id, 'Cancellation');
      expect(rejected.refundTimeline?.currentState).toBe('FAILED');

      const restored = await db.select({
        ticketItemId: ticketBenefitEntitlements.ticketItemId,
        identity: ticketBenefitEntitlements.benefitIdentity,
        state: ticketBenefitEntitlements.state,
        inactiveReason: ticketBenefitEntitlements.inactiveReason,
      }).from(ticketBenefitEntitlements)
        .where(inArray(ticketBenefitEntitlements.ticketItemId, f.items.map((item) => item.id)));
      for (const item of f.items) {
        const rights = restored.filter((right) => right.ticketItemId === item.id);
        expect(rights).toEqual(expect.arrayContaining([
          expect.objectContaining({ identity: 'photo', state: 'inactive', inactiveReason: 'replaced_by_live_run' }),
          expect.objectContaining({ identity: 'poster', state: 'inactive', inactiveReason: 'configuration_changed' }),
          expect.objectContaining({ identity: 'sticker', state: 'active' }),
        ]));
      }
      expect(provider.cancelPayment).not.toHaveBeenCalled();
    });
  });
});
