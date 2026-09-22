import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { AdminPerformanceController } from '../src/modules/admin/admin-performance.controller.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { UploadService } from '../src/modules/admin/upload.service.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { CacheService } from '../src/modules/performance/cache.service.js';
import { CatalogFreshnessService } from '../src/modules/performance/catalog-freshness.service.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../src/common/guards/admin-capabilities.guard.js';
import { PerformanceDraftController } from '../src/modules/admin/performance-draft.controller.js';
import { PerformanceDraftService } from '../src/modules/admin/performance-draft.service.js';
import { AdminOperationsController } from '../src/modules/admin/admin-operations.controller.js';
import { AdminOperationsService } from '../src/modules/admin/admin-operations.service.js';
import { AdminBookingController } from '../src/modules/admin/admin-booking.controller.js';
import { AdminBookingService } from '../src/modules/admin/admin-booking.service.js';
import { AdminBenefitsService } from '../src/modules/admin/admin-benefits.service.js';
import { AdminBenefitsController } from '../src/modules/admin/admin-benefits.controller.js';
import { BenefitRunnerService } from '../src/modules/admin/benefit-runner.service.js';
import { TranslationService } from '../src/modules/translation/translation.service.js';
import { BookingService } from '../src/modules/booking/booking.service.js';
import { FeatureFlagsService } from '../src/modules/feature-flags/feature-flags.service.js';

// No DATABASE_URL: authenticated HTTP boundary against a disposable PostgreSQL.
describe('Performance preparation — real HTTP and PostgreSQL', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let app: INestApplication;
  let db: DrizzleDB;
  let pool: Pool;
  let actorId: string;
  let catalog: PerformanceService;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'preparation_test' })
      .withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'preparation_test', max: 5 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    actorId = randomUUID();
    await db.insert(schema.users).values({ id: actorId, email: `${actorId}@example.test`,
      name: 'Preparation operator', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin' });
    const cache = new CacheService({ get: async () => null, set: async () => 'OK',
      del: async () => 0, scan: async () => ['0', []] } as never);
    const freshness = new CatalogFreshnessService(cache);
    catalog = new PerformanceService(db, cache);
    const admin = new AdminService(db, freshness, new AdminAuditService(db));
    // Vitest's TS transform omits constructor metadata. Supply wiring only;
    // the HTTP routes, pipes, Reflector and both authorization guards are real.
    Reflect.defineMetadata('design:paramtypes', [AdminService, UploadService, PerformanceService], AdminPerformanceController);
    Reflect.defineMetadata('design:paramtypes', [PerformanceDraftService], PerformanceDraftController);
    Reflect.defineMetadata('design:paramtypes', [AdminOperationsService], AdminOperationsController);
    Reflect.defineMetadata('design:paramtypes', [AdminBookingService], AdminBookingController);
    Reflect.defineMetadata('design:paramtypes', [AdminBenefitsService, BenefitRunnerService], AdminBenefitsController);
    const module = await Test.createTestingModule({
      controllers: [AdminPerformanceController, PerformanceDraftController, AdminOperationsController, AdminBookingController, AdminBenefitsController],
      providers: [
        { provide: AdminBenefitsService, useValue: new AdminBenefitsService(db, new AdminAuditService(db)) },
        { provide: BenefitRunnerService, useValue: new BenefitRunnerService(db, new AdminBenefitsService(db, new AdminAuditService(db)), new AdminAuditService(db)) },
        { provide: AdminOperationsService, useValue: new AdminOperationsService(db, new AdminAuditService(db)) },
        // Read endpoints cannot call payment or broadcast collaborators.
        { provide: AdminBookingService, useValue: new AdminBookingService(db, undefined as never, undefined as never, new AdminAuditService(db)) },
        { provide: PerformanceDraftService, useValue: new PerformanceDraftService(db, admin, freshness) },
        { provide: AdminService, useValue: admin },
        { provide: UploadService, useValue: new UploadService(new ConfigService({ R2_ACCOUNT_ID: '' })) },
        { provide: PerformanceService, useValue: catalog },
      ],
    }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector()))
      .overrideGuard(AdminCapabilitiesGuard).useValue(new AdminCapabilitiesGuard(new Reflector()))
      .compile();
    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { user: { id: req.get('x-test-actor') ?? actorId, role: 'admin', adminCapabilityBundle: req.get('x-test-bundle') ?? 'operator',
        ...(req.get('x-test-capabilities') ? { adminCapabilities: req.get('x-test-capabilities')!.split(',') } : {}),
      } });
      next();
    });
    await app.listen(0, '127.0.0.1');
  }, 120000);

  afterAll(async () => { await app?.close(); await closePool?.(); await container?.stop(); });

  function input() {
    return { title: `Preparation ${randomUUID()}`, genre: 'artist_celebrity', venueName: 'Test theatre',
      startDate: '2099-01-01T18:00', endDate: '2099-01-01T20:00', ageRating: '전체 관람가',
      priceTiers: [{ tierName: 'VIP', price: 50000 }] };
  }

  it.each(['finance', 'scanner'])('denies %s performance creation through the real capability guard', async (bundle) => {
    const response = await request(app.getHttpServer()).post('/admin/performances')
      .set('x-test-bundle', bundle).send(input());
    expect(response.status).toBe(403);
  });

  it('lets an operator create and retrieve a draft, but blocks finance and scanner mutations', async () => {
    const payload = input();
    const created = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    expect(created.status).toBe(201);
    expect(created.body.publishState).toBe('draft');
    const id = created.body.id;
    const detail = await request(app.getHttpServer()).get(`/admin/performances/${id}`);
    expect(detail.body.title).toBe(payload.title);
    for (const bundle of ['finance', 'scanner']) {
      expect((await request(app.getHttpServer()).post(`/admin/performances/${id}/seat-map`)
        .set('x-test-bundle', bundle).send({ seatMaps: [] })).status).toBe(403);
      expect((await request(app.getHttpServer()).post('/admin/upload/presigned')
        .set('x-test-bundle', bundle).send({ folder: 'posters', contentType: 'image/png', extension: 'png' })).status).toBe(403);
      expect((await request(app.getHttpServer()).delete(`/admin/performances/${id}`)
        .set('x-test-bundle', bundle)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get(`/admin/performances/${id}`)).body.title).toBe(payload.title);
  });

  it('rejects publication metadata through ordinary creation and updates', async () => {
    const payload = input();
    expect((await request(app.getHttpServer()).post('/admin/performances')
      .send({ ...payload, publishState: 'published' })).status).toBe(400);
    const created = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    expect(created.status).toBe(201);
    for (const change of [{ publishState: 'published' }, { publishedAt: new Date().toISOString() }, { publishedByUserId: actorId }]) {
      expect((await request(app.getHttpServer()).put(`/admin/performances/${created.body.id}`).send(change)).status).toBe(400);
    }
    const listed = await request(app.getHttpServer()).get('/admin/performances').query({ search: payload.title });
    expect(listed.body.data).toHaveLength(1);
  });

  it('allows a banner-only operator to upload banners without granting access to performance assets', async () => {
    const upload = (folder: string) => request(app.getHttpServer()).post('/admin/upload/presigned')
      .set('x-test-capabilities', 'banner.manage').send({ folder, contentType: 'image/png', extension: 'png' });
    expect((await upload('banners')).status).toBe(201);
    expect((await upload('posters')).status).toBe(403);
  });

  it('saves an incomplete private draft, resumes it, and rejects an outdated writer without losing the latest work', async () => {
    const created = await request(app.getHttpServer()).post('/admin/performance-drafts')
      .send({ data: { title: '아직 장소가 없는 초안', priceTiers: [{ tierName: '', price: 0 }] }, step: 'basic' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ revision: 1, performanceId: null });
    const path = `/admin/performance-drafts/${created.body.id}`;
    expect((await request(app.getHttpServer()).get(path)).body.data.title).toBe('아직 장소가 없는 초안');
    const saved = await request(app.getHttpServer()).put(path)
      .send({ expectedRevision: 1, data: { title: '다음 창에서 저장한 제목' }, step: 'seats' });
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(2);
    expect((await request(app.getHttpServer()).put(path)
      .send({ expectedRevision: 1, data: { title: '오래된 제목' }, step: 'basic' })).status).toBe(409);
    expect((await request(app.getHttpServer()).get(path)).body).toMatchObject({ revision: 2, data: { title: '다음 창에서 저장한 제목' } });
    expect((await request(app.getHttpServer()).get('/admin/performances').query({ search: '다음 창에서 저장한 제목' })).body.total).toBe(0);
    expect((await request(app.getHttpServer()).get(path).set('x-test-bundle', 'finance')).status).toBe(403);
  });

  it('applies a complete draft exactly once across duplicate requests and retains an audit receipt', async () => {
    const payload = input();
    const draft = await request(app.getHttpServer()).post('/admin/performance-drafts')
      .send({ data: payload, step: 'review' });
    const applied = await Promise.all([1, 2].map(() => request(app.getHttpServer())
      .post(`/admin/performance-drafts/${draft.body.id}/apply`).send({ expectedRevision: 1 })));
    expect(applied.map((response) => response.status)).toEqual([201, 201]);
    expect(applied[1]!.body.performanceId).toBe(applied[0]!.body.performanceId);
    expect(applied[0]!.body.appliedAt).toBeTruthy();
    const events = await request(app.getHttpServer()).get('/admin/performances').query({ search: payload.title });
    expect(events.body.total).toBe(1);
    const audit = await new AdminAuditService(db).query({ resourceType: 'performance', resourceId: applied[0]!.body.performanceId });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: actorId, action: 'event.update', status: 'success' });
  });

  it('uses stored preparation facts rather than client checkboxes when approving publication', async () => {
    const created = await request(app.getHttpServer()).post('/admin/performances').send(input());
    const response = await request(app.getHttpServer()).post(`/admin/performances/${created.body.id}/publish`)
      .set('x-test-bundle', 'approver').send({ reason: '게시 확인', confirmed: true, expectedUpdatedAt: created.body.updatedAt,
        confirmedChangedFields: ['publishState'], contentChecklist: {
          ko: { title: true, description: true }, en: { title: true, description: true },
        } });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('준비');
    const audit = await new AdminAuditService(db).query({ resourceType: 'performance', resourceId: created.body.id, action: 'event.publish' });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.status).toBe('failed');
  });

  it('deletes an unused performance created from a draft and removes its applied draft atomically', async () => {
    const draft = await request(app.getHttpServer()).post('/admin/performance-drafts')
      .send({ data: input(), step: 'review' });
    const applied = await request(app.getHttpServer()).post(`/admin/performance-drafts/${draft.body.id}/apply`)
      .send({ expectedRevision: 1 });
    expect(applied.status).toBe(201);
    const id = applied.body.performanceId;
    const response = await request(app.getHttpServer()).delete(`/admin/performances/${id}`);
    expect(response.status).toBe(200);
    expect((await pool.query('SELECT id FROM performances WHERE id=$1', [id])).rows).toHaveLength(0);
    expect((await request(app.getHttpServer()).get(`/admin/performance-drafts/${draft.body.id}`)).status).toBe(404);
    const audit = await new AdminAuditService(db).query({ resourceType: 'performance', resourceId: id });
    expect(audit).toHaveLength(1);
  });

  it('retains the applied draft and original performance when bookings block deletion', async () => {
    const draft = await request(app.getHttpServer()).post('/admin/performance-drafts')
      .send({ data: { ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }] }, step: 'review' });
    const applied = await request(app.getHttpServer()).post(`/admin/performance-drafts/${draft.body.id}/apply`)
      .send({ expectedRevision: 1 });
    const id = applied.body.performanceId;
    const event = await request(app.getHttpServer()).get(`/admin/performances/${id}`);
    await db.insert(schema.reservations).values({ userId: actorId, showtimeId: event.body.showtimes[0].id,
      reservationNumber: randomUUID().slice(0, 24), totalAmount: 50000, status: 'CONFIRMED', cancelDeadline: new Date('2098-12-31') });
    expect((await request(app.getHttpServer()).delete(`/admin/performances/${id}`)).status).toBe(409);
    expect((await request(app.getHttpServer()).get(`/admin/performance-drafts/${draft.body.id}`)).body.performanceId).toBe(id);
    expect((await request(app.getHttpServer()).get(`/admin/performances/${id}`)).status).toBe(200);
  });

  it('publishes reviewed stored content with approver authority while retaining the independent sale status', async () => {
    const payload = { ...input(), description: '공연 상세 안내', showtimes: [{ dateTime: '2099-01-01T18:00' }],
      seatMaps: [{ floorKey: '1F', floorLabel: '1층', svgUrl: 'https://example.test/seats.svg', totalSeats: 1,
        seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-1'] }] } }] };
    const created = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    expect(created.status).toBe(201);
    const id = created.body.id;
    for (const field of ['title', 'description'] as const) {
      const hash = createHash('sha256').update(payload[field]).digest('hex');
      const [source] = await db.insert(schema.translationSources).values({ entityType: 'performance', entityId: id,
        field, sourceText: payload[field], contentHash: hash }).returning();
      await db.insert(schema.translationDrafts).values({ sourceId: source!.id, targetLocale: 'en', status: 'published',
        translatedText: field === 'title' ? 'Reviewed fan meeting' : 'Reviewed performance information', sourceContentHash: hash,
        reviewedBy: actorId, publishedAt: new Date() });
    }
    const preparation = await request(app.getHttpServer()).get(`/admin/performances/${id}/preparation`);
    expect(preparation.body).toMatchObject({ canPublish: true, publishState: 'draft', status: 'upcoming' });
    const publish = { reason: '콘텐츠와 좌석 검수 완료', confirmed: true, expectedUpdatedAt: preparation.body.updatedAt, confirmedChangedFields: ['publishState'],
      contentChecklist: { ko: { title: true, description: true }, en: { title: true, description: true } } };
    expect((await request(app.getHttpServer()).post(`/admin/performances/${id}/publish`).send(publish)).status).toBe(403);
    const changed = await request(app.getHttpServer()).put(`/admin/performances/${id}`).send({ runtime: '120분' });
    expect((await request(app.getHttpServer()).post(`/admin/performances/${id}/publish`).set('x-test-bundle', 'approver').send(publish)).status).toBe(409);
    const result = await request(app.getHttpServer()).post(`/admin/performances/${id}/publish`).set('x-test-bundle', 'approver')
      .send({ ...publish, expectedUpdatedAt: changed.body.updatedAt });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ publishState: 'published', status: 'upcoming', publishedByUserId: actorId });
    await request(app.getHttpServer()).put(`/admin/performances/${id}`).send({ description: '수정 후 아직 번역하지 않은 안내' });
    expect((await request(app.getHttpServer()).get(`/admin/performances/${id}/preparation`)).body.canPublish).toBe(false);
    expect((await catalog.findById(id, 'en'))?.description).toBe('수정 후 아직 번역하지 않은 안내');
    const queue = await new TranslationService(db).listQueue({ entityId: id, locale: 'en' });
    expect(queue.find((draft) => draft.field === 'description')?.status).toBe('stale');
  });

  it.each(['review', 'publish'] as const)('does not let a waiting translation %s overwrite source invalidation', async (transition) => {
    const original = '원문 변경 이전';
    const hash = createHash('sha256').update(original).digest('hex');
    const [source] = await db.insert(schema.translationSources).values({ entityType: 'performance', entityId: randomUUID(),
      field: 'description', sourceText: original, contentHash: hash }).returning();
    const [draft] = await db.insert(schema.translationDrafts).values({ sourceId: source!.id, targetLocale: 'en',
      status: transition === 'publish' ? 'review' : 'draft', translatedText: 'Previous source', sourceContentHash: hash }).returning();
    const blocker = await pool.connect();
    const translations = new TranslationService(db);
    try {
      await blocker.query('begin');
      await blocker.query('select id from translation_drafts where id = $1 for update', [draft!.id]);
      const pending = (transition === 'publish' ? translations.publishDraft(draft!.id)
        : translations.markReviewed(draft!.id, actorId, 'Reviewed previous source')).catch((error: unknown) => error);
      // Pause at the real database write boundary, after the service read the old state.
      let waiting = false;
      for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
        const active = await pool.query("select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%translation_drafts%'");
        waiting = active.rowCount! > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await blocker.query('update translation_sources set source_text = $1, content_hash = $2 where id = $3',
        ['바뀐 원문', createHash('sha256').update('바뀐 원문').digest('hex'), source!.id]);
      await blocker.query("update translation_drafts set status = 'stale' where id = $1", [draft!.id]);
      await blocker.query('commit');
      expect(await pending).toBeInstanceOf(BadRequestException);
      expect((await translations.listQueue({ entityId: source!.entityId }))[0]?.status).toBe('stale');
    } finally { await blocker.query('rollback'); blocker.release(); }
  });

  it('allows blank draft values but rejects malformed field types before saving a resumable form', async () => {
    expect((await request(app.getHttpServer()).post('/admin/performance-drafts').send({ data: { title: '', priceTiers: [] } })).status).toBe(201);
    expect((await request(app.getHttpServer()).post('/admin/performance-drafts').send({ data: { title: {}, priceTiers: 'broken' } })).status).toBe(400);
  });

  it('preserves a conflicting performance draft and keeps another operator out of its private input', async () => {
    const payload = input();
    const created = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    const draft = await request(app.getHttpServer()).post('/admin/performance-drafts').send({
      performanceId: created.body.id, baseUpdatedAt: created.body.updatedAt, data: { ...payload, title: '내가 작성 중인 제목' }, step: 'review',
    });
    expect(draft.status).toBe(201);
    expect((await request(app.getHttpServer()).get(`/admin/performance-drafts/${draft.body.id}`).set('x-test-actor', randomUUID())).status).toBe(404);
    await request(app.getHttpServer()).put(`/admin/performances/${created.body.id}`).send({ title: '다른 담당자가 확정한 제목' });
    expect((await request(app.getHttpServer()).post(`/admin/performance-drafts/${draft.body.id}/apply`).send({ expectedRevision: 1 })).status).toBe(409);
    expect((await request(app.getHttpServer()).get(`/admin/performance-drafts/${draft.body.id}`)).body).toMatchObject({ appliedAt: null, data: { title: '내가 작성 중인 제목' } });
    expect((await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`)).body.title).toBe('다른 담당자가 확정한 제목');
  });

  it('preserves a newer seat-map edit against an older performance draft and records the seat-map audit', async () => {
    const payload = input();
    const event = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    const draft = await request(app.getHttpServer()).post('/admin/performance-drafts').send({
      performanceId: event.body.id, baseUpdatedAt: event.body.updatedAt, data: { ...payload, seatMaps: [] }, step: 'review',
    });
    const maps = [{ floorKey: '1F', floorLabel: '1층', svgUrl: 'https://example.test/new-map.svg', totalSeats: 1,
      seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-1'] }] } }];
    expect((await request(app.getHttpServer()).post(`/admin/performances/${event.body.id}/seat-map`).send({ seatMaps: maps })).status).toBe(201);
    expect((await request(app.getHttpServer()).post(`/admin/performance-drafts/${draft.body.id}/apply`).send({ expectedRevision: 1 })).status).toBe(409);
    const audit = await new AdminAuditService(db).query({ resourceType: 'performance', resourceId: event.body.id, action: 'event.update' });
    expect(audit.some((entry) => entry.changedFields.includes('seatMaps') && entry.reason === '좌석맵 저장')).toBe(true);
    expect((await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`)).body.seatMaps).toHaveLength(1);
  });

  it('returns only customer cases linked to the selected performance and showtime', async () => {
    const fixture = [] as Array<{ eventId: string; showtimeId: string; threadId: string }>;
    for (const title of ['첫 공연 문의', '다른 공연 문의']) {
      const created = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }] });
      const detail = await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`);
      const showtimeId = detail.body.showtimes[0].id;
      const [order] = await db.insert(schema.reservations).values({ userId: actorId, showtimeId, reservationNumber: randomUUID().slice(0, 28), totalAmount: 50000,
        cancelDeadline: new Date('2098-12-31') }).returning();
      const [thread] = await db.insert(schema.supportThreads).values({ title, category: 'booking', reservationId: order!.id,
        userId: actorId, slaDueAt: new Date('2099-01-01') }).returning();
      fixture.push({ eventId: created.body.id, showtimeId, threadId: thread!.id });
    }
    const result = await request(app.getHttpServer()).get('/admin/operations/inbox')
      .query({ performanceId: fixture[0]!.eventId, showtimeId: fixture[0]!.showtimeId });
    expect(result.status).toBe(200);
    expect(result.body.rows.map((row: { id: string }) => row.id)).toEqual([fixture[0]!.threadId]);
    expect((await request(app.getHttpServer()).get('/admin/operations/inbox').set('x-test-bundle', 'scanner')).status).toBe(403);
  });

  it('shows original foreign charge, confirmed seat refund, delivery history and unqueried PG status without exposing QR credentials', async () => {
    const event = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }] });
    const detail = await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`);
    const showtimeId = detail.body.showtimes[0].id;
    const [order] = await db.insert(schema.reservations).values({ userId: actorId, showtimeId, reservationNumber: randomUUID().slice(0, 28),
      totalAmount: 104000, status: 'CONFIRMED', cancelDeadline: new Date('2098-12-31') }).returning();
    const [payment] = await db.insert(schema.payments).values({ reservationId: order!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(),
      method: 'CARD', currency: 'USD', providerChargeCurrency: 'USD', providerChargeAmountMinor: 7072, amount: 104000,
      status: 'PARTIAL_CANCELED', paidAt: new Date('2026-09-01') }).returning();
    for (const number of [1, 2]) {
      const [item] = await db.insert(schema.ticketItems).values({ reservationId: order!.id, paymentId: payment!.id, showtimeId,
        seatId: `1F:A-${number}`, seatKey: `1F:A-${number}`, floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: String(number),
        price: 50000, serviceFee: 2000, status: number === 1 ? 'cancelled' : 'active',
        cancellationCommand: number === 1 ? { version: 1, id: randomUUID(), requestedAt: '2026-09-02T01:00:00.000Z', reason: '선택 좌석 취소',
          currency: 'USD', amountMinor: 3536, originalAmountMinor: 7072, balanceBeforeMinor: 7072, completedAt: '2026-09-02T01:00:02.000Z',
          options: { secretKeyScope: 'overseas-card', idempotencyKey: 'private-command-key' } } : null,
      }).returning();
      await db.insert(schema.tickets).values({ reservationId: order!.id, paymentId: payment!.id, showtimeId, ticketItemId: item!.id,
        qrTokenJti: `private-credential-${randomUUID()}`, secretVersion: 'test', status: number === 1 ? 'revoked' : 'active',
        emailSentAt: new Date('2026-09-01T00:01:00Z') });
    }
    const path = `/admin/bookings/${order!.id}/support-evidence`;
    const response = await request(app.getHttpServer()).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ originalOrderAmount: 104000,
      provider: { currency: 'USD', originalAmountMinor: 7072, checkedAt: null },
      refundProviderAmount: { currency: 'USD', amountMinor: 3536, amountDecimal: '35.36' },
      rights: { activeSeats: 1, cancelledSeats: 1 },
      delivery: { lastSentAt: '2026-09-01T00:01:00.000Z', inboxReceipt: 'unverified' },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/private-credential|private-command-key|qrTokenJti/);
    expect((await request(app.getHttpServer()).get(path).set('x-test-bundle', 'scanner')).status).toBe(403);
    expect((await request(app.getHttpServer()).get(path).set('x-test-bundle', 'finance')).status).toBe(200);
  });

  it('reports the benefit result lock separately from successful redemption count and preserves its attempt history', async () => {
    const event = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }] });
    const detail = await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`);
    const showtimeId = detail.body.showtimes[0].id;
    const benefits = new AdminBenefitsService(db, new AdminAuditService(db));
    expect(await benefits.getOperationState(showtimeId)).toMatchObject({ resultLockedAt: null, redeemedCount: 0, history: [] });
    const [order] = await db.insert(schema.reservations).values({ userId: actorId, showtimeId, reservationNumber: randomUUID().slice(0, 28),
      totalAmount: 50000, status: 'CONFIRMED', cancelDeadline: new Date('2098-12-31') }).returning();
    const [payment] = await db.insert(schema.payments).values({ reservationId: order!.id, paymentKey: randomUUID(), tossOrderId: randomUUID(),
      method: 'CARD', amount: 50000, status: 'DONE' }).returning();
    const [item] = await db.insert(schema.ticketItems).values({ reservationId: order!.id, paymentId: payment!.id, showtimeId,
      seatId: '1F:A-1', seatKey: '1F:A-1', floorKey: '1F', floorLabel: '1층', tierName: 'VIP', row: 'A', number: '1', price: 50000 }).returning();
    const copy = { ko: { name: '포스터', description: '기본 특전' }, en: { name: 'Poster', description: 'Included' },
      th: { name: 'Poster', description: 'Included' }, 'zh-CN': { name: 'Poster', description: 'Included' } };
    const [entitlement] = await db.insert(schema.ticketBenefitEntitlements).values({ showtimeId, ticketItemId: item!.id,
      benefitIdentity: 'stable-poster', benefitKind: 'included', displayCopySnapshot: copy, source: 'configuration', state: 'active' }).returning();
    await db.insert(schema.ticketBenefitRedemptionRecords).values({ showtimeId, ticketItemId: item!.id, benefitEntitlementId: entitlement!.id,
      scannerUserId: actorId, deviceAttemptId: randomUUID(), redactedTokenRef: 'fixture', result: 'wrong_showtime', createdAt: new Date('2026-09-21T01:00:00Z') });
    expect(await benefits.getOperationState(showtimeId)).toMatchObject({ resultLockedAt: '2026-09-21T01:00:00.000Z', redeemedCount: 0,
      history: [{ seatKey: '1F:A-1', benefitName: '포스터', result: 'wrong_showtime' }] });
    await expect(benefits.saveConfiguration(showtimeId, actorId, { benefits: [{ identity: 'stable-poster', kind: 'included', displayCopy: copy,
      eligibleTierNames: ['VIP'], mutuallyExclusiveWith: [] }] })).rejects.toThrow('Benefit Result Lock');
  });

  it('returns JSON null for a showtime with no benefit configuration and keeps scanner access restricted', async () => {
    const created = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }] });
    const detail = (await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`)).body;
    const path = `/admin/benefits/showtimes/${detail.showtimes[0].id}/configuration`;
    const response = await request(app.getHttpServer()).get(path).set('x-test-bundle', 'admin');
    expect(response.status).toBe(200);
    expect(response.text).toBe('null');
    expect((await request(app.getHttpServer()).get(path).set('x-test-bundle', 'scanner')).status).toBe(403);
  });

  it('preserves unchanged seat and price identities during copy edits and blocks structural changes with booking history', async () => {
    const payload = { ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }], seatMaps: [
      { floorKey: '1F', floorLabel: '1층', svgUrl: 'https://example.test/layout.svg', totalSeats: 2,
        seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-1', 'A-2'] }] } },
    ] };
    const created = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    const before = (await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`)).body;
    const showtimeId = before.showtimes[0].id;
    await db.insert(schema.reservations).values({ userId: actorId, showtimeId, reservationNumber: randomUUID().slice(0, 28),
      totalAmount: 50000, status: 'CONFIRMED', cancelDeadline: new Date('2098-12-31') });
    const safeUpdate = await request(app.getHttpServer()).put(`/admin/performances/${created.body.id}`).send({
      ...payload, title: '좌석은 그대로 두고 안내만 수정', venueAddress: '', venueAccessNotes: '', transportSummary: '',
      showtimes: [{ showtimeId, dateTime: before.showtimes[0].dateTime }],
    });
    expect(safeUpdate.status).toBe(200);
    const after = (await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`)).body;
    expect(after.seatMaps.map((map: { id: string }) => map.id)).toEqual(before.seatMaps.map((map: { id: string }) => map.id));
    expect(after.priceTiers.map((tier: { id: string }) => tier.id)).toEqual(before.priceTiers.map((tier: { id: string }) => tier.id));
    for (const change of [
      { seatMaps: [] }, { priceTiers: [{ tierName: 'VIP', price: 100000 }] },
      { showtimes: [{ showtimeId, dateTime: '2099-02-01T18:00' }] },
    ]) expect((await request(app.getHttpServer()).put(`/admin/performances/${created.body.id}`).send(change)).status).toBe(422);
    expect((await request(app.getHttpServer()).post(`/admin/performances/${created.body.id}/seat-map`)
      .send({ seatMaps: [{ ...payload.seatMaps[0], totalSeats: 1, seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-2'] }] } }] })).status).toBe(422);
    expect((await request(app.getHttpServer()).get(`/admin/performances/${created.body.id}`)).body.showtimes[0].dateTime).toBe(before.showtimes[0].dateTime);
  });

  it('updates the sellable seat price consistently before opening sales even when the seat map is unchanged', async () => {
    const payload = { ...input(), showtimes: [{ dateTime: '2099-01-01T18:00' }], seatMaps: [
      { floorKey: '1F', floorLabel: '1층', svgUrl: 'https://example.test/price-layout.svg', totalSeats: 1,
        seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-1'] }] } },
    ] };
    const event = await request(app.getHttpServer()).post('/admin/performances').send(payload);
    expect((await request(app.getHttpServer()).put(`/admin/performances/${event.body.id}`).send({ priceTiers: [{ tierName: 'VIP', price: 100000 }], seatMaps: payload.seatMaps })).status).toBe(200);
    const detail = (await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`)).body;
    const bookings = await request(app.getHttpServer()).get('/admin/bookings').query({ performanceId: event.body.id, showtimeId: detail.showtimes[0].id });
    expect(bookings.body.tierStats).toMatchObject([{ tierName: 'VIP', price: 100000, totalSeats: 1 }]);
    // Partial API edits must not orphan the existing seat assignments.
    expect((await request(app.getHttpServer()).put(`/admin/performances/${event.body.id}`)
      .send({ priceTiers: [{ tierName: 'R', price: 100000 }] })).status).toBe(422);
    const unchanged = (await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`)).body;
    expect(unchanged.priceTiers.map((tier: { tierName: string }) => tier.tierName)).toEqual(['VIP']);
  });

  it('reuses an existing venue without erasing another performance location details', async () => {
    const venueName = `Shared venue ${randomUUID()}`;
    const first = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), venueName, venueAddress: '서울 · 보존할 주소',
      venueAccessNotes: 'B 출입구로 입장', transportSummary: '셔틀 안내 보존' });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), venueName });
    expect(second.status).toBe(201);
    expect((await request(app.getHttpServer()).get(`/admin/performances/${first.body.id}`)).body.venue.address).toBe('서울 · 보존할 주소');
    expect((await request(app.getHttpServer()).get(`/admin/performances/${first.body.id}`)).body.venue).toMatchObject({
      accessNotes: 'B 출입구로 입장', transportSummary: '셔틀 안내 보존',
    });
    const change = await request(app.getHttpServer()).put(`/admin/performances/${second.body.id}`)
      .send({ venueName, venueAddress: '다른 공연까지 바뀌면 안 되는 주소' });
    expect(change.status).toBe(422);
    expect((await request(app.getHttpServer()).get(`/admin/performances/${first.body.id}`)).body.venue.address).toBe('서울 · 보존할 주소');
  });

  it('keeps an unpublished performance unavailable to a verified buyer even when its sale status is open', async () => {
    const event = await request(app.getHttpServer()).post('/admin/performances').send({ ...input(), status: 'selling',
      showtimes: [{ dateTime: '2099-01-01T18:00' }], seatMaps: [{ floorKey: '1F', floorLabel: '1층', svgUrl: 'https://example.test/private.svg', totalSeats: 1,
        seatConfig: { tiers: [{ tierName: 'VIP', color: '#336699', seatIds: ['A-1'] }] } }] });
    expect(event.status).toBe(201);
    const detail = (await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`)).body;
    // Missing Redis/broadcast adapters make any unauthorized continuation fail;
    // the public method must reject through the publication rule before reaching them.
    const booking = new BookingService(undefined as never, db, undefined as never, new FeatureFlagsService(() => ({ BOOKING_ENABLED: 'true' })));
    await expect(booking.lockSeat({ id: actorId, role: 'user', isEmailVerified: true, isPhoneVerified: true },
      detail.showtimes[0].id, '1F:A-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
