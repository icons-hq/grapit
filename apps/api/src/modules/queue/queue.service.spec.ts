import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueService } from './queue.service.js';
import type { QueueGateway } from './queue.gateway.js';

function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    zadd: vi.fn().mockResolvedValue(1),
    zrank: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(1),
    zrange: vi.fn().mockResolvedValue([]),
    zrem: vi.fn().mockResolvedValue(0),
    sadd: vi.fn().mockResolvedValue(0),
    srem: vi.fn().mockResolvedValue(0),
    smembers: vi.fn().mockResolvedValue([]),
    scard: vi.fn().mockResolvedValue(0),
  };
}

function createMockDb() {
  return {
    select: vi.fn(),
  };
}

function mockPerformanceGate(
  mockDb: ReturnType<typeof createMockDb>,
  row: { status: string; bookingStartsAt?: Date | null } | null,
) {
  const where = vi.fn().mockResolvedValue(row ? [row] : []);
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin, where });
  mockDb.select.mockReturnValue({ from });
  return { from, leftJoin, where };
}

function createMockGateway(): {
  emitAdmitted: ReturnType<typeof vi.fn>;
  emitExpired: ReturnType<typeof vi.fn>;
  emitPosition: ReturnType<typeof vi.fn>;
} {
  return {
    emitAdmitted: vi.fn(),
    emitExpired: vi.fn(),
    emitPosition: vi.fn(),
  };
}

describe('QueueService', () => {
  const performanceId = '550e8400-e29b-41d4-a716-446655440000';
  const identity = {
    userId: 'user-1',
    refreshTokenFamilyId: 'family-1',
    deviceSlotId: 'family-1',
  };

  let service: QueueService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockGateway: ReturnType<typeof createMockGateway>;

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockDb = createMockDb();
    mockGateway = createMockGateway();
    service = new QueueService(
      mockRedis as never,
      mockDb as never,
      mockGateway as unknown as QueueGateway,
    );
  });

  it('creates a new admission session bound to userId, refreshTokenFamilyId, and deviceSlotId', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const lease = await service.ensureQueueSession({
      performanceId,
      identity,
    });

    expect(lease.queueSessionId).toEqual(expect.any(String));
    expect(lease.admissionToken).toEqual(expect.any(String));
    expect(lease.userId).toBe(identity.userId);
    expect(lease.refreshTokenFamilyId).toBe(identity.refreshTokenFamilyId);
    expect(lease.deviceSlotId).toBe(identity.deviceSlotId);

    const identityKeyWrite = mockRedis.set.mock.calls.find(([key]) =>
      String(key).includes(':identity:'),
    );

    expect(identityKeyWrite?.[0]).toContain(identity.userId);
    expect(identityKeyWrite?.[0]).toContain(identity.refreshTokenFamilyId);
    expect(identityKeyWrite?.[0]).toContain(identity.deviceSlotId);
    expect(mockRedis.zadd).toHaveBeenCalledOnce();
  });

  it('reuses the same queueSessionId only when the same identity re-enters', async () => {
    mockRedis.get.mockResolvedValueOnce('queue-session-1');
    vi.spyOn(service as never, 'readQueueSessionRecord').mockResolvedValue({
      queueSessionId: 'queue-session-1',
      performanceId,
      userId: identity.userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admissionTokenHash: 'existing-token-hash',
      state: 'WAITING',
      enteredAt: new Date('2026-05-08T00:00:00.000Z').toISOString(),
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
      paymentRecoveryUntilAt: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    const lease = await service.ensureQueueSession({
      performanceId,
      identity,
    });

    expect(lease.queueSessionId).toBe('queue-session-1');
    expect(lease.userId).toBe(identity.userId);
    expect(lease.refreshTokenFamilyId).toBe(identity.refreshTokenFamilyId);
    expect(lease.deviceSlotId).toBe(identity.deviceSlotId);
    expect(mockRedis.zadd).not.toHaveBeenCalled();
  });

  it('purges stale session keys one by one for Redis Cluster slot safety', async () => {
    mockRedis.get.mockResolvedValueOnce('queue-session-1');
    vi.spyOn(service as never, 'readQueueSessionRecord')
      .mockResolvedValueOnce({
        queueSessionId: 'queue-session-1',
        performanceId,
        userId: identity.userId,
        refreshTokenFamilyId: identity.refreshTokenFamilyId,
        deviceSlotId: identity.deviceSlotId,
        admissionTokenHash: 'existing-token-hash',
        state: 'EXPIRED',
        enteredAt: new Date('2026-05-08T00:00:00.000Z').toISOString(),
        admittedAt: null,
        activeUntilAt: null,
        reentryGraceUntilAt: null,
        paymentRecoveryUntilAt: null,
        expiresAt: new Date('2026-05-08T00:05:00.000Z').toISOString(),
      })
      .mockResolvedValueOnce(null);

    await service.ensureQueueSession({
      performanceId,
      identity,
    });

    const purgeCalls = mockRedis.del.mock.calls.slice(0, 4);
    expect(purgeCalls).toHaveLength(4);
    expect(purgeCalls.every((args) => args.length === 1)).toBe(true);
    expect(purgeCalls.map(([key]) => String(key))).toEqual([
      `{queue:${performanceId}}:session:queue-session-1`,
      '{queue:session-ref}:queue-session-1',
      `{queue:${performanceId}}:identity:user-1:family-1:family-1`,
      '{queue:admission}:existing-token-hash',
    ]);
  });

  it('blocks public queue entry before a scheduled booking start even when status is selling', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-04T09:59:00.000Z'));
      mockPerformanceGate(mockDb, {
        status: 'selling',
        bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
      });

      await expect(
        (service as unknown as {
          assertPerformanceBookingOpen: (
            targetPerformanceId: string,
            actorRole?: string,
          ) => Promise<void>;
        }).assertPerformanceBookingOpen(performanceId),
      ).rejects.toThrow('예매는 추후 오픈 예정입니다');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows public queue entry at a scheduled booking start even when stored status is upcoming', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
      mockPerformanceGate(mockDb, {
        status: 'upcoming',
        bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
      });

      await expect(
        (service as unknown as {
          assertPerformanceBookingOpen: (
            targetPerformanceId: string,
            actorRole?: string,
          ) => Promise<void>;
        }).assertPerformanceBookingOpen(performanceId),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks the queue transport contract to cookie-only admission and realtime queue events', async () => {
    const controllerSource = await readFile(
      resolve(__dirname, 'queue.controller.ts'),
      'utf-8',
    );
    const gatewaySource = await readFile(
      resolve(__dirname, 'queue.gateway.ts'),
      'utf-8',
    );
    const serviceSource = await readFile(
      resolve(__dirname, 'queue.service.ts'),
      'utf-8',
    );

    expect(controllerSource).toContain('queue/performances/:performanceId/enter');
    expect(controllerSource).toContain('httpOnly: true');
    expect(controllerSource).toContain('secure');
    expect(controllerSource).toContain("sameSite: 'lax'");
    expect(controllerSource).toContain("path: '/api/v1'");
    expect(controllerSource).toContain('maxAge: 780000');

    expect(gatewaySource).toContain('queue:position');
    expect(gatewaySource).toContain('queue:admitted');
    expect(gatewaySource).toContain('queue:expired');

    expect(serviceSource).toContain('WAITING');
    expect(serviceSource).toContain('ADMITTED');
    expect(serviceSource).toContain('EXPIRED');
    expect(serviceSource).toContain('QUEUE_ACTIVE_WINDOW_SECONDS = 600');
    expect(serviceSource).toContain('QUEUE_REENTRY_GRACE_SECONDS = 180');
    expect(serviceSource).toContain('etaSeconds');
    expect(serviceSource).toContain('remainingSeats');
    expect(serviceSource).toContain("['sold', 'held_cancelled', 'disabled']");
  });

  it('limits waiting position broadcasts instead of scanning the whole queue', async () => {
    const record = {
      queueSessionId: 'queue-session-1',
      performanceId,
      userId: identity.userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admissionTokenHash: 'token-hash',
      state: 'WAITING',
      enteredAt: new Date('2026-05-08T00:00:00.000Z').toISOString(),
      admittedAt: null,
      activeUntilAt: null,
      reentryGraceUntilAt: null,
      paymentRecoveryUntilAt: null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    mockRedis.zrange.mockResolvedValueOnce([
      'queue-session-1',
      'queue-session-2',
    ]);
    vi.spyOn(service as never, 'readQueueSessionRecord').mockResolvedValue(record);
    vi.spyOn(service as never, 'calculateRemainingSeats').mockResolvedValue(1_000);

    await (
      service as unknown as {
        broadcastWaitingPositions: (targetPerformanceId: string) => Promise<void>;
      }
    ).broadcastWaitingPositions(performanceId);

    expect(mockRedis.zrange).toHaveBeenCalledWith(
      `{queue:${performanceId}}:waiting`,
      0,
      499,
    );
    expect(mockGateway.emitPosition).toHaveBeenCalledTimes(2);
  });

  it('keeps the reconcile lock long enough for high-admission batches', async () => {
    vi.spyOn(service as never, 'reconcilePerformanceQueue').mockResolvedValue(undefined);

    await (
      service as unknown as {
        reconcilePerformanceQueueIfDue: (targetPerformanceId: string) => Promise<void>;
      }
    ).reconcilePerformanceQueueIfDue(performanceId);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `{queue:${performanceId}}:reconcile-lock`,
      '1',
      'PX',
      30_000,
      'NX',
    );
  });
});
