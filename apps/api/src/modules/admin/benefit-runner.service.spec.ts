import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { inspect } from 'node:util';
import { describe, expect, it, vi, type Mock } from 'vitest';

import type { BenefitConfiguration, BenefitDefinition } from '@grabit/shared';
import {
  reservations,
  ticketBenefitEntitlements,
  ticketBenefitRuns,
  ticketBenefits,
  ticketItems,
} from '../../database/schema/index.js';
import type { AdminAuditService } from './admin-audit.service.js';
import type { AdminBenefitsService } from './admin-benefits.service.js';
import * as csvExport from './csv-export.util.js';
import { BenefitRunnerService } from './benefit-runner.service.js';

const SHOWTIME_ID = '00000000-0000-4000-8000-000000000001';
const ACTOR_ID = '00000000-0000-4000-8000-0000000000a1';
const CONFIG_ID = '00000000-0000-4000-8000-00000000c001';
const RUN_ID = '00000000-0000-4000-8000-00000000f001';
const ROLLBACK_RUN_ID = '00000000-0000-4000-8000-00000000f002';
const ENTITLEMENT_ID_1 = '00000000-0000-4000-8000-00000000e001';
const ENTITLEMENT_ID_2 = '00000000-0000-4000-8000-00000000e002';
const NOW = new Date('2026-06-18T01:23:45.000Z');
const ticketIdByLabel = new Map<string, string>();

function ticketId(label: string): string {
  const existing = ticketIdByLabel.get(label);
  if (existing) {
    return existing;
  }
  const id = `00000000-0000-4000-8001-${
    String(ticketIdByLabel.size + 1).padStart(12, '0')
  }`;
  ticketIdByLabel.set(label, id);
  return id;
}

function copy(name: string, description = `${name} description`) {
  return {
    ko: { name, description },
    en: { name, description },
    'zh-CN': { name, description },
    th: { name, description },
  };
}

function limitedBenefit(overrides: Partial<BenefitDefinition> = {}): BenefitDefinition {
  return {
    identity: 'meet-and-greet',
    kind: 'limited',
    displayCopy: copy('밋앤그릿'),
    eligibleTierNames: ['VIP'],
    quantity: 1,
    selectionPriority: 1,
    mutuallyExclusiveWith: [],
    ...overrides,
  } as BenefitDefinition;
}

function includedBenefit(overrides: Partial<BenefitDefinition> = {}): BenefitDefinition {
  return {
    identity: 'poster',
    kind: 'included',
    displayCopy: copy('포스터'),
    eligibleTierNames: ['VIP'],
    mutuallyExclusiveWith: [],
    ...overrides,
  } as BenefitDefinition;
}

function configuration(benefits: BenefitDefinition[]): BenefitConfiguration {
  return {
    id: CONFIG_ID,
    showtimeId: SHOWTIME_ID,
    active: true,
    version: 1,
    benefits,
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    activatedAt: '2026-06-17T00:00:00.000Z',
  };
}

function configurationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIG_ID,
    showtimeId: SHOWTIME_ID,
    version: 1,
    createdByUserId: ACTOR_ID,
    updatedByUserId: ACTOR_ID,
    createdAt: new Date('2026-06-17T00:00:00.000Z'),
    updatedAt: new Date('2026-06-17T00:00:00.000Z'),
    ...overrides,
  };
}

function dbBenefit(benefit: BenefitDefinition) {
  return {
    id: `benefit-${benefit.identity}`,
    configurationId: CONFIG_ID,
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

function candidate(
  id: string,
  buyerUserId: string,
  tierName = 'VIP',
  status = 'active',
  admissionState = 'not_entered',
) {
  return {
    id: ticketId(id),
    ticketItemId: ticketId(id),
    reservationId: `reservation-${buyerUserId}`,
    buyerUserId,
    userId: buyerUserId,
    tierName,
    status,
    admissionState,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    showtimeId: SHOWTIME_ID,
    mode: 'live',
    status: 'completed',
    configurationSnapshot: configuration([
      limitedBenefit({
        identity: 'meet-and-greet',
        displayCopy: copy('밋앤그릿'),
      }),
    ]) as unknown as Record<string, unknown>,
    seedRef: 'seed_***_source',
    randomSeedInternal: 'raw-source-seed',
    resultSummary: {
      assignments: [
        {
          ticketItemId: ticketId('ticket-active'),
          buyerUserId: 'buyer-a',
          tierName: 'VIP',
          benefitIdentity: 'meet-and-greet',
          benefitKind: 'limited',
          benefitNameKo: '밋앤그릿',
          displayCopy: copy('밋앤그릿'),
          selectionPriority: 1,
          assignedAt: NOW.toISOString(),
        },
        {
          ticketItemId: ticketId('ticket-now-inactive'),
          buyerUserId: 'buyer-b',
          tierName: 'VIP',
          benefitIdentity: 'meet-and-greet',
          benefitKind: 'limited',
          benefitNameKo: '밋앤그릿',
          displayCopy: copy('밋앤그릿'),
          selectionPriority: 1,
          assignedAt: NOW.toISOString(),
        },
      ],
      benefits: [],
      totalAssignedCount: 2,
      totalShortfallCount: 0,
    },
    actorUserId: ACTOR_ID,
    confirmedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type QueryCall = {
  selection?: unknown;
  table?: unknown;
  joins: unknown[];
  where?: unknown;
};

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
      if (prop === 'innerJoin' || prop === 'leftJoin') {
        return (table: unknown) => {
          call?.joins.push(table);
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
  options: {
    runIds?: string[];
  } = {},
) {
  const selectCalls: QueryCall[] = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const runIds = [...(options.runIds ?? [RUN_ID, ROLLBACK_RUN_ID])];

  const tx = {
    execute: vi.fn(() => chainResult([{ id: SHOWTIME_ID }])),
    select: vi.fn((selection?: unknown) => {
      const call: QueryCall = { selection, joins: [] };
      selectCalls.push(call);
      return chainResult(selectRows.shift() ?? [], call);
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertCalls.push({ table, values });
        return {
          returning: vi.fn(() => {
            if (table === ticketBenefitRuns) {
              return chainResult([{
                id: runIds.shift() ?? RUN_ID,
                createdAt: NOW,
                updatedAt: NOW,
              }]);
            }
            if (table === ticketBenefitEntitlements && Array.isArray(values)) {
              return chainResult(values.map((_, index) => ({
                id: index === 0 ? ENTITLEMENT_ID_1 : ENTITLEMENT_ID_2,
              })));
            }
            return chainResult([]);
          }),
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
    insertCalls,
    updateCalls,
  };
}

function createAdminBenefitsService(
  overrides: Partial<AdminBenefitsService> & {
    assertBenefitResultUnlockedForMutation?: Mock;
  } = {},
) {
  return {
    lockShowtimeForBenefitMutation: vi.fn().mockResolvedValue(undefined),
    assertBenefitResultUnlockedForMutation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AdminBenefitsService & {
    lockShowtimeForBenefitMutation: Mock;
    assertBenefitResultUnlockedForMutation: Mock;
  };
}

function createService(
  selectRows: unknown[][],
  options: {
    adminBenefitsService?: ReturnType<typeof createAdminBenefitsService>;
    runIds?: string[];
  } = {},
) {
  const db = createMockDb(selectRows, { runIds: options.runIds });
  const adminBenefitsService =
    options.adminBenefitsService ?? createAdminBenefitsService();
  const adminAuditService = {
    write: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  } as unknown as AdminAuditService & { write: Mock };
  const service = new BenefitRunnerService(
    db.db as never,
    adminBenefitsService as never,
    adminAuditService as never,
  );

  return {
    service,
    adminBenefitsService,
    adminAuditService,
    ...db,
  };
}

function testRows(
  benefits: BenefitDefinition[],
  candidates: ReturnType<typeof candidate>[],
) {
  return [
    [configurationRow()],
    benefits.map(dbBenefit),
    candidates,
  ];
}

function liveRows(
  benefits: BenefitDefinition[],
  candidates: ReturnType<typeof candidate>[],
) {
  return [
    [configurationRow()],
    benefits.map(dbBenefit),
    candidates,
  ];
}

function assignmentIdentities(result: {
  resultSummary: { assignments: Array<{ benefitIdentity: string }> };
}) {
  return result.resultSummary.assignments.map((assignment) => assignment.benefitIdentity);
}

function entitlementInsertValues(insertCalls: Array<{ table: unknown; values: unknown }>) {
  return insertCalls.find((call) => call.table === ticketBenefitEntitlements)?.values;
}

function lastRunSummaryUpdate(updateCalls: Array<{
  table: unknown;
  values: Record<string, unknown>;
}>) {
  return updateCalls
    .filter((call) => call.table === ticketBenefitRuns)
    .at(-1)?.values.resultSummary;
}

describe('BenefitRunnerService', () => {
  it('makes test runs deterministic for a fixed seed and stable Ticket Item IDs', async () => {
    const benefits = [
      limitedBenefit({
        identity: 'six-to-one',
        displayCopy: copy('6:1'),
        quantity: 2,
      }),
    ];
    const candidates = [
      candidate('ticket-003', 'buyer-c'),
      candidate('ticket-001', 'buyer-a'),
      candidate('ticket-002', 'buyer-b'),
    ];
    const first = createService(testRows(benefits, candidates));
    const second = createService(testRows(benefits, candidates.slice().reverse()));

    const firstRun = await first.service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'fixed-seed',
    }, { now: NOW });
    const secondRun = await second.service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'fixed-seed',
    }, { now: NOW });

    expect(firstRun.resultSummary.assignments).toEqual(
      secondRun.resultSummary.assignments,
    );
    expect(firstRun.operatorProvidedSeedRef).toBe('fixed-seed');
    expect(JSON.stringify(firstRun)).not.toContain('randomSeedInternal');
  });

  it('rejects live runs when the operator provides a seed', async () => {
    const { service, db } = createService([]);

    await expect(service.runLive({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      confirmed: true,
      operatorProvidedSeedRef: 'operator-seed',
    }, { now: NOW })).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('processes limited benefits by ascending selectionPriority', async () => {
    const benefits = [
      limitedBenefit({
        identity: 'priority-two',
        displayCopy: copy('2순위'),
        quantity: 1,
        selectionPriority: 2,
      }),
      limitedBenefit({
        identity: 'priority-one',
        displayCopy: copy('1순위'),
        quantity: 1,
        selectionPriority: 1,
      }),
    ];
    const { service } = createService(testRows(benefits, [
      candidate('ticket-001', 'buyer-a'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'priority-seed',
    }, { now: NOW });

    expect(assignmentIdentities(result)).toEqual(['priority-one']);
    expect(result.resultSummary.benefits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          benefitIdentity: 'priority-two',
          requestedQuantity: 1,
          assignedCount: 0,
          shortfallCount: 1,
        }),
      ]),
    );
  });

  it('assigns at most one limited benefit to each Ticket Item', async () => {
    const { service } = createService(testRows([
      limitedBenefit({
        identity: 'six-to-one',
        displayCopy: copy('6:1'),
        quantity: 2,
        selectionPriority: 1,
      }),
      limitedBenefit({
        identity: 'polaroid',
        displayCopy: copy('PRE-SIGNED POLAROID'),
        quantity: 2,
        selectionPriority: 2,
      }),
    ], [
      candidate('ticket-001', 'buyer-a'),
      candidate('ticket-002', 'buyer-b'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'one-limited-per-ticket',
    }, { now: NOW });

    const assignedTicketIds = result.resultSummary.assignments.map(
      (assignment) => assignment.ticketItemId,
    );
    expect(new Set(assignedTicketIds).size).toBe(assignedTicketIds.length);
  });

  it('excludes all Ticket Items owned by the same Buyer across mutually exclusive 6:1 and PRE-SIGNED POLAROID benefits', async () => {
    const { service } = createService(testRows([
      limitedBenefit({
        identity: 'six-to-one',
        displayCopy: copy('6:1'),
        quantity: 1,
        selectionPriority: 1,
        mutuallyExclusiveWith: ['pre-signed-polaroid'],
      }),
      limitedBenefit({
        identity: 'pre-signed-polaroid',
        displayCopy: copy('PRE-SIGNED POLAROID'),
        quantity: 2,
        selectionPriority: 2,
        mutuallyExclusiveWith: ['six-to-one'],
      }),
    ], [
      candidate('ticket-a-1', 'buyer-a'),
      candidate('ticket-a-2', 'buyer-a'),
      candidate('ticket-b-1', 'buyer-b'),
      candidate('ticket-c-1', 'buyer-c'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'buyer-mutual-exclusion',
    }, { now: NOW });

    const sixToOneWinner = result.resultSummary.assignments.find(
      (assignment) => assignment.benefitIdentity === 'six-to-one',
    );
    const polaroidBuyers = result.resultSummary.assignments
      .filter((assignment) => assignment.benefitIdentity === 'pre-signed-polaroid')
      .map((assignment) => assignment.buyerUserId);

    expect(sixToOneWinner).toBeDefined();
    expect(polaroidBuyers).not.toContain(sixToOneWinner?.buyerUserId);
  });

  it('records quantity shortfall when eligible Ticket Items are insufficient', async () => {
    const { service } = createService(testRows([
      limitedBenefit({
        identity: 'six-to-one',
        displayCopy: copy('6:1'),
        quantity: 3,
        selectionPriority: 1,
      }),
    ], [
      candidate('ticket-001', 'buyer-a'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'shortfall-seed',
    }, { now: NOW });

    expect(result.resultSummary).toMatchObject({
      totalAssignedCount: 1,
      totalShortfallCount: 2,
      benefits: [
        expect.objectContaining({
          benefitIdentity: 'six-to-one',
          requestedQuantity: 3,
          assignedCount: 1,
          shortfallCount: 2,
        }),
      ],
    });
  });

  it('keeps active Ticket Items eligible even when admission state is entered', async () => {
    const { service } = createService(testRows([
      limitedBenefit({
        identity: 'entered-ticket-benefit',
        displayCopy: copy('입장 완료자 혜택'),
      }),
    ], [
      candidate('ticket-entered', 'buyer-a', 'VIP', 'active', 'entered'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'entered-ticket-seed',
    }, { now: NOW });

    expect(result.resultSummary.assignments).toEqual([
      expect.objectContaining({
        ticketItemId: ticketId('ticket-entered'),
        admissionState: 'entered',
      }),
    ]);
  });

  it('excludes cancelled, expired, and cancellation-pending Ticket Items', async () => {
    const { service } = createService(testRows([
      limitedBenefit({
        identity: 'active-only-benefit',
        displayCopy: copy('정상 티켓 혜택'),
        quantity: 4,
      }),
    ], [
      candidate('ticket-active', 'buyer-a', 'VIP', 'active'),
      candidate('ticket-cancelled', 'buyer-b', 'VIP', 'cancelled'),
      candidate('ticket-expired', 'buyer-c', 'VIP', 'expired'),
      candidate('ticket-cancellation-pending', 'buyer-d', 'VIP', 'cancellation_pending'),
    ]));

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'active-only-seed',
    }, { now: NOW });

    expect(result.resultSummary.assignments).toEqual([
      expect.objectContaining({ ticketItemId: ticketId('ticket-active') }),
    ]);
    expect(JSON.stringify(result.resultSummary.assignments)).not.toContain(
      ticketId('ticket-cancelled'),
    );
    expect(result.resultSummary.totalShortfallCount).toBe(3);
  });

  it('replaces previous active limited assignments on live run', async () => {
    const { service, insertCalls, updateCalls, adminBenefitsService } =
      createService(liveRows([
        limitedBenefit({
          identity: 'six-to-one',
          displayCopy: copy('6:1'),
        }),
      ], [
        candidate('ticket-001', 'buyer-a'),
      ]));

    const result = await service.runLive({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      confirmed: true,
    }, { now: NOW, randomSeed: 'internal-live-seed' });

    expect(adminBenefitsService.lockShowtimeForBenefitMutation).toHaveBeenCalled();
    expect(adminBenefitsService.assertBenefitResultUnlockedForMutation)
      .toHaveBeenCalled();
    expect(updateCalls.filter((call) => call.table === ticketBenefitEntitlements))
      .toEqual([
      {
        table: ticketBenefitEntitlements,
        values: expect.objectContaining({
          state: 'inactive',
          inactiveReason: 'replaced_by_live_run',
        }),
      },
    ]);
    expect(entitlementInsertValues(insertCalls)).toEqual([
      expect.objectContaining({
        showtimeId: SHOWTIME_ID,
        ticketItemId: ticketId('ticket-001'),
        benefitIdentity: 'six-to-one',
        benefitKind: 'limited',
        source: 'live_run',
        runId: RUN_ID,
        state: 'active',
      }),
    ]);
    expect(result.resultSummary.exportRows).toEqual([
      expect.objectContaining({
        benefitEntitlementId: ENTITLEMENT_ID_1,
        ticketItemId: ticketId('ticket-001'),
      }),
    ]);
    expect(lastRunSummaryUpdate(updateCalls)).toEqual(
      expect.objectContaining({
        exportRows: [
          expect.objectContaining({
            benefitEntitlementId: ENTITLEMENT_ID_1,
          }),
        ],
      }),
    );
    expect(result.mode).toBe('live');
    expect(JSON.stringify(result)).not.toContain('internal-live-seed');
  });

  it('blocks live runs after Benefit Result Lock', async () => {
    const adminBenefitsService = createAdminBenefitsService({
      assertBenefitResultUnlockedForMutation: vi.fn()
        .mockRejectedValue(new ConflictException('Benefit Result Lock')),
    });
    const { service, insertCalls } = createService([
      [],
    ], { adminBenefitsService });

    await expect(service.runLive({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      confirmed: true,
    }, { now: NOW, randomSeed: 'internal-live-seed' }))
      .rejects.toBeInstanceOf(ConflictException);

    expect(insertCalls).toEqual([]);
  });

  it('rolls back to a previous live run and skips inactive Ticket Items', async () => {
    const { service, insertCalls, updateCalls } = createService([
      [runRow()],
      [candidate('ticket-active', 'buyer-a')],
    ], { runIds: [ROLLBACK_RUN_ID] });

    const result = await service.rollback({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      sourceRunId: RUN_ID,
      sourceRunMode: 'live',
      reason: 'restore previous draw',
      confirmed: true,
    }, { now: NOW, randomSeed: 'rollback-internal-seed' });

    expect(updateCalls.filter((call) => call.table === ticketBenefitEntitlements))
      .toEqual([
      {
        table: ticketBenefitEntitlements,
        values: expect.objectContaining({
          state: 'inactive',
          inactiveReason: 'rollback_to_previous_run',
        }),
      },
    ]);
    expect(entitlementInsertValues(insertCalls)).toEqual([
      expect.objectContaining({
        ticketItemId: ticketId('ticket-active'),
        benefitIdentity: 'meet-and-greet',
        source: 'rollback',
        runId: ROLLBACK_RUN_ID,
        state: 'active',
      }),
    ]);
    expect(result.resultSummary.exportRows).toEqual([
      expect.objectContaining({
        benefitEntitlementId: ENTITLEMENT_ID_1,
        ticketItemId: ticketId('ticket-active'),
      }),
    ]);
    expect(lastRunSummaryUpdate(updateCalls)).toEqual(
      expect.objectContaining({
        exportRows: [
          expect.objectContaining({
            benefitEntitlementId: ENTITLEMENT_ID_1,
          }),
        ],
      }),
    );
    expect(result.resultSummary).toMatchObject({
      sourceRunId: RUN_ID,
      totalAssignedCount: 1,
      skippedInactiveTicketItemCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('rollback-internal-seed');
    expect(JSON.stringify(result)).not.toContain('raw-source-seed');
  });

  it('rejects rollback when the source run is not live', async () => {
    const { service } = createService([
      [runRow({ mode: 'test' })],
    ]);

    await expect(service.rollback({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      sourceRunId: RUN_ID,
      sourceRunMode: 'live',
      reason: 'restore previous draw',
      confirmed: true,
    }, { now: NOW })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['running', 'failed'] as const)(
    'rejects rollback when the source live run status is %s before mutating entitlements',
    async (status) => {
      const { service, insertCalls, updateCalls } = createService([
        [runRow({ status })],
      ]);

      await expect(service.rollback({
        showtimeId: SHOWTIME_ID,
        actorUserId: ACTOR_ID,
        sourceRunId: RUN_ID,
        sourceRunMode: 'live',
        reason: 'restore previous draw',
        confirmed: true,
      }, { now: NOW })).rejects.toBeInstanceOf(BadRequestException);

      expect(insertCalls).toEqual([]);
      expect(updateCalls.filter((call) => call.table === ticketBenefitEntitlements))
        .toEqual([]);
    },
  );

  it('rejects rollback when the source run summary is malformed before mutating entitlements', async () => {
    const { service, insertCalls, updateCalls } = createService([
      [runRow({ resultSummary: {} })],
    ]);

    await expect(service.rollback({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      sourceRunId: RUN_ID,
      sourceRunMode: 'live',
      reason: 'restore previous draw',
      confirmed: true,
    }, { now: NOW })).rejects.toBeInstanceOf(BadRequestException);

    expect(insertCalls).toEqual([]);
    expect(updateCalls.filter((call) => call.table === ticketBenefitEntitlements))
      .toEqual([]);
  });

  it('blocks rollback after Benefit Result Lock', async () => {
    const adminBenefitsService = createAdminBenefitsService({
      assertBenefitResultUnlockedForMutation: vi.fn()
        .mockRejectedValue(new ConflictException('Benefit Result Lock')),
    });
    const { service, insertCalls } = createService([
      [],
    ], { adminBenefitsService });

    await expect(service.rollback({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      sourceRunId: RUN_ID,
      sourceRunMode: 'live',
      reason: 'restore previous draw',
      confirmed: true,
    }, { now: NOW })).rejects.toBeInstanceOf(ConflictException);

    expect(insertCalls).toEqual([]);
  });

  it('persists test run records and export rows without creating entitlements', async () => {
    const safeCsvRowsSpy = vi.spyOn(csvExport, 'safeCsvRows');
    const withUtf8BomSpy = vi.spyOn(csvExport, 'withUtf8Bom');
    const benefits = [
      includedBenefit({ identity: 'included-poster' }),
      limitedBenefit({
        identity: 'six-to-one',
        displayCopy: copy('=6:1'),
        quantity: 1,
      }),
    ];
    const candidates = [
      candidate('ticket-001', 'buyer-a'),
    ];
    const { service, insertCalls, adminAuditService } = createService([
      ...testRows(benefits, candidates),
      [runRow({
        mode: 'test',
        seedRef: 'seed_***_export',
        randomSeedInternal: 'export-seed',
        configurationSnapshot: configuration(benefits) as unknown as Record<string, unknown>,
        resultSummary: {
          version: 1,
          seedRef: 'seed_***_export',
          assignments: [],
          benefits: [],
          totalAssignedCount: 1,
          totalShortfallCount: 0,
          exportRows: [
            {
              benefitEntitlementId: '00000000-0000-4000-8000-00000000e001',
              ticketItemId: ticketId('ticket-001'),
              showtimeId: SHOWTIME_ID,
              runId: RUN_ID,
              source: 'test_run',
              runMode: 'test',
              attachedToTicket: false,
              benefitIdentity: 'six-to-one',
              benefitKind: 'limited',
              benefitNameKo: '=6:1',
              state: 'active',
              assignedAt: NOW.toISOString(),
              redeemedAt: null,
            },
          ],
        },
      })],
    ]);

    const result = await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'export-seed',
    }, { now: NOW });
    const exportResult = await service.exportRun(RUN_ID, {
      actorUserId: ACTOR_ID,
      now: NOW,
    });

    expect(insertCalls.find((call) => call.table === ticketBenefitRuns)?.values)
      .toMatchObject({
        showtimeId: SHOWTIME_ID,
        mode: 'test',
        status: 'completed',
        seedRef: result.redactedSeedRef,
        resultSummary: expect.objectContaining({
          exportRows: [
            expect.objectContaining({
              ticketItemId: ticketId('ticket-001'),
              benefitIdentity: 'six-to-one',
              attachedToTicket: false,
            }),
          ],
        }),
      });
    expect(insertCalls.some((call) => call.table === ticketBenefitEntitlements))
      .toBe(false);
    expect(exportResult.csv.charCodeAt(0)).toBe(0xfeff);
    expect(exportResult.csv).toContain("'=6:1");
    expect(JSON.stringify(exportResult)).not.toContain('export-seed');
    expect(safeCsvRowsSpy).toHaveBeenCalled();
    expect(withUtf8BomSpy).toHaveBeenCalled();
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'benefits.run.export',
        resourceType: 'benefit_run',
        resourceId: RUN_ID,
        status: 'success',
        changedFields: ['runId', 'showtimeId', 'rowCount', 'generatedAt'],
        after: {
          runId: RUN_ID,
          showtimeId: SHOWTIME_ID,
          rowCount: 1,
          generatedAt: NOW.toISOString(),
        },
      }),
      expect.anything(),
    );
  });

  it('audits entitlement exports with metadata only', async () => {
    const { service, adminAuditService } = createService([
      [
        {
          id: ENTITLEMENT_ID_1,
          ticketItemId: ticketId('ticket-001'),
          showtimeId: SHOWTIME_ID,
          runId: RUN_ID,
          source: 'live_run',
          benefitIdentity: 'six-to-one',
          benefitKind: 'limited',
          displayCopySnapshot: copy('=6:1', 'raw seed must not be exported'),
          state: 'active',
          redeemedAt: null,
          createdAt: NOW,
        },
      ],
    ]);

    const result = await service.exportEntitlements(SHOWTIME_ID, {
      actorUserId: ACTOR_ID,
      now: NOW,
    });

    expect(result.csv).toContain(ENTITLEMENT_ID_1);
    expect(result.csv).toContain("'=6:1");
    expect(adminAuditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'benefits.entitlements.export',
        resourceType: 'benefit_entitlements',
        resourceId: SHOWTIME_ID,
        status: 'success',
        changedFields: ['showtimeId', 'rowCount', 'generatedAt'],
        after: {
          showtimeId: SHOWTIME_ID,
          rowCount: 1,
          generatedAt: NOW.toISOString(),
        },
      }),
      expect.anything(),
    );
    expect(JSON.stringify(adminAuditService.write.mock.calls[0]?.[0]))
      .not.toContain('raw seed');
    expect(JSON.stringify(adminAuditService.write.mock.calls[0]?.[0]))
      .not.toContain('=6:1');
  });

  it('returns run lists in the shared response shape', async () => {
    const { service } = createService([
      [runRow()],
    ]);

    await expect(service.listRuns(SHOWTIME_ID)).resolves.toEqual({
      runs: [
        expect.objectContaining({
          id: RUN_ID,
          showtimeId: SHOWTIME_ID,
        }),
      ],
      nextCursor: null,
    });
  });

  it('loads run records without exposing raw seed values', async () => {
    const { service } = createService([
      [runRow()],
    ]);

    const result = await service.getRun(RUN_ID);

    expect(result).toMatchObject({
      id: RUN_ID,
      redactedSeedRef: 'seed_***_source',
    });
    expect(JSON.stringify(result)).not.toContain('raw-source-seed');
  });

  it('throws when a requested run cannot be found', async () => {
    const { service } = createService([
      [],
    ]);

    await expect(service.getRun(RUN_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('queries active Ticket Item candidates through reservations.userId and status active', async () => {
    const { service, selectCalls } = createService(testRows([
      limitedBenefit(),
    ], [
      candidate('ticket-001', 'buyer-a'),
    ]));

    await service.runTest({
      showtimeId: SHOWTIME_ID,
      actorUserId: ACTOR_ID,
      configurationId: CONFIG_ID,
      operatorProvidedSeedRef: 'candidate-query-seed',
    }, { now: NOW });

    const candidateQuery = selectCalls.find(
      (call) => call.table === ticketItems && call.joins.includes(reservations),
    );
    expect(candidateQuery).toBeDefined();
    const predicateText = inspect(candidateQuery?.where, { depth: 30 });
    expect(predicateText).toContain('showtimeId');
    expect(predicateText).toContain('status');
    expect(predicateText).toContain('active');
  });
});
