import { ConflictException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
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

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
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
) {
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  const tx = {
    select: vi.fn(() => chainResult(selectRows.shift() ?? [])),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values });
        return {
          returning: vi.fn(() => chainResult(insertReturningRows.get(table) ?? [])),
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

  return { db, tx, insertCalls, updateCalls };
}

function createDependencies(selectRows: unknown[][] = []) {
  const db = createMockDb(selectRows);
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & { write: Mock };
  const service = new AdminBenefitsService(db.db as never, adminAuditService);

  return { service, adminAuditService, ...db };
}

describe('AdminBenefitsService', () => {
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

  it('syncs included benefits to existing active ticket items immediately', async () => {
    const { service, insertCalls } = createDependencies([
      [],
      [],
      [
        { id: 'ticket-vip-1', tierName: 'VIP' },
        { id: 'ticket-r-1', tierName: 'R' },
      ],
      [],
    ]);

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

    const entitlementInsert = insertCalls.find(
      (call) => call.table === ticketBenefitEntitlements,
    )?.values;
    expect(entitlementInsert).toEqual([
      expect.objectContaining({
        showtimeId: SHOWTIME_ID,
        ticketItemId: 'ticket-vip-1',
        benefitIdentity: 'vip-drink',
        benefitKind: 'included',
        source: 'configuration',
        runId: null,
        state: 'active',
        displayCopySnapshot: copy('VIP 음료'),
      }),
    ]);
  });

  it('inactivates included entitlements when ticket items are no longer eligible before lock', async () => {
    const { service, updateCalls, insertCalls } = createDependencies([
      [],
      [configurationRow()],
      [dbBenefit(includedBenefit({
        identity: 'vip-drink',
        eligibleTierNames: ['VIP'],
      }))],
      [
        { id: 'ticket-vip-1', tierName: 'VIP' },
        { id: 'ticket-r-1', tierName: 'R' },
      ],
      [
        {
          id: 'entitlement-vip',
          ticketItemId: 'ticket-vip-1',
          benefitIdentity: 'vip-drink',
        },
      ],
    ]);

    await service.saveConfiguration(
      SHOWTIME_ID,
      ACTOR_ID,
      {
        benefits: [includedBenefit({
          identity: 'vip-drink',
          eligibleTierNames: ['R'],
        })],
        reason: 'R석으로 적용 대상 변경',
      },
      { now: NOW },
    );

    expect(updateCalls).toEqual(
      expect.arrayContaining([
        {
          table: ticketBenefitEntitlements,
          values: expect.objectContaining({
            state: 'inactive',
            inactiveReason: 'configuration_changed',
          }),
        },
      ]),
    );
    expect(insertCalls.find((call) => call.table === ticketBenefitEntitlements)?.values)
      .toEqual([
        expect.objectContaining({
          ticketItemId: 'ticket-r-1',
          benefitIdentity: 'vip-drink',
          state: 'active',
        }),
      ]);
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
  });
});
