import { describe, expect, it, vi } from 'vitest';
import { seatInventories } from '../../database/schema/index.js';
import {
  CancelledSeatReleaseWorker,
  pickCancelledSeatReleaseDelaySeconds,
  shouldKeepHeldCancelledSeat,
} from './cancelled-seat-release.worker.js';

describe('CancelledSeatReleaseWorker', () => {
  it('picks a uniform random delay between 60 and 600 seconds', () => {
    expect(pickCancelledSeatReleaseDelaySeconds(1, 10, () => 0)).toBe(60);
    expect(pickCancelledSeatReleaseDelaySeconds(1, 10, () => 0.999999)).toBe(600);
    expect(pickCancelledSeatReleaseDelaySeconds(1, 10, () => 0.5)).toBeGreaterThanOrEqual(60);
  });

  it('keeps seats held when release time lands inside the showtime-imminent guard window', async () => {
    const worker = new CancelledSeatReleaseWorker({} as never, {
      isAvailable: true,
      work: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
    } as never);
    const markHoldSpy = vi
      .spyOn(worker as never, 'markShowtimeImminentHold')
      .mockResolvedValue(undefined as never);
    const releaseSpy = vi
      .spyOn(worker as never, 'releaseHeldSeats')
      .mockResolvedValue(undefined as never);
    vi.spyOn(worker as never, 'loadShowtimeAt').mockResolvedValue(
      new Date('2026-05-15T10:00:00.000Z') as never,
    );

    const payload = {
      reservationId: 'reservation-1',
      showtimeId: 'showtime-1',
      releaseAt: '2026-05-15T09:56:00.000Z',
      seatIdentities: [{ floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' }],
    };

    const result = await worker.handleJob(payload, 'release-job-1');

    expect(shouldKeepHeldCancelledSeat(
      new Date('2026-05-15T10:00:00.000Z'),
      new Date('2026-05-15T09:56:00.000Z'),
    )).toBe(true);
    expect(markHoldSpy).toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped_imminent');
  });

  it('registers the release-cancelled-seat worker on module init', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new CancelledSeatReleaseWorker({} as never, boss as never);

    await worker.onModuleInit();

    expect(boss.work).toHaveBeenCalledWith(
      'release-cancelled-seat',
      expect.any(Function),
    );
  });

  it('does not register the worker in producer-only mode', async () => {
    const boss = {
      isAvailable: true,
      processesJobs: false,
      work: vi.fn(),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new CancelledSeatReleaseWorker({} as never, boss as never);

    await worker.onModuleInit();

    expect(boss.work).not.toHaveBeenCalled();
  });

  it('consumes pg-boss batch payloads when the registered worker runs', async () => {
    const boss = {
      isAvailable: true,
      work: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      stop: vi.fn(),
    };
    const worker = new CancelledSeatReleaseWorker({} as never, boss as never);
    const handleJobSpy = vi
      .spyOn(worker, 'handleJob')
      .mockResolvedValue({ status: 'released' });
    const payload = {
      reservationId: 'reservation-1',
      showtimeId: 'showtime-1',
      releaseAt: '2026-05-15T10:00:00.000Z',
      seatIdentities: [{ floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' }],
    };

    await worker.onModuleInit();
    const handler = boss.work.mock.calls[0]?.[1] as (
      jobs: Array<{ data: typeof payload }>,
    ) => Promise<void>;
    await handler([{ id: 'release-job-1', data: payload }]);

    expect(handleJobSpy).toHaveBeenCalledWith(payload, 'release-job-1');
  });

  it('guards delayed release by current held_cancelled ownership and broadcasts released seats', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { dateTime: new Date('2026-05-15T10:00:00.000Z') },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: 'seat-inventory-1' }]),
          })),
        })),
      })),
    };
    const bookingGateway = { broadcastSeatUpdate: vi.fn() };
    const worker = new CancelledSeatReleaseWorker(
      db as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
      bookingGateway as never,
    );
    const payload = {
      reservationId: 'reservation-1',
      showtimeId: 'showtime-1',
      releaseAt: '2026-05-15T09:00:00.000Z',
      seatIdentities: [{ floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' }],
    };

    const result = await worker.handleJob(payload, 'release-job-1');

    expect(result.status).toBe('released');
    expect(db.update).toHaveBeenCalledWith(seatInventories);
    expect(bookingGateway.broadcastSeatUpdate).toHaveBeenCalledWith(
      'showtime-1',
      '1F:A-10',
      'available',
    );
  });

  it('does not broadcast when the guarded delayed release updates no rows', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            { dateTime: new Date('2026-05-15T10:00:00.000Z') },
          ]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    };
    const bookingGateway = { broadcastSeatUpdate: vi.fn() };
    const worker = new CancelledSeatReleaseWorker(
      db as never,
      { isAvailable: true, work: vi.fn(), send: vi.fn(), stop: vi.fn() } as never,
      bookingGateway as never,
    );

    await worker.handleJob({
      reservationId: 'reservation-1',
      showtimeId: 'showtime-1',
      releaseAt: '2026-05-15T09:00:00.000Z',
      seatIdentities: [{ floorKey: '1F', seatId: 'A-10', seatKey: '1F:A-10' }],
    }, 'stale-release-job');

    expect(bookingGateway.broadcastSeatUpdate).not.toHaveBeenCalled();
  });
});
