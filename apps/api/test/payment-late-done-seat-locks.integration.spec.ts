import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis from 'ioredis';
import { encodeSeatRuntimeId } from '@grabit/shared';
import { BookingService, RECOVERY_SEAT_LOCK_TTL } from '../src/modules/booking/booking.service.js';
import { PaymentService } from '../src/modules/payment/payment.service.js';

/**
 * Audit #71: a late async DONE must hold the seats through its commit without
 * taking them from a buyer who legitimately re-locked them. The ownership
 * decision runs on the real Lua scripts (EXTEND_OWNED_SEAT_LOCKS,
 * ACQUIRE_RECOVERY_SEAT_LOCKS) and real key TTLs, not a BookingService mock.
 *
 * Run with Docker available:
 * pnpm --filter @grabit/api exec vitest run --config vitest.integration.config.ts test/payment-late-done-seat-locks.integration.spec.ts
 */

type LateRecoveryLock = {
  acquired: boolean;
  shouldRelease: boolean;
  showtimeId: string;
  seatKeys: string[];
  ownerToken: string;
};

const showtimeId = 'late-done-showtime-1';
const buyer = 'late-done-buyer-a';
const otherBuyer = 'late-done-buyer-b';
const seatA = '1F:A-1';
const seatB = '1F:A-2';
const reservationId = '6f1c2a8e-4b1d-4c55-9a3e-0d1f2a3b4c5d';
const recoveryOwner = `payment-recovery:${reservationId}`;

function lockKey(seatKey: string) {
  return `{${showtimeId}}:seat:${encodeSeatRuntimeId(seatKey)}`;
}

function createBookingService(redis: IORedis): BookingService {
  // Only the unavailable-seat check reads the database: no sold/held/disabled rows.
  const mockDb = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  return new BookingService(
    redis,
    mockDb as never,
    { broadcastSeatUpdate: () => {} } as never,
    { assertBookingEnabled: () => {}, getFlags: () => ({ bookingEnabled: true }) } as never,
  );
}

describe('late async DONE seat ownership on real Valkey (#71)', () => {
  let container: StartedTestContainer;
  let redis: IORedis;
  let paymentService: PaymentService;

  async function holdCheckoutLock(userId: string, seatKey: string, ttlSeconds: number) {
    await redis.set(lockKey(seatKey), userId, 'EX', ttlSeconds);
    await redis.sadd(`{${showtimeId}}:user-seats:${userId}`, encodeSeatRuntimeId(seatKey));
    await redis.sadd(`{${showtimeId}}:locked-seats`, encodeSeatRuntimeId(seatKey));
  }

  function acquire(status: 'PENDING_PAYMENT' | 'FAILED', seatKeys: string[]): Promise<LateRecoveryLock> {
    return (paymentService as unknown as {
      acquireLateRecoverySeatLocksIfNeeded(input: unknown): Promise<LateRecoveryLock>;
    }).acquireLateRecoverySeatLocksIfNeeded({
      payload: {
        eventId: 'evt-late-done',
        eventType: 'PAYMENT_STATUS_CHANGED',
        data: {
          paymentKey: 'pay_late_done',
          orderId: 'GRP-LATE-DONE',
          status: 'DONE',
          method: 'FOREIGN_EASY_PAY',
          provider: 'ALIPAY_PLUS',
        },
      },
      reservation: { id: reservationId, userId: buyer, showtimeId, status, totalAmount: 52000 * seatKeys.length },
      existingPayment: undefined,
      pendingSeats: seatKeys.map((seatKey) => ({ seatKey })),
    });
  }

  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .start();
    redis = new IORedis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`, {
      maxRetriesPerRequest: 3,
    });
    paymentService = new PaymentService(
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      createBookingService(redis),
    );
  }, 180_000);

  afterAll(async () => {
    await redis?.quit();
    await container?.stop();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('extends the buyer’s live checkout locks through the commit window without a recovery lock', async () => {
    await holdCheckoutLock(buyer, seatA, 5);
    await holdCheckoutLock(buyer, seatB, 5);

    await expect(acquire('PENDING_PAYMENT', [seatA, seatB])).resolves.toMatchObject({
      acquired: true,
      shouldRelease: false,
    });

    expect(await redis.get(lockKey(seatA))).toBe(buyer);
    expect(await redis.ttl(lockKey(seatA))).toBeGreaterThan(RECOVERY_SEAT_LOCK_TTL - 5);
    expect(await redis.ttl(lockKey(seatB))).toBeGreaterThan(RECOVERY_SEAT_LOCK_TTL - 5);
  });

  it('keeps the buyer’s remaining lock and recovers only the expired seat', async () => {
    await holdCheckoutLock(buyer, seatA, 5);
    // seatB's checkout lock expired: its key is gone but the user-seats entry remains.
    await redis.sadd(`{${showtimeId}}:user-seats:${buyer}`, encodeSeatRuntimeId(seatB));

    await expect(acquire('PENDING_PAYMENT', [seatA, seatB])).resolves.toMatchObject({
      acquired: true,
      shouldRelease: true,
      seatKeys: [seatB],
      ownerToken: recoveryOwner,
    });

    expect(await redis.get(lockKey(seatA))).toBe(buyer);
    expect(await redis.ttl(lockKey(seatA))).toBeGreaterThan(RECOVERY_SEAT_LOCK_TTL - 5);
    expect(await redis.get(lockKey(seatB))).toBe(recoveryOwner);
  });

  it('refuses the commit when another buyer re-locked an expired seat, leaving their lock untouched', async () => {
    await holdCheckoutLock(buyer, seatA, 600);
    await holdCheckoutLock(otherBuyer, seatB, 600);

    await expect(acquire('PENDING_PAYMENT', [seatA, seatB])).resolves.toMatchObject({ acquired: false });

    expect(await redis.get(lockKey(seatB))).toBe(otherBuyer);
    expect(await redis.ttl(lockKey(seatB))).toBeGreaterThan(590);
  });

  it('does not take a FAILED reservation’s seat from the same buyer’s newer checkout', async () => {
    // The buyer re-locked the seat for a new reservation after the first one failed.
    await holdCheckoutLock(buyer, seatA, 600);

    await expect(acquire('FAILED', [seatA])).resolves.toMatchObject({ acquired: false });

    expect(await redis.get(lockKey(seatA))).toBe(buyer);
    expect(await redis.ttl(lockKey(seatA))).toBeGreaterThan(590);
  });

  it('recovers a FAILED reservation’s free seat under the reservation-scoped recovery lock', async () => {
    await expect(acquire('FAILED', [seatA])).resolves.toMatchObject({
      acquired: true,
      shouldRelease: true,
      seatKeys: [seatA],
      ownerToken: recoveryOwner,
    });

    expect(await redis.get(lockKey(seatA))).toBe(recoveryOwner);
    expect(await redis.ttl(lockKey(seatA))).toBeLessThanOrEqual(RECOVERY_SEAT_LOCK_TTL);
  });
});
