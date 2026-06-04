import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import IORedis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import {
  BookingService,
  LOCK_EXPIRED_MESSAGE,
  LOCK_OTHER_OWNER_MESSAGE,
} from '../booking.service.js';

/**
 * Phase 07-05 integration spec — PROVES Lua scripts execute correctly on a
 * real Valkey 8 interpreter.
 *
 * Goal: close HIGH-consensus review concern #2 from 07-REVIEWS.md — "Valkey에
 * 대한 실제 런타임 테스트 0건". This spec boots a real Valkey 8 container via
 * testcontainers and runs lockSeat -> getSeatStatus -> unlockSeat through
 * BookingService so the production Lua scripts are sent to real Valkey.
 *
 * Runs only under `pnpm test:integration` (excluded from default `pnpm test`).
 * Requires Docker to be running on the host. If Docker is unavailable, the
 * testcontainers package will throw a clear error from beforeAll.
 *
 * Scope: single happy-path round-trip plus conflict + non-owner unlock edge
 * cases. Not meant to replicate every unit test. Goal is "does the production
 * Lua script execute at all on Valkey 8 and produce the expected Redis state".
 */

function createBookingService(redis: IORedis, maxTicketsPerUser = 1): BookingService {
  const unavailableRows: Array<{ id: string; status: string }> = [];
  function queryRows<T>(rows: T[]) {
    return {
      limit: async () => rows,
      then: (resolve: (value: T[]) => void) => resolve(rows),
    };
  }

  const mockDb = {
    select: (selection?: Record<string, unknown>) => ({
      from: () => ({
        where: () => queryRows(unavailableRows),
        innerJoin: () => {
          const rows = Object.prototype.hasOwnProperty.call(selection ?? {}, 'seatConfig')
            ? [{
                seatConfig: {
                  tiers: [{ tierName: 'VIP', seatIds: ['A-1', 'A-2', 'A-3'] }],
                },
              }]
            : [{ performanceStatus: 'selling', bookingStartsAt: null }];
          return {
            where: () => queryRows(rows),
            leftJoin: () => ({
              where: () => queryRows(rows),
            }),
          };
        },
        leftJoin: () => ({
          where: () => queryRows([{ maxTicketsPerUser, seatHoldMinutes: 10 }]),
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
  return new BookingService(redis, mockDb as any, mockGateway as any, mockFeatureFlags as any);
}

describe('BookingService Lua scripts — real Valkey 8 integration', () => {
  let container: StartedTestContainer;
  let redis: IORedis;

  const userId = 'user-integ-1';
  const showtimeId = 'show-integ-1';
  const seatKey = '1F:A-1';
  const otherSeatKey = '1F:A-2';
  const thirdSeatKey = '1F:A-3';
  const toRuntimeSeatId = (rawSeatKey: string) => encodeURIComponent(rawSeatKey);

  const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
  const runtimeSeatId = toRuntimeSeatId(seatKey);
  const lockKey = `{${showtimeId}}:seat:${runtimeSeatId}`;
  const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
  const LOCK_TTL = 600;

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start();

    const host = container.getHost();
    const port = container.getMappedPort(6379);

    redis = new IORedis({ host, port, maxRetriesPerRequest: 3 });

    // Sanity: PING should return PONG
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
  }, 120_000);

  afterAll(async () => {
    if (redis) await redis.quit();
    if (container) await container.stop();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('does not define copied Lua script bodies in this spec', () => {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /^const\s+(LOCK_SEAT_LUA|UNLOCK_SEAT_LUA|GET_VALID_LOCKED_SEATS_LUA)\s*=/m,
    );
  });

  it('locks a seat through BookingService.lockSeat on real Valkey', async () => {
    const service = createBookingService(redis);

    await expect(service.lockSeat(userId, showtimeId, seatKey))
      .resolves
      .toMatchObject({
        success: true,
        lockId: lockKey,
        seatId: seatKey,
        seatKey,
        floorKey: '1F',
      });

    // Verify the lock was actually set
    const owner = await redis.get(lockKey);
    expect(owner).toBe(userId);

    // Verify TTL was set
    const ttl = await redis.ttl(lockKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LOCK_TTL);

    // Verify SADD was applied
    const userSeats = await redis.smembers(userSeatsKey);
    expect(userSeats).toContain(runtimeSeatId);

    const lockedSeats = await redis.smembers(lockedSeatsKey);
    expect(lockedSeats).toContain(runtimeSeatId);
  });

  it('lists locked seats through BookingService.getSeatStatus on real Valkey', async () => {
    const service = createBookingService(redis);

    await service.lockSeat(userId, showtimeId, seatKey);

    await expect(service.getSeatStatus(showtimeId))
      .resolves
      .toEqual({
        showtimeId,
        seats: { [seatKey]: 'locked' },
      });
  });

  it('rejects duplicate lock on same seat through BookingService.lockSeat', async () => {
    const service = createBookingService(redis);
    const otherUser = 'user-integ-2';

    await service.lockSeat(userId, showtimeId, seatKey);

    await expect(service.lockSeat(otherUser, showtimeId, seatKey))
      .rejects
      .toThrow('이미 다른 사용자가 선택한 좌석입니다');
  });

  it('unlocks the seat through BookingService.unlockSeat for the owner', async () => {
    const service = createBookingService(redis);
    await service.lockSeat(userId, showtimeId, seatKey);

    await expect(service.unlockSeat(userId, showtimeId, seatKey))
      .resolves
      .toBe(true);

    // Verify the lock was actually deleted
    const owner = await redis.get(lockKey);
    expect(owner).toBeNull();

    // Verify the set memberships were removed
    const userSeats = await redis.smembers(userSeatsKey);
    expect(userSeats).not.toContain(runtimeSeatId);

    const lockedSeats = await redis.smembers(lockedSeatsKey);
    expect(lockedSeats).not.toContain(runtimeSeatId);
  });

  it('unlock for non-owner returns 0 (no-op)', async () => {
    const service = createBookingService(redis);
    const runtimeSeatId2 = toRuntimeSeatId(otherSeatKey);
    const lockKey2 = `{${showtimeId}}:seat:${runtimeSeatId2}`;

    await service.lockSeat(userId, showtimeId, otherSeatKey);

    await expect(service.unlockSeat('user-impostor', showtimeId, otherSeatKey))
      .resolves
      .toBe(false);

    // Verify the lock is STILL held by the original user
    const owner = await redis.get(lockKey2);
    expect(owner).toBe(userId);
  });

  describe('planned lock ownership helpers — real Valkey 8 integration', () => {
    const ownershipUserId = 'ownership-user-1';
    const otherUserId = 'ownership-user-2';
    const ownershipShowtimeId = 'ownership-showtime-1';
    const ownershipUserSeatsKey = `{${ownershipShowtimeId}}:user-seats:${ownershipUserId}`;
    const ownershipLockedSeatsKey = `{${ownershipShowtimeId}}:locked-seats`;
    const ownershipSeatKeyA = '1F:A-1';
    const ownershipSeatKeyB = '1F:A-2';
    const ownershipSeatKeyC = '1F:A-3';
    const ownershipRuntimeSeatIdA = toRuntimeSeatId(ownershipSeatKeyA);
    const ownershipRuntimeSeatIdB = toRuntimeSeatId(ownershipSeatKeyB);
    const ownershipRuntimeSeatIdC = toRuntimeSeatId(ownershipSeatKeyC);

    beforeEach(async () => {
      await redis.flushdb();
    });

    it('assertOwnedSeatLocks passes all-owned locks on real Valkey', async () => {
      const service = createBookingService(redis);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdA}`, ownershipUserId, 'EX', LOCK_TTL);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdB}`, ownershipUserId, 'EX', LOCK_TTL);

      await expect(service.assertOwnedSeatLocks(ownershipUserId, ownershipShowtimeId, [ownershipSeatKeyA, ownershipSeatKeyB]))
        .resolves
        .toBeUndefined();
    });

    it('assertOwnedSeatLocks rejects missing locks on real Valkey', async () => {
      const service = createBookingService(redis);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdA}`, ownershipUserId, 'EX', LOCK_TTL);

      await expect(service.assertOwnedSeatLocks(ownershipUserId, ownershipShowtimeId, [ownershipSeatKeyA, ownershipSeatKeyB]))
        .rejects
        .toThrow(LOCK_EXPIRED_MESSAGE);
    });

    it('assertOwnedSeatLocks rejects other-owner locks on real Valkey', async () => {
      const service = createBookingService(redis);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdA}`, ownershipUserId, 'EX', LOCK_TTL);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdB}`, otherUserId, 'EX', LOCK_TTL);

      await expect(service.assertOwnedSeatLocks(ownershipUserId, ownershipShowtimeId, [ownershipSeatKeyA, ownershipSeatKeyB]))
        .rejects
        .toThrow(LOCK_OTHER_OWNER_MESSAGE);
    });

    it('assertOwnedSeatLocks rejects stale index members without deleting indexes on real Valkey', async () => {
      const service = createBookingService(redis);
      await redis.sadd(ownershipUserSeatsKey, ownershipRuntimeSeatIdB);
      await redis.sadd(ownershipLockedSeatsKey, ownershipRuntimeSeatIdB);

      await expect(service.assertOwnedSeatLocks(ownershipUserId, ownershipShowtimeId, [ownershipSeatKeyB]))
        .rejects
        .toThrow(LOCK_EXPIRED_MESSAGE);

      expect(await redis.sismember(ownershipUserSeatsKey, ownershipRuntimeSeatIdB)).toBe(1);
      expect(await redis.sismember(ownershipLockedSeatsKey, ownershipRuntimeSeatIdB)).toBe(1);
    });

    it('consumeOwnedSeatLocks supports unrelated lock preservation on real Valkey', async () => {
      const service = createBookingService(redis);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdA}`, ownershipUserId, 'EX', LOCK_TTL);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdB}`, ownershipUserId, 'EX', LOCK_TTL);
      await redis.set(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdC}`, ownershipUserId, 'EX', LOCK_TTL);
      await redis.sadd(
        ownershipUserSeatsKey,
        ownershipRuntimeSeatIdA,
        ownershipRuntimeSeatIdB,
        ownershipRuntimeSeatIdC,
      );
      await redis.sadd(
        ownershipLockedSeatsKey,
        ownershipRuntimeSeatIdA,
        ownershipRuntimeSeatIdB,
        ownershipRuntimeSeatIdC,
      );

      await expect(service.consumeOwnedSeatLocks(ownershipUserId, ownershipShowtimeId, [ownershipSeatKeyA, ownershipSeatKeyB]))
        .resolves
        .toEqual({ consumedSeatIds: [ownershipSeatKeyA, ownershipSeatKeyB] });

      expect(await redis.get(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdA}`)).toBeNull();
      expect(await redis.get(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdB}`)).toBeNull();
      expect(await redis.get(`{${ownershipShowtimeId}}:seat:${ownershipRuntimeSeatIdC}`)).toBe(ownershipUserId);
      expect(await redis.sismember(ownershipUserSeatsKey, ownershipRuntimeSeatIdC)).toBe(1);
      expect(await redis.sismember(ownershipLockedSeatsKey, ownershipRuntimeSeatIdC)).toBe(1);
    });
  });
});
