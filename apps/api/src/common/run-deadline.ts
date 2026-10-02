/**
 * Optional wall-clock deadline for a bounded process run.
 *
 * The bounded background worker is a Cloud Run Job with a fixed task timeout.
 * Its run is the expiration sweep (with the abandoned payment handoff review)
 * during the processing window, then the shutdown drains of the recovery
 * sweeps, then pg-boss and connection cleanup. Each step has its own cap,
 * sized for the always-on API, and their sum exceeds the Job timeout. The
 * worker sets this deadline once at startup and those steps shorten their own
 * caps to it, so the run ends before Cloud Run kills (and retries) the task.
 * Work cut short converges on a later run through its lease or backoff.
 *
 * The API sets it only when it receives SIGTERM or SIGINT
 * (`installShutdownRunDeadline`), so the shutdown drains end quickly and
 * pg-boss's graceful stop and failWip still run before Cloud Run's SIGKILL.
 * Until then every component keeps its own cap there.
 */
let runDeadlineMs: number | null = null;

/**
 * Time the API gives the recovery sweep drains (onModuleDestroy) after SIGTERM.
 * Cloud Run sends SIGKILL 10 seconds after SIGTERM: drains (1s) + pg-boss
 * graceful stop (`PGBOSS_SHUTDOWN_TIMEOUT_MS`, 7s) leave about 2 seconds for
 * failWip, closing the HTTP server and pools.
 */
export const API_SHUTDOWN_DRAIN_BUDGET_MS = 1_000;

export const SHUTDOWN_RUN_DEADLINE_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

type ShutdownSignal = (typeof SHUTDOWN_RUN_DEADLINE_SIGNALS)[number];

/**
 * On the first SIGTERM or SIGINT, sets the run deadline `budgetMs` from now
 * (or keeps an earlier one, such as the bounded worker's). Install it before
 * Nest's `enableShutdownHooks`: Node calls signal listeners synchronously in
 * registration order, so the deadline is in place before Nest starts the
 * shutdown drains. `once` listeners matter: Nest re-raises the signal after
 * its cleanup and the process must then exit by default.
 *
 * Returns a function that removes the listeners that have not fired.
 */
export function installShutdownRunDeadline(
  proc: Pick<NodeJS.Process, 'once' | 'removeListener'>,
  budgetMs: number,
  now: () => number = Date.now,
): () => void {
  const onSignal = (): void => {
    const deadlineMs = now() + Math.max(0, budgetMs);
    setRunDeadline(runDeadlineMs === null ? deadlineMs : Math.min(runDeadlineMs, deadlineMs));
  };
  const listeners = SHUTDOWN_RUN_DEADLINE_SIGNALS.map((signal) => {
    const listener = (): void => onSignal();
    proc.once(signal, listener);
    return [signal, listener] as [ShutdownSignal, () => void];
  });
  return () => {
    for (const [signal, listener] of listeners) {
      proc.removeListener(signal, listener);
    }
  };
}

export function setRunDeadline(deadlineMs: number | null): void {
  runDeadlineMs = deadlineMs;
}

export function getRunDeadline(): number | null {
  return runDeadlineMs;
}

/**
 * `capMs`, shortened so it ends `reserveMs` before the run deadline. Never
 * negative; without a deadline it is `capMs` unchanged.
 */
export function boundedByRunDeadline(
  capMs: number,
  options: { reserveMs?: number; nowMs?: number } = {},
): number {
  if (runDeadlineMs === null) {
    return capMs;
  }
  const nowMs = options.nowMs ?? Date.now();
  const leftMs = runDeadlineMs - (options.reserveMs ?? 0) - nowMs;
  return Math.max(0, Math.min(capMs, leftMs));
}

/**
 * Waits for `work` at most `capMs` (shortened to the run deadline). Resolves
 * true when the wait timed out. A rejected `work` counts as finished.
 */
export async function waitWithinRunDeadline(
  work: Promise<unknown>,
  capMs: number,
): Promise<boolean> {
  const waitMs = boundedByRunDeadline(capMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(() => false, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), waitMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
