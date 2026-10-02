import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

  const HOUR_MS = 3_600_000;

  async function pendingReservation(
    userId: string,
    showtimeId: string,
    options: {
      status?: 'PENDING_PAYMENT' | 'FAILED';
      deadlineInMs?: number | null;
      lastChangedHoursAgo?: number;
      provider?: 'CARD' | 'ALIPAY_PLUS';
      paymentStatus?: 'READY' | 'IN_PROGRESS' | 'DONE' | 'ABORTED' | 'EXPIRED';
    } = {},
  ) {
    const id = randomUUID();
    const changedAt = new Date(Date.now() - (options.lastChangedHoursAgo ?? 0) * HOUR_MS);
    const provider = options.provider ?? 'CARD';
    const [reservation] = await db.insert(schema.reservations).values({
      userId,
      showtimeId,
      reservationNumber: id.slice(0, 28),
      tossOrderId: id,
      status: options.status ?? 'PENDING_PAYMENT',
      totalAmount: 50_000,
      paymentDeadlineAt: options.deadlineInMs === null
        ? null
        : new Date(Date.now() + (options.deadlineInMs ?? 7 * 60_000)),
      checkoutPaymentMethod: {
        method: provider === 'CARD' ? 'CARD' : 'FOREIGN_EASY_PAY',
        provider,
      },
      checkoutStartedAt: changedAt,
      cancelDeadline: new Date('2098-12-31'),
      createdAt: changedAt,
      updatedAt: changedAt,
    }).returning();
    if (options.paymentStatus) {
      await db.insert(schema.payments).values({
        reservationId: reservation!.id,
        paymentKey: id,
        tossOrderId: id,
        method: provider === 'CARD' ? 'CARD' : 'FOREIGN_EASY_PAY',
        provider,
        amount: 50_000,
        status: options.paymentStatus,
        createdAt: changedAt,
      });
    }
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

  it('keeps a group whose target is mid-checkout out of the batch and merges the other safe groups', async () => {
    const { showtimeId } = await showtime();
    const checkoutSource = await buyer('Hong', '+821012345678');
    const checkoutTarget = await buyer('Hong', '+821012345678');
    await confirmedTicket(checkoutTarget, showtimeId, 'A-1');
    const pendingId = await pendingReservation(checkoutTarget, showtimeId);
    const safeSource = await buyer('Seo', '+821033334444');
    const safeTarget = await buyer('Seo', '+821033334444');
    await confirmedTicket(safeTarget, showtimeId, 'A-2');

    const dryRun = await service.dryRun();
    expect(dryRun.safeGroups).toEqual([
      expect.objectContaining({ targetUserId: safeTarget, sourceUserIds: [safeSource] }),
    ]);
    expect(dryRun.manualReviewGroups).toEqual([
      expect.objectContaining({
        reason: 'payment_in_flight',
        userIds: [checkoutSource, checkoutTarget].sort(),
      }),
    ]);

    const result = await service.apply(applyOptions(hashAccountMergeDryRun(dryRun)));

    expect(result).toMatchObject({ mergedGroups: 1, mergedSourceUsers: 1 });
    const [mergedSource] = await db.select().from(schema.users)
      .where(eq(schema.users.id, safeSource));
    const [untouchedSource] = await db.select().from(schema.users)
      .where(eq(schema.users.id, checkoutSource));
    const [pendingRow] = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, pendingId));
    expect(mergedSource!.accountStatus).toBe('merged');
    expect(untouchedSource!.accountStatus).toBe('active');
    expect(pendingRow!.userId).toBe(checkoutTarget);
    await expect(service.verify(result.batchId, { persist: true })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('does not let a stale pending checkout the sweeper never expires block its group', async () => {
    const { showtimeId } = await showtime();
    const source = await buyer('Han', '+821066667777');
    const target = await buyer('Han', '+821066667777');
    await confirmedTicket(target, showtimeId, 'D-1');
    // Checkout started two days ago, deadline long past, no terminal payment:
    // pending-payment-expiration.worker leaves this PENDING_PAYMENT forever.
    const staleTargetPending = await pendingReservation(target, showtimeId, {
      deadlineInMs: -48 * HOUR_MS,
      lastChangedHoursAgo: 48,
    });
    // Legacy pre-0012 row without a deadline, also never expired.
    const staleSourcePending = await pendingReservation(source, showtimeId, {
      deadlineInMs: null,
      lastChangedHoursAgo: 72,
    });

    const dryRun = await service.dryRun();
    expect(dryRun.manualReviewGroups).toEqual([]);
    expect(dryRun.safeGroups).toEqual([
      expect.objectContaining({ targetUserId: target, sourceUserIds: [source] }),
    ]);

    const result = await service.apply(applyOptions(hashAccountMergeDryRun(dryRun)));

    expect(result.mergedSourceUsers).toBe(1);
    const moved = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, staleSourcePending));
    const kept = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, staleTargetPending));
    expect(moved[0]!.userId).toBe(target);
    expect(kept[0]!.userId).toBe(target);
  });

  it('treats provider payments still progressing and recent Alipay failures as in flight, at the documented ages', async () => {
    const { showtimeId } = await showtime();
    const cases = [
      // [label, reservation options, expected in flight]
      ['paid but unconfirmed, any age', { deadlineInMs: -72 * HOUR_MS, lastChangedHoursAgo: 72, paymentStatus: 'DONE' }, true],
      ['async payment in progress', { deadlineInMs: -30 * HOUR_MS, lastChangedHoursAgo: 30, paymentStatus: 'IN_PROGRESS' }, true],
      ['checkout changed within the settle window', { deadlineInMs: -2 * HOUR_MS, lastChangedHoursAgo: 2 }, true],
      ['aborted payment, stale', { deadlineInMs: -30 * HOUR_MS, lastChangedHoursAgo: 30, paymentStatus: 'ABORTED' }, false],
      ['recent Alipay failure (late DONE can revive it)', { status: 'FAILED', provider: 'ALIPAY_PLUS', deadlineInMs: -3 * HOUR_MS, lastChangedHoursAgo: 3 }, true],
      ['old Alipay failure', { status: 'FAILED', provider: 'ALIPAY_PLUS', deadlineInMs: -30 * HOUR_MS, lastChangedHoursAgo: 30 }, false],
      ['recent card failure', { status: 'FAILED', provider: 'CARD', deadlineInMs: -1 * HOUR_MS, lastChangedHoursAgo: 1 }, false],
    ] as const;

    const expectations: Array<{ label: string; userIds: string[]; inFlight: boolean }> = [];
    for (const [index, [label, options, inFlight]] of cases.entries()) {
      const phone = `+8210700000${String(index).padStart(2, '0')}`;
      const owner = await buyer(`Case${index}`, phone);
      const other = await buyer(`Case${index}`, phone);
      await confirmedTicket(owner, showtimeId, `E-${index}`);
      await pendingReservation(owner, showtimeId, options);
      expectations.push({ label, userIds: [owner, other].sort(), inFlight });
    }

    const dryRun = await service.dryRun();
    for (const { label, userIds, inFlight } of expectations) {
      const manual = dryRun.manualReviewGroups.find((group) =>
        group.userIds.join() === userIds.join());
      expect({ label, inFlight: manual?.reason === 'payment_in_flight' }).toEqual({
        label,
        inFlight,
      });
    }
  });

  it('stops apply before any write when a checkout starts for a safe group after its dry-run', async () => {
    const { showtimeId } = await showtime();
    const source = await buyer('Hong', '+821012345678');
    const target = await buyer('Hong', '+821012345678');
    await confirmedTicket(target, showtimeId, 'A-1');

    const dryRun = await service.dryRun();
    expect(dryRun.safeGroups).toHaveLength(1);
    await pendingReservation(target, showtimeId);

    await expect(service.apply(applyOptions(hashAccountMergeDryRun(dryRun)))).rejects.toThrow(
      'ACCOUNT_MERGE_DRY_RUN_HASH_MISMATCH',
    );
    const [sourceRow] = await db.select().from(schema.users).where(eq(schema.users.id, source));
    expect(sourceRow!.accountStatus).toBe('active');
    expect(await db.select().from(schema.accountMergeBatches)).toEqual([]);
  });

  it('refuses a group whose checkout started after the reviewed dry-run, inside the apply transaction', async () => {
    // The pre-transaction hash check cannot see this checkout: apply reuses the
    // dry-run taken before it (as when the checkout lands between apply's own
    // dry-run and its transaction). Only the locked revalidation can stop it.
    const { showtimeId } = await showtime();
    const source = await buyer('Choi', '+821044445555');
    const target = await buyer('Choi', '+821044445555');
    await confirmedTicket(target, showtimeId, 'F-1');
    // A settled card failure is not in flight; it would move to the target.
    const sourceReservation = await pendingReservation(source, showtimeId, {
      status: 'FAILED',
      provider: 'CARD',
      deadlineInMs: -HOUR_MS,
      lastChangedHoursAgo: 1,
    });
    const reviewedDryRun = await service.dryRun();
    expect(reviewedDryRun.safeGroups).toEqual([
      expect.objectContaining({ targetUserId: target, sourceUserIds: [source] }),
    ]);
    const dryRunSpy = vi.spyOn(service, 'dryRun').mockResolvedValue(reviewedDryRun);
    const pendingId = await pendingReservation(target, showtimeId, { deadlineInMs: 10 * 60_000 });

    try {
      await expect(service.apply(applyOptions(hashAccountMergeDryRun(reviewedDryRun)))).rejects.toThrow(
        `ACCOUNT_MERGE_GROUP_REVALIDATION_FAILED:payment_in_flight:target=${target}`,
      );
    } finally {
      dryRunSpy.mockRestore();
    }

    expect(await db.select().from(schema.accountMergeBatches)).toEqual([]);
    const [sourceRow] = await db.select().from(schema.users).where(eq(schema.users.id, source));
    const [targetRow] = await db.select().from(schema.users).where(eq(schema.users.id, target));
    expect(sourceRow!.accountStatus).toBe('active');
    expect(targetRow!.accountStatus).toBe('active');
    const [sourceOwned] = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, sourceReservation));
    const [pendingOwned] = await db.select().from(schema.reservations)
      .where(eq(schema.reservations.id, pendingId));
    expect(sourceOwned!.userId).toBe(source);
    expect(pendingOwned!.userId).toBe(target);
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

  it('counts live checkouts and only openings near now for the CLI gate', async () => {
    await expect(service.salesActivity()).resolves.toEqual({
      activeCheckoutReservations: 0,
      openingShowtimes: 0,
      recentOpeningHours: 2,
      lookaheadHours: 24,
    });

    // Steady on-sale performances without an opening near now do not trip
    // the gate by themselves (they used to, making the flag habitual).
    const onSale = await showtime({ status: 'selling' });
    await showtime({ status: 'selling', bookingStartsInHours: -5 });
    await showtime({ status: 'selling', bookingStartsInHours: -1 });
    await showtime({ status: 'upcoming', bookingStartsInHours: 2 });
    await showtime({ status: 'upcoming', bookingStartsInHours: 48 });
    await showtime({ status: 'upcoming', bookingStartsInHours: null });
    await showtime({ status: 'selling', publishState: 'draft', bookingStartsInHours: 1 });
    await showtime({ status: 'ended', bookingStartsInHours: 1 });
    await showtime({ status: 'selling', startsInHours: -1, bookingStartsInHours: -1 });
    const holder = await buyer('Jung', '+821022223333');
    await pendingReservation(holder, onSale.showtimeId);
    await pendingReservation(holder, onSale.showtimeId, { deadlineInMs: -10 * 60_000 });
    await pendingReservation(holder, onSale.showtimeId, {
      status: 'FAILED',
      provider: 'ALIPAY_PLUS',
      deadlineInMs: -5 * 60_000,
    });
    await pendingReservation(holder, onSale.showtimeId, {
      status: 'FAILED',
      provider: 'ALIPAY_PLUS',
      deadlineInMs: -3 * HOUR_MS,
      lastChangedHoursAgo: 3,
    });

    await expect(service.salesActivity()).resolves.toEqual({
      activeCheckoutReservations: 2,
      openingShowtimes: 2,
      recentOpeningHours: 2,
      lookaheadHours: 24,
    });
  });

  it('identifies the connected server from the server side for --expected-server', async () => {
    const identity = await service.databaseIdentity();

    expect(identity.database).toBe('account_merge_test');
    expect(identity.systemIdentifier).toMatch(/^\d+$/);
    expect(identity.fingerprint).toBe(`sysid:${identity.systemIdentifier}/account_merge_test`);
  });
});
