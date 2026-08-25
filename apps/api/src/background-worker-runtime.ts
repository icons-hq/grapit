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

interface BackgroundWorkerRuntime {
  sweepPendingPayments(): Promise<PendingPaymentExpirationSweepResult>;
  wait(windowMs: number): Promise<void>;
  stopQueue(): Promise<void>;
  closeApplication(): Promise<void>;
  closeRedis(): Promise<unknown>;
  closeDatabase(): Promise<void>;
}

export async function runBackgroundWorkerWindow(
  runtime: BackgroundWorkerRuntime,
  windowMs: number,
): Promise<PendingPaymentExpirationSweepResult> {
  let result: PendingPaymentExpirationSweepResult | undefined;
  let failure: unknown;

  try {
    result = await runtime.sweepPendingPayments();
    await runtime.wait(windowMs);
  } catch (error) {
    failure = error;
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

  if (failure) {
    throw failure;
  }

  return result ?? { expiredReservations: 0, unlockedSeats: 0 };
}
