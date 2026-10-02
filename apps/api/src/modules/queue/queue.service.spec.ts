import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QueueService,
  RELEASE_QUEUE_RECONCILE_LOCK_LUA,
} from './queue.service.js';
import type { QueueGateway } from './queue.gateway.js';
import {
  evalQueueScriptInMemory,
  isQueueScript,
} from './queue-redis-scripts.js';
import { performances } from '../../database/schema/performances.js';
import { reservations } from '../../database/schema/reservations.js';
import { seatInventories } from '../../database/schema/seat-inventories.js';
import { seatMaps } from '../../database/schema/seat-maps.js';
import { showtimes } from '../../database/schema/showtimes.js';
import { redisProvider } from '../booking/providers/redis.provider.js';

function createMockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn(),
    expire: vi.fn().mockResolvedValue(1),
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

/**
 * Redis double with real TTL semantics evaluated against Date.now() (works
 * with fake timers). Unlike the local-dev InMemoryRedis it never removes
 * locked-seats members when a seat lock expires — exactly like Valkey.
 */
class FakeRedis {
  private readonly strings = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, Map<string, number>>();
  readonly evalKeys: string[][] = [];

  private entry(key: string) {
    const entry = this.strings.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.strings.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.entry(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    const flags = args.map((arg) => (typeof arg === 'string' ? arg.toUpperCase() : arg));
    if (flags.includes('NX') && this.entry(key)) {
      return null;
    }
    let ttlMs: number | null = null;
    const px = flags.indexOf('PX');
    const ex = flags.indexOf('EX');
    if (px >= 0) ttlMs = Number(flags[px + 1]);
    else if (ex >= 0) ttlMs = Number(flags[ex + 1]) * 1000;
    this.strings.set(key, { value, expiresAt: ttlMs === null ? null : Date.now() + ttlMs });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key) || this.sets.delete(key) || this.zsets.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.entry(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async pttl(key: string): Promise<number> {
    const entry = this.entry(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - Date.now();
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    this.sets.set(key, set);
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    return removed;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }

  async sismember(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }

  private ordered(key: string): string[] {
    return [...(this.zsets.get(key) ?? new Map<string, number>()).entries()]
      .sort(([memberA, scoreA], [memberB, scoreB]) =>
        scoreA === scoreB ? memberA.localeCompare(memberB) : scoreA - scoreB)
      .map(([member]) => member);
  }

  async zadd(key: string, score: number | string, member: string): Promise<number> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    this.zsets.set(key, zset);
    const existed = zset.has(member);
    zset.set(member, Number(score));
    return existed ? 0 : 1;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    let removed = 0;
    for (const member of members) {
      if (zset.delete(member)) removed += 1;
    }
    return removed;
  }

  async zrank(key: string, member: string): Promise<number | null> {
    const index = this.ordered(key).indexOf(member);
    return index >= 0 ? index : null;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : String(score);
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.ordered(key).slice(start, stop + 1);
  }

  async eval(script: string, numKeys: number, ...keysAndArgs: (string | number)[]): Promise<unknown> {
    const keys = keysAndArgs.slice(0, numKeys).map(String);
    const args = keysAndArgs.slice(numKeys).map(String);
    this.evalKeys.push(keys);
    if (isQueueScript(script)) {
      return evalQueueScriptInMemory(this, script, keys, args);
    }
    if (script.includes('RELEASE_QUEUE_RECONCILE_LOCK_LUA')) {
      if ((await this.get(keys[0]!)) === args[0]) {
        return this.del(keys[0]!);
      }
      return 0;
    }
    throw new Error(`FakeRedis: unsupported script ${script.slice(0, 40)}`);
  }
}

type QueueDbState = {
  performanceId: string;
  totalSeats: number;
  showtimeIds: string[];
  soldCount: number;
  orderBinding: Record<string, unknown> | null;
};

function createQueueDb(state: QueueDbState) {
  return {
    select: vi.fn((selection: Record<string, unknown> = {}) => ({
      from: (table: unknown) => {
        const rows = (): unknown[] => {
          if (table === seatMaps) return [{ totalSeats: state.totalSeats }];
          if (table === seatInventories) return [{ total: state.soldCount }];
          if (table === reservations) return state.orderBinding ? [state.orderBinding] : [];
          if (table === performances) return [{ status: 'selling', bookingStartsAt: null }];
          if (table === showtimes) {
            return 'performanceId' in selection
              ? [{ performanceId: state.performanceId }]
              : state.showtimeIds.map((id) => ({ id }));
          }
          return [];
        };
        const chain = {
          where: async () => rows(),
          innerJoin: () => chain,
          leftJoin: () => chain,
        };
        return chain;
      },
    })),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type QueueServiceInternals = {
  reconcilePerformanceQueue: (performanceId: string) => Promise<void>;
  reconcilePerformanceQueueIfDue: (performanceId: string) => Promise<void>;
  broadcastWaitingPositions: (performanceId: string) => Promise<void>;
  admitQueueSession: (performanceId: string, queueSessionId: string) => Promise<void>;
};

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

  it('limits waiting position broadcasts and derives positions without per-session Redis reads', async () => {
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
    mockRedis.zcard.mockResolvedValue(2);
    vi.spyOn(service as never, 'readQueueSessionRecord').mockResolvedValue(record);
    const remainingSeatsSpy = vi
      .spyOn(service as never, 'calculateRemainingSeats')
      .mockResolvedValue(1_000);

    await (service as unknown as QueueServiceInternals).broadcastWaitingPositions(performanceId);

    expect(mockRedis.zrange).toHaveBeenCalledWith(
      `{queue:${performanceId}}:waiting`,
      0,
      499,
    );
    expect(mockGateway.emitPosition).toHaveBeenCalledTimes(2);
    expect(mockGateway.emitPosition.mock.calls.map(([, snapshot]) => snapshot.position))
      .toEqual([1, 2]);
    expect(mockRedis.zrank).not.toHaveBeenCalled();
    expect(mockRedis.zcard).toHaveBeenCalledTimes(1);
    expect(remainingSeatsSpy).toHaveBeenCalledTimes(1);
  });

  it('releases the owned reconcile lock after a high-admission batch finishes', async () => {
    vi.spyOn(service as never, 'reconcilePerformanceQueue').mockResolvedValue(undefined);

    await (service as unknown as QueueServiceInternals).reconcilePerformanceQueueIfDue(performanceId);

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
    mockRedis.set.mockImplementation(async (key: string) =>
      key.endsWith(':reconcile-lock') ? null : 'OK');

    await (service as unknown as QueueServiceInternals).reconcilePerformanceQueueIfDue(performanceId);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `{queue:${performanceId}}:reconcile-lock`,
      expect.any(String),
      'PX',
      30_000,
      'NX',
    );
    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('skips the reconcile when another request ran it within the minimum interval', async () => {
    const reconcileSpy = vi
      .spyOn(service as never, 'reconcilePerformanceQueue')
      .mockResolvedValue(undefined);
    mockRedis.set.mockImplementation(async (key: string) =>
      key.endsWith(':reconcile-throttle') ? null : 'OK');

    await (service as unknown as QueueServiceInternals).reconcilePerformanceQueueIfDue(performanceId);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `{queue:${performanceId}}:reconcile-throttle`,
      '1',
      'PX',
      1_000,
      'NX',
    );
    expect(mockRedis.set).not.toHaveBeenCalledWith(
      `{queue:${performanceId}}:reconcile-lock`,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(reconcileSpy).not.toHaveBeenCalled();
  });
});

describe('QueueService session lifecycle (TTL-faithful Redis)', () => {
  const performanceId = '550e8400-e29b-41d4-a716-446655440000';
  const showtimeId = '7d4f1c1e-0000-4000-8000-000000000001';
  const browserA = { userId: 'user-a', refreshTokenFamilyId: 'family-a', deviceSlotId: 'family-a' };
  const browserB = { userId: 'user-b', refreshTokenFamilyId: 'family-b', deviceSlotId: 'family-b' };
  const waitingKey = `{queue:${performanceId}}:waiting`;
  const activeKey = `{queue:${performanceId}}:active`;
  const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
  const sessionKey = (queueSessionId: string) => `{queue:${performanceId}}:session:${queueSessionId}`;
  const T0 = new Date('2026-10-02T11:00:00.000Z');

  let redis: FakeRedis;
  let dbState: QueueDbState;
  let gateway: ReturnType<typeof createMockGateway>;
  let service: QueueService;

  const minutes = (value: number) => value * 60 * 1000;
  const setNow = (offsetMs: number) => vi.setSystemTime(new Date(T0.getTime() + offsetMs));
  const readRecord = async (queueSessionId: string) =>
    JSON.parse((await redis.get(sessionKey(queueSessionId))) ?? 'null') as Record<string, unknown> | null;
  const enter = (identity: typeof browserA, presentedAdmissionToken?: string) =>
    service.enterPerformanceQueue({ performanceId, identity, presentedAdmissionToken });
  const status = (
    queueSessionId: string,
    identity: typeof browserA,
    admissionToken: string,
  ) => service.getQueueSessionStatus({ queueSessionId, identity, admissionToken });

  beforeEach(() => {
    vi.useFakeTimers();
    setNow(0);
    redis = new FakeRedis();
    dbState = {
      performanceId,
      totalSeats: 0,
      showtimeIds: [showtimeId],
      soldCount: 0,
      orderBinding: null,
    };
    gateway = createMockGateway();
    service = new QueueService(
      redis as never,
      createQueueDb(dbState) as never,
      gateway as unknown as QueueGateway,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('session creation and re-entry (#26)', () => {
    it('creates a WAITING session bound to the browser identity', async () => {
      const lease = await service.ensureQueueSession({ performanceId, identity: browserA });

      expect(lease).toMatchObject({
        queueSessionId: expect.any(String),
        admissionToken: expect.any(String),
        ...browserA,
      });
      expect(await redis.get(`{queue:${performanceId}}:identity:user-a:family-a:family-a`))
        .toBe(lease.queueSessionId);
      expect(await redis.get(`{queue:admission}:${hashToken(lease.admissionToken)}`))
        .toBe(lease.queueSessionId);
      expect(await redis.get(`{queue:session-ref}:${lease.queueSessionId}`)).toBe(performanceId);
      expect(await readRecord(lease.queueSessionId)).toMatchObject({ state: 'WAITING' });
      expect(await redis.zcard(waitingKey)).toBe(1);
    });

    it('reuses the session for the same identity and keeps a presented current token', async () => {
      const first = await service.ensureQueueSession({ performanceId, identity: browserA });
      const reentry = await service.ensureQueueSession({
        performanceId,
        identity: browserA,
        presentedAdmissionToken: first.admissionToken,
      });
      const rotated = await service.ensureQueueSession({ performanceId, identity: browserA });

      expect(reentry.queueSessionId).toBe(first.queueSessionId);
      expect(reentry.admissionToken).toBe(first.admissionToken);
      expect(rotated.queueSessionId).toBe(first.queueSessionId);
      expect(rotated.admissionToken).not.toBe(first.admissionToken);
      expect(await redis.get(`{queue:admission}:${hashToken(first.admissionToken)}`)).toBeNull();
      expect(await redis.get(`{queue:admission}:${hashToken(rotated.admissionToken)}`))
        .toBe(first.queueSessionId);
      expect(await redis.zcard(waitingKey)).toBe(1);
    });

    it('creates a single queue position for concurrent first entries from one browser', async () => {
      const leases = await Promise.all([
        service.ensureQueueSession({ performanceId, identity: browserA }),
        service.ensureQueueSession({ performanceId, identity: browserA }),
        service.ensureQueueSession({ performanceId, identity: browserA }),
      ]);

      expect(new Set(leases.map((lease) => lease.queueSessionId)).size).toBe(1);
      expect(await redis.zcard(waitingKey)).toBe(1);
      const record = await readRecord(leases[0]!.queueSessionId);
      expect(leases.map((lease) => hashToken(lease.admissionToken)))
        .toContain(record?.['admissionTokenHash']);
    });

    it('keeps an admission granted while the same browser re-enters with a stale read', async () => {
      const first = await service.ensureQueueSession({ performanceId, identity: browserA });
      const internals = service as unknown as QueueServiceInternals;
      const originalGet = redis.get.bind(redis);
      let interleaved = false;
      redis.get = async (key: string) => {
        const value = await originalGet(key);
        if (!interleaved && key === sessionKey(first.queueSessionId)) {
          interleaved = true;
          // reconcile admits the session between the re-entry's read and write
          await internals.admitQueueSession(performanceId, first.queueSessionId);
        }
        return value;
      };

      const reentry = await service.ensureQueueSession({ performanceId, identity: browserA });
      redis.get = originalGet;

      expect(interleaved).toBe(true);
      const record = await readRecord(first.queueSessionId);
      expect(record).toMatchObject({
        state: 'ADMITTED',
        admissionTokenHash: hashToken(reentry.admissionToken),
      });
      expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(1);
      expect(await redis.zrank(waitingKey, first.queueSessionId)).toBeNull();
      await expect(status(first.queueSessionId, browserA, reentry.admissionToken))
        .resolves.toMatchObject({ state: 'ADMITTED', autoEnter: true });
    });

    it('purges an expired session with same-slot scripts and single-key deletes only', async () => {
      const first = await service.ensureQueueSession({ performanceId, identity: browserA });
      const record = await readRecord(first.queueSessionId);
      await redis.set(
        sessionKey(first.queueSessionId),
        JSON.stringify({ ...record, state: 'EXPIRED' }),
        'PX',
        60_000,
      );
      const delSpy = vi.spyOn(redis, 'del');

      const next = await service.ensureQueueSession({ performanceId, identity: browserA });

      expect(next.queueSessionId).not.toBe(first.queueSessionId);
      expect(await redis.get(sessionKey(first.queueSessionId))).toBeNull();
      expect(await redis.get(`{queue:session-ref}:${first.queueSessionId}`)).toBeNull();
      expect(await redis.get(`{queue:admission}:${hashToken(first.admissionToken)}`)).toBeNull();
      expect(delSpy.mock.calls.every((args) => args.length === 1)).toBe(true);
      for (const keys of redis.evalKeys) {
        const tags = new Set(keys.map((key) => key.match(/^\{[^}]+\}/)?.[0]));
        expect(tags.size).toBe(1);
      }
    });

    it('puts a WAITING record that a lost update left in the active set back in line', async () => {
      dbState.totalSeats = 0;
      const first = await service.ensureQueueSession({ performanceId, identity: browserA });
      const stuck = await readRecord(first.queueSessionId);
      await redis.zrem(waitingKey, first.queueSessionId);
      await redis.sadd(activeKey, first.queueSessionId);

      await (service as unknown as QueueServiceInternals).reconcilePerformanceQueue(performanceId);

      expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);
      expect(await redis.zscore(waitingKey, first.queueSessionId))
        .toBe(String(Date.parse(String(stuck?.['enteredAt']))));
    });
  });

  describe('waiting session heartbeat (#4)', () => {
    it('keeps a polling WAITING session and its position beyond 30 minutes after entry', async () => {
      const a = await enter(browserA);
      setNow(1_000);
      const b = await enter(browserB);

      for (let offset = 5; offset <= 45; offset += 5) {
        setNow(minutes(offset));
        await status(a.queueSessionId, browserA, a.admissionToken);
        await status(b.queueSessionId, browserB, b.admissionToken);
      }

      await expect(status(a.queueSessionId, browserA, a.admissionToken))
        .resolves.toMatchObject({ state: 'WAITING', position: 1, waitingCount: 2 });
      await expect(status(b.queueSessionId, browserB, b.admissionToken))
        .resolves.toMatchObject({ state: 'WAITING', position: 2 });
      expect(await redis.pttl(sessionKey(a.queueSessionId))).toBeGreaterThan(minutes(25));
      expect(await redis.pttl(`{queue:session-ref}:${a.queueSessionId}`))
        .toBeGreaterThan(minutes(25));
    });

    it('drops a WAITING session only after its heartbeat stops for the idle window', async () => {
      const a = await enter(browserA);
      setNow(minutes(20));
      await status(a.queueSessionId, browserA, a.admissionToken);

      setNow(minutes(49));
      await expect(status(a.queueSessionId, browserA, a.admissionToken))
        .resolves.toMatchObject({ state: 'WAITING' });

      setNow(minutes(49) + minutes(31));
      await expect(status(a.queueSessionId, browserA, a.admissionToken))
        .rejects.toThrow('대기열 세션을 찾을 수 없습니다');
    });
  });

  describe('slot return after purchase (#4)', () => {
    async function admitBuyerAndQueueNext() {
      dbState.totalSeats = 2;
      const buyer = await enter(browserA);
      expect(buyer.state).toBe('ADMITTED');
      // the buyer holds one seat lock while paying
      await redis.set(`{${showtimeId}}:seat:A-1`, browserA.userId, 'PX', minutes(10));
      await redis.sadd(lockedSeatsKey, 'A-1');
      setNow(3_000);
      const next = await enter(browserB);
      expect(next.state).toBe('WAITING');
      // purchase completes: the lock is consumed and the seat is sold
      await redis.del(`{${showtimeId}}:seat:A-1`);
      await redis.srem(lockedSeatsKey, 'A-1');
      dbState.soldCount = 1;
      return { buyer, next };
    }

    it('keeps the next buyer waiting while a finished purchase still holds its slot', async () => {
      const { next } = await admitBuyerAndQueueNext();

      setNow(minutes(2));
      await expect(status(next.queueSessionId, browserB, next.admissionToken))
        .resolves.toMatchObject({ state: 'WAITING', position: 1 });
    });

    it('admits the next buyer as soon as the confirmed purchase returns its slot', async () => {
      const { buyer, next } = await admitBuyerAndQueueNext();

      await expect(service.releaseAdmissionAfterPurchase(buyer.queueSessionId)).resolves.toBe(true);
      expect(await redis.sismember(activeKey, buyer.queueSessionId)).toBe(0);
      expect(await readRecord(buyer.queueSessionId)).toMatchObject({ state: 'EXPIRED' });

      setNow(minutes(2));
      await expect(status(next.queueSessionId, browserB, next.admissionToken))
        .resolves.toMatchObject({ state: 'ADMITTED' });
      expect(gateway.emitAdmitted).toHaveBeenCalledWith(
        next.queueSessionId,
        expect.objectContaining({ state: 'ADMITTED' }),
      );
    });

    it('treats the release as best effort and never throws', async () => {
      await expect(service.releaseAdmissionAfterPurchase(undefined)).resolves.toBe(false);
      await expect(service.releaseAdmissionAfterPurchase('admin-bypass-admin-1')).resolves.toBe(false);
      vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('valkey down'));
      await expect(service.releaseAdmissionAfterPurchase('queue-session-1')).resolves.toBe(false);
    });
  });

  describe('payment confirm admission window (#3)', () => {
    async function prepareAndHandoff() {
      dbState.totalSeats = 10;
      const lease = await enter(browserA);
      expect(lease.state).toBe('ADMITTED');
      const admittedAt = new Date(String(lease.admittedAt));

      // T+9: prepare (enables payment recovery until T+13)
      setNow(minutes(9));
      await service.assertAdmissionForShowtime({
        showtimeId,
        identity: browserA,
        admissionToken: lease.admissionToken,
        action: 'prepare-reservation',
      });
      // T+9:30: provider handoff extends the DB deadline to T+17:30
      const deadline = new Date(admittedAt.getTime() + minutes(17.5));
      dbState.orderBinding = {
        performanceId,
        status: 'PENDING_PAYMENT',
        queueSessionId: lease.queueSessionId,
        refreshFamilyId: browserA.refreshTokenFamilyId,
        deviceSlotKey: browserA.deviceSlotId,
        admittedAt,
        admissionActiveUntilAt: deadline,
        reentryGraceUntilAt: deadline,
        paymentDeadlineAt: deadline,
      };
      return lease;
    }

    it('accepts confirm inside the extended payment deadline after the queue windows ended', async () => {
      const lease = await prepareAndHandoff();

      setNow(minutes(14));
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
        admissionToken: lease.admissionToken,
      })).resolves.toMatchObject({ queueSessionId: lease.queueSessionId });

      // the admission cookie (13 minutes) is gone after 3DS / app switch
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
      })).resolves.toMatchObject({ queueSessionId: lease.queueSessionId });
      expect(await readRecord(lease.queueSessionId)).not.toMatchObject({ state: 'EXPIRED' });
    });

    it('accepts confirm after the Redis queue session itself expired', async () => {
      const lease = await prepareAndHandoff();

      setNow(minutes(17));
      await redis.del(sessionKey(lease.queueSessionId));
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
      })).resolves.toMatchObject({ queueSessionId: lease.queueSessionId });
    });

    it('keeps allowing an idempotent confirm retry of a confirmed order', async () => {
      const lease = await prepareAndHandoff();
      dbState.orderBinding = { ...dbState.orderBinding!, status: 'CONFIRMED' };

      setNow(minutes(40));
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
      })).resolves.toMatchObject({ queueSessionId: lease.queueSessionId });
    });

    it('rejects confirm after the extended payment deadline', async () => {
      const lease = await prepareAndHandoff();

      setNow(minutes(17.5) + 1_000);
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
        admissionToken: lease.admissionToken,
      })).rejects.toThrow('대기열 입장 시간이 만료되었습니다');
    });

    it('does not let another browser session confirm through the order binding', async () => {
      await prepareAndHandoff();

      setNow(minutes(14));
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: { ...browserA, refreshTokenFamilyId: 'family-x', deviceSlotId: 'family-x' },
      })).rejects.toThrow('대기열 입장 인증이 필요합니다');
    });
  });

  describe('remaining seats from live locks only (#6)', () => {
    it('drops expired seat-lock members instead of counting them as occupied', async () => {
      dbState.totalSeats = 2;
      await redis.set(`{${showtimeId}}:seat:A-1`, 'buyer-1', 'PX', minutes(7));
      await redis.set(`{${showtimeId}}:seat:A-2`, 'buyer-2', 'PX', minutes(7));
      await redis.sadd(lockedSeatsKey, 'A-1', 'A-2');

      // both buyers abandon payment; their locks expire but the set keeps members
      setNow(minutes(8));
      expect(await redis.scard(lockedSeatsKey)).toBe(2);

      const lease = await enter(browserA);

      expect(lease).toMatchObject({ state: 'ADMITTED', remainingSeats: 2 });
      expect(await redis.scard(lockedSeatsKey)).toBe(0);
    });

    it('still counts live seat locks as occupied', async () => {
      dbState.totalSeats = 1;
      await redis.set(`{${showtimeId}}:seat:A-1`, 'buyer-1', 'PX', minutes(7));
      await redis.sadd(lockedSeatsKey, 'A-1');

      const lease = await enter(browserA);

      expect(lease).toMatchObject({ state: 'WAITING', remainingSeats: 0 });
      expect(await redis.scard(lockedSeatsKey)).toBe(1);
    });
  });

  describe('reconcile off the booking path (#89)', () => {
    it('runs at most one reconcile per performance per interval from status polls', async () => {
      const a = await enter(browserA);
      const reconcileSpy = vi.spyOn(
        service as unknown as QueueServiceInternals,
        'reconcilePerformanceQueue',
      );

      setNow(2_000);
      await Promise.all(
        Array.from({ length: 5 }, () => status(a.queueSessionId, browserA, a.admissionToken)),
      );
      await status(a.queueSessionId, browserA, a.admissionToken);
      expect(reconcileSpy).toHaveBeenCalledTimes(1);

      setNow(3_100);
      await status(a.queueSessionId, browserA, a.admissionToken);
      expect(reconcileSpy).toHaveBeenCalledTimes(2);
    });

    it('does not run the queue reconcile inside seat lock or payment confirm guards', async () => {
      dbState.totalSeats = 10;
      const lease = await enter(browserA);
      const reconcileSpy = vi.spyOn(
        service as unknown as QueueServiceInternals,
        'reconcilePerformanceQueueIfDue',
      );

      setNow(5_000);
      await service.assertAdmissionForShowtime({
        showtimeId,
        identity: browserA,
        admissionToken: lease.admissionToken,
        action: 'lock-seat',
      });
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
        admissionToken: lease.admissionToken,
      })).rejects.toThrow('예매 정보를 찾을 수 없습니다');

      expect(reconcileSpy).not.toHaveBeenCalled();
    });

    it('admits a new entrant directly while the reconcile is throttled', async () => {
      dbState.totalSeats = 10;
      const a = await enter(browserA);
      setNow(200);
      const b = await enter(browserB);

      expect(a.state).toBe('ADMITTED');
      expect(b).toMatchObject({ state: 'ADMITTED', autoEnter: true });
    });

    it('never admits a new entrant ahead of an earlier waiting session', async () => {
      dbState.totalSeats = 0;
      const a = await enter(browserA);
      expect(a.state).toBe('WAITING');

      // one seat frees up; B enters within the reconcile interval
      dbState.totalSeats = 1;
      setNow(2_500);
      await redis.del(`{queue:${performanceId}}:reconcile-throttle`);
      await redis.set(`{queue:${performanceId}}:reconcile-throttle`, '1', 'PX', 1_000);
      const b = await enter(browserB);

      expect(b).toMatchObject({ state: 'WAITING', position: 2 });
      expect(await readRecord(a.queueSessionId)).toMatchObject({ state: 'WAITING' });

      setNow(4_000);
      await expect(status(a.queueSessionId, browserA, a.admissionToken))
        .resolves.toMatchObject({ state: 'ADMITTED' });
    });

    it('fills slots left by expired waiting members in the same reconcile', async () => {
      dbState.totalSeats = 0;
      const ghost = await enter(browserA);
      setNow(1_000);
      const live = await enter(browserB);
      await redis.del(sessionKey(ghost.queueSessionId));

      dbState.totalSeats = 1;
      setNow(3_000);
      await expect(status(live.queueSessionId, browserB, live.admissionToken))
        .resolves.toMatchObject({ state: 'ADMITTED' });
      expect(await redis.zrank(waitingKey, ghost.queueSessionId)).toBeNull();
    });
  });
});

describe('QueueService on the local-development InMemoryRedis', () => {
  const performanceId = '550e8400-e29b-41d4-a716-446655440000';
  const showtimeId = '7d4f1c1e-0000-4000-8000-000000000001';
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('runs entry, status, confirm-release and re-entry without a Valkey server', async () => {
    process.env['NODE_ENV'] = 'development';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config = { get: (_key: string, defaultValue?: string) => defaultValue ?? '' };
    const redis = (redisProvider as unknown as {
      useFactory: (configService: unknown) => unknown;
    }).useFactory(config);
    const service = new QueueService(
      redis as never,
      createQueueDb({
        performanceId,
        totalSeats: 1,
        showtimeIds: [showtimeId],
        soldCount: 0,
        orderBinding: null,
      }) as never,
      createMockGateway() as unknown as QueueGateway,
    );
    const browser = { userId: 'user-a', refreshTokenFamilyId: 'family-a', deviceSlotId: 'family-a' };

    const lease = await service.enterPerformanceQueue({ performanceId, identity: browser });
    expect(lease).toMatchObject({ state: 'ADMITTED', remainingSeats: 1 });
    await expect(service.getQueueSessionStatus({
      queueSessionId: lease.queueSessionId,
      identity: browser,
      admissionToken: lease.admissionToken,
    })).resolves.toMatchObject({ state: 'ADMITTED' });

    await expect(service.releaseAdmissionAfterPurchase(lease.queueSessionId)).resolves.toBe(true);
    const reentry = await service.enterPerformanceQueue({ performanceId, identity: browser });
    expect(reentry.queueSessionId).not.toBe(lease.queueSessionId);
  });
});
