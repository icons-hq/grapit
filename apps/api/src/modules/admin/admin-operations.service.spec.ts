import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  AdminOperationsService,
  type AdminOperationsThreadRow,
} from './admin-operations.service.js';

const NOW = new Date('2026-05-14T03:00:00.000Z');

type MockTotals = { all: number; escalated: number; overdue: number; dueSoon: number };

function createMockDb(
  rows: AdminOperationsThreadRow[] = [],
  totals: MockTotals = { all: rows.length, escalated: 0, overdue: 0, dueSoon: 0 },
) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const leftJoinRefund = vi.fn().mockReturnValue({ where });
  const leftJoinAssignee = vi.fn().mockReturnValue({ leftJoin: leftJoinRefund });
  const leftJoinRequester = vi.fn().mockReturnValue({ leftJoin: leftJoinAssignee });
  const from = vi.fn().mockReturnValue({ leftJoin: leftJoinRequester });

  // Totals query: select({ all, ... }).from().leftJoin(refunds).where()
  const countWhere = vi.fn().mockResolvedValue([totals]);
  const countLeftJoin = vi.fn().mockReturnValue({ where: countWhere });
  const countFrom = vi.fn().mockReturnValue({ leftJoin: countLeftJoin });

  const select = vi.fn((fields?: Record<string, unknown>) =>
    fields && 'all' in fields ? { from: countFrom } : { from });

  const returning = vi.fn().mockResolvedValue([{ id: 'thread-payment' }]);
  const updateWhere = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  // Thread mutations run in a transaction; the tx client shares the update chain.
  const tx = { update };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

  return {
    select,
    update,
    transaction,
    _tx: tx,
    _set: set,
    _returning: returning,
    _limit: limit,
    _where: where,
    _countWhere: countWhere,
  };
}

function createAuditService() {
  return {
    write: vi.fn().mockResolvedValue({ id: 'audit-support-escalate' }),
  };
}

function threadRow(
  overrides: Partial<AdminOperationsThreadRow['thread']> = {},
  extra: Partial<AdminOperationsThreadRow> = {},
): AdminOperationsThreadRow {
  return {
    thread: {
      id: overrides.id ?? 'thread-qna',
      source: overrides.source ?? 'qna',
      category: overrides.category ?? 'general',
      status: overrides.status ?? 'open',
      priority: overrides.priority ?? 'normal',
      escalationState: overrides.escalationState ?? 'none',
      title: overrides.title ?? 'Seat map question',
      summary: overrides.summary ?? 'Operator-visible summary',
      locale: overrides.locale ?? 'ko',
      userId: overrides.userId ?? 'user-1',
      assigneeUserId: overrides.assigneeUserId ?? null,
      reservationId: overrides.reservationId ?? null,
      refundId: overrides.refundId ?? null,
      signupFailureEmailHash: overrides.signupFailureEmailHash ?? null,
      signupFailurePhoneHash: overrides.signupFailurePhoneHash ?? null,
      slaDueAt: overrides.slaDueAt ?? new Date('2026-05-14T06:00:00.000Z'),
      firstResponseAt: overrides.firstResponseAt ?? null,
      lastMessageAt: overrides.lastMessageAt ?? new Date('2026-05-14T02:40:00.000Z'),
      escalatedAt: overrides.escalatedAt ?? null,
      resolvedAt: overrides.resolvedAt ?? null,
      messageCount: overrides.messageCount ?? 1,
      createdAt: overrides.createdAt ?? new Date('2026-05-14T01:00:00.000Z'),
      updatedAt: overrides.updatedAt ?? new Date('2026-05-14T02:45:00.000Z'),
    },
    requester: extra.requester ?? {
      id: 'user-1',
      email: 'sujin@example.com',
      phone: '+821012345678',
      name: 'Sujin',
    },
    assignee: extra.assignee ?? null,
    refund: extra.refund ?? null,
  };
}

describe('AdminOperationsService', () => {
  it('sorts escalated and high-risk operations before SLA urgency and creation time', async () => {
    const rows = [
      threadRow({ id: 'thread-qna', category: 'general', createdAt: new Date('2026-05-14T01:00:00.000Z') }),
      threadRow({ id: 'thread-payment', source: 'cs', category: 'payment_error', createdAt: new Date('2026-05-14T02:00:00.000Z') }),
      threadRow({ id: 'thread-refund', source: 'refund_dispute', category: 'refund_unprocessed', createdAt: new Date('2026-05-14T02:30:00.000Z') }),
      threadRow({ id: 'thread-abuse', source: 'cs', category: 'abuse_fraud', createdAt: new Date('2026-05-14T02:45:00.000Z') }),
      threadRow({ id: 'thread-signup', source: 'signup_failure', category: 'signup_failure', createdAt: new Date('2026-05-14T02:50:00.000Z') }),
    ];
    const service = new AdminOperationsService(createMockDb(rows) as never, createAuditService() as never);

    const inbox = await service.listInbox({}, { now: NOW });

    expect(inbox.rows.map((row) => row.id)).toEqual([
      'thread-signup',
      'thread-abuse',
      'thread-refund',
      'thread-payment',
      'thread-qna',
    ]);
    expect(inbox.rows.slice(0, 4).map((row) => row.escalation.label)).toEqual([
      '즉시 확인',
      '즉시 확인',
      '즉시 확인',
      '즉시 확인',
    ]);
  });

  it('exposes 24-hour SLA countdown, due-soon, and overdue state', async () => {
    const service = new AdminOperationsService(
      createMockDb([
        threadRow({
          id: 'thread-overdue',
          category: 'booking',
          slaDueAt: new Date('2026-05-14T02:40:00.000Z'),
        }),
        threadRow({
          id: 'thread-due-soon',
          category: 'seat_accessibility',
          slaDueAt: new Date('2026-05-14T04:30:00.000Z'),
        }),
        threadRow({
          id: 'thread-within-sla',
          category: 'event_info',
          slaDueAt: new Date('2026-05-14T10:00:00.000Z'),
        }),
      ]) as never,
      createAuditService() as never,
    );

    const inbox = await service.listInbox({}, { now: NOW });

    expect(inbox.rows.map((row) => [row.id, row.sla.state, row.sla.remainingMinutes])).toEqual([
      ['thread-overdue', 'overdue', -20],
      ['thread-due-soon', 'due_soon', 90],
      ['thread-within-sla', 'within_sla', 420],
    ]);
    expect(inbox.rows[0]?.sla.label).toBe('24시간 SLA를 초과했습니다. 즉시 확인해주세요');
    expect(inbox.rows[1]?.sla.label).toBe('24시간 SLA 마감이 가까워지고 있습니다');
  });

  it('masks requester metadata in inbox rows and never returns raw email or phone', async () => {
    const service = new AdminOperationsService(
      createMockDb([
        threadRow({}, {
          requester: {
            id: 'user-raw',
            email: 'raw-customer@example.com',
            phone: '+821055501234',
            name: 'Raw Customer',
          },
        }),
      ]) as never,
      createAuditService() as never,
    );

    const inbox = await service.listInbox({}, { now: NOW });
    const serialized = JSON.stringify(inbox);

    expect(inbox.rows[0]?.requester).toMatchObject({
      id: 'user-raw',
      email: 'ra***@example.com',
      phone: '+82********34',
    });
    expect(serialized).not.toContain('raw-customer@example.com');
    expect(serialized).not.toContain('+821055501234');
  });

  it('looks up signup-failure work by hashed email or phone identifiers', async () => {
    const service = new AdminOperationsService(
      createMockDb([
        threadRow({
          id: 'thread-signup-email',
          source: 'signup_failure',
          category: 'signup_failure',
          signupFailureEmailHash: 'sha256-email',
        }),
        threadRow({
          id: 'thread-other',
          source: 'cs',
          category: 'general',
        }),
      ]) as never,
      createAuditService() as never,
    );

    const matches = await service.lookupSignupFailures(
      { emailHash: 'sha256-email' },
      { now: NOW },
    );

    expect(matches.rows).toHaveLength(1);
    expect(matches.rows[0]).toMatchObject({
      id: 'thread-signup-email',
      source: 'signup_failure',
      signupFailure: {
        emailHash: 'sha256-email',
        phoneHash: null,
      },
    });
  });

  it('retains refund-dispute metadata for operator follow-up and audit context', async () => {
    const service = new AdminOperationsService(
      createMockDb([
        threadRow(
          {
            id: 'thread-refund-retention',
            source: 'refund_dispute',
            category: 'refund_dispute',
            refundId: 'refund-1',
            status: 'resolved',
          },
          {
            refund: {
              id: 'refund-1',
              status: 'processing_at_pg',
              requestedAt: new Date('2026-05-13T12:00:00.000Z'),
              expectedDepositAt: new Date('2026-05-20T12:00:00.000Z'),
            },
          },
        ),
      ]) as never,
      createAuditService() as never,
    );

    const inbox = await service.listInbox({ includeResolved: true }, { now: NOW });

    expect(inbox.rows[0]?.refundDispute).toEqual({
      refundId: 'refund-1',
      status: 'processing_at_pg',
      retainedForAudit: true,
      requestedAt: '2026-05-13T12:00:00.000Z',
      expectedDepositAt: null,
    });
  });

  it('writes support.escalate audit evidence for manual escalation changes', async () => {
    const db = createMockDb();
    const auditService = createAuditService();
    const service = new AdminOperationsService(db as never, auditService as never);

    await service.escalateThread(
      '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      'admin-1',
      { reason: 'Payment provider failure requires finance follow-up' },
      {
        now: NOW,
        ipAddress: '203.0.113.10',
        userAgent: 'Vitest Admin Console',
      },
    );

    expect(db._set).toHaveBeenCalledWith(expect.objectContaining({
      priority: 'urgent',
      escalationState: 'manual_escalated',
      escalatedAt: NOW,
      updatedAt: NOW,
    }));
    expect(auditService.write).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      action: 'support.escalate',
      resourceType: 'support_thread',
      resourceId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      status: 'success',
      reason: 'Payment provider failure requires finance follow-up',
      changedFields: ['priority', 'escalationState', 'escalatedAt'],
      before: null,
      after: {
        priority: 'urgent',
        escalationState: 'manual_escalated',
        escalatedAt: '2026-05-14T03:00:00.000Z',
      },
      ipAddress: '203.0.113.10',
      userAgent: 'Vitest Admin Console',
    }, db._tx);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('audits status and assignee changes with their own actions inside the change transaction (u12)', async () => {
    const db = createMockDb();
    const auditService = createAuditService();
    const service = new AdminOperationsService(db as never, auditService as never);
    const threadId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    db._returning.mockResolvedValue([{ id: threadId }]);

    await service.updateThreadStatus(threadId, 'admin-1', { status: 'resolved', reason: 'answered' }, { now: NOW });
    await service.reassignThread(threadId, 'admin-1', { assigneeUserId: null, reason: 'unassign' }, { now: NOW });

    expect(auditService.write.mock.calls.map(([input]) => input.action)).toEqual([
      'support.resolve',
      'support.assign',
    ]);
    for (const [, client] of auditService.write.mock.calls) {
      expect(client).toBe(db._tx);
    }
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['updateThreadStatus', (service: AdminOperationsService, id: string) =>
      service.updateThreadStatus(id, 'admin-1', { status: 'resolved', reason: 'answered' }, { now: NOW })],
    ['escalateThread', (service: AdminOperationsService, id: string) =>
      service.escalateThread(id, 'admin-1', { reason: 'urgent' }, { now: NOW })],
    ['reassignThread', (service: AdminOperationsService, id: string) =>
      service.reassignThread(id, 'admin-1', { assigneeUserId: null, reason: 'unassign' }, { now: NOW })],
  ])('%s answers 404 and writes no success audit when no thread was updated', async (_name, run) => {
    const db = createMockDb();
    const auditService = createAuditService();
    const service = new AdminOperationsService(db as never, auditService as never);
    db._returning.mockResolvedValue([]);

    await expect(run(service, '7c9e6679-7425-40de-944b-e07fc1f90ae7')).rejects.toBeInstanceOf(NotFoundException);
    expect(auditService.write).not.toHaveBeenCalled();

    // A malformed id never reaches PostgreSQL (22P02).
    await expect(run(service, 'not-a-thread-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('reports inbox totals from the full matching set instead of the loaded page', async () => {
    const db = createMockDb(
      [threadRow({ id: 'thread-overdue', slaDueAt: new Date('2026-05-14T02:00:00.000Z') })],
      { all: 240, escalated: 30, overdue: 150, dueSoon: 12 },
    );
    const service = new AdminOperationsService(db as never, createAuditService() as never);

    const inbox = await service.listInbox({}, { now: NOW });

    expect(inbox.rows).toHaveLength(1);
    expect(inbox.totals).toEqual({ all: 240, escalated: 30, overdue: 150, dueSoon: 12 });
    expect(db._countWhere).toHaveBeenCalledTimes(1);
  });

  it('loads thread detail by id with a single-row query instead of scanning the newest inbox page', async () => {
    const db = createMockDb([
      threadRow({
        id: '7d3c2f10-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        slaDueAt: new Date('2025-01-02T00:00:00.000Z'),
      }),
    ]);
    const messagesOrderBy = vi.fn().mockResolvedValue([]);
    const messagesWhere = vi.fn().mockReturnValue({ orderBy: messagesOrderBy });
    const messagesFrom = vi.fn().mockReturnValue({ where: messagesWhere });
    const baseSelect = db.select;
    let call = 0;
    db.select = vi.fn((fields?: Record<string, unknown>) => {
      call += 1;
      return call === 1 ? baseSelect(fields) : { from: messagesFrom };
    }) as never;
    const service = new AdminOperationsService(db as never, createAuditService() as never);

    const detail = await service.getThreadDetail(
      '7d3c2f10-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      { now: NOW },
    );

    expect(detail).toMatchObject({
      id: '7d3c2f10-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      sla: { state: 'overdue' },
      messages: [],
    });
    expect(db._limit).toHaveBeenCalledWith(1);
    expect(db._countWhere).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed thread id without querying the database', async () => {
    const db = createMockDb();
    const service = new AdminOperationsService(db as never, createAuditService() as never);

    await expect(service.getThreadDetail('not-a-uuid', { now: NOW }))
      .rejects.toThrow(NotFoundException);
    expect(db.select).not.toHaveBeenCalled();
  });
});
