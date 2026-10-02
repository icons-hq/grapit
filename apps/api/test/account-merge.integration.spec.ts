import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import {
  AccountMergeService,
  type ManualMergeAllowlistEntry,
} from '../src/modules/account-merge/account-merge.service.js';
import {
  hashAccountMergeDryRun,
  hashJson,
} from '../src/modules/account-merge/account-merge-policy.js';

/**
 * Audit #104/#105 against real PostgreSQL row locks and the real migration
 * schema. Disposable container only.
 */
describe('Historical account merge safety (PostgreSQL)', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let service: AccountMergeService;
  let operatorId: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'account_merge_test' })
      .withExposedPorts(5432)
      .start();
    pool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      user: 'postgres',
      password: 'test',
      database: 'account_merge_test',
      max: 6,
    });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    service = new AccountMergeService(db);
  }, 120_000);

  afterAll(async () => {
    await closePool?.();
    await container?.stop();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate users, performances, account_merge_batches restart identity cascade`);
    operatorId = randomUUID();
    await db.insert(schema.users).values({
      id: operatorId,
      email: `${operatorId}@example.test`,
      name: 'Operator',
      role: 'admin',
      phone: '+821000000000',
      gender: 'unspecified',
      birthDate: '1980-01-01',
    });
  });

  async function buyer(name: string, phone: string, options: { verified?: boolean } = {}) {
    const id = randomUUID();
    await db.insert(schema.users).values({
      id,
      email: `${id}@example.test`,
      name,
      phone,
      gender: 'unspecified',
      birthDate: '1995-05-15',
      isPhoneVerified: options.verified ?? true,
    });
    return id;
  }

  async function showtime(options: {
    maxTicketsPerUser?: number;
    status?: 'upcoming' | 'selling' | 'closing_soon' | 'ended';
    publishState?: 'draft' | 'published';
    startsInHours?: number;
    bookingStartsInHours?: number | null;
  } = {}) {
    const [performance] = await db.insert(schema.performances).values({
      title: `Show ${randomUUID().slice(0, 8)}`,
      genre: 'concert',
      ageRating: 'All ages',
      status: options.status ?? 'selling',
      publishState: options.publishState ?? 'published',
      startDate: new Date('2099-01-01'),
      endDate: new Date('2099-01-02'),
    }).returning();
    await db.insert(schema.bookingPolicies).values({
      performanceId: performance!.id,
      maxTicketsPerUser: options.maxTicketsPerUser ?? 1,
      bookingStartsAt: options.bookingStartsInHours === undefined || options.bookingStartsInHours === null
        ? null
        : new Date(Date.now() + options.bookingStartsInHours * 3_600_000),
    });
    const [show] = await db.insert(schema.showtimes).values({
      performanceId: performance!.id,
      dateTime: new Date(Date.now() + (options.startsInHours ?? 24 * 30) * 3_600_000),
    }).returning();
    return { performanceId: performance!.id, showtimeId: show!.id };
  }

  async function confirmedTicket(userId: string, showtimeId: string, seat: string) {
    const id = randomUUID();
    const [reservation] = await db.insert(schema.reservations).values({
      userId,
      showtimeId,
      reservationNumber: id.slice(0, 28),
      tossOrderId: id,
      status: 'CONFIRMED',
      totalAmount: 50_000,
      cancelDeadline: new Date('2098-12-31'),
    }).returning();
    const [payment] = await db.insert(schema.payments).values({
      reservationId: reservation!.id,
      paymentKey: id,
      tossOrderId: id,
      method: 'CARD',
      amount: 50_000,
      status: 'DONE',
    }).returning();
    await db.insert(schema.ticketItems).values({
      reservationId: reservation!.id,
      paymentId: payment!.id,
      showtimeId,
      seatId: `1F:${seat}`,
      seatKey: `1F:${seat}`,
      floorKey: '1F',
      floorLabel: '1층',
      row: seat.split('-')[0]!,
      number: seat.split('-')[1]!,
      tierName: 'R',
      price: 48_000,
    });
    return reservation!.id;
  }

  async function pendingReservation(userId: string, showtimeId: string) {
    const id = randomUUID();
    const [reservation] = await db.insert(schema.reservations).values({
      userId,
      showtimeId,
      reservationNumber: id.slice(0, 28),
      tossOrderId: id,
      status: 'PENDING_PAYMENT',
      totalAmount: 50_000,
      paymentDeadlineAt: new Date(Date.now() + 7 * 60_000),
      cancelDeadline: new Date('2098-12-31'),
    }).returning();
    return reservation!.id;
  }

  function applyOptions(
    dryRunHash: string,
    manualAllowlist: ManualMergeAllowlistEntry[] = [],
  ) {
    return {
      operatorUserId: operatorId,
      reason: 'integration merge after dry-run review',
      backupReference: 'integration-backup',
      reportPath: '/tmp/account-merge-integration.json',
      dryRunHash,
      allowlistHash: hashJson(manualAllowlist),
      manualAllowlist,
    };
  }

  it('rolls back a safe merge whose target is mid-checkout and leaves every row in place', async () => {
    const { showtimeId } = await showtime();
    const source = await buyer('Hong', '+821012345678');
    const target = await buyer('Hong', '+821012345678');
    await confirmedTicket(target, showtimeId, 'A-1');
    const pendingId = await pendingReservation(target, showtimeId);

    const dryRun = await service.dryRun();
    expect(dryRun.safeGroups).toEqual([
      expect.objectContaining({ targetUserId: target, sourceUserIds: [source] }),
    ]);

    await expect(service.apply(applyOptions(hashAccountMergeDryRun(dryRun)))).rejects.toThrow(
      'ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:pending_payment',
    );

    const [sourceRow] = await db.select().from(schema.users).where(eq(schema.users.id, source));
    const [pendingRow] = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, pendingId));
    expect(sourceRow!.accountStatus).toBe('active');
    expect(pendingRow!.userId).toBe(target);
    expect(await db.select().from(schema.accountMergeBatches)).toEqual([]);
  });

  it('keeps both purchases on a reviewed manual merge, reports the limit overflow, and verifies', async () => {
    const { performanceId, showtimeId } = await showtime({ maxTicketsPerUser: 1 });
    const kept = await buyer('Kim', '+821055556666');
    const merged = await buyer('Kim', '+821055556666');
    await confirmedTicket(kept, showtimeId, 'B-1');
    const mergedReservation = await confirmedTicket(merged, showtimeId, 'B-2');

    const dryRun = await service.dryRun();
    expect(dryRun.manualReviewGroups).toEqual([
      expect.objectContaining({ reason: 'multiple_confirmed_owners' }),
    ]);
    const allowlist: ManualMergeAllowlistEntry[] = [{
      groupKey: dryRun.manualReviewGroups[0]!.groupKey,
      targetUserId: kept,
      sourceUserIds: [merged],
      reason: 'operator confirmed both purchases belong to one buyer',
    }];

    const result = await service.apply(applyOptions(hashAccountMergeDryRun(dryRun), allowlist));

    expect(result.ticketLimitWarnings).toEqual([{
      groupKey: allowlist[0]!.groupKey,
      targetUserId: kept,
      performanceId,
      activeTicketCount: 2,
      maxTicketsPerUser: 1,
    }]);
    const [movedReservation] = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, mergedReservation));
    expect(movedReservation!.userId).toBe(kept);

    const verification = await service.verify(result.batchId, { persist: true });
    expect(verification).toMatchObject({ ok: true, failedChecks: [] });
    const [batch] = await db.select().from(schema.accountMergeBatches);
    expect(batch!.status).toBe('verified');
  });

  it('rejects an allowlisted unverified-identity group before writing, then merges the safe group without a new dry-run', async () => {
    const { showtimeId } = await showtime();
    const safeSource = await buyer('Hong', '+821012345678');
    const safeTarget = await buyer('Hong', '+821012345678');
    await confirmedTicket(safeTarget, showtimeId, 'C-1');
    const verified = await buyer('Park', '+821077778888');
    const unverified = await buyer('Park', '+821077778888', { verified: false });
    await confirmedTicket(verified, showtimeId, 'C-2');

    const dryRun = await service.dryRun();
    const dryRunHash = hashAccountMergeDryRun(dryRun);
    const incomplete = dryRun.manualReviewGroups.find(
      (group) => group.reason === 'identity_evidence_incomplete',
    )!;
    const badAllowlist: ManualMergeAllowlistEntry[] = [{
      groupKey: incomplete.groupKey,
      targetUserId: verified,
      sourceUserIds: [unverified],
      reason: 'operator reviewed an unverified duplicate',
    }];

    await expect(service.apply(applyOptions(dryRunHash, badAllowlist))).rejects.toThrow(
      'ACCOUNT_MERGE_ALLOWLIST_IDENTITY_EVIDENCE_INCOMPLETE',
    );
    expect(await db.select().from(schema.accountMergeBatches)).toEqual([]);

    const result = await service.apply(applyOptions(dryRunHash, []));
    expect(result.mergedSourceUsers).toBe(1);
    const [sourceRow] = await db.select().from(schema.users)
      .where(eq(schema.users.id, safeSource));
    expect(sourceRow!.accountStatus).toBe('merged');
  });

  it('holds new reservations for buyers whose rows the merge has locked', async () => {
    const { showtimeId } = await showtime();
    const source = await buyer('Lee', '+821099998888');
    const merge = await pool.connect();
    const checkout = await pool.connect();
    try {
      await merge.query('begin');
      await merge.query('select id from users where id = $1 for update', [source]);

      await checkout.query('begin');
      await checkout.query("set local statement_timeout = '500ms'");
      const id = randomUUID();
      await expect(checkout.query(
        `insert into reservations
           (user_id, showtime_id, reservation_number, toss_order_id, status, total_amount, cancel_deadline)
         values ($1, $2, $3, $4, 'PENDING_PAYMENT', 50000, now() + interval '1 day')`,
        [source, showtimeId, id.slice(0, 28), id],
      )).rejects.toMatchObject({ code: '57014' });
    } finally {
      await checkout.query('rollback').catch(() => undefined);
      await merge.query('rollback').catch(() => undefined);
      checkout.release();
      merge.release();
    }
  });

  it('counts live checkouts and open or soon-opening sales for the CLI gate', async () => {
    await expect(service.salesActivity()).resolves.toEqual({
      activeCheckoutReservations: 0,
      openOrOpeningShowtimes: 0,
      lookaheadHours: 24,
    });

    const open = await showtime({ status: 'selling' });
    await showtime({ status: 'upcoming', bookingStartsInHours: 2 });
    await showtime({ status: 'upcoming', bookingStartsInHours: 48 });
    await showtime({ status: 'upcoming', bookingStartsInHours: null });
    await showtime({ status: 'selling', publishState: 'draft' });
    await showtime({ status: 'ended' });
    await showtime({ status: 'selling', startsInHours: -1 });
    const holder = await buyer('Jung', '+821022223333');
    await pendingReservation(holder, open.showtimeId);

    await expect(service.salesActivity()).resolves.toEqual({
      activeCheckoutReservations: 1,
      openOrOpeningShowtimes: 2,
      lookaheadHours: 24,
    });
  });
});
