import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKGROUND_WORKER_WINDOW_MS,
  MAX_BACKGROUND_WORKER_WINDOW_MS,
  MIN_BACKGROUND_WORKER_WINDOW_MS,
  resolveBackgroundWorkerWindowMs,
  runBackgroundWorkerWindow,
} from './background-worker-runtime.js';

function createRuntime() {
  return {
    sweepPendingPayments: vi.fn().mockResolvedValue({
      expiredReservations: 1,
      unlockedSeats: 2,
    }),
    wait: vi.fn().mockResolvedValue(undefined),
    stopQueue: vi.fn().mockResolvedValue(undefined),
    closeApplication: vi.fn().mockResolvedValue(undefined),
    closeRedis: vi.fn().mockResolvedValue('OK'),
    closeDatabase: vi.fn().mockResolvedValue(undefined),
  };
}

describe('background worker runtime', () => {
  it('uses a bounded processing window', () => {
    expect(resolveBackgroundWorkerWindowMs()).toBe(DEFAULT_BACKGROUND_WORKER_WINDOW_MS);
    expect(resolveBackgroundWorkerWindowMs('invalid')).toBe(
      DEFAULT_BACKGROUND_WORKER_WINDOW_MS,
    );
    expect(resolveBackgroundWorkerWindowMs('10')).toBe(
      MIN_BACKGROUND_WORKER_WINDOW_MS,
    );
    expect(resolveBackgroundWorkerWindowMs('999999')).toBe(
      MAX_BACKGROUND_WORKER_WINDOW_MS,
    );
  });

  it('runs the immediate sweep, keeps pg-boss alive for the window, and cleans up', async () => {
    const runtime = createRuntime();

    const result = await runBackgroundWorkerWindow(runtime, 30_000);

    expect(runtime.sweepPendingPayments).toHaveBeenCalledTimes(1);
    expect(runtime.wait).toHaveBeenCalledWith(30_000);
    expect(runtime.stopQueue).toHaveBeenCalledTimes(1);
    expect(runtime.closeApplication).toHaveBeenCalledTimes(1);
    expect(runtime.closeRedis).toHaveBeenCalledTimes(1);
    expect(runtime.closeDatabase).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ expiredReservations: 1, unlockedSeats: 2 });
  });

  it('still stops pg-boss and closes Nest when a sweep fails', async () => {
    const runtime = createRuntime();
    runtime.sweepPendingPayments.mockRejectedValue(new Error('database unavailable'));

    await expect(runBackgroundWorkerWindow(runtime, 30_000)).rejects.toThrow(
      'database unavailable',
    );
    expect(runtime.wait).not.toHaveBeenCalled();
    expect(runtime.stopQueue).toHaveBeenCalledTimes(1);
    expect(runtime.closeApplication).toHaveBeenCalledTimes(1);
    expect(runtime.closeRedis).toHaveBeenCalledTimes(1);
    expect(runtime.closeDatabase).toHaveBeenCalledTimes(1);
  });
});
