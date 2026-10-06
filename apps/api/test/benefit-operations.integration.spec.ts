import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BenefitDefinition } from '@grabit/shared';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../src/database/included-benefit-entitlements.js';
import * as schema from '../src/database/schema/index.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { AdminBenefitsService } from '../src/modules/admin/admin-benefits.service.js';
import { BenefitRunnerService } from '../src/modules/admin/benefit-runner.service.js';
import { repairIncludedBenefits } from '../src/ops/included-benefit-repair.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';

const { users, venues, performances, showtimes, reservations, payments, ticketItems,
  ticketBenefitConfigurations, ticketBenefits, ticketBenefitEntitlements, adminAuditLogs } = schema;

function copy(name: string) {
  return { ko: { name, description: `${name} 설명` }, en: { name, description: name },
    'zh-CN': { name, description: name }, th: { name, description: name } };
}

function included(identity: string, name: string, tiers = ['VIP']): BenefitDefinition {
  return { identity, kind: 'included', displayCopy: copy(name), eligibleTierNames: tiers, mutuallyExclusiveWith: [] };
}

// Never reads DATABASE_URL. Every test uses the disposable container created below.
describe('Benefit operations — PostgreSQL lock and volume regressions', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: DrizzleDB;
  let audit: AdminAuditService;
  let benefits: AdminBenefitsService;
  let runner: BenefitRunnerService;

  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'benefit_ops_test' });
    container = postgres.container;
    pool = new Pool({ host: postgres.host, port: postgres.port,
      user: 'postgres', password: 'test', database: 'benefit_ops_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    audit = new AdminAuditService(db);
    benefits = new AdminBenefitsService(db, audit);
    runner = new BenefitRunnerService(db, benefits, audit);
  }, 120000);

  afterAll(async () => { await closePool?.(); await container?.stop(); });

  async function user(role: 'admin' | 'user' = 'admin') {
    const id = randomUUID();
    const [row] = await db.insert(users).values({ email: `${id}@example.test`, name: 'Operator',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', role,
      isPhoneVerified: true, isEmailVerified: true }).returning();
    return row!.id;
  }

  async function showtimeWithTickets(count: number, tier = 'VIP') {
    const buyerId = await user('user');
    const id = randomUUID();
    const [venue] = await db.insert(venues).values({ name: `Venue-${id}` }).returning();
    const [performance] = await db.insert(performances).values({ title: 'Benefit ops', genre: 'artist_celebrity',
      venueId: venue!.id, ageRating: '전체관람가', status: 'selling', publishState: 'published',
      startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    const [showtime] = await db.insert(showtimes).values({ performanceId: performance!.id,
      dateTime: new Date('2099-01-01') }).returning();
    const [reservation] = await db.insert(reservations).values({ userId: buyerId, showtimeId: showtime!.id,
      reservationNumber: id.slice(0, 28), tossOrderId: `GRP-${id}`, status: 'CONFIRMED', totalAmount: 1000,
      cancelDeadline: new Date('2098-12-31') }).returning();
    const [payment] = await db.insert(payments).values({ reservationId: reservation!.id, paymentKey: id,
      tossOrderId: `GRP-${id}`, method: 'CARD', amount: 1000, status: 'DONE' }).returning();
    const items: Array<{ id: string; tierName: string }> = [];
    for (let offset = 0; offset < count; offset += 1000) {
      const rows = Array.from({ length: Math.min(1000, count - offset) }, (_, index) => {
        const seat = offset + index;
        return { reservationId: reservation!.id, paymentId: payment!.id, showtimeId: showtime!.id,
          seatId: `S-${seat}`, seatKey: `1F:S-${seat}`, floorKey: '1F', floorLabel: '1층', tierName: tier,
          row: 'A', number: String(seat), price: 1000 };
      });
      items.push(...await db.insert(ticketItems).values(rows)
        .returning({ id: ticketItems.id, tierName: ticketItems.tierName }));
    }
    return { showtimeId: showtime!.id, buyerId, items };
  }

  async function countEntitlements(showtimeId: string, state: 'active' | 'inactive' = 'active') {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketBenefitEntitlements)
      .where(and(eq(ticketBenefitEntitlements.showtimeId, showtimeId), eq(ticketBenefitEntitlements.state, state)));
    return row!.count;
  }

  async function withOpenTransaction<T>(work: (client: PoolClient, tx: DrizzleDB) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return { client, result: await work(client, drizzle(client, { schema }) as unknown as DrizzleDB) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw error;
    }
  }

  async function finish(client: PoolClient, outcome: 'COMMIT' | 'ROLLBACK' = 'COMMIT') {
    try { await client.query(outcome); } finally { client.release(); }
  }

  it('lets ticket issuance for different seats of one showtime run in parallel while benefit writers stay serialized', async () => {
    const f = await showtimeWithTickets(3);
    await benefits.saveConfiguration(f.showtimeId, await user(), { benefits: [included('poster', '포스터')] });
    await db.delete(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId));

    const first = await withOpenTransaction((_, tx) =>
      syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.items[0]!], new Date()));
    try {
      // Before the fix both confirms took FOR NO KEY UPDATE and the second one queued here.
      const second = await withOpenTransaction(async (client, tx) => {
        await client.query("SET LOCAL lock_timeout = '500ms'");
        await syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.items[1]!], new Date());
      });
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query("SET LOCAL lock_timeout = '300ms'");
        await expect(writer.query('SELECT id FROM showtimes WHERE id = $1 FOR NO KEY UPDATE', [f.showtimeId]))
          .rejects.toMatchObject({ code: '55P03' });
      } finally {
        await writer.query('ROLLBACK');
        writer.release();
      }
      await finish(second.client);
    } finally {
      await finish(first.client);
    }

    expect(await countEntitlements(f.showtimeId)).toBe(2);
  });

  it('fails a benefit save fast with 409 while issuance holds the showtime instead of queueing', async () => {
    const f = await showtimeWithTickets(1);
    const actor = await user();
    await benefits.saveConfiguration(f.showtimeId, actor, { benefits: [included('poster', '포스터')] });
    const issuing = await withOpenTransaction((_, tx) =>
      syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, f.items, new Date()));
    const startedAt = Date.now();
    try {
      await expect(benefits.saveConfiguration(f.showtimeId, actor, { benefits: [included('poster', '포스터 v2')] }))
        .rejects.toBeInstanceOf(ConflictException);
      expect(Date.now() - startedAt).toBeLessThan(10000);
    } finally {
      await finish(issuing.client, 'ROLLBACK');
    }
  });

  it('adds, refreshes and inactivates included rights of a large sold showtime with set-based statements', async () => {
    const f = await showtimeWithTickets(2600);
    const actor = await user();
    const posters = [included('poster', '포스터'), included('photocard', '포토카드')];

    // 2,600 tickets x 2 benefits x 13 columns exceeded the 65,535 bind parameter limit before.
    await benefits.saveConfiguration(f.showtimeId, actor, { benefits: posters });
    expect(await countEntitlements(f.showtimeId)).toBe(5200);

    await expect(benefits.syncIncludedEntitlementsForShowtime(f.showtimeId, {
      benefits: [included('poster', '포스터 오탈자 수정'), included('photocard', '포토카드')],
    })).resolves.toEqual({ createdCount: 0, inactivatedCount: 0 });
    const [refreshed] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketBenefitEntitlements)
      .where(and(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId),
        sql`${ticketBenefitEntitlements.displayCopySnapshot}->'ko'->>'name' = '포스터 오탈자 수정'`));
    expect(refreshed!.count).toBe(2600);

    await db.update(ticketItems).set({ status: 'cancelled' }).where(eq(ticketItems.id, f.items[0]!.id));
    await benefits.saveConfiguration(f.showtimeId, actor, {
      benefits: [included('poster', '포스터 오탈자 수정', ['R']), included('photocard', '포토카드')],
    });
    expect(await countEntitlements(f.showtimeId)).toBe(2599);
    const [changed] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketBenefitEntitlements)
      .where(and(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId),
        eq(ticketBenefitEntitlements.inactiveReason, 'configuration_changed')));
    expect(changed!.count).toBe(2601);
  }, 120000);

  it('saves a 1-of-4 mutual exclusion rule built from UI identities', async () => {
    const f = await showtimeWithTickets(1);
    const identities = Array.from({ length: 4 }, () => `benefit_${randomUUID()}`);
    const limited = identities.map((identity, index): BenefitDefinition => ({
      identity, kind: 'limited', displayCopy: copy(`추첨 ${index + 1}`), eligibleTierNames: ['VIP'],
      quantity: 1, selectionPriority: index + 1,
      mutuallyExclusiveWith: identities.filter((other) => other !== identity),
    }));

    const saved = await benefits.saveConfiguration(f.showtimeId, await user(), { benefits: limited });
    const loaded = await benefits.getConfiguration(f.showtimeId);

    expect(saved.version).toBe(1);
    expect(loaded?.benefits.find((benefit) => benefit.identity === identities[0])?.mutuallyExclusiveWith)
      .toEqual(identities.slice(1));
  });

  it('exports a live run with the current entitlement state after the result changed', async () => {
    const f = await showtimeWithTickets(2);
    const actor = await user();
    const configuration = await benefits.saveConfiguration(f.showtimeId, actor, { benefits: [{
      identity: 'signed-poster', kind: 'limited', displayCopy: copy('사인 포스터'), eligibleTierNames: ['VIP'],
      quantity: 2, selectionPriority: 1, mutuallyExclusiveWith: [],
    }] });
    const first = await runner.runLive({ showtimeId: f.showtimeId, actorUserId: actor,
      configurationId: configuration.id, confirmed: true });
    const [won] = await db.select().from(ticketBenefitEntitlements)
      .where(eq(ticketBenefitEntitlements.runId, first.id)).limit(1);
    await db.update(ticketBenefitEntitlements).set({ state: 'inactive', inactiveReason: 'ticket_cancelled' })
      .where(eq(ticketBenefitEntitlements.id, won!.id));

    const csv = (await runner.exportRun(first.id, { actorUserId: actor })).csv;
    const cancelledLine = csv.split('\n').find((line) => line.includes(won!.id));

    expect(csv.split('\n')[0]).toMatch(/,"Inactive Reason"$/);
    expect(cancelledLine).toContain(',"inactive",');
    expect(cancelledLine).toMatch(/,"ticket_cancelled"$/);
    expect(csv.split('\n').filter((line) => line.includes(',"active",'))).toHaveLength(1);
  });

  it('repair apply records who ran it, links every inserted right and works above the bind parameter limit', async () => {
    const f = await showtimeWithTickets(2600);
    const operator = await user();
    const [config] = await db.insert(ticketBenefitConfigurations).values({ showtimeId: f.showtimeId, version: 1 }).returning();
    await db.insert(ticketBenefits).values(['a', 'b', 'c', 'd'].map((suffix) => ({
      configurationId: config!.id, identity: `included-${suffix}`, kind: 'included' as const,
      displayCopy: copy(`포함 ${suffix}`), eligibleTierNames: ['VIP'],
    })));

    const dryRun = await repairIncludedBenefits(db, f.showtimeId);
    expect(dryRun).toMatchObject({ missingTickets: 2600, missingEntitlements: 10400, auditLogId: null });
    await expect(repairIncludedBenefits(db, f.showtimeId, {
      expectedHash: dryRun.hash, operatorUserId: f.buyerId, reason: '누락 특전 복구 승인 #1',
    })).rejects.toThrow('BENEFIT_REPAIR_OPERATOR_NOT_ALLOWED');

    const applied = await repairIncludedBenefits(db, f.showtimeId, {
      expectedHash: dryRun.hash, operatorUserId: operator, reason: '누락 특전 복구 승인 #1',
    });

    expect(applied).toMatchObject({ mode: 'apply', appliedEntitlements: 10400 });
    const [auditRow] = await db.select().from(adminAuditLogs).where(eq(adminAuditLogs.id, applied.auditLogId!));
    expect(auditRow).toMatchObject({ actorUserId: operator, action: 'benefits.included_repair.apply',
      resourceType: 'showtime', resourceId: f.showtimeId, reason: '누락 특전 복구 승인 #1' });
    expect(auditRow!.maskedAfterSnapshot).toMatchObject({ reviewedHash: dryRun.hash, missingEntitlements: 10400 });
    const [linked] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketBenefitEntitlements)
      .where(and(eq(ticketBenefitEntitlements.showtimeId, f.showtimeId),
        eq(ticketBenefitEntitlements.repairAuditLogId, applied.auditLogId!)));
    expect(linked!.count).toBe(10400);
    expect(await repairIncludedBenefits(db, f.showtimeId)).toMatchObject({ missingEntitlements: 0 });
  }, 120000);

  it('repair apply leaves unrelated tickets free and fails fast while ticket issuance holds the showtime', async () => {
    const f = await showtimeWithTickets(3);
    const operator = await user();
    await benefits.saveConfiguration(f.showtimeId, operator, { benefits: [included('poster', '포스터')] });
    await db.delete(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    const reason = '오픈 후 누락 특전 복구';

    // A check-in style lock on a ticket that is not a repair candidate must not block the repair.
    const checkIn = await withOpenTransaction((client) =>
      client.query('SELECT id FROM ticket_items WHERE id = $1 FOR UPDATE', [f.items[1]!.id]));
    try {
      const dryRun = await repairIncludedBenefits(db, f.showtimeId);
      expect(dryRun).toMatchObject({ missingTickets: 1, missingEntitlements: 1 });
      await expect(repairIncludedBenefits(db, f.showtimeId, {
        expectedHash: dryRun.hash, operatorUserId: operator, reason,
      })).resolves.toMatchObject({ appliedEntitlements: 1 });
    } finally {
      await finish(checkIn.client, 'ROLLBACK');
    }

    await db.delete(ticketBenefitEntitlements).where(eq(ticketBenefitEntitlements.ticketItemId, f.items[2]!.id));
    const dryRun = await repairIncludedBenefits(db, f.showtimeId);
    const issuing = await withOpenTransaction((_, tx) =>
      syncIncludedBenefitEntitlementsForTicketItems(tx, f.showtimeId, [f.items[0]!], new Date()));
    const startedAt = Date.now();
    try {
      await expect(repairIncludedBenefits(db, f.showtimeId, {
        expectedHash: dryRun.hash, operatorUserId: operator, reason,
      })).rejects.toThrow('BENEFIT_REPAIR_LOCK_TIMEOUT');
      expect(Date.now() - startedAt).toBeLessThan(10000);
    } finally {
      await finish(issuing.client, 'ROLLBACK');
    }
  });
});
