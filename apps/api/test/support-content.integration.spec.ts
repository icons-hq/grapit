import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import * as schema from '../src/database/schema/index.js';
import {
  adminAuditLogs,
  supportNotices,
  supportThreads,
  users,
} from '../src/database/schema/index.js';
import {
  AdminAuditService,
  type AdminAuditWriteInput,
} from '../src/modules/admin/admin-audit.service.js';
import { AdminOperationsService } from '../src/modules/admin/admin-operations.service.js';
import { AdminSupportContentService } from '../src/modules/admin/admin-support-content.service.js';

/**
 * Support content and operations inbox against real Postgres 16 with the
 * production migrations (including enum additions and translation groups).
 *
 * Run: pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/support-content.integration.spec.ts
 */

/** Pass-through cache so every read exercises the SQL filters. */
const noCache = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => undefined,
};

class FailingAuditService extends AdminAuditService {
  override async write(
    input: AdminAuditWriteInput,
    db?: Parameters<AdminAuditService['write']>[1],
  ): Promise<{ id: string }> {
    await super.write(input, db);
    throw new Error('audit sink failed after insert');
  }
}

describe('support content and operations inbox (integration)', () => {
  let pgContainer: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let db: NodePgDatabase<typeof schema>;
  let audit: AdminAuditService;
  let service: AdminSupportContentService;
  let operatorId: string;

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

    audit = new AdminAuditService(db as never);
    service = new AdminSupportContentService(db as never, audit, noCache as never);
  }, 180_000);

  afterAll(async () => {
    await closePool?.();
    await pgContainer?.stop();
  });

  beforeEach(async () => {
    await db.delete(adminAuditLogs);
    await db.delete(supportNotices);
    await db.delete(schema.supportFaqs);
    await db.delete(supportThreads);
    await db.delete(users);
    operatorId = randomUUID();
    await db.insert(users).values({
      id: operatorId,
      email: `operator-${operatorId.slice(0, 8)}@test.com`,
      name: 'Operator',
      phone: `+82010${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
      gender: 'unspecified',
      birthDate: '1990-01-01',
      role: 'admin',
    });
  });

  it('keeps an edited published notice live and stores before/after bodies in admin audit logs', async () => {
    const actor = { actorUserId: operatorId, ipAddress: '203.0.113.9', userAgent: 'it', requestId: 'req-1' };
    const notice = await service.createNotice({
      ...actor,
      category: 'payment',
      locale: 'ko',
      title: '결제 안내',
      body: '이전 본문',
    });
    await service.publishNotice(notice.id, actor);
    const edited = await service.updateNotice(notice.id, {
      ...actor,
      category: 'payment',
      title: '결제 안내',
      body: '수정 본문',
      translationUse: 'manual',
      expectedUpdatedAt: (await service.getNotice(notice.id)).updatedAt,
    });

    expect(edited).toMatchObject({ status: 'published', reviewState: 'published' });
    const publicContent = await service.listPublished({ locale: 'ko' });
    expect(publicContent.notices.map((row) => row.body)).toEqual(['수정 본문']);

    const rows = await db
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.resourceId, notice.id));
    expect(rows.map((row) => row.action).sort()).toEqual([
      'support.content.create',
      'support.content.publish',
      'support.content.update',
    ]);
    const update = rows.find((row) => row.action === 'support.content.update')!;
    expect(update).toMatchObject({
      resourceType: 'support_notice',
      ipAddress: '203.0.113.9',
      requestId: 'req-1',
      changedFields: expect.arrayContaining(['body']),
      maskedBeforeSnapshot: { body: '이전 본문' },
      maskedAfterSnapshot: { body: '수정 본문' },
    });
  });

  it('rolls the content change back when the audit write fails', async () => {
    const notice = await service.createNotice({
      actorUserId: operatorId,
      category: 'general',
      locale: 'ko',
      title: '원본',
      body: '원본 본문',
    });
    const failing = new AdminSupportContentService(
      db as never,
      new FailingAuditService(db as never),
      noCache as never,
    );

    await expect(
      failing.updateNotice(notice.id, { actorUserId: operatorId, body: '저장되면 안 됨' }),
    ).rejects.toThrow('audit sink failed');
    await expect(service.getNotice(notice.id)).resolves.toMatchObject({ body: '원본 본문' });
    const updates = await db
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.action, 'support.content.update'));
    expect(updates).toHaveLength(0);
  });

  it('rejects a stale expectedUpdatedAt under the row lock', async () => {
    const notice = await service.createNotice({
      actorUserId: operatorId,
      category: 'general',
      locale: 'ko',
      title: '원본',
      body: '원본 본문',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.updateNotice(notice.id, {
      actorUserId: operatorId,
      title: '먼저 저장',
      expectedUpdatedAt: notice.updatedAt,
    });

    await expect(
      service.updateNotice(notice.id, {
        actorUserId: operatorId,
        title: '나중 저장',
        expectedUpdatedAt: notice.updatedAt,
      }),
    ).rejects.toThrow(ConflictException);
    await expect(service.getNotice(notice.id)).resolves.toMatchObject({ title: '먼저 저장' });
  });

  it('filters scheduled and ended notices in SQL and falls back only for linked critical notices', async () => {
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const actor = { actorUserId: operatorId };

    const scheduled = await service.createNotice({
      ...actor, category: 'event', locale: 'th', title: 'future', body: 'future', scheduledAt: iso(3_600_000),
    });
    const ending = await service.createNotice({
      ...actor, category: 'event', locale: 'th', title: 'ending', body: 'ending', endsAt: iso(3_600_000),
    });
    const urgent = await service.createNotice({
      ...actor, category: 'urgent', locale: 'ko', title: '긴급', body: '긴급',
    });
    const legacy = await service.createNotice({
      ...actor, category: 'maintenance', locale: 'ko', title: '기존 점검', body: '기존 점검',
    });
    const koGeneral = await service.createNotice({
      ...actor, category: 'general', locale: 'ko', title: '일반', body: '일반',
    });
    for (const notice of [scheduled, ending, urgent, legacy, koGeneral]) {
      await service.publishNotice(notice.id, actor);
    }
    await db
      .update(supportNotices)
      .set({ translationGroupId: null })
      .where(eq(supportNotices.id, legacy.id));
    // Make the "ending" notice end in the past without going through validation.
    await db
      .update(supportNotices)
      .set({ endsAt: new Date(now - 1_000) })
      .where(eq(supportNotices.id, ending.id));

    const thai = await service.listPublished({ locale: 'th' });
    expect(thai.notices.map((row) => [row.id, row.locale])).toEqual([
      [urgent.id, 'ko'],
    ]);

    const english = await service.createNotice({
      ...actor,
      category: 'urgent',
      locale: 'en',
      title: 'Urgent',
      body: 'Urgent',
      translationOfNoticeId: urgent.id,
    });
    await service.publishNotice(english.id, actor);
    await expect(service.listPublished({ locale: 'th' })).resolves.toMatchObject({
      notices: [{ id: english.id, locale: 'en' }],
    });
  });

  it('finds old overdue threads beyond the newest 200 and counts totals over every matching thread', async () => {
    const operations = new AdminOperationsService(db as never, audit);
    const now = new Date('2026-10-01T03:00:00.000Z');
    const oldOverdueId = randomUUID();
    const newerRows = Array.from({ length: 210 }, (_, index) => ({
      id: randomUUID(),
      source: 'qna' as const,
      category: 'general' as const,
      title: `newer ${index}`,
      locale: 'ko' as const,
      slaDueAt: new Date(now.getTime() + 20 * 3_600_000),
      createdAt: new Date(now.getTime() - index * 60_000),
      updatedAt: new Date(now.getTime() - index * 60_000),
    }));
    await db.insert(supportThreads).values([
      {
        id: oldOverdueId,
        source: 'qna',
        category: 'general',
        title: 'old overdue',
        locale: 'ko',
        slaDueAt: new Date('2026-09-01T00:00:00.000Z'),
        createdAt: new Date('2026-08-31T00:00:00.000Z'),
        updatedAt: new Date('2026-08-31T00:00:00.000Z'),
      },
      ...newerRows,
    ]);

    const inbox = await operations.listInbox({}, { now });
    expect(inbox.rows).toHaveLength(100);
    expect(inbox.rows[0]).toMatchObject({ id: oldOverdueId, sla: { state: 'overdue' } });
    expect(inbox.totals).toEqual({ all: 211, escalated: 0, overdue: 1, dueSoon: 0 });

    const overdueOnly = await operations.listInbox({ priority: 'overdue' }, { now });
    expect(overdueOnly.rows.map((row) => row.id)).toEqual([oldOverdueId]);
    expect(overdueOnly.totals.all).toBe(1);

    await expect(operations.getThreadDetail(oldOverdueId, { now })).resolves.toMatchObject({
      id: oldOverdueId,
      subject: 'old overdue',
      messages: [],
    });
  });
});
