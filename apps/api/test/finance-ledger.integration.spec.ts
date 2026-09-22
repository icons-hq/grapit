import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from '../src/database/schema/index.js';
import type { DrizzleDB } from '../src/database/drizzle.provider.js';
import { AdminSettlementController } from '../src/modules/admin/admin-settlement.controller.js';
import { FinanceLedgerService } from '../src/modules/admin/finance-ledger.service.js';
import { AdminAuditService } from '../src/modules/admin/admin-audit.service.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { AdminCapabilitiesGuard } from '../src/common/guards/admin-capabilities.guard.js';
import { createPostgresPoolCleanup } from './helpers/postgres-pool-cleanup.js';
import type { TossPaymentsClient } from '../src/modules/payment/toss-payments.client.js';

describe('Finance ledger — authenticated HTTP and PostgreSQL', () => {
  let container: StartedTestContainer;
  let closePool: (() => Promise<void>) | undefined;
  let app: INestApplication;
  let db: DrizzleDB;
  let actorId: string;
  const provider = { querySettlements: vi.fn() };
  beforeEach(() => provider.querySettlements.mockReset().mockResolvedValue([]));

  beforeAll(async () => {
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'finance_test' })
      .withExposedPorts(5432).start();
    const pool = new Pool({ host: container.getHost(), port: container.getMappedPort(5432),
      user: 'postgres', password: 'test', database: 'finance_test', max: 5 });
    closePool = createPostgresPoolCleanup(pool);
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: 'src/database/migrations' });
    actorId = randomUUID();
    await db.insert(schema.users).values({ id: actorId, email: `${actorId}@example.test`,
      name: 'Finance operator', phone: '+821000000000', gender: 'unspecified', birthDate: '1990-01-01', role: 'admin' });
    Reflect.defineMetadata('design:paramtypes', [FinanceLedgerService], AdminSettlementController);
    const module = await Test.createTestingModule({ controllers: [AdminSettlementController], providers: [
      { provide: FinanceLedgerService, useValue: new FinanceLedgerService(db, provider as unknown as TossPaymentsClient, new AdminAuditService(db)) },
    ] }).overrideGuard(RolesGuard).useValue(new RolesGuard(new Reflector()))
      .overrideGuard(AdminCapabilitiesGuard).useValue(new AdminCapabilitiesGuard(new Reflector())).compile();
    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { user: { id: actorId, role: 'admin', adminCapabilityBundle: req.get('x-test-bundle') ?? 'finance' } }); next();
    });
    await app.listen(0, '127.0.0.1');
  }, 120000);
  afterAll(async () => { await app?.close(); await closePool?.(); await container?.stop(); });

  async function sample() {
    const [performance] = await db.insert(schema.performances).values({ title: 'Finance example', genre: 'concert',
      startDate: new Date('2026-12-01T10:00:00Z'), endDate: new Date('2026-12-01T12:00:00Z'), ageRating: '전체' }).returning();
    const [show] = await db.insert(schema.showtimes).values({ performanceId: performance!.id, dateTime: new Date('2026-12-01T10:00:00Z') }).returning();
    const [reservation] = await db.insert(schema.reservations).values({ userId: actorId, showtimeId: show!.id,
      reservationNumber: `FIN-${randomUUID().slice(0, 16)}`, status: 'CONFIRMED', totalAmount: 104000,
      cancelDeadline: new Date('2026-12-01T00:00:00Z'), createdAt: new Date('2026-08-31T15:10:00Z') }).returning();
    const [payment] = await db.insert(schema.payments).values({ reservationId: reservation!.id, paymentKey: randomUUID(),
      tossOrderId: randomUUID(), provider: 'PAYPAL', method: 'FOREIGN_EASY_PAY', currency: 'KRW', amount: 104000,
      providerChargeCurrency: 'USD', providerChargeAmountMinor: 8000, status: 'DONE', paidAt: new Date('2026-08-31T15:15:00Z') }).returning();
    await db.insert(schema.ticketItems).values(['A-1', 'A-2'].map((seat, index) => ({ reservationId: reservation!.id,
      paymentId: payment!.id, showtimeId: show!.id, seatId: seat, seatKey: `1F:${seat}`, floorKey: '1F', floorLabel: '1층',
      tierName: 'VIP', row: 'A', number: String(index + 1), price: 50000, serviceFee: 2000,
      createdAt: new Date('2026-08-31T15:15:00Z'),
      updatedAt: new Date(index === 0 ? '2026-09-03T01:00:00Z' : '2026-08-31T15:15:00Z'),
      ...(index === 0 ? { status: 'cancelled' as const, cancelledAt: new Date('2026-09-03T01:00:00Z'),
        cancellationFee: 5000, refundableAmount: 45000, cancellationCommand: { version: 1 as const, id: randomUUID(),
          requestedAt: '2026-09-03T00:59:00Z', completedAt: '2026-09-03T01:00:00Z', reason: 'Test', options: { idempotencyKey: randomUUID(), secretKeyScope: 'foreign-easy-pay' as const },
          currency: 'USD' as const, amountMinor: 3461, originalAmountMinor: 8000, balanceBeforeMinor: 8000 } } : {}),
    })));
    return { eventId: performance!.id, showtimeId: show!.id, paymentId: payment!.id, paymentKey: payment!.paymentKey, reservationId: reservation!.id };
  }

  it('keeps the original order once, completed refunds, retained fees and remaining tickets separate, with exact USD minor units', async () => {
    const fixture = await sample();
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      showtimeId: fixture.showtimeId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' });
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ paymentCount: 1, originalOrderKrw: 104000, confirmedRefundKrw: 45000,
      pendingRefundKrw: 0, remainingTicketKrw: 52000, retainedCancellationFeeKrw: 5000, retainedServiceFeeKrw: 2000 });
    expect(response.body.currencies).toEqual([{ currency: 'USD', exponent: 2, chargeMinor: 8000,
      confirmedCancelMinor: 3461, pendingCancelMinor: 0, balanceMinor: 4539, unknownPaymentCount: 0 }]);
    expect(response.body.provider.status).toBe('not_queried');
    expect(response.body.bankEvidence).toBe('unverified');
    expect(response.body.closingStatus).toBe('not_closed');
  });

  it('rejects provider ranges longer than 31 inclusive days before any external request while keeping internal ledger access', async () => {
    const fixture = await sample();
    provider.querySettlements.mockClear();
    const query = { eventId: fixture.eventId, dateFrom: '2026-08-01', dateTo: '2026-09-01',
      dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z', includeProvider: 'true' };
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query)).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/admin/settlement/ledger/export')
      .send({ query, dataset: 'provider', reason: 'Range boundary test' })).status).toBe(400);
    expect(provider.querySettlements).not.toHaveBeenCalled();
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger')
      .query({ ...query, includeProvider: 'false' })).status).toBe(200);
    provider.querySettlements.mockResolvedValue([]);
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger')
      .query({ ...query, dateTo: '2026-08-31' })).status).toBe(200);
    expect(provider.querySettlements).toHaveBeenCalledTimes(2);
  });

  it('combines an earlier seat cancellation with a later remaining-order refund without losing its USD receipt or counting it twice', async () => {
    const fixture = await sample();
    const items = await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.paymentId, fixture.paymentId));
    const remaining = items.find((item) => item.status === 'active')!;
    await db.update(schema.ticketItems).set({ status: 'cancelled', cancelledAt: new Date('2026-09-05T01:00:00Z'),
      cancellationFee: 5000, refundableAmount: 45000 }).where(eq(schema.ticketItems.id, remaining.id));
    await db.insert(schema.refunds).values({ paymentId: fixture.paymentId, reservationId: fixture.reservationId,
      status: 'completed', provider: 'toss_payments', requestedAt: new Date('2026-09-05T00:00:00Z'), completedAt: new Date('2026-09-05T01:00:00Z'),
      providerMetadata: { providerRefund: { currency: 'USD', amountMinor: 3462 },
        cancellationQuote: { items: [{ ticketItemId: remaining.id }] } } });
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-05', dateTo: '2026-09-05', dateBasis: 'cancelled_at', asOf: '2026-09-06T00:00:00Z' });
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({ paymentCount: 1, originalOrderKrw: 104000, confirmedRefundKrw: 90000,
      remainingTicketKrw: 0, retainedCancellationFeeKrw: 10000, retainedServiceFeeKrw: 4000, periodApprovedKrw: 0, periodRefundKrw: 45000 });
    expect(response.body.currencies[0]).toMatchObject({ chargeMinor: 8000, confirmedCancelMinor: 6923, balanceMinor: 1077, unknownPaymentCount: 0 });
  });

  it('queries payout dates independently of approval cohorts and preserves signed USD settlement transactions', async () => {
    const fixture = await sample();
    provider.querySettlements.mockResolvedValue([
      { paymentKey: fixture.paymentKey, transactionKey: 'approval', currency: 'USD', amount: 80, payOutAmount: 77.60, soldDate: '2026-09-01', paidOutDate: '2026-09-06' },
      { paymentKey: fixture.paymentKey, transactionKey: 'cancel', currency: 'USD', amount: -34.61, payOutAmount: -33.57, soldDate: '2026-09-03', paidOutDate: '2026-09-06' },
    ]);
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-06', dateTo: '2026-09-06', dateBasis: 'paid_at', asOf: '2026-09-07T00:00:00Z', includeProvider: 'true', providerDateBasis: 'paidOutDate' });
    expect(response.status).toBe(200);
    expect(response.body.summary.paymentCount).toBe(0);
    expect(response.body.provider).toMatchObject({ status: 'ready', dateBasis: 'paidOutDate', rows: [
      { currency: 'USD', amountMinor: 8000, feeMinor: 240, payoutMinor: 7760, transactionKey: 'approval' },
      { currency: 'USD', amountMinor: -3461, feeMinor: -104, payoutMinor: -3357, transactionKey: 'cancel' },
    ] });
    expect(provider.querySettlements).toHaveBeenCalledWith(expect.objectContaining({ dateType: 'paidOutDate', startDate: '2026-09-06', endDate: '2026-09-06', secretKeyScope: 'default' }));
  });

  it('exports the same amount and date basis without buyer details or payment keys and records the export reason', async () => {
    const fixture = await sample();
    const query = { eventId: fixture.eventId, showtimeId: fixture.showtimeId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' };
    const response = await request(app.getHttpServer()).post('/admin/settlement/ledger/export')
      .send({ query, dataset: 'payments', reason: '9월 승인·취소 원장 대조' });
    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('USD');
    expect(response.text).toContain('8000');
    expect(response.text).toContain('3461');
    expect(response.text).toContain('4539');
    expect(response.text).toContain('104000');
    expect(response.text).toContain('45000');
    expect(response.text).toContain('paid_at');
    expect(response.text).toContain('Asia/Seoul');
    expect(response.text).toContain('2026-09-04T00:00:00Z');
    expect(response.text).not.toContain(fixture.paymentKey);
    expect(response.text).not.toContain('@example.test');
    const audit = await new AdminAuditService(db).query({ action: 'settlement.export', resourceId: fixture.eventId });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ status: 'success', reason: '9월 승인·취소 원장 대조' });
  });

  it('reconstructs pending versus completed cancellation at the chosen cutoff and excludes other KST dates and showtimes', async () => {
    const fixture = await sample();
    const query = { eventId: fixture.eventId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-03T00:59:30Z' };
    const pending = await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query);
    expect(pending.body.summary).toMatchObject({ paymentCount: 1, confirmedRefundKrw: 0, pendingRefundKrw: 45000, remainingTicketKrw: 52000 });
    expect(pending.body.currencies[0]).toMatchObject({ confirmedCancelMinor: 0, pendingCancelMinor: 3461, balanceMinor: 8000 });
    const previousDate = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ ...query, dateFrom: '2026-08-31', dateTo: '2026-08-31' });
    expect(previousDate.body.summary.paymentCount).toBe(0);
    const other = await sample();
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ ...query, showtimeId: other.showtimeId })).status).toBe(400);
  });

  it('distinguishes PG errors, missing currency evidence and a successful empty result without changing local ledger totals', async () => {
    const fixture = await sample();
    const query = { eventId: fixture.eventId, dateFrom: '2026-09-01', dateTo: '2026-09-06', dateBasis: 'paid_at', asOf: '2026-09-07T00:00:00Z', includeProvider: 'true' };
    provider.querySettlements.mockRejectedValueOnce(new Error('provider unavailable'));
    const failed = await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query);
    expect(failed.body.provider.status).toBe('failed');
    expect(failed.body.summary.originalOrderKrw).toBe(104000);
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query)).body.provider.status).toBe('empty');
    provider.querySettlements.mockResolvedValue([{ paymentKey: fixture.paymentKey, transactionKey: 'missing-currency', amount: 80, payOutAmount: 77.6, soldDate: '2026-09-01', paidOutDate: '2026-09-06' }]);
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query)).body.provider.status).toBe('failed');
    expect((await request(app.getHttpServer()).post('/admin/settlement/ledger/export').send({ query, dataset: 'provider', reason: '실패 대조' })).status).toBe(502);
  });

  it.each(['operator', 'scanner'])('blocks %s finance reads and exports through the actual API guards', async (bundle) => {
    const fixture = await sample();
    const query = { eventId: fixture.eventId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' };
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').set('x-test-bundle', bundle).query(query)).status).toBe(403);
    expect((await request(app.getHttpServer()).post('/admin/settlement/ledger/export').set('x-test-bundle', bundle).send({ query, dataset: 'payments', reason: '검증' })).status).toBe(403);
  });

  it('rejects invalid dates and missing export reason before producing any financial file', async () => {
    const fixture = await sample();
    const query = { eventId: fixture.eventId, dateFrom: '2026-02-30', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' };
    expect((await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query)).status).toBe(400);
    expect((await request(app.getHttpServer()).post('/admin/settlement/ledger/export').send({ query: { ...query, dateFrom: '2026-09-01' }, dataset: 'payments', reason: ' ' })).status).toBe(400);
  });

  it('does not keep a refused full refund pending after its ticket rights were restored', async () => {
    const fixture = await sample();
    const items = await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.paymentId, fixture.paymentId));
    const remaining = items.find((item) => item.status === 'active')!;
    await db.insert(schema.refunds).values({ paymentId: fixture.paymentId, reservationId: fixture.reservationId,
      status: 'failed', provider: 'toss_payments', requestedAt: new Date('2026-09-05T00:00:00Z'), failedAt: new Date('2026-09-05T01:00:00Z'),
      providerMetadata: { rightsRestoredAt: '2026-09-05T01:00:00Z', providerRefund: { currency: 'USD', amountMinor: 3462 }, cancellationQuote: { items: [{ ticketItemId: remaining.id }] } } });
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-06T00:00:00Z' });
    expect(response.body.summary.remainingTicketKrw).toBe(52000);
    expect(response.body.currencies[0].pendingCancelMinor).toBe(0);
  });

  it.each([false, true])('uses the original full-refund quote before restoration, including previous attempts: later retry %s', async (retried) => {
    const fixture = await sample();
    const items = await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.paymentId, fixture.paymentId));
    const remaining = items.find((item) => item.status === 'active')!;
    const cancellationQuote = { items: [{ ticketItemId: remaining.id, refundableAmount: 45000, cancellationFee: 5000, serviceFeeRefund: 0 }] };
    const original = { requestedAt: '2026-09-05T00:00:00Z', failedAt: '2026-09-05T01:00:00Z', rightsRestoredAt: '2026-09-05T01:00:00Z',
      cancellationQuote, cancelRequest: { options: { currency: 'USD', cancelAmount: 34.62 } } };
    await db.insert(schema.refunds).values({ paymentId: fixture.paymentId, reservationId: fixture.reservationId,
      status: retried ? 'requested' : 'failed', provider: 'toss_payments', requestedAt: new Date(retried ? '2026-09-08T00:00:00Z' : original.requestedAt),
      failedAt: retried ? null : new Date(original.failedAt), providerMetadata: retried
        ? { previousAttempts: [original], cancellationQuote: { items: [{ ticketItemId: remaining.id, refundableAmount: 50000, cancellationFee: 0, serviceFeeRefund: 0 }] }, providerRefund: { currency: 'USD', amountMinor: 3846 } }
        : { ...original, providerRefund: { currency: 'USD', amountMinor: 3462 } } });
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-05T00:30:00Z' });
    expect(response.body.summary).toMatchObject({ confirmedRefundKrw: 45000, pendingRefundKrw: 45000, remainingTicketKrw: 0 });
    expect(response.body.currencies[0]).toMatchObject({ confirmedCancelMinor: 3461, pendingCancelMinor: 3462 });
  });

  it.each(['ALIPAY_PLUS', 'TRUEMONEY', 'OVERSEAS_CARD'])('does not invent a KRW provider charge for %s when the provider snapshot is missing', async (providerName) => {
    const fixture = await sample();
    await db.update(schema.payments).set({ provider: providerName === 'OVERSEAS_CARD' ? 'CARD' : providerName,
      providerMetadata: providerName === 'OVERSEAS_CARD' ? { requestedProvider: 'OVERSEAS_CARD' } : {},
      providerChargeCurrency: null, providerChargeAmountMinor: null }).where(eq(schema.payments.id, fixture.paymentId));
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' });
    expect(response.body.rows[0].chargeMinor).toBeNull();
    expect(response.body.summary.unknownPaymentCount).toBe(1);
    expect(response.body.currencies).toEqual([]);
  });

  it.each([undefined, 'not-a-date', '2026-02-30'])('reports invalid PG date evidence as failed, never empty: %s', async (paidOutDate) => {
    const fixture = await sample();
    provider.querySettlements.mockResolvedValue([{ paymentKey: fixture.paymentKey, transactionKey: 'invalid-date', currency: 'USD',
      amount: 80, payOutAmount: 77.6, soldDate: '2026-09-01', paidOutDate }]);
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-06', dateBasis: 'paid_at', asOf: '2026-09-07T00:00:00Z', includeProvider: 'true' });
    expect(response.body.provider.status).toBe('failed');
  });

  it('reports cancellation amounts as unknown for a paid-then-compensated order without ticket evidence', async () => {
    const fixture = await sample();
    await db.delete(schema.ticketItems).where(eq(schema.ticketItems.paymentId, fixture.paymentId));
    await db.update(schema.payments).set({ status: 'CANCELED', cancelledAt: new Date('2026-09-03T01:00:00Z') }).where(eq(schema.payments.id, fixture.paymentId));
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' });
    expect(response.body.rows[0]).toMatchObject({ chargeMinor: 8000, confirmedCancelMinor: null, balanceMinor: null, confirmedRefundKrw: null });
    expect(response.body.summary.unknownPaymentCount).toBe(1);
    expect(response.body.currencies[0].confirmedCancelMinor).toBeNull();
  });

  it('retires the ambiguous legacy finance contracts instead of returning contradictory totals', async () => {
    const fixture = await sample();
    expect((await request(app.getHttpServer()).get('/admin/settlement/summary').query({ eventId: fixture.eventId })).status).toBe(410);
    expect((await request(app.getHttpServer()).post('/admin/settlement/export').send({ eventId: fixture.eventId,
      dataset: 'settlement_accounting_input', reason: '레거시 계약 확인' })).status).toBe(410);
  });

  it('preserves a payment/order difference instead of substituting the order amount for the stored approved amount', async () => {
    const fixture = await sample();
    await db.update(schema.payments).set({ amount: 103999 }).where(eq(schema.payments.id, fixture.paymentId));
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query({ eventId: fixture.eventId,
      dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-04T00:00:00Z' });
    expect(response.body.rows[0]).toMatchObject({ originalOrderKrw: 104000, storedPaymentAmount: 103999, storedPaymentCurrency: 'KRW' });
    expect(response.body.summary.confirmedPaymentKrw).toBe(103999);
    expect(response.body.rows[0].warnings.length).toBeGreaterThan(0);
  });

  it('marks an erased seat-cancellation history as unknown instead of restoring historical active/zero amounts', async () => {
    const fixture = await sample();
    const [item] = await db.select().from(schema.ticketItems).where(eq(schema.ticketItems.paymentId, fixture.paymentId));
    // Shape written by restorePreparedTicketItemCancellation after a pre-PG internal failure.
    await db.update(schema.ticketItems).set({ status: 'active', cancelledAt: null, cancellationCommand: null,
      refundableAmount: 0, cancellationFee: 0, serviceFeeRefund: 0, updatedAt: new Date('2026-09-05T01:00:00Z') })
      .where(eq(schema.ticketItems.id, item!.id));
    const query = { eventId: fixture.eventId, dateFrom: '2026-09-01', dateTo: '2026-09-01', dateBasis: 'paid_at', asOf: '2026-09-05T00:30:00Z' };
    const response = await request(app.getHttpServer()).get('/admin/settlement/ledger').query(query);
    expect(response.body.rows[0].tickets.find((ticket: { id: string }) => ticket.id === item!.id).state).toBe('unknown');
    expect(response.body.summary).toMatchObject({ remainingTicketKrw: null, pendingRefundKrw: null });
    expect(response.body.rows[0].confirmedCancelMinor).toBeNull();
    const cancellationWindow = await request(app.getHttpServer()).get('/admin/settlement/ledger')
      .query({ ...query, dateBasis: 'cancelled_at', dateFrom: '2026-09-05', dateTo: '2026-09-05' });
    expect(cancellationWindow.body.rows).toHaveLength(1);
    expect(cancellationWindow.body.warnings.join(' ')).toContain('대조 후보');
  });
});
