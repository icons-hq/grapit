import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boundedByRunDeadline,
  getRunDeadline,
  setRunDeadline,
  waitWithinRunDeadline,
} from './run-deadline.js';

describe('run deadline (bounded worker time budget)', () => {
  afterEach(() => {
    setRunDeadline(null);
    vi.useRealTimers();
  });

  it('keeps every cap unchanged without a deadline (the API)', () => {
    expect(getRunDeadline()).toBeNull();
    expect(boundedByRunDeadline(60_000, { reserveMs: 20_000, nowMs: 0 })).toBe(60_000);
  });

  it('shortens a cap to the time left before the deadline and the reserve', () => {
    setRunDeadline(100_000);

    expect(boundedByRunDeadline(65_000, { nowMs: 10_000 })).toBe(65_000);
    expect(boundedByRunDeadline(65_000, { reserveMs: 20_000, nowMs: 30_000 })).toBe(50_000);
    expect(boundedByRunDeadline(65_000, { reserveMs: 20_000, nowMs: 95_000 })).toBe(0);
  });

  it('stops waiting for a drain at the deadline and reports the timeout', async () => {
    vi.useFakeTimers();
    setRunDeadline(Date.now() + 5_000);
    const stuck = new Promise<void>(() => undefined);

    const waited = waitWithinRunDeadline(stuck, 60_000);
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void waited.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(waited).resolves.toBe(true);
  });

  it('returns as soon as the work finishes, also when it failed', async () => {
    await expect(waitWithinRunDeadline(Promise.resolve(), 60_000)).resolves.toBe(false);
    await expect(waitWithinRunDeadline(Promise.reject(new Error('x')), 60_000)).resolves.toBe(false);

    setRunDeadline(Date.now() - 1);
    await expect(waitWithinRunDeadline(Promise.resolve(), 60_000)).resolves.toBe(false);
  });
});
