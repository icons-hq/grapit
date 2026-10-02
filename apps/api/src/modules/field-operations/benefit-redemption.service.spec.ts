import { createHash } from 'node:crypto';
import { ConflictException, RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { BenefitRedemptionController } from './benefit-redemption.controller.js';
import { BenefitRedemptionService } from './benefit-redemption.service.js';

// Persistence, competing requests, input binding, negative attempts, after-entry
// redemption and result locks are covered by the real HTTP/PostgreSQL suite.
describe('Benefit redemption route contract', () => {
  it('requires online redemption with its own capability within the scanner bundle', () => {
    expect(Reflect.getMetadata(PATH_METADATA, BenefitRedemptionController)).toBe('field/benefits');
    expect(Reflect.getMetadata(ROLES_KEY, BenefitRedemptionController)).toEqual(['admin']);
    expect(Reflect.getMetadata(PATH_METADATA, BenefitRedemptionController.prototype.redeem)).toBe('redeem');
    expect(Reflect.getMetadata(METHOD_METADATA, BenefitRedemptionController.prototype.redeem)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ADMIN_CAPABILITIES_KEY, BenefitRedemptionController.prototype.redeem)).toEqual(['field.benefits.redeem']);
    expect(Object.getOwnPropertyNames(BenefitRedemptionController.prototype)).toEqual(['constructor', 'redeem']);
  });
});

const input = {
  token: 'opaque-qr-token',
  showtimeId: '00000000-0000-4000-8000-000000000001',
  benefitEntitlementId: '00000000-0000-4000-8000-000000000801',
  deviceAttemptId: 'benefit-attempt-1',
  confirmed: true as const,
};
const context = { scannerUserId: 'scanner-1' };

function redemptionDependencies(failure?: unknown, selectedRows: unknown[][] = []) {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) query[method] = vi.fn(() => query);
  // Each select resolves the next prepared row set, then nothing.
  const pendingRows = [...selectedRows];
  query.limit = vi.fn(async () => pendingRows.shift() ?? []);
  const tx = {
    execute: vi.fn(async (statement: SQL) => {
      const rendered = dialect.sqlToQuery(statement);
      statements.push(`${rendered.sql} ${JSON.stringify(rendered.params)}`);
      if (failure && statements.length === 2) throw failure;
      return [];
    }),
    select: vi.fn(() => query),
    insert: vi.fn(),
    update: vi.fn(),
  };
  const db = { transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)) };
  const verifyTicketForScannerContract = vi.fn();
  const service = new BenefitRedemptionService(db as never, { verifyTicketForScannerContract } as never);
  return { service, statements, tx, verifyTicketForScannerContract };
}

/** Drizzle wraps the driver error, so the SQLSTATE sits on the cause. */
function wrappedPostgresError(code: string) {
  return Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('pg error'), { code }) });
}

// Payment confirmation share-locks the same showtime row; a first redemption must
// not wait without bound behind a stream of confirmations (audit D6).
describe('Field benefit redemption lock budget', () => {
  it('bounds lock waits and statement time before taking any lock', async () => {
    const { service, statements } = redemptionDependencies();

    await expect(service.redeem(input, context)).resolves.toMatchObject({ outcome: 'not_eligible' });

    expect(statements[0]).toContain("set_config('lock_timeout', $1, true)");
    expect(statements[0]).toContain("set_config('statement_timeout', $2, true)");
    expect(statements[0]).toContain('["3s","10s"]');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
  });

  it('answers a lock timeout with a retryable conflict that tells staff not to hand over the item', async () => {
    const { service } = redemptionDependencies(wrappedPostgresError('55P03'));

    const error = await service.redeem(input, context).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      '같은 회차 결제 처리와 겹쳐 특전 지급을 확인하지 못했습니다. 실물을 지급하지 말고 같은 요청으로 다시 확인해주세요.',
    );
  });

  it('answers a statement timeout with 503', async () => {
    const { service } = redemptionDependencies(wrappedPostgresError('57014'));

    await expect(service.redeem(input, context)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('passes other failures through unchanged', async () => {
    const failure = new Error('database unavailable');
    const { service } = redemptionDependencies(failure);

    await expect(service.redeem(input, context)).rejects.toBe(failure);
  });
});

const TICKET_ITEM_ID = '00000000-0000-4000-8000-000000000901';
const SCANNER_ID = '00000000-0000-4000-8000-000000000501';

function entitlementRow() {
  const copy = { name: '공식 포스터', description: '공식 포스터 설명' };
  return {
    id: input.benefitEntitlementId,
    ticketItemId: TICKET_ITEM_ID,
    showtimeId: input.showtimeId,
    runId: null,
    source: 'configuration',
    benefitIdentity: 'benefit_official_poster',
    benefitKind: 'included',
    displayCopySnapshot: { ko: copy, en: copy, 'zh-CN': copy, th: copy },
    state: 'redeemed',
    redeemedAt: new Date('2026-10-03T10:00:00.000Z'),
    redeemedByUserId: SCANNER_ID,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-03T10:00:00.000Z'),
  };
}

function recordedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000601',
    showtimeId: input.showtimeId,
    requestedShowtimeId: input.showtimeId,
    ticketItemId: TICKET_ITEM_ID,
    benefitEntitlementId: input.benefitEntitlementId,
    scannerUserId: SCANNER_ID,
    deviceAttemptId: input.deviceAttemptId,
    result: 'redeemed',
    redactedTokenRef: `qr:${createHash('sha256').update(input.token).digest('hex').slice(0, 16)}`,
    rejectionReason: null,
    createdAt: new Date('2026-10-03T10:00:00.000Z'),
    ...overrides,
  };
}

// A retry of a settled redemption used to queue behind the showtime lock that
// payment confirmations share-lock, and answered 409 after 3 s (field-ops-12).
describe('Field benefit redemption retry of a recorded attempt', () => {
  it('returns the first result without taking the showtime or ticket locks', async () => {
    const { service, statements, tx, verifyTicketForScannerContract } = redemptionDependencies(undefined, [
      [recordedAttempt()],
      [entitlementRow()],
    ]);

    await expect(service.redeem(input, { scannerUserId: SCANNER_ID })).resolves.toMatchObject({
      outcome: 'redeemed',
      redemptionEventId: '00000000-0000-4000-8000-000000000601',
      redeemedAt: '2026-10-03T10:00:00.000Z',
    });

    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements.join('\n')).not.toContain('FOR NO KEY UPDATE');
    expect(statements.join('\n')).not.toContain('FOR UPDATE');
    expect(verifyTicketForScannerContract).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('keeps answering 409 when the recorded attempt belongs to another redemption', async () => {
    const { service, statements, tx } = redemptionDependencies(undefined, [
      [recordedAttempt({ scannerUserId: '00000000-0000-4000-8000-000000000502' })],
      [entitlementRow()],
    ]);

    await expect(service.redeem(input, { scannerUserId: SCANNER_ID })).rejects.toBeInstanceOf(ConflictException);

    expect(statements.join('\n')).not.toContain('FOR NO KEY UPDATE');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('takes the showtime lock before the first redemption of an attempt', async () => {
    const { service, statements } = redemptionDependencies(undefined, [
      [],
      [{ ...entitlementRow(), state: 'active', redeemedAt: null, redeemedByUserId: null }],
    ]);

    // The re-read after the locks finds no entitlement here; only the lock order matters.
    await service.redeem(input, { scannerUserId: SCANNER_ID }).catch(() => undefined);

    expect(statements[2]).toContain('FOR NO KEY UPDATE');
    expect(statements[3]).toContain('FOR UPDATE OF r, p, ti');
  });
});
