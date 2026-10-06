import type { PendingPaymentExpirationSweepResult } from './modules/jobs/pending-payment-expiration.worker.js';

export const DEFAULT_BACKGROUND_WORKER_WINDOW_MS = 30_000;
export const MIN_BACKGROUND_WORKER_WINDOW_MS = 1_000;
export const MAX_BACKGROUND_WORKER_WINDOW_MS = 240_000;

export function resolveBackgroundWorkerWindowMs(value?: string): number {
  if (!value) {
    return DEFAULT_BACKGROUND_WORKER_WINDOW_MS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BACKGROUND_WORKER_WINDOW_MS;
  }

  return Math.min(
    MAX_BACKGROUND_WORKER_WINDOW_MS,
    Math.max(MIN_BACKGROUND_WORKER_WINDOW_MS, Math.floor(parsed)),
  );
}

export const BACKGROUND_WORKER_FORCED_EXIT_GRACE_MS = 5_000;

/** Cloud Run Job task timeout (scripts/managed-demo/deploy-background-worker-v2.mjs `timeout`). */
export const BACKGROUND_WORKER_JOB_TIMEOUT_MS = 120_000;
/**
 * Kept after the run deadline for pg-boss's graceful stop (7s), closing the
 * Redis and database clients, and margin. A task that exceeds the Job timeout
 * fails and is retried (maxRetries 1), so the deadline must leave this room.
 */
export const BACKGROUND_WORKER_CLEANUP_RESERVE_MS = 15_000;

/**
 * Wall-clock deadline (epoch ms) for the sweep, the processing window and the
 * recovery drains of one worker run (common/run-deadline.ts).
 */
export function resolveBackgroundWorkerRunDeadline(processStartedAtMs: number): number {
  return processStartedAtMs + BACKGROUND_WORKER_JOB_TIMEOUT_MS - BACKGROUND_WORKER_CLEANUP_RESERVE_MS;
}

export interface ForcedWorkerExitOptions {
  exit?(code: number): void;
  getExitCode?(): number | string | null | undefined;
  graceMs?: number;
  onForcedExit?(): void;
}

/**
 * A Cloud Run Job execution must end once its window and cleanup are done. A
 * pg-boss instance discarded after a failed startup attempt can keep internal
 * timers that pg-boss cannot clear (stop() is a no-op after a failed start),
 * which would hold the event loop open until the task timeout. The timer is
 * unref'd, so it only fires when something still keeps the process alive after
 * cleanup; a clean run exits on its own first.
 */
export function scheduleForcedWorkerExit(
  options: ForcedWorkerExitOptions = {},
): ReturnType<typeof setTimeout> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const getExitCode = options.getExitCode ?? (() => process.exitCode);
  const timer = setTimeout(() => {
    options.onForcedExit?.();
    exit(Number(getExitCode() ?? 0) || 0);
  }, options.graceMs ?? BACKGROUND_WORKER_FORCED_EXIT_GRACE_MS);
  timer.unref();
  return timer;
}

export class BackgroundWorkerQueueUnavailableError extends Error {
  constructor() {
    super(
      'pg-boss is not processing jobs in this worker run; refund retry, cancelled-seat release, and QR reminder queues were not consumed',
    );
    this.name = 'BackgroundWorkerQueueUnavailableError';
  }
}

export interface BackgroundWorkerRuntime {
  sweepPendingPayments(): Promise<PendingPaymentExpirationSweepResult>;
  /** True when pg-boss started and registered queue workers in this process. */
  isQueueProcessing(): boolean;
  wait(windowMs: number): Promise<void>;
  stopQueue(): Promise<void>;
  closeApplication(): Promise<void>;
  closeRedis(): Promise<unknown>;
  closeDatabase(): Promise<void>;
  onSweepFailure?(error: unknown): void;
}

export async function runBackgroundWorkerWindow(
  runtime: BackgroundWorkerRuntime,
  windowMs: number,
): Promise<PendingPaymentExpirationSweepResult> {
  let result: PendingPaymentExpirationSweepResult | undefined;
  let sweepFailure: unknown;
  let failure: unknown;

  // The expiration sweep and the pg-boss queues are independent. A sweep
  // failure must not cancel the processing window, otherwise refund retries,
  // cancelled-seat releases, and QR reminders stall for the whole run. The
  // sweep (including the abandoned payment handoff review, which can take
  // about a minute of provider lookups) runs during the window rather than
  // before it, so the run lasts max(sweep, window) instead of their sum.
  const sweep = runtime.sweepPendingPayments().then(
    (value) => {
      result = value;
    },
    (error: unknown) => {
      sweepFailure = error;
      runtime.onSweepFailure?.(error);
    },
  );

  if (runtime.isQueueProcessing()) {
    try {
      await runtime.wait(windowMs);
    } catch (error) {
      failure = error;
    }
  } else {
    failure = new BackgroundWorkerQueueUnavailableError();
  }
  await sweep;

  // Close the application before stopping pg-boss, in the same order as an API
  // shutdown: the recovery sweeps drain in onModuleDestroy while pg-boss still
  // accepts the retries they schedule (a stopped queue would turn those into
  // retry_schedule_failed and a support CTA), and PgBossShutdownService then
  // stops pg-boss gracefully. stopQueue is the idempotent fallback.
  try {
    await runtime.closeApplication();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.stopQueue();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.closeRedis();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.closeDatabase();
  } catch (error) {
    failure ??= error;
  }

  // Exit non-zero (scheduled-execution alert) for queue/cleanup failures first,
  // then for a sweep failure that happened while the queues still ran.
  const finalFailure = failure ?? sweepFailure;
  if (finalFailure !== undefined) {
    throw finalFailure;
  }

  return result ?? { expiredReservations: 0, unlockedSeats: 0 };
}
