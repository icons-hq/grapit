import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_SHUTDOWN_DRAIN_BUDGET_MS,
  boundedByRunDeadline,
  getRunDeadline,
  installShutdownRunDeadline,
  setRunDeadline,
  waitWithinRunDeadline,
} from './run-deadline.js';
import { PGBOSS_SHUTDOWN_TIMEOUT_MS } from '../modules/jobs/pgboss.provider.js';

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

describe('installShutdownRunDeadline (API SIGTERM, audit #153)', () => {
  afterEach(() => {
    setRunDeadline(null);
    vi.useRealTimers();
  });

  function fakeProcess() {
    return new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'once' | 'removeListener'>;
  }

  it('leaves the API without a deadline until a termination signal arrives', () => {
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS, () => 1_000_000);

    expect(getRunDeadline()).toBeNull();
    expect(boundedByRunDeadline(60_000)).toBe(60_000);
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'shortens every shutdown drain to the budget after %s',
    (signal) => {
      const proc = fakeProcess();
      installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS, () => 1_000_000);

      proc.emit(signal);

      expect(getRunDeadline()).toBe(1_000_000 + API_SHUTDOWN_DRAIN_BUDGET_MS);
      // held-seat 30s, refund recovery 60s, async DONE 60s drains
      for (const capMs of [30_000, 60_000]) {
        expect(boundedByRunDeadline(capMs, { nowMs: 1_000_000 })).toBeLessThanOrEqual(1_000);
      }
    },
  );

  it('fits the drains, the pg-boss graceful stop and cleanup into Cloud Run\'s 10 seconds', () => {
    expect(API_SHUTDOWN_DRAIN_BUDGET_MS + PGBOSS_SHUTDOWN_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
  });

  it('cuts a drain in progress at the budget once SIGTERM arrives', async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS);
    const stuckSweep = new Promise<void>(() => undefined);

    proc.emit('SIGTERM');
    const waited = waitWithinRunDeadline(stuckSweep, 60_000);
    await vi.advanceTimersByTimeAsync(API_SHUTDOWN_DRAIN_BUDGET_MS);

    await expect(waited).resolves.toBe(true);
  });

  it('keeps an earlier deadline (the bounded worker) and never extends it', () => {
    setRunDeadline(1_000_500);
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS, () => 1_000_000);

    proc.emit('SIGTERM');

    expect(getRunDeadline()).toBe(1_000_500);
  });

  it('pulls a later worker deadline in to the budget', () => {
    setRunDeadline(1_100_000);
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS, () => 1_000_000);

    proc.emit('SIGTERM');

    expect(getRunDeadline()).toBe(1_000_000 + API_SHUTDOWN_DRAIN_BUDGET_MS);
  });

  it('listens once, so the signal Nest re-raises after its cleanup still ends the process', () => {
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS);
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    expect(proc.listenerCount('SIGINT')).toBe(1);

    proc.emit('SIGTERM');

    expect(proc.listenerCount('SIGTERM')).toBe(0);
  });

  it('runs before listeners registered after it, such as Nest shutdown hooks', () => {
    const proc = fakeProcess();
    installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS, () => 1_000_000);
    let deadlineSeenByNest: number | null | undefined;
    proc.on('SIGTERM', () => {
      deadlineSeenByNest = getRunDeadline();
    });

    proc.emit('SIGTERM');

    expect(deadlineSeenByNest).toBe(1_000_000 + API_SHUTDOWN_DRAIN_BUDGET_MS);
  });

  it('can be uninstalled', () => {
    const proc = fakeProcess();
    const uninstall = installShutdownRunDeadline(proc, API_SHUTDOWN_DRAIN_BUDGET_MS);

    uninstall();
    proc.emit('SIGTERM');

    expect(proc.listenerCount('SIGINT')).toBe(0);
    expect(getRunDeadline()).toBeNull();
  });
});
