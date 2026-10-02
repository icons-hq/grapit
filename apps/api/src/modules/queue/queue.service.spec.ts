import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUEUE_ETA_MIN_SAMPLE_MS,
  QueueService,
  RELEASE_QUEUE_RECONCILE_LOCK_LUA,
  estimateQueueWaitSeconds,
} from './queue.service.js';
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
    eval: vi.fn().mockResolvedValue(1),
  };
}

function createMockDb() {
  return {
    select: vi.fn(),
  };
}

type PerformanceGateRow = {
  status: string;
  publishState?: string;
  bookingStartsAt?: Date | null;
  showtimeCount?: number;
  sellableShowtimeCount?: number;
};

function mockPerformanceGate(
  mockDb: ReturnType<typeof createMockDb>,
  row: PerformanceGateRow | null,
) {
  const where = vi.fn().mockResolvedValue(
    row
      ? [
          {
            publishState: 'published',
            bookingStartsAt: null,
            showtimeCount: 1,
            sellableShowtimeCount: 1,
            ...row,
          },
        ]
      : [],
  );
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin, where });
  mockDb.select.mockReturnValue({ from });
  return { from, leftJoin, where };
}

type QueueGateAccess = {
  assertPerformanceBookingOpen: (
    targetPerformanceId: string,
    actorRole?: string,
  ) => Promise<void>;
};

async function captureRejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the promise to reject');
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

  it('returns an identifiable not-open rejection with the booking start and server time', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-04T09:59:00.000Z'));
      mockPerformanceGate(mockDb, {
        status: 'selling',
        bookingStartsAt: new Date('2026-06-04T10:00:00.000Z'),
      });

      const error = await captureRejection(
        (service as unknown as QueueGateAccess).assertPerformanceBookingOpen(performanceId),
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe('예매는 추후 오픈 예정입니다');
      expect(error.getResponse()).toMatchObject({
        errorCode: 'BOOKING_NOT_OPEN',
        bookingStartsAt: '2026-06-04T10:00:00.000Z',
        serverNow: '2026-06-04T09:59:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([undefined, 'admin'])(
    'rejects unknown performance ids with 404 before creating queue keys (role: %s)',
    async (actorRole) => {
      mockPerformanceGate(mockDb, null);

      const error = await captureRejection(
        service.enterPerformanceQueue({ performanceId, identity, actorRole, bypassQueue: actorRole === 'admin' }),
      );

      expect(error.getStatus()).toBe(404);
      expect(error.getResponse()).toMatchObject({ errorCode: 'PERFORMANCE_NOT_FOUND' });
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    },
  );

  it('hides unpublished performances from public queue entry but keeps the admin test path', async () => {
    mockPerformanceGate(mockDb, { status: 'selling', publishState: 'publish_ready' });
    const gate = service as unknown as QueueGateAccess;

    const publicError = await captureRejection(gate.assertPerformanceBookingOpen(performanceId));
    expect(publicError.getStatus()).toBe(404);

    await expect(gate.assertPerformanceBookingOpen(performanceId, 'admin')).resolves.toBeUndefined();
  });

  it.each([undefined, 'admin'])(
    'blocks queue entry for ended performances without admin bypass (role: %s)',
    async (actorRole) => {
      mockPerformanceGate(mockDb, { status: 'ended' });

      const error = await captureRejection(
        (service as unknown as QueueGateAccess).assertPerformanceBookingOpen(performanceId, actorRole),
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe('판매가 종료된 공연입니다');
      expect(error.getResponse()).toMatchObject({ errorCode: 'BOOKING_ENDED' });
    },
  );

  it.each([undefined, 'admin'])(
    'blocks queue entry once every showtime has started, without admin bypass (role: %s)',
    async (actorRole) => {
      mockPerformanceGate(mockDb, {
        status: 'selling',
        showtimeCount: 3,
        sellableShowtimeCount: 0,
      });

      const error = await captureRejection(
        service.enterPerformanceQueue({ performanceId, identity, actorRole, bypassQueue: actorRole === 'admin' }),
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe('이미 시작된 회차는 예매할 수 없습니다.');
      expect(error.getResponse()).toMatchObject({ errorCode: 'NO_BOOKABLE_SHOWTIME' });
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    },
  );

  it('blocks queue entry when the performance has no showtime to sell', async () => {
    mockPerformanceGate(mockDb, {
      status: 'selling',
      showtimeCount: 0,
      sellableShowtimeCount: 0,
    });

    const error = await captureRejection(
      (service as unknown as QueueGateAccess).assertPerformanceBookingOpen(performanceId),
    );

    expect(error.getStatus()).toBe(403);
    expect(error.message).toBe('예매 가능한 회차가 없습니다.');
  });

  it('allows queue entry while at least one showtime has not started', async () => {
    mockPerformanceGate(mockDb, {
      status: 'selling',
      showtimeCount: 3,
      sellableShowtimeCount: 1,
    });

    await expect(
      (service as unknown as QueueGateAccess).assertPerformanceBookingOpen(performanceId),
    ).resolves.toBeUndefined();
  });

  describe('wait estimate', () => {
    it('derives ETA from measured line movement instead of a fixed per-position step', () => {
      // ~1000 admissions per 10 minutes: rank 6000 -> 5000 in 600s.
      const etaSeconds = estimateQueueWaitSeconds({
        origin: { rank: 6_000, at: 0 },
        currentRank: 4_999,
        now: 600_000,
      });

      // 5000th in line at 1000 per 10 min is ~50 minutes, not 5000 * 5s (~6.9h).
      expect(etaSeconds).toBeGreaterThanOrEqual(49 * 60);
      expect(etaSeconds).toBeLessThanOrEqual(51 * 60);
    });

    it('stays pending until the line has moved over a minimum sample window', () => {
      expect(
        estimateQueueWaitSeconds({
          origin: { rank: 600, at: 0 },
          currentRank: 590,
          now: QUEUE_ETA_MIN_SAMPLE_MS - 1,
        }),
      ).toBeNull();
      expect(
        estimateQueueWaitSeconds({
          origin: { rank: 600, at: 0 },
          currentRank: 600,
          now: 20 * 60_000,
        }),
      ).toBeNull();
    });

    it('seeds the origin sample on the first waiting snapshot and reports the wait as pending', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'));
        const record = createWaitingRecord();
        mockRedis.zrank.mockResolvedValueOnce(599);
        mockRedis.zcard.mockResolvedValueOnce(2_000);
        mockRedis.get.mockImplementation(async (key: string) =>
          key.endsWith(':remaining-seats') ? '300' : null,
        );

        const snapshot = await buildSnapshot(service, record);

        expect(snapshot).toMatchObject({
          position: 600,
          etaSeconds: 0,
          etaPending: true,
        });
        expect(mockRedis.set).toHaveBeenCalledWith(
          `{queue:${performanceId}}:eta-origin:${record.queueSessionId}`,
          JSON.stringify({ rank: 599, at: Date.parse('2026-06-04T10:00:00.000Z') }),
          'EX',
          7_200,
          'NX',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('reports the measured wait once the line has advanced since the origin sample', async () => {
      vi.useFakeTimers();
      try {
        const originAt = Date.parse('2026-06-04T10:00:00.000Z');
        vi.setSystemTime(originAt + 10 * 60_000);
        const record = createWaitingRecord();
        // 300-seat sale: 900 waiting ahead -> 600 after 10 minutes (30/min).
        mockRedis.zrank.mockResolvedValueOnce(599);
        mockRedis.get.mockImplementation(async (key: string) => {
          if (key.endsWith(':remaining-seats')) return '300';
          if (key.includes(':eta-origin:')) return JSON.stringify({ rank: 899, at: originAt });
          return null;
        });

        const snapshot = await buildSnapshot(service, record);

        expect(snapshot.etaPending).toBe(false);
        // 600 positions at 30/min is 20 minutes, not (600 - 1) * 5s.
        expect(snapshot.etaSeconds).toBe(20 * 60);
        expect(mockRedis.set).not.toHaveBeenCalledWith(
          expect.stringContaining(':eta-origin:'),
          expect.anything(),
          'EX',
          expect.any(Number),
          'NX',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not compute a wait estimate for admitted sessions', async () => {
      const record = {
        ...createWaitingRecord(),
        state: 'ADMITTED',
        admittedAt: new Date().toISOString(),
        activeUntilAt: new Date(Date.now() + 600_000).toISOString(),
        reentryGraceUntilAt: new Date(Date.now() + 780_000).toISOString(),
      };
      mockRedis.zrank.mockResolvedValueOnce(null);
      mockRedis.get.mockResolvedValue('10');

      const snapshot = await buildSnapshot(service, record);

      expect(snapshot).toMatchObject({ state: 'ADMITTED', etaSeconds: 0, etaPending: false });
      expect(mockRedis.get).not.toHaveBeenCalledWith(expect.stringContaining(':eta-origin:'));
    });
  });

  function createWaitingRecord() {
    return {
      queueSessionId: 'queue-session-eta',
      performanceId,
      userId: identity.userId,
      refreshTokenFamilyId: identity.refreshTokenFamilyId,
      deviceSlotId: identity.deviceSlotId,
      admissionTokenHash: 'token-hash',
      state: 'WAITING',
      enteredAt: new Date('2026-06-04T09:59:00.000Z').toISOString(),
      admittedAt: null as string | null,
      activeUntilAt: null as string | null,
      reentryGraceUntilAt: null as string | null,
      paymentRecoveryUntilAt: null as string | null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  function buildSnapshot(
    target: QueueService,
    record: ReturnType<typeof createWaitingRecord>,
  ): Promise<{ state: string; position: number; etaSeconds: number; etaPending: boolean }> {
    return (
      target as unknown as {
        buildSnapshot: (
          value: ReturnType<typeof createWaitingRecord>,
        ) => Promise<{ state: string; position: number; etaSeconds: number; etaPending: boolean }>;
      }
    ).buildSnapshot(record);
  }

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

  it('releases the owned reconcile lock after a high-admission batch finishes', async () => {
    vi.spyOn(service as never, 'reconcilePerformanceQueue').mockResolvedValue(undefined);

    await (
      service as unknown as {
        reconcilePerformanceQueueIfDue: (targetPerformanceId: string) => Promise<void>;
      }
    ).reconcilePerformanceQueueIfDue(performanceId);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `{queue:${performanceId}}:reconcile-lock`,
      expect.any(String),
      'PX',
      30_000,
      'NX',
    );
    expect(mockRedis.eval).toHaveBeenCalledWith(
      RELEASE_QUEUE_RECONCILE_LOCK_LUA,
      1,
      `{queue:${performanceId}}:reconcile-lock`,
      mockRedis.set.mock.calls.find(([setKey]) => setKey === `{queue:${performanceId}}:reconcile-lock`)?.[1],
    );
  });

  it('compares the reconcile lock token before deleting', () => {
    expect(RELEASE_QUEUE_RECONCILE_LOCK_LUA).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
    expect(RELEASE_QUEUE_RECONCILE_LOCK_LUA).toContain("redis.call('DEL', KEYS[1])");
  });

  it('does not reconcile when the reconcile lock is already held', async () => {
    const reconcileSpy = vi
      .spyOn(service as never, 'reconcilePerformanceQueue')
      .mockResolvedValue(undefined);
    mockRedis.set.mockResolvedValueOnce(null);

    await (
      service as unknown as {
        reconcilePerformanceQueueIfDue: (targetPerformanceId: string) => Promise<void>;
      }
    ).reconcilePerformanceQueueIfDue(performanceId);

    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});
