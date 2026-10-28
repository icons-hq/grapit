import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import type { StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { VenueLayoutController } from '../src/modules/admin/venue-layout.controller.js';
import { VenueLayoutService } from '../src/modules/admin/venue-layout.service.js';
import { PerformanceIntakeService } from '../src/modules/admin/performance-intake.service.js';
import { AdminPerformanceController } from '../src/modules/admin/admin-performance.controller.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { UploadService } from '../src/modules/admin/upload.service.js';
import { PerformanceService } from '../src/modules/performance/performance.service.js';
import { CacheService } from '../src/modules/performance/cache.service.js';
import { CatalogFreshnessService } from '../src/modules/performance/catalog-freshness.service.js';
import { PerformanceViewCounter } from '../src/modules/performance/performance-view-counter.service.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../src/common/guards/admin-capabilities.guard.js';
import { startPostgresContainer } from './helpers/postgres-container.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { adminBodyParser } from '../src/config/admin-body-parser.js';

// Only a fresh local container is used. No environment URL or provider call.
describe('Venue layout versions — public admin HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    const postgres = await startPostgresContainer({ database: 'venue_layout_test' });
    container = postgres.container;
    const pool = new Pool({ host: postgres.host, port: postgres.port, user: postgres.user,
      password: postgres.password, database: postgres.database, max: 6 });
    closePool = createPostgresPoolCleanup(pool);
    const db: DrizzleDB = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    const actorId = randomUUID();
    await db.insert(schema.users).values({ id: actorId, email: `${actorId}@example.test`, name: 'Layout operator',
      phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin' });
    const cache = new CacheService({ get: async () => null, set: async () => 'OK', del: async () => 0,
      scan: async () => ['0', []] } as never);
    const audit = new AdminAuditService(db);
    const intake = new PerformanceIntakeService();
    Reflect.defineMetadata('design:paramtypes', [VenueLayoutService], VenueLayoutController);
    Reflect.defineMetadata('design:paramtypes', [AdminService, UploadService, PerformanceService], AdminPerformanceController);
    const module = await Test.createTestingModule({
      controllers: [VenueLayoutController, AdminPerformanceController],
      providers: [
        { provide: VenueLayoutService, useValue: new VenueLayoutService(db, audit, intake) },
        { provide: AdminService, useValue: new AdminService(db, new CatalogFreshnessService(cache), audit, intake) },
        { provide: PerformanceService, useValue: new PerformanceService(db, cache, new PerformanceViewCounter(db)) },
        { provide: UploadService, useValue: new UploadService(new ConfigService({ R2_ACCOUNT_ID: '' })) },
      ],
    }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector()))
      .overrideGuard(AdminCapabilitiesGuard).useValue(new AdminCapabilitiesGuard(new Reflector())).compile();
    app = module.createNestApplication();
    app.use('/admin', adminBodyParser());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { user: { id: actorId, role: req.get('x-test-role') ?? 'admin',
        adminCapabilityBundle: req.get('x-test-bundle') ?? 'operator' } });
      next();
    });
    await app.listen(0, '127.0.0.1');
  }, 120000);
  afterAll(async () => { await app?.close(); await closePool?.(); await container?.stop(); });

  function template(venueName = `Venue ${randomUUID()}`, seat = 'A-1') {
    return { venueName, layoutName: '정면 무대', seatMaps: [{
      floorKey: '1F', floorLabel: '1층', sortOrder: 0, svgUrl: 'https://example.test/venue.svg', totalSeats: 1,
      seatConfig: { tiers: [{ tierName: 'VIP', color: '#6C3CE0', seatIds: [seat] }],
        sections: [{ sectionKey: 'A', label: 'A구역', seatIds: [seat] }] },
    }] };
  }

  function performance(layout: { venueName: string; seatMaps: unknown[] }, overrides = {}) {
    return { title: `Layout event ${randomUUID()}`, genre: 'artist_celebrity', venueName: layout.venueName,
      startDate: '2099-01-01T18:00', endDate: '2099-01-01T20:00', ageRating: '전체 관람가',
      priceTiers: [{ tierName: 'VIP', price: 50000 }], showtimes: [{ dateTime: '2099-01-01T18:00' }],
      seatMaps: layout.seatMaps, ...overrides };
  }

  it('keeps a performance pinned to the immutable venue version while a new version is saved', async () => {
    const input = template();
    const first = await request(app.getHttpServer()).post('/admin/venue-layouts').send(input).expect(201);
    const event = await request(app.getHttpServer()).post('/admin/performances').send(performance(first.body)).expect(201);
    await request(app.getHttpServer()).post('/admin/venue-layouts').send(template(input.venueName, 'B-2')).expect(201);
    const saved = await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`).expect(200);
    expect(saved.body.seatMaps[0]).toMatchObject({ venueLayoutId: first.body.id,
      seatConfig: { sections: [{ sectionKey: 'A', label: 'A구역', seatIds: ['A-1'] }] } });
    const original = await request(app.getHttpServer()).get(`/admin/venue-layouts/${first.body.id}`).expect(200);
    expect(original.body).toMatchObject({ version: 1, totalSeats: 1, seatMaps: input.seatMaps });
    const list = await request(app.getHttpServer()).get('/admin/venue-layouts').query({ venueName: input.venueName }).expect(200);
    expect(list.body.map((layout: { version: number }) => layout.version)).toEqual([2, 1]);
  });

  it('serializes concurrent version saves without overwriting either version', async () => {
    const input = template();
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/admin/venue-layouts').send(input),
      request(app.getHttpServer()).post('/admin/venue-layouts').send(input),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses.map((response) => response.body.version).sort()).toEqual([1, 2]);
  });

  it('lets the first performance fill a template-created venue address without changing a shared venue', async () => {
    const layout = (await request(app.getHttpServer()).post('/admin/venue-layouts').send(template()).expect(201)).body;
    const first = await request(app.getHttpServer()).post('/admin/performances')
      .send(performance(layout, { venueAddress: '서울 · 첫 공연에서 등록한 주소' })).expect(201);
    await request(app.getHttpServer()).post('/admin/performances')
      .send(performance(layout, { venueAddress: '다른 주소' })).expect(422);
    const unchanged = await request(app.getHttpServer()).get(`/admin/performances/${first.body.id}`).expect(200);
    expect(unchanged.body.venue.address).toBe('서울 · 첫 공연에서 등록한 주소');
  });

  it('saves and pins a 10,000-seat venue through HTTP without exceeding SQL parameter limits', async () => {
    const input = template();
    const ids = Array.from({ length: 10000 }, (_, index) => `A-${index + 1}`);
    input.seatMaps[0]!.totalSeats = ids.length;
    input.seatMaps[0]!.seatConfig.tiers[0]!.seatIds = ids;
    input.seatMaps[0]!.seatConfig.sections[0]!.seatIds = ids;
    const layout = (await request(app.getHttpServer()).post('/admin/venue-layouts').send(input).expect(201)).body;
    const event = (await request(app.getHttpServer()).post('/admin/performances').send(performance(layout)).expect(201)).body;
    const detail = (await request(app.getHttpServer()).get(`/admin/performances/${event.id}`).expect(200)).body;
    expect(detail.seatMaps[0].totalSeats).toBe(10000);
    expect(detail.seatMaps[0].venueLayoutId).toBe(layout.id);
    expect(detail.seatMaps[0].seatConfig.sections[0].seatIds).toHaveLength(10000);
  });

  it('rejects another venue and tampered template geometry instead of silently relinking them', async () => {
    const layout = (await request(app.getHttpServer()).post('/admin/venue-layouts').send(template()).expect(201)).body;
    await request(app.getHttpServer()).post('/admin/performances')
      .send(performance(layout, { venueName: `Another ${randomUUID()}` })).expect(422);
    await request(app.getHttpServer()).post('/admin/performances').send(performance(layout, {
      seatMaps: [{ ...layout.seatMaps[0], svgUrl: 'https://example.test/another.svg' }],
    })).expect(422);
  });

  it('blocks seat-layout replacement once sales are open', async () => {
    const layout = (await request(app.getHttpServer()).post('/admin/venue-layouts').send(template()).expect(201)).body;
    const event = await request(app.getHttpServer()).post('/admin/performances').send(performance(layout, { status: 'selling' })).expect(201);
    const next = (await request(app.getHttpServer()).post('/admin/venue-layouts').send(template(layout.venueName, 'B-2')).expect(201)).body;
    await request(app.getHttpServer()).post(`/admin/performances/${event.body.id}/seat-map`).send({ seatMaps: next.seatMaps }).expect(422);
    const unchanged = await request(app.getHttpServer()).get(`/admin/performances/${event.body.id}`).expect(200);
    expect(unchanged.body.seatMaps[0].venueLayoutId).toBe(layout.id);
  });

  it('requires event editing capabilities and refuses duplicate section assignments', async () => {
    await request(app.getHttpServer()).post('/admin/venue-layouts').set('x-test-bundle', 'scanner').send(template()).expect(403);
    await request(app.getHttpServer()).get('/admin/venue-layouts').set('x-test-role', 'user').expect(403);
    const input = template();
    input.seatMaps[0]!.seatConfig.sections.push({ sectionKey: 'B', label: 'B구역', seatIds: ['A-1'] });
    await request(app.getHttpServer()).post('/admin/venue-layouts').send(input).expect(400);
  });
});
