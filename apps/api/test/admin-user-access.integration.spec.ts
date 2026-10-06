import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema/index.js';
import {
  adminAuditLogs,
  performances,
  reservations,
  showtimes,
  socialAccounts,
  supportThreads,
  users,
  venues,
} from '../src/database/schema/index.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { AdminOperationsService } from '../src/modules/admin/admin-operations.service.js';
import { AdminUserService } from '../src/modules/admin/admin-user.service.js';
import { lockActiveBuyerAccount } from '../src/modules/reservation/reservation.service.js';
import { UserRepository } from '../src/modules/user/user.repository.js';
import { UserService } from '../src/modules/user/user.service.js';

/**
 * AdminUserService against real Postgres 16 + migrations.
 *
 * - audit #44: admin withdrawal is blocked by PENDING_PAYMENT or a CONFIRMED
 *   reservation whose showtime has not started (real timestamp comparison and
 *   rollback, not mocks).
 * - audit #122: scanner bundle rows are reported as `scanner`.
 * - audit #42: the admin bundle is persisted canonically.
 * - audit #44 race: withdrawal locks the users row FOR UPDATE and reservation
 *   prepare re-reads account_status FOR KEY SHARE, exercised with two real
 *   connections in both orders.
 *
 * 실행: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/admin-user-access.integration.spec.ts
 */
describe('AdminUserService access and withdrawal (integration)', () => {
  let pgContainer: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: NodePgDatabase<typeof schema>;
  let service: AdminUserService;
  let userService: UserService;

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ image: 'postgres:16', database: 'grabit_test' });
    pgContainer = postgres.container;

    pool = new Pool({
      host: postgres.host,
      port: postgres.port,
      user: 'postgres',
      password: 'test',
      database: 'grabit_test',
    });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    service = new AdminUserService(db as never, new AdminAuditService(db as never));
    userService = new UserService(
      new UserRepository(db as never),
      {} as never,
      db as never,
      new AdminAuditService(db as never),
    );
  }, 180_000);

  afterAll(async () => {
    await closePool?.();
    await pgContainer?.stop();
  });

  beforeEach(async () => {
    await db.delete(adminAuditLogs);
    await db.delete(supportThreads);
    await db.delete(reservations);
    await db.delete(showtimes);
    await db.delete(performances);
    await db.delete(venues);
    await db.delete(socialAccounts);
    await db.delete(users);
  });

  async function seedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      email: `user-${id.slice(0, 8)}@test.com`,
      name: `User ${id.slice(0, 4)}`,
      phone: `+8210${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      gender: 'unspecified',
      birthDate: '1990-01-01',
      role: 'user',
      ...overrides,
    });
    return id;
  }

  async function seedShowtime(offsetMs: number) {
    const venueId = randomUUID();
    await db.insert(venues).values({ id: venueId, name: `Venue-${venueId.slice(0, 8)}` });
    const performanceId = randomUUID();
    await db.insert(performances).values({
      id: performanceId,
      title: 'Withdrawal Test Show',
      genre: 'artist_celebrity',
      venueId,
      ageRating: '전체관람가',
      status: 'selling',
      startDate: new Date(Date.now() - 30 * 86_400_000),
      endDate: new Date(Date.now() + 30 * 86_400_000),
    });
    const showtimeId = randomUUID();
    await db.insert(showtimes).values({
      id: showtimeId,
      performanceId,
      dateTime: new Date(Date.now() + offsetMs),
    });
    return showtimeId;
  }

  async function seedReservation(
    userId: string,
    showtimeId: string,
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'FAILED',
  ) {
    const id = randomUUID();
    await db.insert(reservations).values({
      id,
      userId,
      showtimeId,
      reservationNumber: `R${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      status,
      totalAmount: 50_000,
      cancelDeadline: new Date(Date.now() + 86_400_000),
    });
    return id;
  }

  async function seedSuperuser() {
    return seedUser({ role: 'admin', adminCapabilityBundle: 'admin', adminCapabilities: [] });
  }

  async function seedBuyerWithSocialLink() {
    const buyerId = await seedUser();
    await db.insert(socialAccounts).values({
      userId: buyerId,
      provider: 'kakao',
      providerId: `kakao-${buyerId}`,
    });
    return buyerId;
  }

  async function expectStillActive(buyerId: string) {
    const [row] = await db.select().from(users).where(eq(users.id, buyerId));
    expect(row?.accountStatus ?? 'active').toBe('active');
    const links = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, buyerId));
    expect(links).toHaveLength(1);
    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.resourceId, buyerId));
    expect(audits).toHaveLength(0);
  }

  it('blocks withdrawal while a payment is in progress and keeps the account untouched', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const showtimeId = await seedShowtime(7 * 86_400_000);
    await seedReservation(buyerId, showtimeId, 'PENDING_PAYMENT');

    const error = await service
      .withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ACCOUNT_WITHDRAWAL_BLOCKED',
      blockers: [{ key: 'pending_payment_reservations', count: 1 }],
    });
    await expectStillActive(buyerId);
  });

  it('blocks withdrawal while a confirmed ticket is for a showtime that has not started', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const upcoming = await seedShowtime(60 * 60_000);
    await seedReservation(buyerId, upcoming, 'CONFIRMED');

    await expect(
      service.withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true }),
    ).rejects.toThrow(/관람 예정 확정 예매 1건/);
    await expectStillActive(buyerId);
  });

  it('withdraws members whose tickets are past or cancelled', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const past = await seedShowtime(-60 * 60_000);
    const upcoming = await seedShowtime(7 * 86_400_000);
    await seedReservation(buyerId, past, 'CONFIRMED');
    await seedReservation(buyerId, upcoming, 'CANCELLED');
    await seedReservation(buyerId, upcoming, 'FAILED');

    await service.withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true });

    const [row] = await db.select().from(users).where(eq(users.id, buyerId));
    expect(row?.accountStatus).toBe('withdrawn');
    expect(row?.withdrawalSource).toBe('admin');
    const links = await db.select().from(socialAccounts).where(eq(socialAccounts.userId, buyerId));
    expect(links).toHaveLength(0);
    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.resourceId, buyerId));
    expect(audits.map((audit) => audit.action)).toEqual(['user.withdraw']);
  });

  async function waitForLockWaiters(expected: number) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ waiting: number }>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if ((rows[0]?.waiting ?? 0) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`expected ${expected} session(s) waiting on a lock`);
  }

  /**
   * The statements reservation prepare runs inside its transaction, on a
   * dedicated connection that stays open until the test commits or rolls back.
   */
  async function beginPrepare(buyerId: string, showtimeId: string) {
    const client: PoolClient = await pool.connect();
    await client.query('BEGIN');
    const prepareDb = drizzle(client, { schema });
    const done = (async () => {
      await lockActiveBuyerAccount(prepareDb as never, buyerId);
      await prepareDb.insert(reservations).values({
        userId: buyerId,
        showtimeId,
        reservationNumber: `R${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        status: 'PENDING_PAYMENT',
        totalAmount: 50_000,
        cancelDeadline: new Date(Date.now() + 86_400_000),
        paymentDeadlineAt: new Date(Date.now() + 600_000),
      });
    })();
    // Surface the outcome only when the test awaits it.
    done.catch(() => undefined);
    let open = true;
    const finish = async (statement: 'COMMIT' | 'ROLLBACK') => {
      if (!open) return;
      open = false;
      try {
        await client.query(statement);
      } finally {
        client.release();
      }
    };
    return { done, commit: () => finish('COMMIT'), rollback: () => finish('ROLLBACK') };
  }

  it('makes a prepare that waited on an in-flight admin withdrawal fail instead of creating a payment', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const showtimeId = await seedShowtime(7 * 86_400_000);
    // Holds the withdrawal transaction open after it locked and updated the
    // users row: its social_accounts DELETE waits for this row lock.
    const holder = await pool.connect();
    let holderOpen = true;
    const releaseHolder = async () => {
      if (!holderOpen) return;
      holderOpen = false;
      await holder.query('ROLLBACK');
      holder.release();
    };
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM social_accounts WHERE user_id = $1 FOR UPDATE', [buyerId]);

    const withdrawal = service
      .withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true })
      .catch((caught: unknown) => caught);
    let prepare: Awaited<ReturnType<typeof beginPrepare>> | undefined;
    try {
      await waitForLockWaiters(1);
      prepare = await beginPrepare(buyerId, showtimeId);
      // Prepare waits on the withdrawal's users row lock instead of inserting.
      await waitForLockWaiters(2);

      await releaseHolder();
      expect(await withdrawal).not.toBeInstanceOf(Error);
      const error = await prepare.done.catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('탈퇴 처리된 계정입니다');
    } finally {
      await releaseHolder();
      await withdrawal;
      await prepare?.rollback();
    }

    const [row] = await db.select().from(users).where(eq(users.id, buyerId));
    expect(row?.accountStatus).toBe('withdrawn');
    await expect(db.select().from(reservations).where(eq(reservations.userId, buyerId))).resolves.toHaveLength(0);
  });

  it('blocks an admin withdrawal that waited for a prepare which committed a pending payment', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const showtimeId = await seedShowtime(7 * 86_400_000);
    const prepare = await beginPrepare(buyerId, showtimeId);
    let withdrawal: Promise<unknown> | undefined;
    try {
      await prepare.done;
      withdrawal = service
        .withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true })
        .catch((caught: unknown) => caught);
      // FOR UPDATE on the users row waits for the prepare's FOR KEY SHARE.
      await waitForLockWaiters(1);
      await prepare.commit();
    } finally {
      await prepare.rollback();
    }
    const error = await withdrawal;

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'ACCOUNT_WITHDRAWAL_BLOCKED',
      blockers: [{ key: 'pending_payment_reservations', count: 1 }],
    });
    await expectStillActive(buyerId);
  });

  it('blocks a self withdrawal that waited for a prepare which committed a pending payment', async () => {
    const buyerId = await seedBuyerWithSocialLink();
    const showtimeId = await seedShowtime(7 * 86_400_000);
    const prepare = await beginPrepare(buyerId, showtimeId);
    let withdrawal: Promise<unknown> | undefined;
    try {
      await prepare.done;
      withdrawal = userService
        .withdrawSelf(buyerId, { reason: 'leaving', confirmed: true })
        .catch((caught: unknown) => caught);
      await waitForLockWaiters(1);
      await prepare.commit();
    } finally {
      await prepare.rollback();
    }
    const error = await withdrawal;

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'ACCOUNT_WITHDRAWAL_BLOCKED' });
    await expectStillActive(buyerId);
  });

  it('counts every blocking reservation beyond the sample list', async () => {
    const actorId = await seedSuperuser();
    const buyerId = await seedBuyerWithSocialLink();
    const upcoming = await seedShowtime(7 * 86_400_000);
    for (let index = 0; index < 101; index += 1) {
      await seedReservation(buyerId, upcoming, 'PENDING_PAYMENT');
    }
    for (let index = 0; index < 3; index += 1) {
      await seedReservation(buyerId, upcoming, 'CONFIRMED');
    }

    const error = await service
      .withdrawUser(actorId, buyerId, { reason: 'CS request', confirmed: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    const response = (error as ConflictException).getResponse() as { reservations: unknown[] };
    expect(response).toMatchObject({
      blockers: [
        { key: 'pending_payment_reservations', count: 101 },
        { key: 'upcoming_confirmed_reservations', count: 3 },
      ],
    });
    expect(response.reservations).toHaveLength(10);
    expect((error as ConflictException).message).toContain('결제 진행 중 예매 101건');
  });

  it('stores an audit row when request headers exceed the audit columns (u12)', async () => {
    const actorId = await seedSuperuser();

    const written = await new AdminAuditService(db as never).write({
      actorUserId: actorId,
      action: 'security.permission.update',
      resourceType: 'user',
      resourceId: actorId,
      status: 'success',
      userAgent: 'U'.repeat(600),
      requestId: 'r'.repeat(200),
      ipAddress: `2001:db8::${'f'.repeat(80)}`,
    });

    const [row] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, written.id));
    expect(row?.userAgent).toHaveLength(500);
    expect(row?.requestId).toHaveLength(120);
    expect(row?.ipAddress).toHaveLength(45);
  });

  it('audits support thread status and assignee changes with their own actions, atomically (u12)', async () => {
    const actorId = await seedSuperuser();
    const [thread] = await db.insert(supportThreads).values({
      category: 'general',
      title: 'Seat question',
      slaDueAt: new Date(Date.now() + 86_400_000),
    }).returning({ id: supportThreads.id });
    const operations = new AdminOperationsService(db as never, new AdminAuditService(db as never));

    await operations.updateThreadStatus(thread!.id, actorId, { status: 'resolved', reason: 'answered' });
    await operations.reassignThread(thread!.id, actorId, { assigneeUserId: actorId, reason: 'owner' });
    await operations.escalateThread(thread!.id, actorId, { reason: 'refund dispute' });
    await expect(
      operations.updateThreadStatus(randomUUID(), actorId, { status: 'closed', reason: 'missing thread' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const audits = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.actorUserId, actorId));
    expect(audits.map((audit) => audit.action).sort()).toEqual([
      'support.assign',
      'support.escalate',
      'support.resolve',
    ]);
    expect(audits.every((audit) => audit.resourceId === thread!.id)).toBe(true);
  });

  it('reports scanner bundle accounts as scanner, not as a missing bundle', async () => {
    const scannerId = await seedUser({
      role: 'admin',
      adminCapabilityBundle: 'scanner',
      adminCapabilities: [],
    });

    await expect(service.getUserDetail(scannerId)).resolves.toMatchObject({
      role: 'admin',
      adminCapabilityBundle: 'scanner',
    });
    const list = await service.listUsers({ verification: 'all', page: 1, limit: 20 });
    expect(list.items.find((item) => item.id === scannerId)?.adminCapabilityBundle).toBe('scanner');
  });

  it('persists the admin bundle with the canonical empty capability list', async () => {
    const actorId = await seedSuperuser();
    const targetId = await seedUser();

    await service.updatePermissions(actorId, targetId, {
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [],
      reason: 'second security owner',
      confirmed: true,
    });

    const [row] = await db.select().from(users).where(eq(users.id, targetId));
    expect(row).toMatchObject({
      role: 'admin',
      adminCapabilityBundle: 'admin',
      adminCapabilities: [],
    });
    const [audit] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.resourceId, targetId));
    expect(audit?.maskedAfterSnapshot).toMatchObject({ adminSuperuser: true });
  });
});
