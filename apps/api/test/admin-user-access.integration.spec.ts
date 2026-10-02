import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { ConflictException } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema/index.js';
import {
  adminAuditLogs,
  performances,
  reservations,
  showtimes,
  socialAccounts,
  users,
  venues,
} from '../src/database/schema/index.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { AdminUserService } from '../src/modules/admin/admin-user.service.js';

/**
 * AdminUserService against real Postgres 16 + migrations.
 *
 * - audit #44: admin withdrawal is blocked by PENDING_PAYMENT or a CONFIRMED
 *   reservation whose showtime has not started (real timestamp comparison and
 *   rollback, not mocks).
 * - audit #122: scanner bundle rows are reported as `scanner`.
 * - audit #42: the admin bundle is persisted canonically.
 *
 * 실행: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/admin-user-access.integration.spec.ts
 */
describe('AdminUserService access and withdrawal (integration)', () => {
  let pgContainer: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: NodePgDatabase<typeof schema>;
  let service: AdminUserService;

  beforeAll(async () => {
    pgContainer = await new GenericContainer('postgres:16')
      .withExposedPorts(5432)
      .withEnvironment({
        POSTGRES_PASSWORD: 'test',
        POSTGRES_USER: 'postgres',
        POSTGRES_DB: 'grabit_test',
      })
      .start();

    pool = new Pool({
      host: pgContainer.getHost(),
      port: pgContainer.getMappedPort(5432),
      user: 'postgres',
      password: 'test',
      database: 'grabit_test',
    });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });

    service = new AdminUserService(db as never, new AdminAuditService(db as never));
  }, 180_000);

  afterAll(async () => {
    await closePool?.();
    await pgContainer?.stop();
  });

  beforeEach(async () => {
    await db.delete(adminAuditLogs);
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
      reservationNumber: `R${Date.now()}${Math.floor(Math.random() * 10000)}`,
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
