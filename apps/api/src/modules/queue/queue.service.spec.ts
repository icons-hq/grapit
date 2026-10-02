import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUEUE_ACTIVE_WINDOW_SECONDS,
  QUEUE_ADMISSION_COOKIE_MAX_AGE_MS,
  QUEUE_ETA_CYCLE_MAX_SECONDS,
  QUEUE_ETA_MAX_SECONDS,
  QUEUE_SLOT_MIN_HOLD_SECONDS,
  QUEUE_WAITING_COOKIE_MAX_AGE_MS,
  QueueService,
  RELEASE_QUEUE_RECONCILE_LOCK_LUA,
  estimateQueueWait,
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
    // The JavaScript mirror also covers the reconcile lock release (#89).
    if (isQueueScript(script)) {
      return evalQueueScriptInMemory(this, script, keys, args);
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
  // Optional per-showtime start (default: far ahead, on sale) and sold seats
  // (default: soldCount for the whole performance).
  showtimeStartsAt?: Record<string, Date>;
  soldByShowtime?: Record<string, number>;
  // When set, every reservations query is recorded here. The double returns
  // `orderBinding` whatever the WHERE says, so a test reads the filter from it.
  reservationQueries?: Array<{ selection: Record<string, unknown>; where: SQL | undefined }>;
};

const pgDialect = new PgDialect();
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

/**
 * The C1 cutoff a query applied, read from its real SQL: the bound value of
 * `"showtimes"."date_time" > $n`, or null when the query did not filter.
 */
function readOnSaleCutoff(where: SQL | undefined): Date | null {
  if (!where) return null;
  const query = pgDialect.sqlToQuery(where);
  const match = /"showtimes"\."date_time" > \$(\d+)/.exec(query.sql);
  return match ? new Date(String(query.params[Number(match[1]) - 1])) : null;
}

function createQueueDb(state: QueueDbState) {
  const selectedShowtimeIds = (where: SQL | undefined): string[] => {
    const cutoff = readOnSaleCutoff(where);
    return state.showtimeIds.filter((id) =>
      cutoff === null
      || (state.showtimeStartsAt?.[id] ?? FAR_FUTURE).getTime() > cutoff.getTime());
  };

  return {
    select: vi.fn((selection: Record<string, unknown> = {}) => ({
      from: (table: unknown) => {
        const rows = (where: SQL | undefined): unknown[] => {
          if (table === seatMaps) return [{ totalSeats: state.totalSeats }];
          if (table === seatInventories) {
            if (!state.soldByShowtime) return [{ total: state.soldCount }];
            const total = selectedShowtimeIds(where)
              .reduce((sum, id) => sum + (state.soldByShowtime?.[id] ?? 0), 0);
            return [{ total }];
          }
          if (table === reservations) {
            state.reservationQueries?.push({ selection, where });
            return state.orderBinding ? [state.orderBinding] : [];
          }
          if (table === performances) {
            // Queue entry gate row: a published, selling performance with a
            // showtime that has not started yet.
            return [{
              status: 'selling',
              publishState: 'published',
              bookingStartsAt: null,
              showtimeCount: state.showtimeIds.length,
              sellableShowtimeCount: state.showtimeIds.length,
            }];
          }
          if (table === showtimes) {
            return 'performanceId' in selection
              ? [{ performanceId: state.performanceId }]
              : selectedShowtimeIds(where).map((id) => ({ id }));
          }
          return [];
        };
        const chain = {
          where: async (where?: SQL) => rows(where),
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
  admitQueueSessionWithinCapacity: (performanceId: string, queueSessionId: string) => Promise<void>;
  calculateRemainingSeats: (performanceId: string) => Promise<number>;
};

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
     * under-report the wait. This drives the real reconcile/expiry code with the
     * TTL-faithful Redis fake and checks every waiting snapshot against the time
     * the session was actually admitted. Some buyers confirm payment early and
     * return their slot right away (#4), so admission can also come sooner than
     * a full admission window.
     */
    it('contains the actual admission time in every waiting snapshot through opening burst and waves', async () => {
      vi.useFakeTimers();
      try {
        const openAt = Date.parse('2026-06-04T10:00:00.000Z');
        vi.setSystemTime(openAt);
        const seats = 3;
        const stepMs = 5_000;
        const fakeRedis = new FakeRedis();
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
          releaseAt: number | null;
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
          const entry: Tracked = { name, lease, samples: [], admittedAt: null, releaseAt: null };
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
            const index = tracked.indexOf(entry);
            // Every third buyer confirms payment two minutes after admission and
            // returns the slot at once; of the rest, every other buyer keeps the
            // slot through the payment-recovery grace (13 minutes) and the others
            // hold it for the 10-minute active window.
            if (index % 3 === 1) {
              entry.releaseAt = entry.admittedAt + 2 * 60_000;
            } else if (index % 2 === 0) {
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
            if (entry.releaseAt !== null && Date.now() >= entry.releaseAt) {
              entry.releaseAt = null;
              await simulated.releaseAdmissionAfterPurchase(entry.lease.queueSessionId);
            }
          }
          for (const entry of tracked) {
            if (entry.admittedAt === null) await poll(entry);
          }
          vi.setSystemTime(Date.now() + stepMs);
        }

        expect(tracked.every((entry) => entry.admittedAt !== null)).toBe(true);
        // Waves actually happened: the last buyer waited more than two active
        // windows even though some slots came back early.
        const longestWait = Math.max(
          ...tracked.map((entry) => (entry.admittedAt ?? 0) - openAt),
        );
        expect(longestWait).toBeGreaterThan(2 * QUEUE_ACTIVE_WINDOW_SECONDS * 1000);
        // An early slot return admitted someone before the first active window ended.
        const earliestLaterAdmission = Math.min(
          ...tracked.slice(seats).map((entry) => (entry.admittedAt ?? Infinity) - openAt),
        );
        expect(earliestLaterAdmission).toBeLessThan(QUEUE_ACTIVE_WINDOW_SECONDS * 1000);

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
        expect(lateWaitMs).toBeGreaterThan(QUEUE_ACTIVE_WINDOW_SECONDS * 1000);
        expect(lateWaitMs).toBeLessThanOrEqual(lateFirst?.max ?? 0);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The upper bound holds only at the remaining seats of the snapshot. When
     * seats sell while a buyer waits, the cycle capacity shrinks, the earlier
     * bound no longer covers the wait, and the next snapshot widens the range
     * so that it covers the wait again.
     */
    it('widens the range when remaining seats shrink while waiting', async () => {
      vi.useFakeTimers();
      try {
        const openAt = Date.parse('2026-06-04T10:00:00.000Z');
        vi.setSystemTime(openAt);
        const stepMs = 5_000;
        const fakeRedis = new FakeRedis();
        const remainingSeatsKey = `{queue:${performanceId}}:remaining-seats`;
        await fakeRedis.set(remainingSeatsKey, '3');
        const simulated = new QueueService(
          fakeRedis as never,
          mockDb as never,
          mockGateway as unknown as QueueGateway,
        );

        const leases: Array<Awaited<ReturnType<QueueService['ensureQueueSession']>>> = [];
        for (let index = 0; index < 6; index += 1) {
          vi.setSystemTime(openAt + index * 10);
          leases.push(await simulated.ensureQueueSession({
            performanceId,
            identity: {
              userId: `buyer-${index}`,
              refreshTokenFamilyId: `buyer-${index}-family`,
              deviceSlotId: `buyer-${index}-family`,
            },
          }));
        }
        const poll = (lease: (typeof leases)[number]) => simulated.getQueueSessionStatus({
          queueSessionId: lease.queueSessionId,
          identity: lease,
          admissionToken: lease.admissionToken,
        });
        const last = leases[5]!;

        // first reconcile: 3 seats admit the first three, the last is third in line
        const before = await poll(last);
        const beforeAt = Date.now();
        expect(before).toMatchObject({ state: 'WAITING', position: 3, etaUnavailable: false });
        expect(before.etaSeconds).toBe(QUEUE_ETA_CYCLE_MAX_SECONDS);

        // two seats sell: one admission per cycle from now on
        await fakeRedis.set(remainingSeatsKey, '1');
        vi.setSystemTime(Date.now() + stepMs);
        const after = await poll(last);
        const afterAt = Date.now();
        expect(after).toMatchObject({ state: 'WAITING', position: 3, etaUnavailable: false });
        expect(after.etaSeconds).toBe(3 * QUEUE_ETA_CYCLE_MAX_SECONDS);
        expect(after.etaSeconds).toBeGreaterThan(before.etaSeconds);

        let admittedAt: number | null = null;
        while (admittedAt === null && Date.now() <= openAt + 3 * 60 * 60_000) {
          vi.setSystemTime(Date.now() + stepMs);
          if ((await poll(last)).state !== 'WAITING') admittedAt = Date.now();
        }

        expect(admittedAt).not.toBeNull();
        // the bound sampled at 3 remaining seats did not hold once seats sold ...
        expect((admittedAt ?? 0) - beforeAt).toBeGreaterThan(before.etaSeconds * 1000);
        // ... the widened bound sampled after the drop does
        expect((admittedAt ?? 0) - afterAt).toBeLessThanOrEqual(after.etaSeconds * 1000);
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
    // Admission cookie: 13 minutes for an admission, the 30-minute idle window
    // while WAITING (Max-Age is checked in queue.controller.http.spec.ts).
    expect(controllerSource).toContain('QUEUE_ADMISSION_COOKIE_MAX_AGE_MS');
    expect(controllerSource).toContain('QUEUE_WAITING_COOKIE_MAX_AGE_MS');
    expect(QUEUE_ADMISSION_COOKIE_MAX_AGE_MS).toBe(780_000);
    expect(QUEUE_WAITING_COOKIE_MAX_AGE_MS).toBe(1_800_000);

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

  describe('re-entry after the active window (D2, #4 #26 #32)', () => {
    const identityKeyA = `{queue:${performanceId}}:identity:user-a:family-a:family-a`;
    const prepare = (admissionToken: string) =>
      service.assertAdmissionForShowtime({
        showtimeId,
        identity: browserA,
        admissionToken,
        action: 'prepare-reservation',
      });
    const pendingOrder = (
      lease: { queueSessionId: string; admittedAt: string | null },
      paymentDeadlineAt: Date,
    ): Record<string, unknown> => {
      const admittedAt = new Date(String(lease.admittedAt));
      return {
        tossOrderId: 'ORDER-1',
        status: 'PENDING_PAYMENT',
        queueSessionId: lease.queueSessionId,
        refreshFamilyId: browserA.refreshTokenFamilyId,
        deviceSlotKey: browserA.deviceSlotId,
        admittedAt,
        admissionActiveUntilAt: new Date(admittedAt.getTime() + minutes(10)),
        reentryGraceUntilAt: new Date(admittedAt.getTime() + minutes(13)),
        paymentDeadlineAt,
        // start of the order's showtime (C1)
        showtimeAt: dbState.showtimeStartsAt?.[showtimeId] ?? FAR_FUTURE,
      };
    };

    it('reuses the admission up to activeUntilAt and replaces it right after', async () => {
      dbState.totalSeats = 1;
      const first = await enter(browserA);
      expect(first.state).toBe('ADMITTED');
      setNow(1_000);
      await expect(enter(browserB)).resolves.toMatchObject({ state: 'WAITING', position: 1 });

      // activeUntilAt itself still belongs to the admission (lock/prepare accept it)
      setNow(minutes(10));
      await expect(enter(browserA, first.admissionToken)).resolves.toMatchObject({
        queueSessionId: first.queueSessionId,
        state: 'ADMITTED',
        autoEnter: true,
        activeUntilAt: first.activeUntilAt,
      });
      expect(gateway.emitExpired).not.toHaveBeenCalled();

      setNow(minutes(10) + 1);
      const next = await enter(browserA, first.admissionToken);

      expect(next.queueSessionId).not.toBe(first.queueSessionId);
      expect(next).toMatchObject({ state: 'WAITING', autoEnter: false, activeUntilAt: null });
      expect(next.position).toBeGreaterThan(0);
      expect(next).not.toHaveProperty('recoveryOrderId');
      expect(gateway.emitExpired).toHaveBeenCalledWith(
        first.queueSessionId,
        expect.objectContaining({ state: 'EXPIRED', autoEnter: false }),
      );
      expect(await readRecord(first.queueSessionId)).toBeNull();
      expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);
      expect(await redis.get(identityKeyA)).toBe(next.queueSessionId);
      expect(await redis.get(`{queue:admission}:${hashToken(first.admissionToken)}`)).toBeNull();
    });

    it.each([
      ['no order', () => null],
      ['a cancelled order', (order: Record<string, unknown>) => ({ ...order, status: 'CANCELLED' })],
      [
        'an order of another browser session',
        (order: Record<string, unknown>) => ({
          ...order,
          refreshFamilyId: 'family-x',
          deviceSlotKey: 'family-x',
        }),
      ],
      [
        'an order prepared under another queue session',
        (order: Record<string, unknown>) => ({ ...order, queueSessionId: 'queue-session-other' }),
      ],
      [
        'an order past its payment deadline',
        (order: Record<string, unknown>) => ({
          ...order,
          paymentDeadlineAt: new Date(T0.getTime() + minutes(10.5)),
        }),
      ],
    ])(
      'takes a new waiting position after the active window with %s, even inside the recovery grace',
      async (_label, orderFor) => {
        dbState.totalSeats = 1;
        const first = await enter(browserA);
        setNow(1_000);
        const other = await enter(browserB);
        expect(other.state).toBe('WAITING');
        setNow(minutes(9));
        await prepare(first.admissionToken); // payment recovery until T+13
        dbState.orderBinding = orderFor(pendingOrder(first, new Date(T0.getTime() + minutes(16))));

        // the confirm page cancelled the order (or it does not bind) and rejoins at T+11
        setNow(minutes(11));
        const next = await enter(browserA, first.admissionToken);

        expect(next.queueSessionId).not.toBe(first.queueSessionId);
        expect(next).toMatchObject({ state: 'WAITING', autoEnter: false });
        expect(next.position).toBeGreaterThan(0);
        expect(next).not.toHaveProperty('recoveryOrderId');
        expect(await readRecord(first.queueSessionId)).toBeNull();
        expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);
        expect(gateway.emitExpired).toHaveBeenCalledWith(
          first.queueSessionId,
          expect.objectContaining({ state: 'EXPIRED' }),
        );
      },
    );

    it('keeps only payment recovery while a pending order bound to the session can still be paid', async () => {
      dbState.totalSeats = 10;
      const first = await enter(browserA);
      setNow(minutes(9));
      await prepare(first.admissionToken);
      // provider handoff extended the payment deadline to T+17:30
      dbState.orderBinding = pendingOrder(first, new Date(T0.getTime() + minutes(17.5)));
      const prepared = await readRecord(first.queueSessionId);

      // active window over, recovery grace still open
      setNow(minutes(11));
      const recovery = await enter(browserA, first.admissionToken);
      expect(recovery).toMatchObject({
        queueSessionId: first.queueSessionId,
        state: 'PAYMENT_RECOVERY',
        autoEnter: false,
        recoveryOrderId: 'ORDER-1',
        position: 0,
        activeUntilAt: first.activeUntilAt,
      });
      // no new window and no longer slot
      expect(await readRecord(first.queueSessionId)).toMatchObject({
        state: 'ADMITTED',
        activeUntilAt: prepared?.['activeUntilAt'],
        paymentRecoveryUntilAt: prepared?.['paymentRecoveryUntilAt'],
        expiresAt: prepared?.['expiresAt'],
      });

      // both windows over: the reconcile returns the slot, recovery stays
      setNow(minutes(14));
      const late = await enter(browserA, recovery.admissionToken);
      expect(late).toMatchObject({
        queueSessionId: first.queueSessionId,
        state: 'PAYMENT_RECOVERY',
        recoveryOrderId: 'ORDER-1',
        autoEnter: false,
      });
      expect(await readRecord(first.queueSessionId)).toMatchObject({ state: 'EXPIRED' });
      expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);

      // the 13-minute admission cookie is gone: a new token, still recovery only
      setNow(minutes(15));
      const noCookie = await enter(browserA);
      expect(noCookie).toMatchObject({
        queueSessionId: first.queueSessionId,
        state: 'PAYMENT_RECOVERY',
        recoveryOrderId: 'ORDER-1',
      });
      expect(noCookie.admissionToken).not.toBe(late.admissionToken);
      await expect(status(first.queueSessionId, browserA, noCookie.admissionToken))
        .resolves.toMatchObject({ state: 'PAYMENT_RECOVERY', recoveryOrderId: 'ORDER-1' });
      // payment confirm is still authorised by the order binding
      await expect(service.assertAdmissionForOrder({
        orderId: 'ORDER-1',
        userId: browserA.userId,
        identity: browserA,
      })).resolves.toMatchObject({ queueSessionId: first.queueSessionId });

      // the order deadline passes: the next entry is a new queue entry
      setNow(minutes(17.5) + 1_000);
      const rejoin = await enter(browserA, noCookie.admissionToken);
      expect(rejoin.queueSessionId).not.toBe(first.queueSessionId);
      expect(rejoin.state).not.toBe('PAYMENT_RECOVERY');
      expect(rejoin).not.toHaveProperty('recoveryOrderId');
    });

    it('never re-grants seat selection to a recovery-only session', async () => {
      dbState.totalSeats = 10;
      const first = await enter(browserA);
      setNow(minutes(9));
      await prepare(first.admissionToken);
      dbState.orderBinding = pendingOrder(first, new Date(T0.getTime() + minutes(16)));

      setNow(minutes(11));
      const recovery = await enter(browserA, first.admissionToken);
      expect(recovery.state).toBe('PAYMENT_RECOVERY');

      await expect(service.assertAdmissionForShowtime({
        showtimeId,
        identity: browserA,
        admissionToken: recovery.admissionToken,
        action: 'lock-seat',
      })).rejects.toThrow('대기열 입장 시간이 만료되었습니다');

      // the refused lock expired the session; the order is still payable
      await expect(enter(browserA, recovery.admissionToken)).resolves.toMatchObject({
        queueSessionId: first.queueSessionId,
        state: 'PAYMENT_RECOVERY',
        recoveryOrderId: 'ORDER-1',
      });
      await expect(service.assertAdmissionForShowtime({
        showtimeId,
        identity: browserA,
        admissionToken: recovery.admissionToken,
        action: 'prepare-reservation',
      })).rejects.toThrow('대기열 입장 시간이 만료되었습니다');
    });

    it('reports the same judgement from status polls after the active window', async () => {
      dbState.totalSeats = 10;
      const first = await enter(browserA);
      setNow(minutes(9));
      await prepare(first.admissionToken);
      dbState.orderBinding = pendingOrder(first, new Date(T0.getTime() + minutes(16)));

      setNow(minutes(10) + 1);
      await expect(status(first.queueSessionId, browserA, first.admissionToken))
        .resolves.toMatchObject({
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
          recoveryOrderId: 'ORDER-1',
        });
      expect(gateway.emitExpired).not.toHaveBeenCalled();

      // the buyer cancels the pending order: the admission ends at once
      dbState.orderBinding = { ...dbState.orderBinding!, status: 'CANCELLED' };
      setNow(minutes(10.5));
      const ended = await status(first.queueSessionId, browserA, first.admissionToken);

      expect(ended).toMatchObject({ state: 'EXPIRED', autoEnter: false });
      expect(ended).not.toHaveProperty('recoveryOrderId');
      expect(await readRecord(first.queueSessionId)).toMatchObject({ state: 'EXPIRED' });
      expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);
      expect(gateway.emitExpired).toHaveBeenCalledWith(
        first.queueSessionId,
        expect.objectContaining({ state: 'EXPIRED' }),
      );
    });

    describe('only for an order whose showtime has not started (C1, #2 #4)', () => {
      const laterShowtimeId = '7d4f1c1e-0000-4000-8000-000000000003';
      // The cutoff of the payment-recovery lookup (the query that selects showtimeAt).
      const recoveryLookupCutoffs = () =>
        (dbState.reservationQueries ?? [])
          .filter(({ selection }) => 'showtimeAt' in selection)
          .map(({ where }) => readOnSaleCutoff(where)?.getTime() ?? null);

      beforeEach(() => {
        dbState.totalSeats = 1;
        dbState.showtimeIds = [showtimeId, laterShowtimeId];
        // the order's showtime has the one free seat; the later showtime is sold out
        dbState.soldByShowtime = { [showtimeId]: 0, [laterShowtimeId]: 1 };
        dbState.reservationQueries = [];
      });

      it('takes a new waiting position once the pending order\'s showtime has started', async () => {
        dbState.showtimeStartsAt = {
          [showtimeId]: new Date(T0.getTime() + minutes(10.5)),
          [laterShowtimeId]: FAR_FUTURE,
        };
        const first = await enter(browserA);
        expect(first.state).toBe('ADMITTED');
        setNow(1_000);
        await expect(enter(browserB)).resolves.toMatchObject({ state: 'WAITING', position: 1 });
        setNow(minutes(9));
        await prepare(first.admissionToken);
        // the payment deadline is not capped at the showtime start
        dbState.orderBinding = pendingOrder(first, new Date(T0.getTime() + minutes(16)));

        // window closed, showtime not started yet: still payment recovery
        setNow(minutes(10) + 1);
        await expect(status(first.queueSessionId, browserA, first.admissionToken))
          .resolves.toMatchObject({ state: 'PAYMENT_RECOVERY', recoveryOrderId: 'ORDER-1' });

        // the showtime started: payment handoff and confirm refuse the order,
        // so the session no longer holds the buyer in payment recovery
        setNow(minutes(11));
        const ended = await status(first.queueSessionId, browserA, first.admissionToken);
        expect(ended).toMatchObject({ state: 'EXPIRED', autoEnter: false });
        expect(ended).not.toHaveProperty('recoveryOrderId');
        expect(gateway.emitExpired).toHaveBeenCalledWith(
          first.queueSessionId,
          expect.objectContaining({ state: 'EXPIRED' }),
        );

        const next = await enter(browserA, first.admissionToken);
        expect(next.queueSessionId).not.toBe(first.queueSessionId);
        expect(next).toMatchObject({ state: 'WAITING', autoEnter: false, position: 2 });
        expect(next).not.toHaveProperty('recoveryOrderId');
        expect(await readRecord(first.queueSessionId)).toBeNull();
        expect(await redis.sismember(activeKey, first.queueSessionId)).toBe(0);

        // the lookup query itself only selects orders of showtimes on sale at now
        expect(recoveryLookupCutoffs().at(-1)).toBe(T0.getTime() + minutes(11));
      });

      it('keeps payment recovery for a pending order of a showtime still on sale', async () => {
        dbState.showtimeStartsAt = {
          [showtimeId]: new Date(T0.getTime() + minutes(60)),
          [laterShowtimeId]: FAR_FUTURE,
        };
        const first = await enter(browserA);
        setNow(minutes(9));
        await prepare(first.admissionToken);
        dbState.orderBinding = pendingOrder(first, new Date(T0.getTime() + minutes(16)));

        setNow(minutes(11));
        await expect(enter(browserA, first.admissionToken)).resolves.toMatchObject({
          queueSessionId: first.queueSessionId,
          state: 'PAYMENT_RECOVERY',
          autoEnter: false,
          recoveryOrderId: 'ORDER-1',
        });
        await expect(status(first.queueSessionId, browserA, first.admissionToken))
          .resolves.toMatchObject({ state: 'PAYMENT_RECOVERY', recoveryOrderId: 'ORDER-1' });
        expect(gateway.emitExpired).not.toHaveBeenCalled();
        const cutoffs = recoveryLookupCutoffs();
        expect(cutoffs.length).toBeGreaterThan(0);
        expect(cutoffs.every((cutoff) => cutoff === T0.getTime() + minutes(11))).toBe(true);
      });
    });
  });

  describe('status poll (#4 #26 #32 #89)', () => {
    const remainingSeatsKey = `{queue:${performanceId}}:remaining-seats`;

    it('judges the admission window once, even when it ends during the snapshot reads', async () => {
      dbState.totalSeats = 10;
      const first = await enter(browserA);
      expect(first.state).toBe('ADMITTED');
      const activeUntilAt = Date.parse(String(first.activeUntilAt));

      // the poll starts inside the window ...
      vi.setSystemTime(activeUntilAt);
      const originalZcard = redis.zcard.bind(redis);
      let advanced = false;
      redis.zcard = async (key: string) => {
        if (!advanced) {
          advanced = true;
          // ... and the window ends while the snapshot counters are read
          vi.setSystemTime(activeUntilAt + 1);
        }
        return originalZcard(key);
      };
      const snapshot = await status(first.queueSessionId, browserA, first.admissionToken);
      redis.zcard = originalZcard;

      expect(advanced).toBe(true);
      expect(snapshot).toMatchObject({ state: 'ADMITTED', autoEnter: true });
      expect(gateway.emitExpired).not.toHaveBeenCalled();
      expect(await readRecord(first.queueSessionId)).toMatchObject({ state: 'ADMITTED' });

      // the next poll judges the closed window, with the recovery lookup
      await expect(status(first.queueSessionId, browserA, first.admissionToken))
        .resolves.toMatchObject({ state: 'EXPIRED', autoEnter: false });
    });

    it('reads the remaining-seats cache once per status poll', async () => {
      dbState.totalSeats = 1;
      await enter(browserA);
      setNow(1_000);
      const waiting = await enter(browserB);
      expect(waiting.state).toBe('WAITING');

      // inside the reconcile interval of B's entry, so the poll runs no reconcile
      setNow(1_500);
      const get = vi.spyOn(redis, 'get');
      const snapshot = await status(waiting.queueSessionId, browserB, waiting.admissionToken);

      expect(get.mock.calls.filter(([key]) => key === remainingSeatsKey)).toHaveLength(1);
      expect(snapshot).toMatchObject({
        state: 'WAITING',
        position: 1,
        remainingSeats: 1,
        etaSeconds: QUEUE_ETA_CYCLE_MAX_SECONDS,
        etaUnavailable: false,
      });
    });
  });

  describe('remaining seats of the showtimes on sale (C1, #2 #6 #91)', () => {
    const startedShowtimeId = '7d4f1c1e-0000-4000-8000-000000000002';
    const laterShowtimeId = '7d4f1c1e-0000-4000-8000-000000000003';

    it('does not wait for seats of a showtime that has already started', async () => {
      dbState.totalSeats = 2;
      dbState.showtimeIds = [startedShowtimeId, showtimeId];
      dbState.showtimeStartsAt = {
        [startedShowtimeId]: new Date(T0.getTime() - minutes(60)),
        [showtimeId]: new Date(T0.getTime() + minutes(120)),
      };
      // the started showtime still has free seats; the one on sale is sold out
      dbState.soldByShowtime = { [startedShowtimeId]: 0, [showtimeId]: 2 };

      const lease = await enter(browserA);

      expect(lease).toMatchObject({
        state: 'WAITING',
        position: 1,
        remainingSeats: 0,
        etaUnavailable: true,
      });
      expect(await redis.scard(activeKey)).toBe(0);
    });

    it('counts capacity, sold seats and live locks over the same on-sale showtimes', async () => {
      dbState.totalSeats = 3;
      dbState.showtimeIds = [startedShowtimeId, showtimeId, laterShowtimeId];
      dbState.showtimeStartsAt = {
        [startedShowtimeId]: new Date(T0.getTime() - minutes(60)),
        [showtimeId]: new Date(T0.getTime() + minutes(120)),
        [laterShowtimeId]: new Date(T0.getTime() + minutes(24 * 60)),
      };
      dbState.soldByShowtime = { [startedShowtimeId]: 1, [showtimeId]: 1, [laterShowtimeId]: 0 };
      await redis.set(`{${startedShowtimeId}}:seat:A-1`, 'buyer-1', 'PX', minutes(7));
      await redis.sadd(`{${startedShowtimeId}}:locked-seats`, 'A-1');
      await redis.set(`{${showtimeId}}:seat:A-1`, 'buyer-2', 'PX', minutes(7));
      await redis.sadd(lockedSeatsKey, 'A-1');

      const lease = await enter(browserA);

      // 2 on-sale showtimes x 3 seats - 1 sold - 1 live lock (not 9 - 2 - 2)
      expect(lease.remainingSeats).toBe(4);
      expect(redis.evalKeys.some((keys) => keys.includes(`{${startedShowtimeId}}:locked-seats`)))
        .toBe(false);
    });

    it('closes the waiting line once every showtime has started', async () => {
      dbState.totalSeats = 0;
      dbState.showtimeStartsAt = { [showtimeId]: new Date(T0.getTime() + minutes(20)) };
      const waiting = await enter(browserA);
      expect(waiting.state).toBe('WAITING');

      // seats would be free now, but the only showtime starts
      dbState.totalSeats = 5;
      setNow(minutes(20));
      const error = await captureRejection(
        status(waiting.queueSessionId, browserA, waiting.admissionToken),
      );

      expect(error.getStatus()).toBe(403);
      expect(error.message).toBe('이미 시작된 회차는 예매할 수 없습니다.');
      expect(error.getResponse()).toMatchObject({ errorCode: 'NO_BOOKABLE_SHOWTIME' });
      // the reconcile that ran with the poll admitted nobody
      expect(await readRecord(waiting.queueSessionId)).toMatchObject({ state: 'WAITING' });
      expect(await redis.scard(activeKey)).toBe(0);
    });
  });

  describe('admission capacity (#89)', () => {
    const browserC = { userId: 'user-c', refreshTokenFamilyId: 'family-c', deviceSlotId: 'family-c' };

    it('keeps the active set within capacity when a direct admission overlaps a reconcile', async () => {
      dbState.totalSeats = 0;
      const a = await enter(browserA);
      setNow(100);
      const b = await enter(browserB);
      setNow(200);
      const c = await enter(browserC);
      expect([a.state, b.state, c.state]).toEqual(['WAITING', 'WAITING', 'WAITING']);

      dbState.totalSeats = 2;
      setNow(5_000);
      const internals = service as unknown as QueueServiceInternals;
      const originalScard = redis.scard.bind(redis);
      let interleaved = false;
      redis.scard = async (key: string) => {
        const count = await originalScard(key);
        if (!interleaved && key === activeKey) {
          interleaved = true;
          // another instance admits the head of the line between the reconcile's
          // SCARD and its admission batch
          await internals.admitQueueSessionWithinCapacity(performanceId, a.queueSessionId);
        }
        return count;
      };

      await internals.reconcilePerformanceQueue(performanceId);
      redis.scard = originalScard;

      expect(interleaved).toBe(true);
      expect(await redis.scard(activeKey)).toBe(2);
      expect(await readRecord(a.queueSessionId)).toMatchObject({ state: 'ADMITTED' });
      expect(await readRecord(b.queueSessionId)).toMatchObject({ state: 'ADMITTED' });
      expect(await readRecord(c.queueSessionId)).toMatchObject({ state: 'WAITING' });
      expect(await redis.zrank(waitingKey, c.queueSessionId)).toBe(0);
    });
  });

  describe('remaining seats cache miss (#89)', () => {
    it('computes the remaining seats once for concurrent cache misses', async () => {
      dbState.totalSeats = 7;
      const internals = service as unknown as QueueServiceInternals;
      const fresh = vi.spyOn(service as never, 'calculateRemainingSeatsFresh');

      const results = await Promise.all(
        Array.from({ length: 8 }, () => internals.calculateRemainingSeats(performanceId)),
      );

      expect(results).toEqual(Array.from({ length: 8 }, () => 7));
      expect(fresh).toHaveBeenCalledTimes(1);

      // cached for 2 seconds, then the next miss computes again
      await internals.calculateRemainingSeats(performanceId);
      expect(fresh).toHaveBeenCalledTimes(1);
      setNow(2_500);
      await internals.calculateRemainingSeats(performanceId);
      expect(fresh).toHaveBeenCalledTimes(2);
    });

    it('shares a failed computation and computes again on the next miss', async () => {
      dbState.totalSeats = 4;
      const internals = service as unknown as QueueServiceInternals;
      const fresh = vi
        .spyOn(service as never, 'calculateRemainingSeatsFresh')
        .mockRejectedValueOnce(new Error('db down'));

      const results = await Promise.allSettled(
        Array.from({ length: 3 }, () => internals.calculateRemainingSeats(performanceId)),
      );

      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      expect(fresh).toHaveBeenCalledTimes(1);
      await expect(internals.calculateRemainingSeats(performanceId)).resolves.toBe(4);
      expect(fresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('slot return of the confirmed order (#4, #3)', () => {
    it('returns the slot of the session the order was prepared under, not the confirming browser', async () => {
      dbState.totalSeats = 10;
      const orderSession = await enter(browserA);
      // the same buyer confirms from another browser whose own admission passes
      // the Redis fallback (e.g. after an in-app browser handoff)
      const otherBrowser = {
        userId: browserA.userId,
        refreshTokenFamilyId: 'family-a2',
        deviceSlotId: 'family-a2',
      };
      setNow(1_000);
      const confirmingSession = await enter(otherBrowser);
      expect(confirmingSession.state).toBe('ADMITTED');
      dbState.orderBinding = {
        tossOrderId: 'ORDER-1',
        status: 'CONFIRMED',
        queueSessionId: orderSession.queueSessionId,
      };

      await expect(service.releaseAdmissionForOrder('ORDER-1', browserA.userId)).resolves.toBe(true);

      expect(await readRecord(orderSession.queueSessionId)).toMatchObject({ state: 'EXPIRED' });
      expect(await redis.sismember(activeKey, orderSession.queueSessionId)).toBe(0);
      expect(await readRecord(confirmingSession.queueSessionId)).toMatchObject({ state: 'ADMITTED' });
      expect(await redis.sismember(activeKey, confirmingSession.queueSessionId)).toBe(1);
    });

    it('releases nothing without a confirmed order bound to a queue session, and never throws', async () => {
      dbState.totalSeats = 10;
      const lease = await enter(browserA);

      dbState.orderBinding = {
        tossOrderId: 'ORDER-1',
        status: 'PENDING_PAYMENT',
        queueSessionId: lease.queueSessionId,
      };
      await expect(service.releaseAdmissionForOrder('ORDER-1', browserA.userId)).resolves.toBe(false);
      dbState.orderBinding = { tossOrderId: 'ORDER-1', status: 'CONFIRMED', queueSessionId: null };
      await expect(service.releaseAdmissionForOrder('ORDER-1', browserA.userId)).resolves.toBe(false);
      dbState.orderBinding = null;
      await expect(service.releaseAdmissionForOrder('ORDER-1', browserA.userId)).resolves.toBe(false);
      expect(await readRecord(lease.queueSessionId)).toMatchObject({ state: 'ADMITTED' });

      const failing = new QueueService(
        redis as never,
        { select: () => { throw new Error('db down'); } } as never,
        gateway as unknown as QueueGateway,
      );
      await expect(failing.releaseAdmissionForOrder('ORDER-1', browserA.userId)).resolves.toBe(false);
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

  it('releases the reconcile lock so the next reconcile runs after the throttle interval (#89)', async () => {
    vi.useFakeTimers();
    try {
      process.env['NODE_ENV'] = 'development';
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = { get: (_key: string, defaultValue?: string) => defaultValue ?? '' };
      const redis = (redisProvider as unknown as {
        useFactory: (configService: unknown) => { get: (key: string) => Promise<string | null> };
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
      const reconcile = vi
        .spyOn(service as never, 'reconcilePerformanceQueue')
        .mockResolvedValue(undefined as never);
      const internals = service as unknown as QueueServiceInternals;

      await internals.reconcilePerformanceQueueIfDue(performanceId);
      expect(await redis.get(`{queue:${performanceId}}:reconcile-lock`)).toBeNull();

      vi.advanceTimersByTime(1_100);
      await internals.reconcilePerformanceQueueIfDue(performanceId);

      expect(reconcile).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
