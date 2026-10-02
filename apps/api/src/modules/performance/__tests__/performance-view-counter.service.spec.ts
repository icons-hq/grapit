import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import {
  PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS,
  PerformanceViewCounter,
} from '../performance-view-counter.service.js';

const PERFORMANCE_A = '00000000-0000-4000-8000-00000000000a';
const PERFORMANCE_B = '00000000-0000-4000-8000-00000000000b';

function createDb() {
  const executed: SQL[] = [];
  const tx = {
    execute: vi.fn(async (query: SQL) => {
      executed.push(query);
      return { rows: [] };
    }),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  };
  return { db, tx, executed };
}

function render(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

describe('PerformanceViewCounter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('folds many views into one batched UPDATE per flush instead of one per request', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    for (let i = 0; i < 1_000; i += 1) counter.record(PERFORMANCE_A);
    counter.record(PERFORMANCE_B);

    await expect(counter.flush()).resolves.toBe(1_001);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(executed).toHaveLength(2);
    const timeouts = render(executed[0]!);
    expect(timeouts.sql).toContain("set_config('lock_timeout'");
    expect(timeouts.sql).toContain("set_config('statement_timeout'");
    expect(timeouts.params).toEqual(['1000ms', '3000ms']);

    const update = render(executed[1]!);
    expect(update.sql).toContain('SET view_count = p.view_count + v.delta');
    expect(update.sql).toContain('FROM (VALUES');
    // Sorted ids keep the row-lock order identical across instances.
    expect(update.params).toEqual([PERFORMANCE_A, 1_000, PERFORMANCE_B, 1]);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(0);
  });

  it('does nothing when no views were recorded', async () => {
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    await expect(counter.flush()).resolves.toBe(0);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('keeps deltas for the next flush when the batch fails (lock timeout, DB outage)', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
    db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    );

    counter.record(PERFORMANCE_A);
    counter.record(PERFORMANCE_A);
    await expect(counter.flush()).resolves.toBe(0);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(2);

    counter.record(PERFORMANCE_A);
    await expect(counter.flush()).resolves.toBe(3);
    expect(render(executed.at(-1)!).params).toEqual([PERFORMANCE_A, 3]);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(0);
  });

  it('shares an in-flight flush and keeps views recorded meanwhile for the next one', async () => {
    const { db, executed } = createDb();
    let release!: () => void;
    db.transaction.mockImplementationOnce(async (callback) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return callback({ execute: async (query: SQL) => { executed.push(query); } } as never);
    });
    const counter = new PerformanceViewCounter(db as never);

    counter.record(PERFORMANCE_A);
    const first = counter.flush();
    const concurrent = counter.flush();
    counter.record(PERFORMANCE_A);
    release();

    await expect(first).resolves.toBe(1);
    await expect(concurrent).resolves.toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(1);
  });

  it('ignores ids that would poison the batched uuid cast', async () => {
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    counter.record('not-a-uuid');

    await expect(counter.flush()).resolves.toBe(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('flushes on its interval and on shutdown', async () => {
    vi.useFakeTimers();
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    counter.onModuleInit();

    counter.record(PERFORMANCE_A);
    await vi.advanceTimersByTimeAsync(PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS);
    expect(db.transaction).toHaveBeenCalledTimes(1);

    counter.record(PERFORMANCE_B);
    await counter.onApplicationShutdown();
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(counter.pendingCount(PERFORMANCE_B)).toBe(0);

    counter.record(PERFORMANCE_A);
    await vi.advanceTimersByTimeAsync(PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS * 3);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });
});
