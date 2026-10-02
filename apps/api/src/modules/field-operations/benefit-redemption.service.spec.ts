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

function redemptionDependencies(failure?: unknown) {
  const dialect = new PgDialect();
  const statements: string[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) query[method] = vi.fn(() => query);
  query.limit = vi.fn(async () => []);
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
  const service = new BenefitRedemptionService(db as never, { verifyTicketForScannerContract: vi.fn() } as never);
  return { service, statements, tx };
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
