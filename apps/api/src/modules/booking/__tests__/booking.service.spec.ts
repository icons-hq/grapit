import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ASSERT_OWNED_SEAT_LOCKS_LUA,
  BookingService,
  CONSUME_OWNED_SEAT_LOCKS_LUA,
  EXTEND_OWNED_SEAT_LOCKS_LUA,
  LOCK_EXPIRED_MESSAGE,
  LOCK_OTHER_OWNER_MESSAGE,
  PAYMENT_CONFIRM_LOCK_TTL,
  REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
  RELEASE_PAYMENT_CONFIRM_LOCK_LUA,
} from '../booking.service.js';
import type { BookingGateway } from '../booking.gateway.js';
import type { FeatureFlagsService } from '../../feature-flags/feature-flags.service.js';

// Mock Redis client
function createMockRedis() {
  return {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    smembers: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    scard: vi.fn(),
    expire: vi.fn(),
    eval: vi.fn(),
    ttl: vi.fn(),
  };
}

// Mock Gateway
function createMockGateway(): { broadcastSeatUpdate: ReturnType<typeof vi.fn> } {
  return {
    broadcastSeatUpdate: vi.fn(),
  };
}

// Mock Drizzle DB
function createMockDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
  };
}

function chainResult<T>(rows: T[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: T[]) => void) => resolve(rows);
      }
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function createMockFeatureFlags(bookingEnabled = true) {
  const mock = {
    getFlags: vi.fn(() => ({ bookingEnabled })),
    assertBookingEnabled: vi.fn((actor?: { id: string; role?: string }) => {
      if (!mock.getFlags().bookingEnabled && actor?.role !== 'admin') {
        throw new ForbiddenException('예매는 추후 오픈 예정입니다');
      }
    }),
  };
  return mock;
}

describe('BookingService', () => {
  let service: BookingService;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockGateway: ReturnType<typeof createMockGateway>;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockFeatureFlags: ReturnType<typeof createMockFeatureFlags>;

  const userId = 'user-123';
  const showtimeId = '550e8400-e29b-41d4-a716-446655440000';
  const seatId = 'A-1';

  beforeEach(() => {
    mockRedis = createMockRedis();
    mockGateway = createMockGateway();
    mockDb = createMockDb();
    mockFeatureFlags = createMockFeatureFlags(true);

    service = new BookingService(
      mockRedis as any,
      mockDb as any,
      mockGateway as unknown as BookingGateway,
      mockFeatureFlags as unknown as FeatureFlagsService,
    );
  });

  // Helper: mock DB select to return no unavailable record (used by lockSeat DB defense)
  function mockNoSoldRecord(maxTicketsPerUser = 4) {
    mockDb.select
      .mockReturnValueOnce(chainResult([]))
      .mockReturnValueOnce(chainResult([{ maxTicketsPerUser }]));
  }

  describe('lockSeat', () => {
    it('rejects disabled booking before Redis lock mutation', async () => {
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });

      await expect(service.lockSeat(userId, showtimeId, seatId))
        .rejects
        .toThrow(ForbiddenException);
      await expect(service.lockSeat(userId, showtimeId, seatId))
        .rejects
        .toThrow('예매는 추후 오픈 예정입니다');

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockRedis.set).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    it('allows admin actor through disabled booking flag to existing lock validation', async () => {
      mockFeatureFlags.getFlags.mockReturnValue({ bookingEnabled: false });
      mockNoSoldRecord();
      mockRedis.eval.mockResolvedValue([1, `{${showtimeId}}:seat:${seatId}`, seatId]);

      await expect(service.lockSeat({ id: userId, role: 'admin' }, showtimeId, seatId))
        .resolves
        .toEqual(expect.objectContaining({ success: true, seatId }));

      expect(mockFeatureFlags.assertBookingEnabled).toHaveBeenCalledWith({
        id: userId,
        role: 'admin',
      });
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it('cleans stale user-seats entries before count check via Lua eval', async () => {
      mockNoSoldRecord();
      // Lua returns [1, lockKey, seatId] = success
      const lockKey = `{${showtimeId}}:seat:${seatId}`;
      mockRedis.eval.mockResolvedValue([1, lockKey, seatId]);

      const before = Date.now();
      const result = await service.lockSeat(userId, showtimeId, seatId);
      const after = Date.now();

      // Verify redis.eval called with script containing SMEMBERS + owner check loop
      // ioredis flat signature: eval(script, numKeys, ...keysAndArgs)
      expect(mockRedis.eval).toHaveBeenCalledOnce();
      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const script = callArgs[0] as string;
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      expect(script).toContain('SMEMBERS');
      expect(script).toContain('GET');
      expect(script).toContain('owner == ARGV[1]');
      expect(numKeys).toBe(3);
      expect(flatKeys).toContain(`{${showtimeId}}:user-seats:${userId}`);
      expect(flatKeys).toContain(`{${showtimeId}}:seat:1F%3AA-1`);
      expect(flatKeys).toContain(`{${showtimeId}}:locked-seats`);

      // Verify response shape
      expect(result.success).toBe(true);
      expect(result.seatId).toBe(seatId);
      expect(result.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
      expect(result.expiresAt).toBeLessThanOrEqual(after + 600_000);
    });

    it('rejects when live seat count >= MAX_SEATS after stale cleanup', async () => {
      mockNoSoldRecord();
      // Lua returns [0, "MAX_SEATS"] = max seats exceeded
      mockRedis.eval.mockResolvedValue([0, 'MAX_SEATS']);

      await expect(service.lockSeat(userId, showtimeId, seatId))
        .rejects
        .toThrow(ConflictException);
    });

    it('uses event-configured maxTicketsPerUser instead of hardcoded MAX_SEATS', async () => {
      mockNoSoldRecord(1);
      mockRedis.eval.mockResolvedValue([0, 'MAX_SEATS']);

      await expect(service.lockSeat(userId, showtimeId, '1F:A-1'))
        .rejects
        .toThrow('최대 1석까지 선택할 수 있습니다');

      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      const flatArgs = callArgs.slice(2 + numKeys) as string[];
      expect(flatKeys).toContain(`{${showtimeId}}:seat:1F%3AA-1`);
      expect(flatArgs[2]).toBe('1');
    });

    it('rejects when SET NX fails (seat taken)', async () => {
      mockNoSoldRecord();
      // Lua returns [0, "CONFLICT"] = seat already locked
      mockRedis.eval.mockResolvedValue([0, 'CONFLICT']);

      await expect(service.lockSeat(userId, showtimeId, seatId))
        .rejects
        .toThrow(ConflictException);
    });

    it('calls gateway.broadcastSeatUpdate after successful lock', async () => {
      mockNoSoldRecord();
      const lockKey = `{${showtimeId}}:seat:${seatId}`;
      mockRedis.eval.mockResolvedValue([1, lockKey, seatId]);

      await service.lockSeat(userId, showtimeId, seatId);

      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledOnce();
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        showtimeId,
        seatId,
        'locked',
        userId,
      );
    });

    it('does NOT broadcast when lock fails', async () => {
      mockNoSoldRecord();
      mockRedis.eval.mockResolvedValue([0, 'CONFLICT']);

      await expect(service.lockSeat(userId, showtimeId, seatId))
        .rejects
        .toThrow(ConflictException);

      expect(mockGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });

    describe('unavailable seat defense', () => {
      it('should throw ConflictException when seat_inventories has status=sold', async () => {
        mockDb.select.mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: randomUUID(), status: 'sold' }]),
          }),
        });

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow(ConflictException);

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow('이미 판매된 좌석입니다');

        expect(mockRedis.eval).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when seat_inventories has status=held_cancelled', async () => {
        mockDb.select.mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: randomUUID(), status: 'held_cancelled' }]),
          }),
        });

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow(ConflictException);

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow('환불 처리 중인 좌석입니다');

        expect(mockRedis.eval).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when seat_inventories has status=disabled', async () => {
        mockDb.select.mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: randomUUID(), status: 'disabled' }]),
          }),
        });

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow(ConflictException);

        await expect(service.lockSeat(userId, showtimeId, seatId))
          .rejects.toThrow('운영자가 비활성화한 좌석입니다');

        expect(mockRedis.eval).not.toHaveBeenCalled();
      });

      it('should proceed to Redis lock when no sold record exists in seat_inventories', async () => {
        mockNoSoldRecord();
        mockRedis.eval.mockResolvedValue([1, `{${showtimeId}}:seat:${seatId}`, seatId]);

        const result = await service.lockSeat(userId, showtimeId, seatId);

        expect(result.success).toBe(true);
        expect(result.seatId).toBe(seatId);
        expect(mockRedis.eval).toHaveBeenCalled();
      });

      it('should proceed normally when seat_inventories record exists with status=available', async () => {
        mockNoSoldRecord();
        mockRedis.eval.mockResolvedValue([1, `{${showtimeId}}:seat:${seatId}`, seatId]);

        const result = await service.lockSeat(userId, showtimeId, seatId);

        expect(result.success).toBe(true);
        expect(mockRedis.eval).toHaveBeenCalled();
        expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, seatId, 'locked', userId);
      });
    });
  });

  describe('unlockSeat', () => {
    it('returns true when Lua script confirms ownership and deletes lock', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const result = await service.unlockSeat(userId, showtimeId, seatId);

      expect(result).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledOnce();
      // ioredis flat signature: eval(script, numKeys, ...keysAndArgs)
      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const script = callArgs[0] as string;
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      const flatArgs = callArgs.slice(2 + numKeys) as string[];
      expect(script).toContain('GET');
      expect(script).toContain('DEL');
      expect(script).toContain('SREM');
      expect(numKeys).toBe(3);
      expect(flatKeys).toEqual([
        `{${showtimeId}}:seat:1F%3AA-1`,
        `{${showtimeId}}:user-seats:${userId}`,
        `{${showtimeId}}:locked-seats`,
      ]);
      expect(flatArgs).toEqual([userId, '1F%3AA-1']);
    });

    it('returns false when Lua script detects different owner', async () => {
      mockRedis.eval.mockResolvedValue(0);

      const result = await service.unlockSeat(userId, showtimeId, seatId);

      expect(result).toBe(false);
    });

    it('atomically removes from lock key, user-seats, and locked-seats via Lua', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.unlockSeat(userId, showtimeId, seatId);

      // Lua script handles all cleanup atomically — no separate redis calls
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.srem).not.toHaveBeenCalled();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('calls gateway.broadcastSeatUpdate after successful unlock', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.unlockSeat(userId, showtimeId, seatId);

      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledOnce();
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
        showtimeId,
        seatId,
        'available',
        userId,
      );
    });
  });

  describe('unlockAllSeats', () => {
    it('unlocks all owned seats and returns seatIds', async () => {
      mockRedis.smembers.mockResolvedValue(['A-1', 'A-2']);
      mockRedis.get
        .mockResolvedValueOnce(userId)   // A-1 owned
        .mockResolvedValueOnce(userId);  // A-2 owned
      mockRedis.del.mockResolvedValue(1);
      mockRedis.srem.mockResolvedValue(1);

      const result = await service.unlockAllSeats(userId, showtimeId);

      expect(result.unlockedSeats).toEqual(['A-1', 'A-2']);

      // Verify del called for each seat lock key
      expect(mockRedis.del).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-1`);
      expect(mockRedis.del).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-2`);

      // Verify srem called for locked-seats for each seat
      const lockedSeatsCalls = mockRedis.srem.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes(':locked-seats'),
      );
      expect(lockedSeatsCalls).toHaveLength(2);

      // Verify broadcast called for each unlocked seat
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledTimes(2);
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, 'A-1', 'available', userId);
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, 'A-2', 'available', userId);

      // Verify user-seats key deleted entirely at the end
      expect(mockRedis.del).toHaveBeenCalledWith(`{${showtimeId}}:user-seats:${userId}`);
    });

    it('skips seats not owned by user', async () => {
      mockRedis.smembers.mockResolvedValue(['A-1', 'A-2']);
      mockRedis.get
        .mockResolvedValueOnce(userId)        // A-1 owned
        .mockResolvedValueOnce('other-user');  // A-2 NOT owned
      mockRedis.del.mockResolvedValue(1);
      mockRedis.srem.mockResolvedValue(1);

      const result = await service.unlockAllSeats(userId, showtimeId);

      // Only A-1 unlocked
      expect(result.unlockedSeats).toEqual(['A-1']);

      // Verify del called only for A-1
      expect(mockRedis.del).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-1`);

      // Verify broadcast only for A-1
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledTimes(1);
      expect(mockGateway.broadcastSeatUpdate).toHaveBeenCalledWith(showtimeId, 'A-1', 'available', userId);
    });

    it('returns empty array when no seats locked', async () => {
      mockRedis.smembers.mockResolvedValue([]);

      const result = await service.unlockAllSeats(userId, showtimeId);

      expect(result.unlockedSeats).toEqual([]);
      expect(mockGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
    });
  });

  describe('lock ownership helpers', () => {
    it('assertOwnedSeatLocks succeeds when all requested seat locks belong to the user', async () => {
      mockRedis.eval.mockResolvedValue([1, 'OK', '2', '']);

      await expect(service.assertOwnedSeatLocks(userId, showtimeId, ['A-1', 'A-2']))
        .resolves
        .toBeUndefined();

      expect(mockRedis.eval).toHaveBeenCalledOnce();
      expect(mockRedis.eval.mock.calls[0]?.[0]).toBe(ASSERT_OWNED_SEAT_LOCKS_LUA);
    });

    it('assertOwnedSeatLocks rejects missing or expired locks with lock-expired message', async () => {
      mockRedis.eval.mockResolvedValue([0, 'MISSING', 'A-2', '']);

      await expect(service.assertOwnedSeatLocks(userId, showtimeId, ['A-1', 'A-2']))
        .rejects
        .toThrow(LOCK_EXPIRED_MESSAGE);
    });

    it('assertOwnedSeatLocks rejects other-user locks with other-user message', async () => {
      mockRedis.eval.mockResolvedValue([0, 'OTHER_OWNER', 'A-2', 'other-user']);

      await expect(service.assertOwnedSeatLocks(userId, showtimeId, ['A-1', 'A-2']))
        .rejects
        .toThrow(LOCK_OTHER_OWNER_MESSAGE);
    });

    it('consumeOwnedSeatLocks uses KEYS [userSeatsKey, lockedSeatsKey, ...seatLockKeys] and ARGV [userId, ...seatIds]', async () => {
      mockRedis.eval.mockResolvedValue([1, 'OK', '2', '']);

      await expect(service.consumeOwnedSeatLocks(userId, showtimeId, ['A-1', 'A-2']))
        .resolves
        .toEqual({ consumedSeatIds: ['A-1', 'A-2'] });

      expect(mockRedis.eval).toHaveBeenCalledOnce();
      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const script = callArgs[0] as string;
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      const flatArgs = callArgs.slice(2 + numKeys) as string[];
      expect(script).toBe(CONSUME_OWNED_SEAT_LOCKS_LUA);
      expect(numKeys).toBe(4);
      expect(flatKeys).toEqual([
        `{${showtimeId}}:user-seats:${userId}`,
        `{${showtimeId}}:locked-seats`,
        `{${showtimeId}}:seat:1F%3AA-1`,
        `{${showtimeId}}:seat:1F%3AA-2`,
      ]);
      expect(flatArgs).toEqual([userId, '1F%3AA-1', '1F%3AA-2']);
    });

    it('consumeOwnedSeatLocks preserves unrelated same-showtime locks', async () => {
      mockRedis.eval.mockResolvedValue([1, 'OK', '2', '']);

      await service.consumeOwnedSeatLocks(userId, showtimeId, ['A-1', 'A-2']);

      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      expect(flatKeys).not.toContain(`{${showtimeId}}:seat:A-3`);
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.srem).not.toHaveBeenCalled();
    });

    it('extendOwnedSeatLocks verifies ownership and extends each requested lock atomically', async () => {
      mockRedis.eval.mockResolvedValue([1, 'OK', '2', '']);

      await expect(service.extendOwnedSeatLocks(
        userId,
        showtimeId,
        ['A-1', 'A-2'],
        PAYMENT_CONFIRM_LOCK_TTL,
      )).resolves.toBeUndefined();

      expect(mockRedis.eval).toHaveBeenCalledOnce();
      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const script = callArgs[0] as string;
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      const flatArgs = callArgs.slice(2 + numKeys) as string[];
      expect(script).toBe(EXTEND_OWNED_SEAT_LOCKS_LUA);
      expect(numKeys).toBe(3);
      expect(flatKeys).toEqual([
        `{${showtimeId}}:user-seats:${userId}`,
        `{${showtimeId}}:seat:1F%3AA-1`,
        `{${showtimeId}}:seat:1F%3AA-2`,
      ]);
      expect(flatArgs).toEqual([userId, String(PAYMENT_CONFIRM_LOCK_TTL), '1F%3AA-1', '1F%3AA-2']);
    });

    it('extendOwnedSeatLocks rejects missing locks with lock-expired message', async () => {
      mockRedis.eval.mockResolvedValue([0, 'MISSING', 'A-2', '']);

      await expect(service.extendOwnedSeatLocks(
        userId,
        showtimeId,
        ['A-1', 'A-2'],
        PAYMENT_CONFIRM_LOCK_TTL,
      )).rejects.toThrow(LOCK_EXPIRED_MESSAGE);
    });
  });

  describe('payment confirm lock helpers', () => {
    it('acquirePaymentConfirmLock stores an order-level NX lock with a 60 second TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await expect(service.acquirePaymentConfirmLock('order-123', 'token-123'))
        .resolves
        .toBe(true);

      expect(mockRedis.set).toHaveBeenCalledWith(
        '{payment-confirm}:order-123',
        'token-123',
        'EX',
        60,
        'NX',
      );
    });

    it('acquirePaymentConfirmLock returns false when another confirm owns the order lock', async () => {
      mockRedis.set.mockResolvedValue(null);

      await expect(service.acquirePaymentConfirmLock('order-123', 'token-123'))
        .resolves
        .toBe(false);
    });

    it('releasePaymentConfirmLock compares the lock token before deleting', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await service.releasePaymentConfirmLock('order-123', 'token-123');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        RELEASE_PAYMENT_CONFIRM_LOCK_LUA,
        1,
        '{payment-confirm}:order-123',
        'token-123',
      );
    });

    it('refreshPaymentConfirmLock extends only a matching order-level lock token', async () => {
      mockRedis.eval.mockResolvedValue(1);

      await expect(service.refreshPaymentConfirmLock('order-123', 'token-123'))
        .resolves
        .toBe(true);

      expect(mockRedis.eval).toHaveBeenCalledWith(
        REFRESH_PAYMENT_CONFIRM_LOCK_LUA,
        1,
        '{payment-confirm}:order-123',
        'token-123',
        String(PAYMENT_CONFIRM_LOCK_TTL),
      );
    });

    it('refreshPaymentConfirmLock returns false when the order lock token changed', async () => {
      mockRedis.eval.mockResolvedValue(0);

      await expect(service.refreshPaymentConfirmLock('order-123', 'token-123'))
        .resolves
        .toBe(false);
    });
  });

  describe('getMyLocks', () => {
    it('uses hash-tagged seat lock keys and returns the earliest valid TTL', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      mockRedis.smembers.mockResolvedValue(['A-1', 'A-2', 'A-3']);
      mockRedis.get
        .mockResolvedValueOnce(userId)
        .mockResolvedValueOnce(userId)
        .mockResolvedValueOnce('other-user');
      mockRedis.ttl
        .mockResolvedValueOnce(120)
        .mockResolvedValueOnce(60);

      const result = await service.getMyLocks(userId, showtimeId);

      expect(result).toEqual({
        seatIds: ['A-1', 'A-2'],
        expiresAt: 1_000_000 + 60_000,
      });
      expect(mockRedis.get).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-1`);
      expect(mockRedis.get).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-2`);
      expect(mockRedis.get).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-3`);
      expect(mockRedis.ttl).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-1`);
      expect(mockRedis.ttl).toHaveBeenCalledWith(`{${showtimeId}}:seat:A-2`);
      expect(mockRedis.ttl).not.toHaveBeenCalledWith(`seat:${showtimeId}:A-1`);
      nowSpy.mockRestore();
    });
  });

  describe('getSeatStatus', () => {
    it('returns Record of seatId to SeatState combining Redis locks + DB unavailable records', async () => {
      // Mock Lua eval returning valid locked seats (stale entries cleaned by script)
      mockRedis.eval.mockResolvedValue(['A-1', 'A-2']);

      // Mock DB sold seats
      const mockFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { seatId: 'B-1', status: 'sold' },
          { seatId: 'C-1', status: 'held_cancelled' },
          { seatId: 'D-1', status: 'disabled' },
        ]),
      });
      mockDb.select.mockReturnValue({ from: mockFrom });

      const result = await service.getSeatStatus(showtimeId);

      expect(result.showtimeId).toBe(showtimeId);
      expect(result.seats['A-1']).toBe('locked');
      expect(result.seats['A-2']).toBe('locked');
      expect(result.seats['B-1']).toBe('sold');
      expect(result.seats['C-1']).toBe('held');
      expect(result.seats['D-1']).toBe('disabled');

      // Verify eval called with GET_VALID_LOCKED_SEATS_LUA pattern
      // ioredis flat signature: eval(script, numKeys, ...keysAndArgs)
      expect(mockRedis.eval).toHaveBeenCalledOnce();
      const callArgs = mockRedis.eval.mock.calls[0] as unknown[];
      const script = callArgs[0] as string;
      const numKeys = callArgs[1] as number;
      const flatKeys = callArgs.slice(2, 2 + numKeys) as string[];
      const flatArgs = callArgs.slice(2 + numKeys) as string[];
      expect(script).toContain('SMEMBERS');
      expect(script).toContain('EXISTS');
      expect(numKeys).toBe(1);
      expect(flatKeys).toEqual([`{${showtimeId}}:locked-seats`]);
      expect(flatArgs).toEqual([`{${showtimeId}}:seat:`]);
    });

    it('uses canonical seatKey identity so same seat labels on different floors do not collide', async () => {
      mockRedis.eval.mockResolvedValue(['1F%3AA-1']);
      mockDb.select.mockReturnValue(
        chainResult([
          { seatId: 'A-1', floorKey: '2F', seatKey: '2F:A-1', status: 'sold' },
        ]),
      );

      const result = await service.getSeatStatus(showtimeId);

      expect(result.seats['1F:A-1']).toBe('locked');
      expect(result.seats['2F:A-1']).toBe('sold');
      expect(result.seats['A-1']).toBeUndefined();
    });
  });
});
