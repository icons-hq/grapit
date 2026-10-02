import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUEUE_ETA_CYCLE_MAX_SECONDS,
  QUEUE_ETA_MAX_SECONDS,
  QUEUE_SLOT_MIN_HOLD_SECONDS,
  QueueService,
  RELEASE_QUEUE_RECONCILE_LOCK_LUA,
  estimateQueueWait,
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

type SnapshotView = {
  state: string;
  position: number;
  etaSeconds: number;
  etaMinSeconds: number;
  etaUnavailable: boolean;
};

type QueueSimulationAccess = {
  readQueueSessionRecord: (performanceId: string, queueSessionId: string) => Promise<unknown>;
  enablePaymentRecovery: (record: unknown) => Promise<unknown>;
  buildSnapshot: (
    record: unknown,
  ) => Promise<Awaited<ReturnType<QueueService['getQueueSessionStatus']>>>;
};

/**
 * Functional in-memory Redis for the commands QueueService uses. Unlike the
 * call-recording mock it keeps real string/set/sorted-set state (sorted by
 * score, then member, like Redis) so reconcile, ranks and slot accounting
 * behave as they do against Valkey. Key TTLs are not simulated; queue timing
 * is driven by the timestamps stored in session records.
 */
function createFunctionalRedis() {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
  const ordered = (key: string): string[] =>
    [...(zsets.get(key) ?? new Map<string, number>()).entries()]
      .sort(([memberA, scoreA], [memberB, scoreB]) =>
        scoreA !== scoreB ? scoreA - scoreB : memberA < memberB ? -1 : memberA > memberB ? 1 : 0,
      )
      .map(([member]) => member);

  return {
    async get(key: string) {
      return strings.get(key) ?? null;
    },
    async set(key: string, value: string, ...options: Array<string | number>) {
      if (options.includes('NX') && strings.has(key)) return null;
      strings.set(key, String(value));
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (strings.delete(key) || sets.delete(key) || zsets.delete(key)) removed += 1;
      }
      return removed;
    },
    async zadd(key: string, score: number, member: string) {
      const zset = zsets.get(key) ?? new Map<string, number>();
      const added = zset.has(member) ? 0 : 1;
      zset.set(member, Number(score));
      zsets.set(key, zset);
      return added;
    },
    async zrank(key: string, member: string) {
      const index = ordered(key).indexOf(member);
      return index < 0 ? null : index;
    },
    async zcard(key: string) {
      return zsets.get(key)?.size ?? 0;
    },
    async zrange(key: string, start: number, stop: number) {
      const members = ordered(key);
      return members.slice(start, stop < 0 ? members.length + stop + 1 : stop + 1);
    },
    async zrem(key: string, ...members: string[]) {
      const zset = zsets.get(key);
      let removed = 0;
      for (const member of members) if (zset?.delete(member)) removed += 1;
      return removed;
    },
    async sadd(key: string, ...members: string[]) {
      const set = sets.get(key) ?? new Set<string>();
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added += 1;
        }
      }
      sets.set(key, set);
      return added;
    },
    async srem(key: string, ...members: string[]) {
      const set = sets.get(key);
      let removed = 0;
      for (const member of members) if (set?.delete(member)) removed += 1;
      return removed;
    },
    async smembers(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
    async eval(_script: string, _numKeys: number, key: string, token: string) {
      // RELEASE_QUEUE_RECONCILE_LOCK_LUA: delete only when the token matches.
      if (strings.get(key) === token) {
        strings.delete(key);
        return 1;
      }
      return 0;
    },
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

  describe('wait estimate (audit #91)', () => {
    it('bounds the audit example by admission cycles instead of a fixed per-position step', () => {
      // 1000+ seats: ~1000 admissions per 10-13 minute cycle, position 5000.
      const estimate = estimateQueueWait({ position: 5_000, remainingSeats: 8_000 });

      // 5 cycles: about 40-67 minutes, which contains the ~50 minutes the audit
      // expects and is nowhere near 5000 * 5s (~6.9h).
      expect(estimate).toEqual({
        etaSeconds: 5 * QUEUE_ETA_CYCLE_MAX_SECONDS,
        etaMinSeconds: 4 * QUEUE_SLOT_MIN_HOLD_SECONDS,
        etaUnavailable: false,
      });
      expect(estimate.etaMinSeconds).toBeLessThanOrEqual(50 * 60);
      expect(estimate.etaSeconds).toBeGreaterThanOrEqual(50 * 60);
    });

    it('covers the 300-seat example that the fixed step under-reported', () => {
      // Position 600 with 300 seats needs a second cycle: about 10-27 minutes, not ~50.
      expect(estimateQueueWait({ position: 600, remainingSeats: 300 })).toEqual({
        etaSeconds: 2 * QUEUE_ETA_CYCLE_MAX_SECONDS,
        etaMinSeconds: QUEUE_SLOT_MIN_HOLD_SECONDS,
        etaUnavailable: false,
      });
      // First cycle: admitted as soon as a current slot frees up.
      expect(estimateQueueWait({ position: 300, remainingSeats: 300 })).toEqual({
        etaSeconds: QUEUE_ETA_CYCLE_MAX_SECONDS,
        etaMinSeconds: 0,
        etaUnavailable: false,
      });
    });

    it('reports the estimate as unavailable instead of an unrealistic number', () => {
      // No seat left to admit into.
      expect(estimateQueueWait({ position: 10, remainingSeats: 0 })).toMatchObject({
        etaUnavailable: true,
        etaSeconds: QUEUE_ETA_MAX_SECONDS,
      });
      // One seat left and 1000 people ahead would otherwise read as ~9 days.
      expect(estimateQueueWait({ position: 1_000, remainingSeats: 1 })).toMatchObject({
        etaUnavailable: true,
        etaSeconds: QUEUE_ETA_MAX_SECONDS,
      });
      // Missing rank.
      expect(estimateQueueWait({ position: 0, remainingSeats: 100 })).toMatchObject({
        etaUnavailable: true,
      });
      // Just inside the cap is still a range.
      const lastCycles = Math.floor(QUEUE_ETA_MAX_SECONDS / QUEUE_ETA_CYCLE_MAX_SECONDS);
      expect(
        estimateQueueWait({ position: lastCycles * 1_000, remainingSeats: 5_000 }),
      ).toMatchObject({ etaUnavailable: false, etaSeconds: lastCycles * QUEUE_ETA_CYCLE_MAX_SECONDS });
      expect(
        estimateQueueWait({ position: lastCycles * 1_000 + 1, remainingSeats: 5_000 }),
      ).toMatchObject({ etaUnavailable: true });
    });

    it('builds waiting snapshots from position and remaining seats without per-session ETA state', async () => {
      const record = createWaitingRecord();
      mockRedis.zrank.mockResolvedValueOnce(599);
      mockRedis.zcard.mockResolvedValueOnce(2_000);
      mockRedis.get.mockImplementation(async (key: string) =>
        key.endsWith(':remaining-seats') ? '300' : null,
      );

      const snapshot = await buildSnapshot(service, record);

      expect(snapshot).toMatchObject({
        position: 600,
        etaSeconds: 2 * QUEUE_ETA_CYCLE_MAX_SECONDS,
        etaMinSeconds: QUEUE_SLOT_MIN_HOLD_SECONDS,
        etaUnavailable: false,
      });
      // Older clients only read etaSeconds; it must never read as "entering soon".
      expect(snapshot.etaSeconds).toBeGreaterThan(0);
      expect(mockRedis.set).not.toHaveBeenCalled();
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

      expect(snapshot).toMatchObject({
        state: 'ADMITTED',
        etaSeconds: 0,
        etaMinSeconds: 0,
        etaUnavailable: false,
      });
    });

    /**
     * Regression for the review of the measured-throughput ETA: admission moves
     * in waves (an opening burst, then a cycle every 10-13 minutes), so an ETA
     * sampled during the opening reconcile or just before a wave must not
     * under-report the wait. This drives the real reconcile/expiry code with a
     * functional Redis fake and checks every waiting snapshot against the time
     * the session was actually admitted.
     */
    it('contains the actual admission time in every waiting snapshot through opening burst and waves', async () => {
      vi.useFakeTimers();
      try {
        const openAt = Date.parse('2026-06-04T10:00:00.000Z');
        vi.setSystemTime(openAt);
        const seats = 3;
        const stepMs = 5_000;
        const fakeRedis = createFunctionalRedis();
        await fakeRedis.set(`{queue:${performanceId}}:remaining-seats`, String(seats));
        const simulated = new QueueService(
          fakeRedis as never,
          mockDb as never,
          mockGateway as unknown as QueueGateway,
        );
        const internals = simulated as unknown as QueueSimulationAccess;

        type Snapshot = Awaited<ReturnType<QueueService['getQueueSessionStatus']>>;
        type Tracked = {
          name: string;
          lease: Awaited<ReturnType<QueueService['ensureQueueSession']>>;
          samples: Array<{ at: number; min: number; max: number; unavailable: boolean }>;
          admittedAt: number | null;
        };
        const tracked: Tracked[] = [];
        const enter = async (name: string) => {
          const lease = await simulated.ensureQueueSession({
            performanceId,
            identity: {
              userId: name,
              refreshTokenFamilyId: `${name}-family`,
              deviceSlotId: `${name}-family`,
            },
          });
          const entry: Tracked = { name, lease, samples: [], admittedAt: null };
          tracked.push(entry);
          return entry;
        };
        const sample = (entry: Tracked, snapshot: Snapshot) => {
          if (snapshot.state === 'WAITING') {
            entry.samples.push({
              at: Date.now(),
              min: snapshot.etaMinSeconds * 1000,
              max: snapshot.etaSeconds * 1000,
              unavailable: snapshot.etaUnavailable,
            });
          }
        };
        const poll = async (entry: Tracked) => {
          const snapshot = await simulated.getQueueSessionStatus({
            queueSessionId: entry.lease.queueSessionId,
            identity: entry.lease,
            admissionToken: entry.lease.admissionToken,
          });
          sample(entry, snapshot);
          if (snapshot.state !== 'WAITING' && entry.admittedAt === null) {
            entry.admittedAt = Date.now();
            // Every other buyer reaches checkout and keeps the slot through the
            // payment-recovery grace (13 minutes); the rest hold it 10 minutes.
            if (tracked.indexOf(entry) % 2 === 0) {
              const stored = await internals.readQueueSessionRecord(
                performanceId,
                entry.lease.queueSessionId,
              );
              if (stored) await internals.enablePaymentRecovery(stored);
            }
          }
        };

        // Opening burst: 9 buyers enter before any reconcile pass has run, so
        // their first snapshot is taken while the first wave is still in line.
        for (let index = 0; index < 9; index += 1) {
          // Entries a few milliseconds apart (same-millisecond scores would be
          // ordered by random session id, as in Redis).
          vi.setSystemTime(openAt + index * 10);
          const entry = await enter(`burst-${index}`);
          const stored = await internals.readQueueSessionRecord(
            performanceId,
            entry.lease.queueSessionId,
          );
          if (stored) sample(entry, await internals.buildSnapshot(stored));
        }

        const lateJoinAt = openAt + 9 * 60_000; // one minute before the first wave
        let lateJoined = false;
        const deadline = openAt + 90 * 60_000;
        while (Date.now() <= deadline && tracked.some((entry) => entry.admittedAt === null)) {
          if (!lateJoined && Date.now() >= lateJoinAt) {
            lateJoined = true;
            await enter('late-joiner');
          }
          for (const entry of tracked) {
            if (entry.admittedAt === null) await poll(entry);
          }
          vi.setSystemTime(Date.now() + stepMs);
        }

        expect(tracked.every((entry) => entry.admittedAt !== null)).toBe(true);
        // Waves actually happened: the last buyer waited more than two cycles.
        const longestWait = Math.max(
          ...tracked.map((entry) => (entry.admittedAt ?? 0) - openAt),
        );
        expect(longestWait).toBeGreaterThan(2 * QUEUE_SLOT_MIN_HOLD_SECONDS * 1000);

        let checked = 0;
        for (const entry of tracked) {
          for (const observed of entry.samples) {
            const label = `${entry.name} sampled at +${(observed.at - openAt) / 1000}s`;
            const actualWaitMs = (entry.admittedAt ?? 0) - observed.at;
            expect(observed.unavailable, label).toBe(false);
            // Never promises an earlier admission than reality (the reviewed
            // estimate under-reported by several times) ...
            expect(actualWaitMs, label).toBeLessThanOrEqual(observed.max);
            // ... and never a later minimum than reality.
            expect(actualWaitMs, label).toBeGreaterThanOrEqual(observed.min);
            checked += 1;
          }
        }
        expect(checked).toBeGreaterThan(100);

        // The late joiner sampled one minute before a wave still gets an upper
        // bound that covers its real wait (the measured estimate showed ~1/5).
        const late = tracked.find((entry) => entry.name === 'late-joiner');
        const lateFirst = late?.samples[0];
        expect(lateFirst).toBeDefined();
        const lateWaitMs = (late?.admittedAt ?? 0) - (lateFirst?.at ?? 0);
        expect(lateWaitMs).toBeGreaterThan(QUEUE_SLOT_MIN_HOLD_SECONDS * 1000);
        expect(lateWaitMs).toBeLessThanOrEqual(lateFirst?.max ?? 0);
      } finally {
        vi.useRealTimers();
      }
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
  ): Promise<SnapshotView> {
    return (
      target as unknown as {
        buildSnapshot: (value: ReturnType<typeof createWaitingRecord>) => Promise<SnapshotView>;
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
