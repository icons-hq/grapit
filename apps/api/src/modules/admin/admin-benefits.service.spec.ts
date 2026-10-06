import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi, type Mock } from 'vitest';

import type { BenefitDefinition } from '@grabit/shared';
import { ADMIN_CAPABILITIES_KEY } from '../../common/decorators/admin-capabilities.decorator.js';
import {
  ticketBenefitConfigurationChanges,
  ticketBenefitConfigurations,
  ticketBenefitEntitlements,
  ticketBenefits,
} from '../../database/schema/index.js';
import type { AdminAuditService } from './admin-audit.service.js';
import { AdminBenefitsController } from './admin-benefits.controller.js';
import * as csvExport from './csv-export.util.js';
import { AdminBenefitsService } from './admin-benefits.service.js';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000a1';
const CONFIG_EXISTING_ID = '00000000-0000-4000-8000-00000000c001';
const CONFIG_NEW_ID = '00000000-0000-4000-8000-00000000c002';
const NOW = new Date('2026-06-18T01:23:45.000Z');

function copy(name: string, description = `${name} description`) {
  return {
    ko: { name, description },
    en: { name, description },
    'zh-CN': { name, description },
    th: { name, description },
  };
}

function includedBenefit(overrides: Partial<BenefitDefinition> = {}): BenefitDefinition {
  return {
    identity: 'drink-voucher',
    kind: 'included',
    displayCopy: copy('무료 음료'),
    eligibleTierNames: ['VIP'],
    mutuallyExclusiveWith: [],
    ...overrides,
  } as BenefitDefinition;
}

function limitedBenefit(overrides: Partial<BenefitDefinition> = {}): BenefitDefinition {
  return {
    identity: 'meet-and-greet',
    kind: 'limited',
    displayCopy: copy('밋앤그릿'),
    eligibleTierNames: ['VIP'],
    quantity: 10,
    selectionPriority: 1,
    mutuallyExclusiveWith: [],
    ...overrides,
  } as BenefitDefinition;
}

function dbBenefit(benefit: BenefitDefinition, configurationId = CONFIG_EXISTING_ID) {
  return {
    id: `benefit-${benefit.identity}`,
    configurationId,
    identity: benefit.identity,
    kind: benefit.kind,
    displayCopy: benefit.displayCopy,
    eligibleTierNames: benefit.eligibleTierNames,
    quantity: benefit.kind === 'limited' ? benefit.quantity : null,
    selectionPriority: benefit.kind === 'limited' ? benefit.selectionPriority : null,
    mutualExclusionGroup: benefit.mutuallyExclusiveWith.join(',') || null,
    createdAt: new Date('2026-06-17T00:00:00.000Z'),
    updatedAt: new Date('2026-06-17T00:00:00.000Z'),
  };
}

function configurationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_EXISTING_ID,
    showtimeId: SHOWTIME_ID,
    version: 1,
    createdByUserId: ACTOR_ID,
    updatedByUserId: ACTOR_ID,
    createdAt: new Date('2026-06-17T00:00:00.000Z'),
    updatedAt: new Date('2026-06-17T00:30:00.000Z'),
    ...overrides,
  };
}

type QueryCall = {
  selection?: unknown;
  table?: unknown;
  where?: unknown;
};

type ExecuteCall = { sql: string; params: unknown[] };
type ExecuteOptions = {
  inactivatedCount?: number;
  createdCount?: number;
  failWith?: unknown;
};

const dialect = new PgDialect();

function chainResult<T>(rows: T[], call?: QueryCall) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }
      if (prop === 'from') {
        return (table: unknown) => {
          if (call) {
            call.table = table;
          }
          return new Proxy({}, handler);
        };
      }
      if (prop === 'where') {
        return (where: unknown) => {
          if (call) {
            call.where = where;
          }
          return new Proxy({}, handler);
        };
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function createMockDb(
  selectRows: unknown[][],
  insertReturningRows = new Map<unknown, unknown[]>([
    [
      ticketBenefitConfigurations,
      [{
        id: CONFIG_NEW_ID,
        createdAt: NOW,
        updatedAt: NOW,
      }],
    ],
    [
      ticketBenefitConfigurationChanges,
      [{ id: 'change-1' }],
    ],
  ]),
  insertConflictReturningRows?: Map<unknown, unknown[]>,
  executeOptions: ExecuteOptions = {},
) {
  const selectCalls: QueryCall[] = [];
  const executeCalls: ExecuteCall[] = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const insertConflictDoNothingCalls: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const conflictReturningRows = (table: unknown, values: unknown) => {
    if (insertConflictReturningRows?.has(table)) {
      return insertConflictReturningRows.get(table) ?? [];
    }
    if (table === ticketBenefitEntitlements && Array.isArray(values)) {
      return values.map((_, index) => ({ id: `entitlement-created-${index + 1}` }));
    }
    return [];
  };

  const tx = {
    execute: vi.fn((query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      executeCalls.push(rendered);
      if (executeOptions.failWith && rendered.sql.includes('FROM showtimes')) {
        return Promise.reject(executeOptions.failWith);
      }
      if (rendered.sql.includes('FROM showtimes')) {
        return chainResult([{ id: SHOWTIME_ID }]);
      }
      if (rendered.sql.includes('changed AS')) {
        return chainResult([{ count: executeOptions.inactivatedCount ?? 0 }]);
      }
      if (rendered.sql.includes('inserted AS')) {
        return chainResult([{ count: executeOptions.createdCount ?? 0 }]);
      }
      return chainResult([]);
    }),
    select: vi.fn((selection?: unknown) => {
      const call: QueryCall = { selection };
      selectCalls.push(call);
      return chainResult(selectRows.shift() ?? [], call);
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values });
        const onConflictDoNothing = vi.fn(() => {
          insertConflictDoNothingCalls.push({ table, values });
          return {
            returning: vi.fn(() => chainResult(conflictReturningRows(table, values))),
            then: (resolve: (value: unknown[]) => void) => resolve([]),
          };
        });
        return {
          returning: vi.fn(() => chainResult(insertReturningRows.get(table) ?? [])),
          onConflictDoNothing,
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateCalls.push({ table, values });
        return {
          where: vi.fn(() => chainResult([])),
        };
      }),
    })),
  };
  const db = {
    ...tx,
    transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };

  return {
    db,
    tx,
    selectCalls,
    executeCalls,
    insertCalls,
    insertConflictDoNothingCalls,
    updateCalls,
  };
}

function createDependencies(
  selectRows: unknown[][] = [],
  insertReturningRows?: Map<unknown, unknown[]>,
  insertConflictReturningRows?: Map<unknown, unknown[]>,
  executeOptions: ExecuteOptions = {},
) {
  const db = createMockDb(selectRows, insertReturningRows, insertConflictReturningRows, executeOptions);
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & { write: Mock };
  const service = new AdminBenefitsService(db.db as never, adminAuditService);

  return { service, adminAuditService, ...db };
}

function syncStatements(executeCalls: ExecuteCall[]) {
  return executeCalls.filter((call) => call.sql.includes('ticket_benefit_entitlements'));
}

function desiredParam(call: ExecuteCall | undefined): unknown {
  const json = call?.params.find((param) =>
    typeof param === 'string' && param.startsWith('{'),
  );
  return JSON.parse(String(json));
}

describe('AdminBenefitsService', () => {
  it('locks the showtime row with lock and statement timeouts before configuration writes, audit, and included sync', async () => {
    const { service, tx, executeCalls, adminAuditService } = createDependencies([
      [],
      [],
      [],
      [],
    ]);

    await service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      { benefits: [includedBenefit()], reason: 'serialized mutation' },
      { now: NOW },
    );

    expect(executeCalls[0]?.sql).toContain('set_config');
    expect(executeCalls[0]?.params).toEqual(['3s', '30s']);
    expect(executeCalls[0]?.sql).toMatch(/set_config\('lock_timeout', \$1, true\)/);
    expect(executeCalls[0]?.sql).toMatch(/set_config\('statement_timeout', \$2, true\)/);
    expect(executeCalls[1]?.sql).toContain('FOR NO KEY UPDATE');
    expect(tx.execute.mock.invocationCallOrder[1])
      .toBeLessThan(tx.insert.mock.invocationCallOrder[0]!);
    expect(tx.execute.mock.invocationCallOrder[1])
      .toBeLessThan(adminAuditService.write.mock.invocationCallOrder[0]!);
  });

  it.each([
    ['55P03', ConflictException, '잠시 후 다시 시도'],
    ['57014', ServiceUnavailableException, '제한 시간'],
  ] as const)('maps PostgreSQL %s from the benefit lock to an operator-facing error', async (code, ErrorType, message) => {
    const driverError = Object.assign(new Error('Failed query'), { cause: { code } });
    const { service, insertCalls, adminAuditService } = createDependencies(
      [],
      undefined,
      undefined,
      { failWith: driverError },
    );

    const result = service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      { benefits: [includedBenefit()], reason: 'lock timeout' },
      { now: NOW },
    );

    await expect(result).rejects.toBeInstanceOf(ErrorType);
    await expect(result).rejects.toThrow(message);
    expect(insertCalls).toEqual([]);
    expect(adminAuditService.write).not.toHaveBeenCalled();
  });

  it('rejects mutual exclusion rules that the runner would ignore before opening a transaction', async () => {
    const { service, db } = createDependencies();
    const included = includedBenefit({ identity: 'vip-poster', mutuallyExclusiveWith: ['vip-raffle'] });
    const limited = limitedBenefit({ identity: 'vip-raffle' });

    await expect(service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      { benefits: [included, limited], reason: 'included exclusion' },
      { now: NOW },
    )).rejects.toThrow('기본 포함 특전에는 함께 배정하지 않을 특전을 설정할 수 없습니다');
    await expect(service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      {
        benefits: [
          includedBenefit({ identity: 'vip-poster' }),
          limitedBenefit({ identity: 'vip-raffle', mutuallyExclusiveWith: ['vip-poster'] }),
        ],
        reason: 'limited to included exclusion',
      },
      { now: NOW },
    )).rejects.toThrow('한정 특전끼리만');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('stores more than 120 characters of mutual exclusion identities', async () => {
    const identities = Array.from({ length: 4 }, (_, index) =>
      `benefit_${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const benefits = identities.map((identity, index) => limitedBenefit({
      identity,
      selectionPriority: index + 1,
      mutuallyExclusiveWith: identities.filter((other) => other !== identity),
    }));
    const { service, insertCalls } = createDependencies([[], []]);

    await service.saveConfiguration(SHOWTIME_ID, ACTOR_ID, { benefits, reason: '1인 1개' }, { now: NOW });

    const rows = insertCalls.find((call) => call.table === ticketBenefits)?.values as Array<{
      mutualExclusionGroup: string;
    }>;
    expect(rows[0]?.mutualExclusionGroup.length).toBeGreaterThan(120);
    expect(rows[0]?.mutualExclusionGroup.split(',')).toEqual(identities.slice(1));
  });

  it('creates or updates the active configuration for a showtime', async () => {
    const created = createDependencies([
      [],
      [],
      [],
      [],
    ]);

    await expect(
      created.service.saveConfiguration(
        SHOWTIME_ID,
        ACTOR_ID,
        { benefits: [includedBenefit()], reason: 'VIP 기본 혜택 설정' },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      id: CONFIG_NEW_ID,
      showtimeId: SHOWTIME_ID,
      active: true,
      version: 1,
      benefits: [expect.objectContaining({ identity: 'drink-voucher' })],
    });
    expect(created.insertCalls.find((call) => call.table === ticketBenefitConfigurations)?.values)
      .toMatchObject({
        showtimeId: SHOWTIME_ID,
        version: 1,
        createdByUserId: ACTOR_ID,
        updatedByUserId: ACTOR_ID,
      });

    const updated = createDependencies([
      [],
      [configurationRow()],
      [dbBenefit(includedBenefit())],
      [],
      [],
    ]);

    await expect(
      updated.service.saveConfiguration(
        SHOWTIME_ID,
        ACTOR_ID,
        {
          benefits: [includedBenefit({
            displayCopy: copy('무료 음료 2잔'),
          })],
          reason: '혜택 문구 수정',
        },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      id: CONFIG_NEW_ID,
      showtimeId: SHOWTIME_ID,
      active: true,
      version: 2,
      benefits: [expect.objectContaining({
        identity: 'drink-voucher',
        displayCopy: expect.objectContaining({
          ko: expect.objectContaining({ name: '무료 음료 2잔' }),
        }),
      })],
    });
    expect(updated.insertCalls.find((call) => call.table === ticketBenefitConfigurations)?.values)
      .toMatchObject({
        showtimeId: SHOWTIME_ID,
        version: 2,
      });
  });

  it('rejects duplicate benefit identities before opening a transaction', async () => {
    const { service, db } = createDependencies();

    await expect(
      service.saveConfiguration(
        SHOWTIME_ID,
        ACTOR_ID,
        {
          benefits: [
            includedBenefit({ identity: 'same-benefit' }),
            limitedBenefit({ identity: 'same-benefit' }),
          ],
          reason: '중복 identity 검증',
        },
        { now: NOW },
      ),
    ).rejects.toThrow();

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('blocks saving after Benefit Result Lock', async () => {
    const { service, db, insertCalls, adminAuditService } = createDependencies([
      [{ id: 'redemption-1' }],
    ]);

    await expect(
      service.saveConfiguration(
        SHOWTIME_ID,
        ACTOR_ID,
        { benefits: [includedBenefit()], reason: '락 이후 저장 시도' },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(insertCalls).toEqual([]);
    expect(adminAuditService.write).not.toHaveBeenCalled();
  });

  it('throws when configuration insert does not return a row', async () => {
    const insertReturningRows = new Map<unknown, unknown[]>([
      [ticketBenefitConfigurations, []],
      [ticketBenefitConfigurationChanges, [{ id: 'change-1' }]],
    ]);
    const { service } = createDependencies([
      [],
      [],
      [],
      [],
    ], insertReturningRows);

    await expect(
      service.saveConfiguration(
        SHOWTIME_ID,
        ACTOR_ID,
        { benefits: [includedBenefit()], reason: 'missing returning row' },
        { now: NOW },
      ),
    ).rejects.toThrow('혜택 설정 저장 결과를 확인할 수 없습니다');
  });

  it('writes a Benefit Configuration Change Record and admin audit event when saved', async () => {
    const beforeBenefit = includedBenefit();
    const afterBenefit = includedBenefit({
      eligibleTierNames: ['VIP', 'R'],
    });
    const { service, insertCalls, adminAuditService, tx } = createDependencies([
      [],
      [configurationRow()],
      [dbBenefit(beforeBenefit)],
      [],
      [],
    ]);

    await service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      { benefits: [afterBenefit], reason: 'R석까지 포함' },
      {
        now: NOW,
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        requestId: 'req-benefit-save',
      },
    );

    const changeRecord = insertCalls.find(
      (call) => call.table === ticketBenefitConfigurationChanges,
    )?.values;
    expect(changeRecord).toMatchObject({
      showtimeId: SHOWTIME_ID,
      configurationId: CONFIG_NEW_ID,
      action: 'updated',
      actorUserId: ACTOR_ID,
      reason: 'R석까지 포함',
      beforeSnapshot: expect.objectContaining({
        id: CONFIG_EXISTING_ID,
        version: 1,
        benefits: [expect.objectContaining({ identity: 'drink-voucher' })],
      }),
      afterSnapshot: expect.objectContaining({
        id: CONFIG_NEW_ID,
        version: 2,
        benefits: [
          expect.objectContaining({
            identity: 'drink-voucher',
            eligibleTierNames: ['VIP', 'R'],
          }),
        ],
      }),
    });
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        action: 'benefits.configuration.update',
        resourceType: 'benefit_configuration',
        resourceId: CONFIG_NEW_ID,
        status: 'success',
        reason: 'R석까지 포함',
        changedFields: ['benefits', 'version'],
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
        requestId: 'req-benefit-save',
      }),
      tx,
    );
  });

  it('syncs included benefits to existing active ticket items with set-based SQL instead of per-row parameters', async () => {
    const { service, executeCalls, insertCalls } = createDependencies(
      [[], []],
      undefined,
      undefined,
      { createdCount: 2600 },
    );

    await service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      {
        benefits: [
          includedBenefit({
            identity: 'vip-drink',
            displayCopy: copy('VIP 음료'),
            eligibleTierNames: ['VIP'],
          }),
          limitedBenefit({
            identity: 'vip-raffle',
            eligibleTierNames: ['VIP'],
          }),
        ],
        reason: 'VIP 포함 혜택 설정',
      },
      { now: NOW },
    );

    expect(insertCalls.some((call) => call.table === ticketBenefitEntitlements)).toBe(false);
    const statements = syncStatements(executeCalls);
    expect(statements).toHaveLength(3);
    const insert = statements.find((call) => call.sql.includes('INSERT INTO ticket_benefit_entitlements'));
    expect(insert?.sql).toContain('ON CONFLICT DO NOTHING');
    expect(insert?.sql).toContain("ti.status = 'active'");
    expect(insert?.sql).toContain("'configuration'::ticket_benefit_entitlement_source");
    expect(insert?.params.length).toBeLessThanOrEqual(5);
    expect(desiredParam(insert)).toEqual({
      'vip-drink': { tiers: ['VIP'], copy: copy('VIP 음료') },
    });
  });

  it('refreshes existing display copies with one UPDATE that skips unchanged rows', async () => {
    const { service, tx, executeCalls } = createDependencies();

    await service.syncIncludedEntitlementsForShowtime(SHOWTIME_ID, {
      db: tx as never,
      benefits: [includedBenefit({
        identity: 'vip-drink',
        displayCopy: copy('VIP 음료 오탈자 수정'),
        eligibleTierNames: ['VIP'],
      })],
      now: NOW,
    });

    const refresh = syncStatements(executeCalls).filter((call) =>
      call.sql.includes('SET display_copy_snapshot'));
    expect(refresh).toHaveLength(1);
    expect(refresh[0]?.sql).toMatch(/IS DISTINCT FROM \(\$\d+::jsonb -> e\.benefit_identity::text -> 'copy'\)/);
    expect(refresh[0]?.sql).toContain("e.state = 'active'");
    expect(refresh[0]?.sql).not.toContain('ticket_items');
    expect(desiredParam(refresh[0])).toEqual({
      'vip-drink': { tiers: ['VIP'], copy: copy('VIP 음료 오탈자 수정') },
    });
  });

  it('inactivates included entitlements whose ticket is no longer eligible and reports the count', async () => {
    const { service, tx, executeCalls } = createDependencies(
      [],
      undefined,
      undefined,
      { inactivatedCount: 7, createdCount: 3 },
    );

    await expect(service.syncIncludedEntitlementsForShowtime(SHOWTIME_ID, {
      db: tx as never,
      benefits: [includedBenefit({ identity: 'vip-drink', eligibleTierNames: ['R'] })],
      now: NOW,
    })).resolves.toEqual({ createdCount: 3, inactivatedCount: 7 });

    const inactivate = syncStatements(executeCalls).find((call) => call.sql.includes('changed AS'));
    expect(inactivate?.sql).toContain("inactive_reason = 'configuration_changed'");
    expect(inactivate?.sql).toContain('ti.id = e.ticket_item_id');
    expect(inactivate?.sql).toContain("ti.status = 'active'");
    expect(inactivate?.params).toEqual(expect.arrayContaining([SHOWTIME_ID, NOW.toISOString()]));
    expect(desiredParam(inactivate)).toEqual({
      'vip-drink': { tiers: ['R'], copy: copy('무료 음료') },
    });
  });

  it('only inactivates when no included benefit remains', async () => {
    const { service, tx, executeCalls } = createDependencies(
      [],
      undefined,
      undefined,
      { inactivatedCount: 2 },
    );

    await expect(service.syncIncludedEntitlementsForShowtime(SHOWTIME_ID, {
      db: tx as never,
      benefits: [limitedBenefit()],
      now: NOW,
    })).resolves.toEqual({ createdCount: 0, inactivatedCount: 2 });

    const statements = syncStatements(executeCalls);
    expect(statements).toHaveLength(1);
    expect(desiredParam(statements[0])).toEqual({});
  });

  it('keeps unsaved test snapshots side-effect-free and does not update active configuration', async () => {
    const { service, db, tx, adminAuditService } = createDependencies([
      [configurationRow()],
      [dbBenefit(includedBenefit())],
    ]);

    await expect(
      service.buildUnsavedTestSnapshot(
        SHOWTIME_ID,
        { benefits: [limitedBenefit()], reason: '테스트 실행 전 preview' },
        { now: NOW },
      ),
    ).resolves.toEqual({
      active: false,
      sourceConfigurationId: CONFIG_EXISTING_ID,
      capturedAt: NOW.toISOString(),
      benefits: [limitedBenefit()],
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(adminAuditService.write).not.toHaveBeenCalled();
  });

  it('exports active configuration rows through safeCsvRows and withUtf8Bom without raw QR token fields', async () => {
    const safeCsvRowsSpy = vi.spyOn(csvExport, 'safeCsvRows');
    const withUtf8BomSpy = vi.spyOn(csvExport, 'withUtf8Bom');
    const { service, adminAuditService } = createDependencies([
      [configurationRow()],
      [
        {
          ...dbBenefit(includedBenefit({
            identity: 'vip-drink',
            displayCopy: copy('=VIP 음료', 'ey.raw.qr-token must not leak'),
          })),
          rawQrToken: 'ey.raw.qr-token',
          authorization: 'Bearer raw-secret',
        },
        dbBenefit(limitedBenefit()),
      ],
    ]);

    const result = await service.exportConfiguration(
      SHOWTIME_ID,
      { actorUserId: ACTOR_ID },
      { now: NOW },
    );

    expect(result).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      rowCount: 2,
      generatedAt: NOW.toISOString(),
    });
    expect(result.csv.charCodeAt(0)).toBe(0xfeff);
    expect(safeCsvRowsSpy).toHaveBeenCalled();
    expect(withUtf8BomSpy).toHaveBeenCalled();
    expect(result.csv).toContain("'=VIP 음료");
    expect(JSON.stringify(result)).not.toContain('ey.raw.qr-token');
    expect(JSON.stringify(result)).not.toContain('Bearer raw-secret');
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'benefits.configuration.export',
        resourceType: 'benefit_configuration',
        resourceId: CONFIG_EXISTING_ID,
        status: 'success',
        changedFields: ['showtimeId', 'configurationId', 'rowCount'],
        after: expect.objectContaining({
          showtimeId: SHOWTIME_ID,
          configurationId: CONFIG_EXISTING_ID,
          rowCount: 2,
        }),
      }),
      expect.anything(),
    );
  });
});

describe('AdminBenefitsController route contract', () => {
  it('requires benefits.manage for save endpoints and benefits.export for config export', () => {
    const prototype = AdminBenefitsController.prototype;

    expect(Reflect.getMetadata(PATH_METADATA, AdminBenefitsController))
      .toBe('admin/benefits');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.getConfiguration))
      .toBe('showtimes/:showtimeId/configuration');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.saveConfiguration))
      .toBe('showtimes/:showtimeId/configuration');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.listConfigurationChanges))
      .toBe('showtimes/:showtimeId/configuration/changes');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.exportConfiguration))
      .toBe('showtimes/:showtimeId/configuration/export');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.runTest))
      .toBe('showtimes/:showtimeId/test-runs');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.runLive))
      .toBe('showtimes/:showtimeId/live-runs');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.listRuns))
      .toBe('showtimes/:showtimeId/runs');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.getRun))
      .toBe('runs/:runId');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.exportRun))
      .toBe('runs/:runId/export');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.rollback))
      .toBe('showtimes/:showtimeId/rollback');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.exportEntitlements))
      .toBe('showtimes/:showtimeId/entitlements/export');
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.saveConfiguration,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.exportConfiguration,
      ),
    ).toEqual(['benefits.export']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.runTest,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.runLive,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.listRuns,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.getRun,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.rollback,
      ),
    ).toEqual(['benefits.manage']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.exportRun,
      ),
    ).toEqual(['benefits.export']);
    expect(
      Reflect.getMetadata(
        ADMIN_CAPABILITIES_KEY,
        prototype.exportEntitlements,
      ),
    ).toEqual(['benefits.export']);
  });
});
