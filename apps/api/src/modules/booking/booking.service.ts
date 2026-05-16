import {
  Injectable,
  Inject,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type IORedis from 'ioredis';
import { eq, and, or, isNull } from 'drizzle-orm';
import { REDIS_CLIENT } from './providers/redis.provider.js';
import { DRIZZLE } from '../../database/drizzle.provider.js';
import type { DrizzleDB } from '../../database/drizzle.provider.js';
import { seatInventories } from '../../database/schema/seat-inventories.js';
import { bookingPolicies } from '../../database/schema/booking-policies.js';
import { performances } from '../../database/schema/performances.js';
import { showtimes } from '../../database/schema/showtimes.js';
import { BookingGateway } from './booking.gateway.js';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service.js';
import {
  DEFAULT_PERFORMANCE_BOOKING_POLICY,
  type LockSeatResponse,
  type SeatState,
  type SeatStatusResponse,
  type UnlockAllResponse,
} from '@grabit/shared';

/** Lock TTL in seconds (10 minutes, per BOOK-03) */
const LOCK_TTL = 600;
const DEFAULT_FLOOR_KEY = '1F';

export const LOCK_EXPIRED_MESSAGE = '좌석 점유 시간이 만료되었습니다. 좌석을 다시 선택해주세요.';
export const LOCK_OTHER_OWNER_MESSAGE = '이미 다른 사용자가 선택한 좌석입니다.';
export const BOOKING_VERIFICATION_REQUIRED_MESSAGE =
  '이메일 인증과 휴대폰 인증을 완료해야 예매할 수 있습니다.';

export type SeatLockOwnershipFailureReason = 'MISSING' | 'OTHER_OWNER';

type SeatLockOwnershipResult = [number, string, string, string];
type RuntimeSeatIdentity = {
  seatId: string;
  floorKey: string;
  seatKey: string;
  runtimeSeatId: string;
};
type BookingActor = {
  id: string;
  role?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
};

function parseRuntimeSeatIdentity(rawSeatIdOrKey: string): RuntimeSeatIdentity {
  const separatorIndex = rawSeatIdOrKey.indexOf(':');
  const floorKey = separatorIndex > 0
    ? rawSeatIdOrKey.slice(0, separatorIndex)
    : DEFAULT_FLOOR_KEY;
  const seatId = separatorIndex > 0
    ? rawSeatIdOrKey.slice(separatorIndex + 1)
    : rawSeatIdOrKey;
  const seatKey = separatorIndex > 0
    ? rawSeatIdOrKey
    : `${floorKey}:${seatId}`;

  return {
    seatId,
    floorKey,
    seatKey,
    runtimeSeatId: encodeURIComponent(seatKey),
  };
}

function decodeRuntimeSeatId(runtimeSeatId: string): string {
  return decodeURIComponent(runtimeSeatId);
}

function assertBookingVerificationComplete(actor: BookingActor): void {
  if (actor.isEmailVerified !== true || actor.isPhoneVerified !== true) {
    throw new ForbiddenException(BOOKING_VERIFICATION_REQUIRED_MESSAGE);
  }
}

/**
 * Lua script for atomic seat locking.
 * Cleans stale user-seats entries, checks count, SET NX, SADD + EXPIRE.
 *
 * KEYS[1] = {showtimeId}:user-seats:{userId}
 * KEYS[2] = {showtimeId}:seat:{seatId}
 * KEYS[3] = {showtimeId}:locked-seats
 * ARGV[1] = userId
 * ARGV[2] = LOCK_TTL (600)
 * ARGV[3] = MAX_SEATS (4)
 * ARGV[4] = seatId
 * ARGV[5] = key prefix "{showtimeId}:seat:"
 *
 * Hash tag {showtimeId} ensures all keys hash to the same Redis Cluster slot.
 */
const LOCK_SEAT_LUA = `
local members = redis.call('SMEMBERS', KEYS[1])
local alive = 0
for i, sid in ipairs(members) do
  local owner = redis.call('GET', ARGV[5] .. sid)
  if owner == ARGV[1] then
    alive = alive + 1
  else
    redis.call('SREM', KEYS[1], sid)
    if not owner then
      redis.call('SREM', KEYS[3], sid)
    end
  end
end
if alive >= tonumber(ARGV[3]) then
  return {0, 'MAX_SEATS'}
end
local ok = redis.call('SET', KEYS[2], ARGV[1], 'NX', 'EX', tonumber(ARGV[2]))
if not ok then
  return {0, 'CONFLICT'}
end
redis.call('SADD', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
redis.call('SADD', KEYS[3], ARGV[4])
return {1, KEYS[2], ARGV[4]}
`;

/**
 * Lua script for atomic seat unlocking.
 * Checks ownership before deleting to prevent TOCTOU race.
 *
 * KEYS[1] = {showtimeId}:seat:{seatId}
 * KEYS[2] = {showtimeId}:user-seats:{userId}
 * KEYS[3] = {showtimeId}:locked-seats
 * ARGV[1] = userId
 * ARGV[2] = seatId
 * Returns: 1 if unlocked, 0 if not owner
 */
const UNLOCK_SEAT_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], ARGV[2])
  redis.call('SREM', KEYS[3], ARGV[2])
  return 1
end
return 0
`;

/**
 * Lua script to get valid locked seats, cleaning stale entries.
 * Checks each seat in locked-seats set against its actual Redis key.
 *
 * KEYS[1] = {showtimeId}:locked-seats
 * ARGV[1] = key prefix "{showtimeId}:seat:"
 * Returns: array of valid (still-locked) seat IDs
 */
const GET_VALID_LOCKED_SEATS_LUA = `
local members = redis.call('SMEMBERS', KEYS[1])
local alive = {}
for i, sid in ipairs(members) do
  if redis.call('EXISTS', ARGV[1] .. sid) == 1 then
    alive[#alive + 1] = sid
  else
    redis.call('SREM', KEYS[1], sid)
  end
end
return alive
`;

/**
 * Lua script for asserting that all requested seats are actively locked by the user.
 *
 * KEYS[i] = {showtimeId}:seat:{seatId}
 * ARGV[1] = userId
 * ARGV[2..] = requested seat IDs
 *
 * Returns: {1, 'OK', count, ''} or {0, 'MISSING'|'OTHER_OWNER', seatId, owner}
 */
export const ASSERT_OWNED_SEAT_LOCKS_LUA = `
-- ASSERT_OWNED_SEAT_LOCKS_LUA
local userId = ARGV[1]
for i = 1, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  local seatId = ARGV[i + 1]
  if not owner then
    return {0, 'MISSING', seatId, ''}
  end
  if owner ~= userId then
    return {0, 'OTHER_OWNER', seatId, owner}
  end
end
return {1, 'OK', tostring(#ARGV - 1), ''}
`;

/**
 * Lua script for atomically consuming requested locks owned by the user.
 *
 * KEYS[1] = {showtimeId}:user-seats:{userId}
 * KEYS[2] = {showtimeId}:locked-seats
 * KEYS[3..] = {showtimeId}:seat:{seatId}
 * ARGV[1] = userId
 * ARGV[2..] = requested seat IDs
 *
 * Returns: {1, 'OK', count, ''} or {0, 'MISSING'|'OTHER_OWNER', seatId, owner}
 */
export const CONSUME_OWNED_SEAT_LOCKS_LUA = `
-- CONSUME_OWNED_SEAT_LOCKS_LUA
local userId = ARGV[1]
for i = 3, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  local seatId = ARGV[i - 1]
  if not owner then
    return {0, 'MISSING', seatId, ''}
  end
  if owner ~= userId then
    return {0, 'OTHER_OWNER', seatId, owner}
  end
end
for i = 3, #KEYS do
  local seatId = ARGV[i - 1]
  redis.call('DEL', KEYS[i])
  redis.call('SREM', KEYS[1], seatId)
  redis.call('SREM', KEYS[2], seatId)
end
return {1, 'OK', tostring(#ARGV - 1), ''}
`;

/**
 * Lua script for atomically verifying ownership and extending requested locks.
 *
 * KEYS[1] = {showtimeId}:user-seats:{userId}
 * KEYS[2..] = {showtimeId}:seat:{seatId}
 * ARGV[1] = userId
 * ARGV[2] = ttl seconds
 * ARGV[3..] = requested seat IDs
 *
 * Returns: {1, 'OK', count, ''} or {0, 'MISSING'|'OTHER_OWNER', seatId, owner}
 */
export const EXTEND_OWNED_SEAT_LOCKS_LUA = `
-- EXTEND_OWNED_SEAT_LOCKS_LUA
local userId = ARGV[1]
local ttl = tonumber(ARGV[2])
for i = 2, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  local seatId = ARGV[i + 1]
  if not owner then
    return {0, 'MISSING', seatId, ''}
  end
  if owner ~= userId then
    return {0, 'OTHER_OWNER', seatId, owner}
  end
end
for i = 2, #KEYS do
  local currentTtl = redis.call('TTL', KEYS[i])
  if currentTtl < ttl then
    redis.call('EXPIRE', KEYS[i], ttl)
  end
end
local userSeatsTtl = redis.call('TTL', KEYS[1])
if userSeatsTtl < ttl then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return {1, 'OK', tostring(#ARGV - 2), ''}
`;

export const PAYMENT_CONFIRM_LOCK_TTL = 60;

export const RELEASE_PAYMENT_CONFIRM_LOCK_LUA = `
-- RELEASE_PAYMENT_CONFIRM_LOCK_LUA
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export const REFRESH_PAYMENT_CONFIRM_LOCK_LUA = `
-- REFRESH_PAYMENT_CONFIRM_LOCK_LUA
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
return 0
`;

@Injectable()
export class BookingService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly gateway: BookingGateway,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private async getMaxTicketsPerUser(showtimeId: string): Promise<number> {
    const [row] = await this.db
      .select({
        maxTicketsPerUser: bookingPolicies.maxTicketsPerUser,
      })
      .from(showtimes)
      .leftJoin(bookingPolicies, eq(bookingPolicies.performanceId, showtimes.performanceId))
      .where(eq(showtimes.id, showtimeId));

    return row?.maxTicketsPerUser ?? DEFAULT_PERFORMANCE_BOOKING_POLICY.maxTicketsPerUser;
  }

  /**
   * Attempts to lock a seat for a user using a single Lua script (redis.eval).
   * Atomically: cleans stale user-seats, checks count, SET NX, SADD + EXPIRE.
   */
  async lockSeat(
    actorOrUserId: string | BookingActor,
    showtimeId: string,
    seatId: string,
  ): Promise<LockSeatResponse> {
    const actor = typeof actorOrUserId === 'string'
      ? { id: actorOrUserId, isEmailVerified: true, isPhoneVerified: true }
      : actorOrUserId;
    const userId = actor.id;
    this.featureFlags.assertBookingEnabled(actor);
    assertBookingVerificationComplete(actor);
    await this.assertShowtimeBookingOpen(showtimeId, actor);
    const seatIdentity = parseRuntimeSeatIdentity(seatId);

    // DB-level unavailable check: defense against Redis TTL expiry and delayed refund release races.
    const [unavailableRecord] = await this.db
      .select({
        id: seatInventories.id,
        status: seatInventories.status,
      })
      .from(seatInventories)
      .where(
        and(
          eq(seatInventories.showtimeId, showtimeId),
          eq(seatInventories.floorKey, seatIdentity.floorKey),
          or(
            eq(seatInventories.seatKey, seatIdentity.seatKey),
            and(
              isNull(seatInventories.seatKey),
              eq(seatInventories.seatId, seatIdentity.seatId),
            ),
          ),
          or(
            eq(seatInventories.status, 'sold'),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.status, 'disabled'),
          ),
        ),
      );

    if (unavailableRecord) {
      throw new ConflictException(
        unavailableRecord.status === 'held_cancelled'
          ? '환불 처리 중인 좌석입니다'
          : unavailableRecord.status === 'disabled'
            ? '운영자가 판매를 중지한 좌석입니다'
          : '이미 판매된 좌석입니다',
      );
    }

    const maxTicketsPerUser = await this.getMaxTicketsPerUser(showtimeId);

    const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
    const lockKey = `{${showtimeId}}:seat:${seatIdentity.runtimeSeatId}`;
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
    const keyPrefix = `{${showtimeId}}:seat:`;

    const result = (await this.redis.eval(
      LOCK_SEAT_LUA,
      3,
      userSeatsKey,
      lockKey,
      lockedSeatsKey,
      userId,
      String(LOCK_TTL),
      String(maxTicketsPerUser),
      seatIdentity.runtimeSeatId,
      keyPrefix,
    )) as [number, string, string?];

    const [status, reason] = result;

    if (status === 0) {
      if (reason === 'MAX_SEATS') {
        throw new ConflictException(`최대 ${maxTicketsPerUser}석까지 선택할 수 있습니다`);
      }
      throw new ConflictException('이미 다른 사용자가 선택한 좌석입니다');
    }

    // Broadcast real-time update (include userId so sender can ignore own events)
    this.gateway.broadcastSeatUpdate(showtimeId, seatId, 'locked', userId);

    return {
      success: true,
      lockId: lockKey,
      seatId,
      seatKey: seatIdentity.seatKey,
      floorKey: seatIdentity.floorKey,
      expiresAt: Date.now() + LOCK_TTL * 1000,
    };
  }

  private async assertShowtimeBookingOpen(
    showtimeId: string,
    actor: BookingActor,
  ): Promise<void> {
    if (actor.role === 'admin') {
      return;
    }

    const [row] = await this.db
      .select({ performanceStatus: performances.status })
      .from(showtimes)
      .innerJoin(performances, eq(showtimes.performanceId, performances.id))
      .where(eq(showtimes.id, showtimeId));

    if (row?.performanceStatus === 'upcoming') {
      throw new ForbiddenException('예매는 추후 오픈 예정입니다');
    }
  }

  /**
   * Releases a seat lock only if the caller is the owner.
   * Removes from both user-seats and locked-seats Redis sets.
   */
  async unlockSeat(userId: string, showtimeId: string, seatId: string): Promise<boolean> {
    const seatIdentity = parseRuntimeSeatIdentity(seatId);
    const lockKey = `{${showtimeId}}:seat:${seatIdentity.runtimeSeatId}`;
    const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;

    const result = (await this.redis.eval(
      UNLOCK_SEAT_LUA,
      3,
      lockKey,
      userSeatsKey,
      lockedSeatsKey,
      userId,
      seatIdentity.runtimeSeatId,
    )) as number;

    if (result === 0) {
      return false;
    }

    this.gateway.broadcastSeatUpdate(showtimeId, seatId, 'available', userId);
    return true;
  }

  /**
   * Unlocks ALL seats for a user in a showtime.
   * Used by timer reset to release all locks at once.
   * Not Lua-based because: called once per reset (no concurrency),
   * and we need per-seat broadcast calls in Node.
   */
  async unlockAllSeats(userId: string, showtimeId: string): Promise<UnlockAllResponse> {
    const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;

    const members = await this.redis.smembers(userSeatsKey);

    if (members.length === 0) {
      return { unlockedSeats: [] };
    }

    const unlockedSeats: string[] = [];

    for (const runtimeSeatId of members) {
      const lockKey = `{${showtimeId}}:seat:${runtimeSeatId}`;
      const owner = await this.redis.get(lockKey);

      if (owner === userId) {
        await this.redis.del(lockKey);
        await this.redis.srem(lockedSeatsKey, runtimeSeatId);
        const rawSeatId = decodeRuntimeSeatId(runtimeSeatId);
        this.gateway.broadcastSeatUpdate(showtimeId, rawSeatId, 'available', userId);
        unlockedSeats.push(rawSeatId);
      }
    }

    // Delete the user-seats key entirely
    await this.redis.del(userSeatsKey);

    return { unlockedSeats };
  }

  async assertOwnedSeatLocks(userId: string, showtimeId: string, seatIds: string[]): Promise<void> {
    await this.assertNoUnavailableSeatRecords(showtimeId, seatIds);

    const runtimeSeatIds = seatIds.map((seatId) => parseRuntimeSeatIdentity(seatId).runtimeSeatId);
    const seatLockKeys = runtimeSeatIds.map((runtimeSeatId) => `{${showtimeId}}:seat:${runtimeSeatId}`);

    const result = (await this.redis.eval(ASSERT_OWNED_SEAT_LOCKS_LUA,
      runtimeSeatIds.length,
      ...seatLockKeys,
      userId,
      ...runtimeSeatIds,
    )) as SeatLockOwnershipResult;

    const conflict = this.lockConflictFromResult(result);
    if (conflict) throw conflict;
  }

  async consumeOwnedSeatLocks(
    userId: string,
    showtimeId: string,
    seatIds: string[],
    options: { skipUnavailableCheck?: boolean } = {},
  ): Promise<{ consumedSeatIds: string[] }> {
    if (!options.skipUnavailableCheck) {
      await this.assertNoUnavailableSeatRecords(showtimeId, seatIds);
    }

    const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
    const runtimeSeatIds = seatIds.map((seatId) => parseRuntimeSeatIdentity(seatId).runtimeSeatId);
    const seatLockKeys = runtimeSeatIds.map((runtimeSeatId) => `{${showtimeId}}:seat:${runtimeSeatId}`);

    const result = (await this.redis.eval(CONSUME_OWNED_SEAT_LOCKS_LUA,
      2 + runtimeSeatIds.length,
      userSeatsKey,
      lockedSeatsKey,
      ...seatLockKeys,
      userId,
      ...runtimeSeatIds,
    )) as SeatLockOwnershipResult;

    const conflict = this.lockConflictFromResult(result);
    if (conflict) throw conflict;

    return { consumedSeatIds: seatIds };
  }

  async extendOwnedSeatLocks(
    userId: string,
    showtimeId: string,
    seatIds: string[],
    ttlSeconds: number,
  ): Promise<void> {
    await this.assertNoUnavailableSeatRecords(showtimeId, seatIds);

    const userSeatsKey = `{${showtimeId}}:user-seats:${userId}`;
    const runtimeSeatIds = seatIds.map((seatId) => parseRuntimeSeatIdentity(seatId).runtimeSeatId);
    const seatLockKeys = runtimeSeatIds.map((runtimeSeatId) => `{${showtimeId}}:seat:${runtimeSeatId}`);

    const result = (await this.redis.eval(EXTEND_OWNED_SEAT_LOCKS_LUA,
      1 + runtimeSeatIds.length,
      userSeatsKey,
      ...seatLockKeys,
      userId,
      String(ttlSeconds),
      ...runtimeSeatIds,
    )) as SeatLockOwnershipResult;

    const conflict = this.lockConflictFromResult(result);
    if (conflict) throw conflict;
  }

  async forceReleaseSeatLock(showtimeId: string, seatId: string): Promise<void> {
    const runtimeSeatId = parseRuntimeSeatIdentity(seatId).runtimeSeatId;
    const lockKey = `{${showtimeId}}:seat:${runtimeSeatId}`;
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
    const owner = await this.redis.get(lockKey);

    await this.redis.del(lockKey);
    await this.redis.srem(lockedSeatsKey, runtimeSeatId);

    if (owner) {
      await this.redis.srem(`{${showtimeId}}:user-seats:${owner}`, runtimeSeatId);
    }
  }

  async acquirePaymentConfirmLock(orderId: string, lockToken: string): Promise<boolean> {
    const lockKey = `{payment-confirm}:${orderId}`;
    const result = await this.redis.set(lockKey, lockToken, 'EX', PAYMENT_CONFIRM_LOCK_TTL, 'NX');
    return result === 'OK';
  }

  async refreshPaymentConfirmLock(
    orderId: string,
    lockToken: string,
    ttlSeconds = PAYMENT_CONFIRM_LOCK_TTL,
  ): Promise<boolean> {
    const lockKey = `{payment-confirm}:${orderId}`;
    const result = await this.redis.eval(
      REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
      1,
      lockKey,
      lockToken,
      String(ttlSeconds),
    );
    return result === 1;
  }

  async releasePaymentConfirmLock(orderId: string, lockToken: string): Promise<void> {
    const lockKey = `{payment-confirm}:${orderId}`;
    await this.redis.eval(RELEASE_PAYMENT_CONFIRM_LOCK_LUA, 1, lockKey, lockToken);
  }

  private lockConflictFromResult(result: SeatLockOwnershipResult): ConflictException | null {
    const [status, reason] = result;
    if (status === 1) return null;

    if (reason === 'MISSING') {
      return new ConflictException(LOCK_EXPIRED_MESSAGE);
    }
    if (reason === 'OTHER_OWNER') {
      return new ConflictException(LOCK_OTHER_OWNER_MESSAGE);
    }
    return new ConflictException(LOCK_EXPIRED_MESSAGE);
  }

  private async assertNoUnavailableSeatRecords(showtimeId: string, seatIds: string[]): Promise<void> {
    for (const seatId of seatIds) {
      const seatIdentity = parseRuntimeSeatIdentity(seatId);
      const [unavailableRecord] = await this.db
        .select({
          status: seatInventories.status,
        })
        .from(seatInventories)
        .where(
          and(
            eq(seatInventories.showtimeId, showtimeId),
            eq(seatInventories.floorKey, seatIdentity.floorKey),
            or(
              eq(seatInventories.seatKey, seatIdentity.seatKey),
              and(
                isNull(seatInventories.seatKey),
                eq(seatInventories.seatId, seatIdentity.seatId),
              ),
            ),
            or(
              eq(seatInventories.status, 'sold'),
              eq(seatInventories.status, 'held_cancelled'),
              eq(seatInventories.status, 'disabled'),
            ),
          ),
        );

      if (!unavailableRecord) continue;

      if (unavailableRecord.status === 'held_cancelled') {
        throw new ConflictException('환불 처리 중인 좌석입니다');
      }
      if (unavailableRecord.status === 'disabled') {
        throw new ConflictException('운영자가 비활성화한 좌석입니다');
      }
      throw new ConflictException('이미 판매된 좌석입니다');
    }
  }

  /**
   * Returns the current user's locked seats for a showtime.
   */
  async getMyLocks(userId: string, showtimeId: string): Promise<{ seatIds: string[]; expiresAt: number | null }> {
    const userSeats = await this.redis.smembers(`{${showtimeId}}:user-seats:${userId}`);

    if (userSeats.length === 0) {
      return { seatIds: [], expiresAt: null };
    }

    // Filter to only seats still actually locked by this user
    const validSeats: string[] = [];
    let expiresAt: number | null = null;

    for (const runtimeSeatId of userSeats) {
      const lockKey = `{${showtimeId}}:seat:${runtimeSeatId}`;
      const owner = await this.redis.get(lockKey);
      if (owner === userId) {
        validSeats.push(decodeRuntimeSeatId(runtimeSeatId));
        const remainingTtl = await this.redis.ttl(lockKey);
        if (remainingTtl > 0) {
          const seatExpiresAt = Date.now() + remainingTtl * 1000;
          expiresAt = expiresAt === null ? seatExpiresAt : Math.min(expiresAt, seatExpiresAt);
        }
      }
    }

    return { seatIds: validSeats, expiresAt };
  }

  /**
   * Returns the status of all seats for a showtime.
   * Combines Redis locks + DB unavailable records.
   */
  async getSeatStatus(showtimeId: string): Promise<SeatStatusResponse> {
    // 1. Get locked seats from Redis (with stale entry cleanup)
    const lockedSeatsKey = `{${showtimeId}}:locked-seats`;
    const keyPrefix = `{${showtimeId}}:seat:`;
    const lockedSeats = (await this.redis.eval(
      GET_VALID_LOCKED_SEATS_LUA,
      1,
      lockedSeatsKey,
      keyPrefix,
    )) as string[];

    // 2. Get sold and delayed-release seats from DB
    const unavailableSeats = await this.db
      .select({
        seatId: seatInventories.seatId,
        floorKey: seatInventories.floorKey,
        seatKey: seatInventories.seatKey,
        status: seatInventories.status,
      })
      .from(seatInventories)
      .where(
        and(
          eq(seatInventories.showtimeId, showtimeId),
          or(
            eq(seatInventories.status, 'sold'),
            eq(seatInventories.status, 'held_cancelled'),
            eq(seatInventories.status, 'disabled'),
          ),
        ),
      );

    // 3. Build combined seat map
    const seats: Record<string, SeatState> = {};

    for (const runtimeSeatId of lockedSeats) {
      seats[decodeRuntimeSeatId(runtimeSeatId)] = 'locked';
    }

    for (const row of unavailableSeats) {
      const soldSeatKey = row.seatKey ?? (row.floorKey ? `${row.floorKey}:${row.seatId}` : row.seatId);
      seats[soldSeatKey] = row.status === 'held_cancelled'
        ? 'held'
        : row.status === 'disabled'
          ? 'disabled'
          : 'sold';
    }

    return { showtimeId, seats };
  }
}
