import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_WORKER_CLEANUP_RESERVE_MS,
  BACKGROUND_WORKER_FORCED_EXIT_GRACE_MS,
  BACKGROUND_WORKER_JOB_TIMEOUT_MS,
  BackgroundWorkerQueueUnavailableError,
  DEFAULT_BACKGROUND_WORKER_WINDOW_MS,
  MAX_BACKGROUND_WORKER_WINDOW_MS,
  MIN_BACKGROUND_WORKER_WINDOW_MS,
  resolveBackgroundWorkerRunDeadline,
  resolveBackgroundWorkerWindowMs,
  runBackgroundWorkerWindow,
  scheduleForcedWorkerExit,
} from './background-worker-runtime.js';

function createRuntime() {
  return {
    sweepPendingPayments: vi.fn().mockResolvedValue({
      expiredReservations: 1,
      unlockedSeats: 2,
    }),
    isQueueProcessing: vi.fn().mockReturnValue(true),
    onSweepFailure: vi.fn(),
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

  it('keeps the queue window open when the sweep fails, then exits non-zero', async () => {
    const runtime = createRuntime();
    const sweepError = new Error('database unavailable');
    runtime.sweepPendingPayments.mockRejectedValue(sweepError);

    await expect(runBackgroundWorkerWindow(runtime, 30_000)).rejects.toThrow(
      'database unavailable',
    );
    expect(runtime.onSweepFailure).toHaveBeenCalledWith(sweepError);
    // refund retry, cancelled-seat release, and QR jobs still get the full window
    expect(runtime.wait).toHaveBeenCalledWith(30_000);
    expect(runtime.wait.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.closeApplication.mock.invocationCallOrder[0]!,
    );
    expect(runtime.stopQueue).toHaveBeenCalledTimes(1);
    expect(runtime.closeApplication).toHaveBeenCalledTimes(1);
    expect(runtime.closeRedis).toHaveBeenCalledTimes(1);
    expect(runtime.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it('fails the run when pg-boss is not processing jobs, after sweeping and cleaning up', async () => {
    const runtime = createRuntime();
    runtime.isQueueProcessing.mockReturnValue(false);

    await expect(runBackgroundWorkerWindow(runtime, 30_000)).rejects.toBeInstanceOf(
      BackgroundWorkerQueueUnavailableError,
    );
    expect(runtime.sweepPendingPayments).toHaveBeenCalledTimes(1);
    expect(runtime.wait).not.toHaveBeenCalled();
    expect(runtime.stopQueue).toHaveBeenCalledTimes(1);
    expect(runtime.closeApplication).toHaveBeenCalledTimes(1);
    expect(runtime.closeRedis).toHaveBeenCalledTimes(1);
    expect(runtime.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it('reports the queue failure first when both the sweep and the queue fail', async () => {
    const runtime = createRuntime();
    runtime.sweepPendingPayments.mockRejectedValue(new Error('sweep failed'));
    runtime.isQueueProcessing.mockReturnValue(false);

    await expect(runBackgroundWorkerWindow(runtime, 30_000)).rejects.toBeInstanceOf(
      BackgroundWorkerQueueUnavailableError,
    );
    expect(runtime.onSweepFailure).toHaveBeenCalledTimes(1);
  });

  it('runs the expiration sweep during the window instead of before it (seam: w2a review x u03 drains)', async () => {
    const runtime = createRuntime();
    let finishSweep: (value: { expiredReservations: number; unlockedSeats: number }) => void = () => undefined;
    runtime.sweepPendingPayments.mockReturnValue(new Promise((resolveSweep) => {
      finishSweep = resolveSweep;
    }));
    let finishWindow: () => void = () => undefined;
    runtime.wait.mockReturnValue(new Promise<void>((resolveWindow) => {
      finishWindow = resolveWindow;
    }));

    const run = runBackgroundWorkerWindow(runtime, 30_000);
    await Promise.resolve();
    // The window started while the abandoned-handoff review is still looking up Toss.
    expect(runtime.wait).toHaveBeenCalledWith(30_000);

    finishWindow();
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    // Cleanup waits for the sweep, which still owns order leases and DB work.
    expect(runtime.closeApplication).not.toHaveBeenCalled();

    finishSweep({ expiredReservations: 3, unlockedSeats: 0 });
    await expect(run).resolves.toEqual({ expiredReservations: 3, unlockedSeats: 0 });
  });

  it('closes the application (recovery drains) before pg-boss stops accepting retries', async () => {
    const runtime = createRuntime();

    await runBackgroundWorkerWindow(runtime, 30_000);

    // A drain that schedules a refund retry must still reach pg-boss, otherwise it is
    // recorded as retry_schedule_failed and turns on the support CTA.
    expect(runtime.closeApplication.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.stopQueue.mock.invocationCallOrder[0]!,
    );
    expect(runtime.stopQueue.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.closeRedis.mock.invocationCallOrder[0]!,
    );
  });

  it('ends the run deadline early enough for cleanup inside the Cloud Run Job timeout', () => {
    expect(resolveBackgroundWorkerRunDeadline(1_000)).toBe(
      1_000 + BACKGROUND_WORKER_JOB_TIMEOUT_MS - BACKGROUND_WORKER_CLEANUP_RESERVE_MS,
    );
    // pg-boss graceful stop (7s, checked here with margin) plus Redis/DB close must fit the reserve.
    expect(BACKGROUND_WORKER_CLEANUP_RESERVE_MS).toBeGreaterThanOrEqual(8_000 + 5_000);

    const deployScript = readFileSync(
      resolve(__dirname, '../../../scripts/managed-demo/deploy-background-worker-v2.mjs'),
      'utf8',
    );
    expect(deployScript).toContain(`timeout: '${BACKGROUND_WORKER_JOB_TIMEOUT_MS / 1000}s'`);
  });

  it('surfaces a cleanup failure after a successful window', async () => {
    const runtime = createRuntime();
    runtime.closeRedis.mockRejectedValue(new Error('redis quit failed'));

    await expect(runBackgroundWorkerWindow(runtime, 30_000)).rejects.toThrow(
      'redis quit failed',
    );
    expect(runtime.closeDatabase).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleForcedWorkerExit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not keep a cleanly finished worker process alive', () => {
    const exit = vi.fn();
    const timer = scheduleForcedWorkerExit({ exit });

    try {
      // unref'd: a clean run exits naturally before the grace period ends.
      expect(timer.hasRef()).toBe(false);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
    }
  });

  it('forces the exit with the run status when leaked timers keep the event loop open', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const onForcedExit = vi.fn();

    scheduleForcedWorkerExit({ exit, onForcedExit, getExitCode: () => 1 });
    vi.advanceTimersByTime(BACKGROUND_WORKER_FORCED_EXIT_GRACE_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onForcedExit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('keeps a successful run successful when it has to force the exit', () => {
    vi.useFakeTimers();
    const exit = vi.fn();

    scheduleForcedWorkerExit({ exit, getExitCode: () => undefined, graceMs: 10 });
    vi.advanceTimersByTime(10);

    expect(exit).toHaveBeenCalledWith(0);
  });
});
