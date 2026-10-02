import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldCancelledSeatRecoveryWorker } from './held-cancelled-seat-recovery.worker.js';

describe('HeldCancelledSeatRecoveryWorker lifecycle', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('does not start on API instances that disable background processing', () => {
    const db = { execute: vi.fn() };
    const worker = new HeldCancelledSeatRecoveryWorker(db as never,
      { get: vi.fn().mockReturnValue('false') } as never);

    worker.onModuleInit();

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('waits for an in-flight sweep on shutdown so the database is not closed under it', async () => {
    let finishSweep!: () => void;
    const db = {
      execute: vi.fn(() => new Promise((resolve) => {
        finishSweep = () => resolve({ rows: [{ showtime_id: 'showtime-1', seat_key: '1F:A-1', reopened_item_count: 1 }] });
      })),
    };
    const gateway = { broadcastSeatUpdate: vi.fn() };
    const worker = new HeldCancelledSeatRecoveryWorker(db as never,
      { get: vi.fn().mockReturnValue(undefined) } as never, gateway as never);

    worker.onModuleInit();
    expect(db.execute).toHaveBeenCalledTimes(1);
    let destroyed = false;
    const destroy = worker.onModuleDestroy().then(() => { destroyed = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(destroyed).toBe(false);

    finishSweep();
    await destroy;

    expect(destroyed).toBe(true);
    expect(gateway.broadcastSeatUpdate).toHaveBeenCalledWith('showtime-1', '1F:A-1', 'available');
  });
});
