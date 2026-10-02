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
 * The API never sets it, so every component keeps its own cap there.
 */
let runDeadlineMs: number | null = null;

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
