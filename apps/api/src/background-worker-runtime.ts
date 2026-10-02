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
  // cancelled-seat releases, and QR reminders stall for the whole run.
  try {
    result = await runtime.sweepPendingPayments();
  } catch (error) {
    sweepFailure = error;
    runtime.onSweepFailure?.(error);
  }

  if (runtime.isQueueProcessing()) {
    try {
      await runtime.wait(windowMs);
    } catch (error) {
      failure = error;
    }
  } else {
    failure = new BackgroundWorkerQueueUnavailableError();
  }

  try {
    await runtime.stopQueue();
  } catch (error) {
    failure ??= error;
  }

  try {
    await runtime.closeApplication();
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
