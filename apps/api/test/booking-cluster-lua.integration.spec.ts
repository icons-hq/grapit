import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis, { Cluster } from 'ioredis';
import {
  BookingService,
  LOCK_EXPIRED_MESSAGE,
  LOCK_OTHER_OWNER_MESSAGE,
} from '../src/modules/booking/booking.service.js';

/**
 * Phase 20 / SC-2 / D-04 / D-17 booking Lua cluster guard.
 *
 * Phase 14 proved SMS OTP hash tags with a single-shard Valkey Cluster. This
 * spec applies the same testcontainers topology to the booking Lua paths users
 * depend on: lockSeat -> getSeatStatus -> unlockSeat plus Phase 19 ownership
 * helpers. It intentionally changes no production code.
 *
 * Run with Docker available:
 * pnpm --filter @grabit/api test:integration -- booking-cluster-lua
 */

type ClusterSlotTuple = [
  number,
  number,
  [string, number, string],
  ...[string, number, string][],
];

function buildNatMap(
  slots: ClusterSlotTuple[],
  host: string,
  port: number,
): Record<string, { host: string; port: number }> {
  const seen = new Set<string>();
  const natMap: Record<string, { host: string; port: number }> = {};

  for (const slot of slots) {
    for (let i = 2; i < slot.length; i++) {
      const node = slot[i] as [string, number, string];
      const key = `${node[0]}:${node[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      natMap[key] = { host, port };
    }
  }

  if (Object.keys(natMap).length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      '[booking-cluster-bootstrap] raw CLUSTER SLOTS reply:',
      JSON.stringify(slots),
    );
    throw new Error(
      'CLUSTER SLOTS returned no usable ip:port tuples — check cluster-announce-ip or testcontainers host resolution.',
    );
  }

  natMap[`${host}:6379`] = { host, port };
  return natMap;
}

function createBookingService(redis: Cluster, maxTicketsPerUser = 1): BookingService {
  const unavailableRows: Array<{ id: string; status: string }> = [];
  const mockDb = {
    select: () => ({
      from: () => ({
        where: async () => unavailableRows,
        innerJoin: () => ({
          where: async () => [{ performanceStatus: 'selling' }],
        }),
        leftJoin: () => ({
          where: async () => [{ maxTicketsPerUser }],
        }),
      }),
    }),
  };
  const mockGateway = {
    broadcastSeatUpdate: () => {},
  };
  const mockFeatureFlags = {
    assertBookingEnabled: () => {},
    getFlags: () => ({ bookingEnabled: true }),
  };
  return new BookingService(
    redis as unknown as IORedis,
    mockDb as any,
    mockGateway as any,
    mockFeatureFlags as any,
  );
}

describe('BookingService Lua scripts — Valkey Cluster mode', () => {
  let container: StartedTestContainer;
  let cluster: Cluster;
  let service: BookingService;

  const userId = 'booking-cluster-user-1';
  const otherUserId = 'booking-cluster-user-2';
  const showtimeId = 'booking-cluster-showtime-1';
  const seatKey = '1F:A-1';
  const otherSeatKey = '1F:A-2';
  const unrelatedSeatKey = '1F:A-3';
  const lockTtl = 600;
  const toRuntimeSeatId = (rawSeatKey: string) => encodeURIComponent(rawSeatKey);

  const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
  const runtimeSeatId = toRuntimeSeatId(seatKey);
  const otherRuntimeSeatId = toRuntimeSeatId(otherSeatKey);
  const unrelatedRuntimeSeatId = toRuntimeSeatId(unrelatedSeatKey);
  const lockKey = `{${showtimeId}}:seat:${runtimeSeatId}`;
  const otherLockKey = `{${showtimeId}}:seat:${otherRuntimeSeatId}`;
  const unrelatedLockKey = `{${showtimeId}}:seat:${unrelatedRuntimeSeatId}`;
  const lockedSeatsKey = `{${showtimeId}}:locked-seats`;

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withCommand([
        'valkey-server',
        '--port',
        '6379',
        '--cluster-enabled',
        'yes',
        '--cluster-config-file',
        'nodes.conf',
        '--cluster-node-timeout',
        '5000',
        '--appendonly',
        'no',
        '--cluster-require-full-coverage',
        'no',
      ])
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);
    const boot = new IORedis(`redis://${host}:${port}`, {
      maxRetriesPerRequest: 3,
    });

    await boot.call('CONFIG', 'SET', 'cluster-announce-ip', host);
    await boot.call('CONFIG', 'SET', 'cluster-announce-port', String(port));
    await boot.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');

    for (let i = 0; i < 24; i++) {
      const info = (await boot.call('CLUSTER', 'INFO')) as string;
      if (info.includes('cluster_state:ok')) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const slots = (await boot.call('CLUSTER', 'SLOTS')) as ClusterSlotTuple[];
    const natMap = buildNatMap(slots, host, port);
    await boot.quit();

    cluster = new IORedis.Cluster([{ host, port }], {
      natMap,
      lazyConnect: true,
      scaleReads: 'master',
      enableReadyCheck: true,
      redisOptions: { maxRetriesPerRequest: 3 },
    });
    await cluster.connect();
    service = createBookingService(cluster);
  }, 180_000);

  afterAll(async () => {
    await cluster?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await cluster.flushdb();
  });

  it('rejects legacy booking Lua keys without a shared {showtimeId} hash tag', async () => {
    const legacyUserSeatsKey = 'booking:legacy:user-seats:booking-cluster-user-1';
    const legacyLockKey = 'booking:legacy:seat:A-1';
    const legacyLockedSeatsKey = 'booking:legacy:locked-seats';
    const legacySlots = await Promise.all([
      cluster.call('CLUSTER', 'KEYSLOT', legacyUserSeatsKey),
      cluster.call('CLUSTER', 'KEYSLOT', legacyLockKey),
      cluster.call('CLUSTER', 'KEYSLOT', legacyLockedSeatsKey),
    ]);

    expect(new Set(legacySlots).size).toBeGreaterThan(1);
    await expect(
      cluster.eval(
        `
        redis.call('SADD', KEYS[1], ARGV[1])
        redis.call('SET', KEYS[2], ARGV[2])
        redis.call('SADD', KEYS[3], ARGV[1])
        return 1
        `,
        3,
        legacyUserSeatsKey,
        legacyLockKey,
        legacyLockedSeatsKey,
        seatKey,
        userId,
      ),
    ).rejects.toThrow(/CROSSSLOT/);
  });

  it('proves booking lock keys share one CLUSTER KEYSLOT by {showtimeId}', async () => {
    const s1 = await cluster.call('CLUSTER', 'KEYSLOT', userSeatsKey);
    const s2 = await cluster.call('CLUSTER', 'KEYSLOT', lockKey);
    const s3 = await cluster.call('CLUSTER', 'KEYSLOT', lockedSeatsKey);

    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  it('locks, reports, and unlocks a seat through BookingService under cluster mode', async () => {
    await expect(service.lockSeat(userId, showtimeId, seatKey))
      .resolves
      .toMatchObject({
        success: true,
        lockId: lockKey,
        seatId: seatKey,
        seatKey,
        floorKey: '1F',
      });

    expect(await cluster.get(lockKey)).toBe(userId);
    expect(await cluster.smembers(userSeatsKey)).toContain(runtimeSeatId);
    expect(await cluster.smembers(lockedSeatsKey)).toContain(runtimeSeatId);

    await expect(service.getSeatStatus(showtimeId))
      .resolves
      .toEqual({
        showtimeId,
        seats: { [seatKey]: 'locked' },
      });

    await expect(service.unlockSeat(userId, showtimeId, seatKey))
      .resolves
      .toBe(true);

    expect(await cluster.get(lockKey)).toBeNull();
    expect(await cluster.sismember(userSeatsKey, runtimeSeatId)).toBe(0);
    expect(await cluster.sismember(lockedSeatsKey, runtimeSeatId)).toBe(0);
    await expect(service.getSeatStatus(showtimeId))
      .resolves
      .toEqual({ showtimeId, seats: {} });
  });

  it('assertOwnedSeatLocks preserves Phase 19 owner/missing/other-owner behavior under cluster mode', async () => {
    await cluster.set(lockKey, userId, 'EX', lockTtl);
    await expect(service.assertOwnedSeatLocks(userId, showtimeId, [seatKey]))
      .resolves
      .toBeUndefined();

    await expect(service.assertOwnedSeatLocks(userId, showtimeId, [seatKey, otherSeatKey]))
      .rejects
      .toThrow(LOCK_EXPIRED_MESSAGE);

    await cluster.set(otherLockKey, otherUserId, 'EX', lockTtl);
    await expect(service.assertOwnedSeatLocks(userId, showtimeId, [seatKey, otherSeatKey]))
      .rejects
      .toThrow(LOCK_OTHER_OWNER_MESSAGE);
  });

  it('consumeOwnedSeatLocks deletes only requested owned locks under cluster mode', async () => {
    await cluster.set(lockKey, userId, 'EX', lockTtl);
    await cluster.set(otherLockKey, userId, 'EX', lockTtl);
    await cluster.set(unrelatedLockKey, userId, 'EX', lockTtl);
    await cluster.sadd(userSeatsKey, runtimeSeatId, otherRuntimeSeatId, unrelatedRuntimeSeatId);
    await cluster.sadd(lockedSeatsKey, runtimeSeatId, otherRuntimeSeatId, unrelatedRuntimeSeatId);

    await expect(service.consumeOwnedSeatLocks(userId, showtimeId, [seatKey, otherSeatKey]))
      .resolves
      .toEqual({ consumedSeatIds: [seatKey, otherSeatKey] });

    expect(await cluster.get(lockKey)).toBeNull();
    expect(await cluster.get(otherLockKey)).toBeNull();
    expect(await cluster.get(unrelatedLockKey)).toBe(userId);
    expect(await cluster.sismember(userSeatsKey, unrelatedRuntimeSeatId)).toBe(1);
    expect(await cluster.sismember(lockedSeatsKey, unrelatedRuntimeSeatId)).toBe(1);
  });
});
