import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import { syncIncludedBenefitEntitlementsForTicketItems } from '../src/database/included-benefit-entitlements.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../src/common/guards/admin-capabilities.guard.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { QrTicketService } from '../src/modules/ticket/qr-ticket.service.js';
import { FieldCheckInService } from '../src/modules/field-operations/field-check-in.service.js';
import { FieldCheckInController } from '../src/modules/field-operations/field-check-in.controller.js';
import { BenefitRedemptionService } from '../src/modules/field-operations/benefit-redemption.service.js';
import { BenefitRedemptionController } from '../src/modules/field-operations/benefit-redemption.controller.js';
import { OfflineSyncService } from '../src/modules/field-operations/offline-sync.service.js';
import { OfflineSyncController } from '../src/modules/field-operations/offline-sync.controller.js';
import { AdminBenefitsService } from '../src/modules/admin/admin-benefits.service.js';
import { FieldMonitorService } from '../src/modules/field-operations/field-monitor.service.js';

// Disposable database only. Real signatures, HTTP pipes, capability guards and ledgers.
describe('Seat-level field admission — HTTP and PostgreSQL', () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let closePool: (() => Promise<void>) | undefined;
  let app: INestApplication;
  let db: DrizzleDB;
  let qr: QrTicketService;
  let actorId: string;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'field_test' }).withExposedPorts(5432).start();
    pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: 'test', database: 'field_test', max: 8 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    actorId = randomUUID();
    await db.insert(schema.users).values({ id: actorId, email: `${actorId}@example.test`, name: 'Scanner', role: 'admin', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01' });
    qr = new QrTicketService(db, new ConfigService({ QR_TICKET_SECRET: 'field-test-signing-secret-at-least-32-characters',
      QR_TICKET_SECRET_VERSION: 'field-test-v1', FRONTEND_URL: 'https://example.test' }), new JwtService(), {} as never, { isAvailable: false } as never);
    const audit = new AdminAuditService(db);
    const field = new FieldCheckInService(db, qr, audit);
    Reflect.defineMetadata('design:paramtypes', [FieldCheckInService], FieldCheckInController);
    Reflect.defineMetadata('design:paramtypes', [BenefitRedemptionService], BenefitRedemptionController);
    Reflect.defineMetadata('design:paramtypes', [OfflineSyncService], OfflineSyncController);
    const module = await Test.createTestingModule({
      controllers: [FieldCheckInController, BenefitRedemptionController, OfflineSyncController],
      providers: [
        { provide: FieldCheckInService, useValue: field },
        { provide: BenefitRedemptionService, useValue: new BenefitRedemptionService(db, qr) },
        { provide: OfflineSyncService, useValue: new OfflineSyncService(db, field, audit) },
      ],
    }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector()))
      .overrideGuard(AdminCapabilitiesGuard).useValue(new AdminCapabilitiesGuard(new Reflector())).compile();
    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { user: { id: actorId, role: 'admin', adminCapabilityBundle: req.get('x-test-bundle') ?? 'scanner',
        ...(req.get('x-test-capabilities') ? { adminCapabilities: req.get('x-test-capabilities')!.split(',') } : {}),
      } }); next();
    });
    await app.listen(0, '127.0.0.1');
  }, 120000);
  afterAll(async () => { await app?.close(); await closePool?.(); await container?.stop(); });

  async function fixture() {
    const id = randomUUID();
    const [buyer] = await db.insert(schema.users).values({ email: `${id}@example.test`, name: 'Two guests', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01' }).returning();
    const [event] = await db.insert(schema.performances).values({ title: 'Field rehearsal', genre: 'artist_celebrity', ageRating: 'All ages',
      status: 'selling', publishState: 'published', startDate: new Date('2099-01-01'), endDate: new Date('2099-01-02') }).returning();
    const [show] = await db.insert(schema.showtimes).values({ performanceId: event!.id, dateTime: new Date('2099-01-01') }).returning();
    const [order] = await db.insert(schema.reservations).values({ userId: buyer!.id, showtimeId: show!.id, reservationNumber: id.slice(0, 28),
      tossOrderId: id, status: 'CONFIRMED', totalAmount: 104000, cancelDeadline: new Date('2098-12-31') }).returning();
    const [payment] = await db.insert(schema.payments).values({ reservationId: order!.id, paymentKey: id, tossOrderId: id,
      method: 'CARD', amount: 104000, status: 'DONE' }).returning();
    const items = await db.insert(schema.ticketItems).values([1, 2].map((n) => ({ reservationId: order!.id, paymentId: payment!.id, showtimeId: show!.id,
      seatId: `1F:A-${n}`, seatKey: `1F:A-${n}`, floorKey: '1F', floorLabel: '1층', row: 'A', number: String(n), tierName: 'VIP', price: 50000, serviceFee: 2000 }))).returning();
    const [configuration] = await db.insert(schema.ticketBenefitConfigurations).values({ showtimeId: show!.id, version: 1 }).returning();
    await db.insert(schema.ticketBenefits).values({ configurationId: configuration!.id, identity: 'poster', kind: 'included', eligibleTierNames: ['VIP'],
      displayCopy: Object.fromEntries(['ko', 'en', 'th', 'zh-CN'].map((locale) => [locale, { name: 'Poster', description: 'Included poster' }])) });
    await db.transaction((tx) => syncIncludedBenefitEntitlementsForTicketItems(tx, show!.id, items, new Date()));
    const issued = await qr.ensureIssuedTicketsForReservation({ reservationId: order!.id, paymentId: payment!.id });
    const credentials = items.map((item) => issued.find((credential) => credential.ticketItemId === item.id)!);
    return { buyer: buyer!, event: event!, show: show!, order: order!, payment: payment!, items, credentials };
  }
  function consume(f: Awaited<ReturnType<typeof fixture>>, index = 0, attempt = randomUUID()) {
    return request(app.getHttpServer()).post('/field/check-in/consume').send({ token: f.credentials[index]!.token,
      showtimeId: f.show.id, deviceAttemptId: attempt, confirmed: true });
  }
  async function states(f: Awaited<ReturnType<typeof fixture>>) {
    return db.select().from(schema.ticketItems).where(eq(schema.ticketItems.reservationId, f.order.id)).orderBy(schema.ticketItems.number);
  }

  it('verifies without consuming, then admits only the scanned seat and keeps both buyer QR credentials', async () => {
    const f = await fixture();
    const verified = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: f.credentials[0]!.token, showtimeId: f.show.id });
    expect(verified.status).toBe(201); expect(verified.body.processable).toBe(true);
    expect((await states(f)).map((x) => x.admissionState)).toEqual(['not_entered', 'not_entered']);
    expect((await consume(f)).body.outcome).toBe('entered');
    expect((await states(f)).map((x) => x.admissionState)).toEqual(['entered', 'not_entered']);
    const monitor = await new FieldMonitorService(db).getSummary({ eventId: f.event.id, showtimeId: f.show.id });
    expect(monitor).toMatchObject({ enteredCount: 1, notEnteredCount: 1 });
    expect(await qr.getOwnedTicketsForReservation(f.order.id, f.buyer.id)).toHaveLength(2);
    expect((await consume(f, 1)).body.outcome).toBe('entered');
  });

  it('admits concurrent different seats independently and consumes one seat once under concurrent duplicate requests', async () => {
    const f = await fixture();
    const results = await Promise.all([consume(f), consume(f), consume(f, 1)]);
    expect(results.every((x) => x.status === 201)).toBe(true);
    expect(results.filter((x) => x.body.outcome === 'entered')).toHaveLength(2);
    expect(results.filter((x) => ['already_used', 'duplicate'].includes(x.body.outcome))).toHaveLength(1);
    const rows = await db.select().from(schema.ticketScanEvents).where(eq(schema.ticketScanEvents.showtimeId, f.show.id));
    expect(rows.filter((x) => x.result === 'success')).toHaveLength(2);
  });

  it('returns the original success for a repeated device attempt, including offline recovery after a lost response', async () => {
    const f = await fixture(); const deviceAttemptId = randomUUID();
    const first = await consume(f, 0, deviceAttemptId); const retry = await consume(f, 0, deviceAttemptId);
    expect(first.status).toBe(201); expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ outcome: 'entered', scanEventId: first.body.scanEventId });
    const sync = await request(app.getHttpServer()).post('/field/check-in/offline-sync').send({ attempts: [{ deviceAttemptId,
      scannerUserId: actorId, showtimeId: f.show.id, attemptedAt: new Date().toISOString(), token: f.credentials[0]!.token,
      redactedTokenRef: 'redacted-test-token', syncState: 'pending' }] });
    expect(sync.status).toBe(201); expect(sync.body.results[0]).toMatchObject({ syncState: 'synced', outcome: 'entered', scanEventId: first.body.scanEventId });
  });

  it.each(['cancelled', 'cancellation_pending', 'expired'] as const)('identifies a signed %s ticket without treating it as a forged QR', async (status) => {
    const f = await fixture(); await db.update(schema.ticketItems).set({ status }).where(eq(schema.ticketItems.id, f.items[0]!.id));
    const result = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: f.credentials[0]!.token, showtimeId: f.show.id });
    expect(result.body).toMatchObject({ processable: false, outcome: status === 'expired' ? 'expired' : 'refunded_cancelled' });
    expect((await consume(f)).body.outcome).toBe(status === 'expired' ? 'expired' : 'refunded_cancelled');
    expect((await states(f)).every((x) => x.admissionState === 'not_entered')).toBe(true);
  });

  it('rejects another showtime without changing any ticket or benefit and exposes the previous entry time for duplicates', async () => {
    const f = await fixture();
    const wrong = await request(app.getHttpServer()).post('/field/check-in/consume').send({ token: f.credentials[0]!.token,
      showtimeId: randomUUID(), deviceAttemptId: randomUUID(), confirmed: true });
    expect(wrong.body.outcome).toBe('wrong_showtime');
    expect((await states(f)).every((x) => x.admissionState === 'not_entered')).toBe(true);
    const entered = await consume(f);
    const duplicate = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: f.credentials[0]!.token, showtimeId: f.show.id });
    expect(duplicate.body.priorScan?.scannedAt).toBeTruthy(); expect(entered.body.consumedAt).toBeTruthy();
  });

  it('requires separate benefit permission and redeems only one entitlement without consuming entry', async () => {
    const f = await fixture();
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    const input = { token: f.credentials[0]!.token, showtimeId: f.show.id, benefitEntitlementId: entitlement!.id, deviceAttemptId: randomUUID(), confirmed: true };
    const denied = await request(app.getHttpServer()).post('/field/benefits/redeem').set('x-test-capabilities', 'field.scan.verify,field.scan.consume').send(input);
    expect(denied.status).toBe(403);
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/field/benefits/redeem').send({ ...input, deviceAttemptId: randomUUID() })));
    expect(responses.map((x) => x.body.outcome).sort()).toEqual(['duplicate', 'redeemed']);
    expect((await states(f)).every((x) => x.admissionState === 'not_entered')).toBe(true);
  });
  async function waitForLock(fragment: string) {
    for (let i = 0; i < 150; i += 1) {
      const result = await pool.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query like $1", [`%${fragment}%`]);
      if (result.rows[0].n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected field transaction to wait on a PostgreSQL row lock');
  }

  it('rechecks cancellation after waiting for its transaction and never consumes stale verified rights', async () => {
    const f = await fixture(); const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM reservations WHERE id=$1 FOR UPDATE', [f.order.id]);
      const pending = consume(f).then((response) => response);
      await waitForLock('INNER JOIN payments p');
      await blocker.query("UPDATE ticket_items SET status='cancellation_pending' WHERE id=$1", [f.items[0]!.id]);
      await blocker.query("UPDATE tickets SET status='revoked', revoked_at=now() WHERE ticket_item_id=$1", [f.items[0]!.id]);
      await blocker.query('COMMIT');
      expect((await pending).body.outcome).toBe('refunded_cancelled');
      expect((await states(f)).every((x) => x.admissionState === 'not_entered')).toBe(true);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('preserves historical bulk admission and reports its time without synthesizing new success events', async () => {
    const f = await fixture(); const historicalAt = new Date('2026-07-04T10:00:00Z');
    await db.update(schema.ticketItems).set({ admissionState: 'entered', enteredAt: historicalAt }).where(eq(schema.ticketItems.reservationId, f.order.id));
    await db.update(schema.tickets).set({ usedAt: historicalAt }).where(eq(schema.tickets.reservationId, f.order.id));
    const response = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: f.credentials[1]!.token, showtimeId: f.show.id });
    expect(response.body).toMatchObject({ outcome: 'already_used', priorScan: { scannedAt: historicalAt.toISOString() } });
    expect((await consume(f, 1)).body.outcome).toBe('already_used');
    expect((await states(f)).map((x) => x.enteredAt)).toEqual([historicalAt, historicalAt]);
    expect((await db.select().from(schema.ticketScanEvents).where(eq(schema.ticketScanEvents.reservationId, f.order.id))).every((x) => x.result !== 'success')).toBe(true);
  });

  it('refuses reusing an admission attempt for another ticket', async () => {
    const f = await fixture(); const attempt = randomUUID();
    expect((await consume(f, 0, attempt)).body.outcome).toBe('entered');
    expect((await consume(f, 1, attempt)).status).toBe(409);
    expect((await states(f))[1]!.admissionState).toBe('not_entered');
  });

  it('keeps offline duplicates and cancellation conflicts separate from successful replay', async () => {
    const f = await fixture(); await consume(f);
    await db.update(schema.ticketItems).set({ status: 'cancellation_pending' }).where(eq(schema.ticketItems.id, f.items[1]!.id));
    const response = await request(app.getHttpServer()).post('/field/check-in/offline-sync').send({ attempts: f.credentials.map((credential) => ({
      deviceAttemptId: randomUUID(), scannerUserId: actorId, showtimeId: f.show.id, attemptedAt: new Date().toISOString(),
      token: credential.token, redactedTokenRef: 'redacted-test-token', syncState: 'pending',
    })) });
    expect(response.body.results.map((x: { syncState: string; outcome: string }) => [x.syncState, x.outcome]))
      .toEqual([['rejected', 'already_used'], ['rejected', 'refunded_cancelled']]);
    expect((await states(f))[1]!.admissionState).toBe('not_entered');
  });

  it.each(['wrong_showtime', 'not_eligible', 'inactive', 'tampered'] as const)('rejects %s benefit redemption and stores no raw QR', async (outcome) => {
    const f = await fixture();
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    if (outcome === 'inactive') await db.update(schema.ticketBenefitEntitlements).set({ state: 'inactive' }).where(eq(schema.ticketBenefitEntitlements.id, entitlement!.id));
    const input = {
      token: outcome === 'tampered' ? 'forged-qr' : f.credentials[outcome === 'not_eligible' ? 1 : 0]!.token,
      showtimeId: outcome === 'wrong_showtime' ? randomUUID() : f.show.id, benefitEntitlementId: entitlement!.id,
      deviceAttemptId: randomUUID(), confirmed: true,
    };
    const response = await request(app.getHttpServer()).post('/field/benefits/redeem').send(input);
    expect(response.status).toBe(201); expect(response.body.outcome).toBe(outcome);
    const replay = await request(app.getHttpServer()).post('/field/benefits/redeem').send(input);
    expect(replay.status).toBe(201); expect(replay.body.outcome).toBe(outcome);
    const records = await db.select().from(schema.ticketBenefitRedemptionRecords).where(eq(schema.ticketBenefitRedemptionRecords.showtimeId, f.show.id));
    expect(records).toHaveLength(1); expect(records[0]!.result).toBe(outcome);
    expect(JSON.stringify(records)).not.toContain(f.credentials[0]!.token); expect(records[0]!.redactedTokenRef).not.toContain('forged-qr');
  });

  it('redeems after entry, replays the same receipt, and locks configuration without removing used rights', async () => {
    const f = await fixture(); await consume(f);
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    const input = { token: f.credentials[0]!.token, showtimeId: f.show.id, benefitEntitlementId: entitlement!.id, deviceAttemptId: randomUUID(), confirmed: true };
    const first = await request(app.getHttpServer()).post('/field/benefits/redeem').send(input);
    const retry = await request(app.getHttpServer()).post('/field/benefits/redeem').send(input);
    expect(first.body.outcome).toBe('redeemed'); expect(retry.body).toMatchObject({ outcome: 'redeemed', redemptionEventId: first.body.redemptionEventId });
    const admin = new AdminBenefitsService(db, new AdminAuditService(db));
    const config = await admin.getConfiguration(f.show.id);
    await expect(admin.saveConfiguration(f.show.id, actorId, { benefits: config!.benefits, reason: 'Must remain locked' })).rejects.toThrow();
    const verified = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: f.credentials[0]!.token, showtimeId: f.show.id });
    expect(verified.body.ticket.benefitEntitlements[0].state).toBe('redeemed');
    expect((await states(f))[1]!.admissionState).toBe('not_entered');
  });

  it('serializes configuration changes behind an in-flight first redemption', async () => {
    const f = await fixture(); const blocker = await pool.connect(); const admin = new AdminBenefitsService(db, new AdminAuditService(db));
    const config = await admin.getConfiguration(f.show.id);
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM reservations WHERE id=$1 FOR UPDATE', [f.order.id]);
      const redeem = request(app.getHttpServer()).post('/field/benefits/redeem').send({ token: f.credentials[0]!.token,
        showtimeId: f.show.id, benefitEntitlementId: entitlement!.id, deviceAttemptId: randomUUID(), confirmed: true }).then((r) => r);
      await waitForLock('INNER JOIN payments p');
      const change = admin.saveConfiguration(f.show.id, actorId, { benefits: config!.benefits, reason: 'Concurrent edit' }).then(() => 'saved', () => 'locked');
      await waitForLock('FROM showtimes');
      await blocker.query('COMMIT');
      expect((await redeem).body.outcome).toBe('redeemed'); expect(await change).toBe('locked');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('lists showtime labels only with field verification permission', async () => {
    const f = await fixture();
    const response = await request(app.getHttpServer()).get('/field/check-in/showtimes');
    expect(response.status).toBe(200); expect(response.body).toContainEqual(expect.objectContaining({ id: f.show.id, title: f.event.title }));
    expect((await request(app.getHttpServer()).get('/field/check-in/showtimes').set('x-test-bundle', 'finance')).status).toBe(403);
  });

  it('binds a rejected entry receipt to the requested showtime as well as the actual ticket', async () => {
    const f = await fixture(); const input = { token: f.credentials[0]!.token, showtimeId: randomUUID(), deviceAttemptId: randomUUID(), confirmed: true };
    const send = (body: typeof input) => request(app.getHttpServer()).post('/field/check-in/consume').send(body);
    const first = await send(input); expect(first.body.outcome).toBe('wrong_showtime');
    const replay = await send(input); expect(replay.status).toBe(201);
    expect(replay.body).toMatchObject({ outcome: 'wrong_showtime', scanEventId: first.body.scanEventId });
    expect((await send({ ...input, showtimeId: f.show.id })).status).toBe(409);
  });

  it('binds a rejected benefit receipt to its requested showtime', async () => {
    const f = await fixture();
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    const input = { token: f.credentials[0]!.token, showtimeId: randomUUID(), benefitEntitlementId: entitlement!.id, deviceAttemptId: randomUUID(), confirmed: true };
    const send = (body: typeof input) => request(app.getHttpServer()).post('/field/benefits/redeem').send(body);
    expect((await send(input)).body.outcome).toBe('wrong_showtime');
    expect((await send(input)).body.outcome).toBe('wrong_showtime');
    expect((await send({ ...input, showtimeId: f.show.id })).status).toBe(409);
  });

  it('rejects a real signed QR with a changed signature without server errors or permanent offline pending', async () => {
    const f = await fixture(); const parts = f.credentials[0]!.token.split('.');
    parts[2] = (parts[2]!.startsWith('a') ? 'b' : 'a') + parts[2]!.slice(1); const altered = parts.join('.');
    const verified = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: altered, showtimeId: f.show.id });
    expect(verified.status).toBe(201); expect(verified.body.outcome).toBe('tampered');
    const synced = await request(app.getHttpServer()).post('/field/check-in/offline-sync').send({ attempts: [{ token: altered,
      showtimeId: f.show.id, scannerUserId: actorId, deviceAttemptId: randomUUID(), attemptedAt: new Date().toISOString(),
      redactedTokenRef: 'test-redacted-token', syncState: 'pending' }] });
    expect(synced.body.results[0]).toMatchObject({ syncState: 'rejected', outcome: 'tampered' });
  });

  it('classifies a signed expired JWT as expired and does not consume its ticket', async () => {
    const f = await fixture(); const jwt = new JwtService();
    const payload = jwt.decode(f.credentials[0]!.token) as Record<string, unknown>;
    const expired = await jwt.signAsync({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, {
      secret: 'field-test-signing-secret-at-least-32-characters', algorithm: 'HS256', noTimestamp: true,
    });
    const verified = await request(app.getHttpServer()).post('/field/check-in/verify').send({ token: expired, showtimeId: f.show.id });
    expect(verified.status).toBe(201); expect(verified.body.outcome).toBe('expired');
    expect((await states(f)).every((x) => x.admissionState === 'not_entered')).toBe(true);
  });

  it('allows concurrent admission and first benefit redemption without a showtime foreign-key deadlock', async () => {
    const f = await fixture(); const blocker = await pool.connect();
    const [entitlement] = await db.select().from(schema.ticketBenefitEntitlements).where(eq(schema.ticketBenefitEntitlements.ticketItemId, f.items[0]!.id));
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [f.credentials[0]!.id]);
      const admission = consume(f).then((response) => response);
      await waitForLock('SELECT id FROM tickets');
      const redemption = request(app.getHttpServer()).post('/field/benefits/redeem').send({ token: f.credentials[0]!.token,
        showtimeId: f.show.id, benefitEntitlementId: entitlement!.id, deviceAttemptId: randomUUID(), confirmed: true }).then((response) => response);
      await waitForLock('INNER JOIN payments p');
      await blocker.query('COMMIT');
      const results = await Promise.all([admission, redemption]);
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect(results.map((result) => result.body.outcome)).toEqual(['entered', 'redeemed']);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

});
