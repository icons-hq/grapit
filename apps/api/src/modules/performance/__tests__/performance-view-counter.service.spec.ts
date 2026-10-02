import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { setRunDeadline } from '../../../common/run-deadline.js';
import {
  PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS,
  PerformanceViewCounter,
  VIEW_COUNT_SHUTDOWN_FLUSH_CAP_MS,
  buildViewCountFlushStatement,
} from '../performance-view-counter.service.js';

const PERFORMANCE_A = '00000000-0000-4000-8000-00000000000a';
const PERFORMANCE_B = '00000000-0000-4000-8000-00000000000b';

function createDb() {
  const executed: SQL[] = [];
  const db = {
    execute: vi.fn(async (query: SQL) => {
      executed.push(query);
      return { rows: [] };
    }),
    transaction: vi.fn(),
  };
  return { db, executed };
}

function render(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function statements(query: SQL) {
  return render(query).sql.split(';').map((part) => part.trim()).filter(Boolean);
}

describe('PerformanceViewCounter', () => {
  afterEach(() => {
    vi.useRealTimers();
    setRunDeadline(null);
  });

  it('folds many views into one batched UPDATE per flush instead of one per request', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    for (let i = 0; i < 1_000; i += 1) counter.record(PERFORMANCE_A);
    counter.record(PERFORMANCE_B);

    await expect(counter.flush()).resolves.toBe(1_001);

    expect(db.execute).toHaveBeenCalledTimes(1);
    const update = statements(executed[0]!).at(-1)!;
    expect(update).toContain('SET view_count = p.view_count + v.delta');
    expect(update).toContain(`FROM (VALUES ('${PERFORMANCE_A}'::uuid, 1000), ('${PERFORMANCE_B}'::uuid, 1))`);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(0);
  });

  it('sends the whole flush as one parameterless message, so no client round trip happens while row locks are held', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    counter.record(PERFORMANCE_A);

    await counter.flush();

    // A multi-round-trip BEGIN ... COMMIT could stall idle in transaction on a
    // hot row when Cloud Run throttles the CPU between round trips.
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1);
    const rendered = render(executed[0]!);
    // No bind parameters: node-postgres uses the simple protocol, and
    // PostgreSQL runs the statements as one implicit transaction.
    expect(rendered.params).toEqual([]);
    expect(rendered.sql).not.toMatch(/\b(begin|commit|rollback|start transaction)\b/i);
    expect(statements(executed[0]!)).toEqual([
      "SET LOCAL lock_timeout = '1000ms'",
      "SET LOCAL statement_timeout = '3000ms'",
      `SELECT count(*) FROM (SELECT id FROM performances WHERE id IN ('${PERFORMANCE_A}'::uuid) ORDER BY id FOR NO KEY UPDATE) AS locked`,
      `UPDATE performances AS p SET view_count = p.view_count + v.delta FROM (VALUES ('${PERFORMANCE_A}'::uuid, 1)) AS v(id, delta) WHERE p.id = v.id`,
    ]);
  });

  it('takes the row locks in id order before updating, whatever order the views arrived in', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    counter.record(PERFORMANCE_B);
    counter.record(PERFORMANCE_A);

    await counter.flush();

    const [, , lockPass, update] = statements(executed[0]!);
    expect(lockPass).toContain(`IN ('${PERFORMANCE_A}'::uuid, '${PERFORMANCE_B}'::uuid) ORDER BY id FOR NO KEY UPDATE`);
    expect(update).toContain('UPDATE performances');
  });

  it('merges differently cased ids so one row never gets two VALUES rows', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    counter.record(PERFORMANCE_A.toUpperCase());
    counter.record(PERFORMANCE_A);

    await expect(counter.flush()).resolves.toBe(2);

    expect(statements(executed[0]!).at(-1)).toContain(`(VALUES ('${PERFORMANCE_A}'::uuid, 2))`);
  });

  it('refuses to inline anything but canonical uuids and positive integers', () => {
    expect(() => buildViewCountFlushStatement([["x'); drop table performances; --", 1]])).toThrow();
    expect(() => buildViewCountFlushStatement([[PERFORMANCE_A.toUpperCase(), 1]])).toThrow();
    expect(() => buildViewCountFlushStatement([[PERFORMANCE_A, 0]])).toThrow();
    expect(() => buildViewCountFlushStatement([[PERFORMANCE_A, 1.5]])).toThrow();
    expect(() => buildViewCountFlushStatement([])).toThrow();
  });

  it('does nothing when no views were recorded', async () => {
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    await expect(counter.flush()).resolves.toBe(0);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('keeps deltas for the next flush when the batch fails (lock timeout, DB outage)', async () => {
    const { db, executed } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
    db.execute.mockRejectedValueOnce(
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    );

    counter.record(PERFORMANCE_A);
    counter.record(PERFORMANCE_A);
    await expect(counter.flush()).resolves.toBe(0);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(2);

    counter.record(PERFORMANCE_A);
    await expect(counter.flush()).resolves.toBe(3);
    expect(statements(executed.at(-1)!).at(-1)).toContain(`('${PERFORMANCE_A}'::uuid, 3)`);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(0);
  });

  it('shares an in-flight flush and keeps views recorded meanwhile for the next one', async () => {
    const { db } = createDb();
    let release!: () => void;
    db.execute.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { rows: [] };
    });
    const counter = new PerformanceViewCounter(db as never);

    counter.record(PERFORMANCE_A);
    const first = counter.flush();
    const concurrent = counter.flush();
    counter.record(PERFORMANCE_A);
    release();

    await expect(first).resolves.toBe(1);
    await expect(concurrent).resolves.toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(counter.pendingCount(PERFORMANCE_A)).toBe(1);
  });

  it('ignores ids that would poison the batched uuid cast', async () => {
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);

    counter.record('not-a-uuid');

    await expect(counter.flush()).resolves.toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('flushes on its interval and on shutdown', async () => {
    vi.useFakeTimers();
    const { db } = createDb();
    const counter = new PerformanceViewCounter(db as never);
    counter.onModuleInit();

    counter.record(PERFORMANCE_A);
    await vi.advanceTimersByTimeAsync(PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS);
    expect(db.execute).toHaveBeenCalledTimes(1);

    counter.record(PERFORMANCE_B);
    await counter.onApplicationShutdown();
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(counter.pendingCount(PERFORMANCE_B)).toBe(0);

    counter.record(PERFORMANCE_A);
    await vi.advanceTimersByTimeAsync(PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS * 3);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  describe('shutdown order (audit #153)', () => {
    function hangingDb() {
      const { db } = createDb();
      let release!: () => void;
      db.execute.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { rows: [] };
      });
      return { db, release: () => release() };
    }

    it('stops the flush timer in onModuleDestroy without any DB call', async () => {
      vi.useFakeTimers();
      const { db } = createDb();
      const counter = new PerformanceViewCounter(db as never);
      counter.onModuleInit();
      counter.record(PERFORMANCE_A);

      // Nest runs beforeApplicationShutdown (pg-boss stop, failWip) only
      // after every onModuleDestroy, so this hook must not wait on the pool.
      counter.onModuleDestroy();
      expect(db.execute).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS * 3);
      expect(db.execute).not.toHaveBeenCalled();
      expect(counter.pendingCount(PERFORMANCE_A)).toBe(1);

      // the final flush runs in onApplicationShutdown
      await counter.onApplicationShutdown();
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(counter.pendingCount(PERFORMANCE_A)).toBe(0);
    });

    it('returns from onApplicationShutdown at the cap instead of waiting for a slow final flush', async () => {
      vi.useFakeTimers();
      const { db, release } = hangingDb();
      const counter = new PerformanceViewCounter(db as never);
      const warn = vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
      counter.record(PERFORMANCE_A);

      let returned = false;
      const shutdown = counter.onApplicationShutdown().then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(VIEW_COUNT_SHUTDOWN_FLUSH_CAP_MS - 1);
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(returned).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
      expect(returned).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      release();
    });

    it('does not wait for the final flush once the run deadline has passed', async () => {
      vi.useFakeTimers();
      const { db, release } = hangingDb();
      const counter = new PerformanceViewCounter(db as never);
      vi.spyOn(counter['logger'], 'warn').mockImplementation(() => undefined);
      counter.record(PERFORMANCE_A);
      // SIGTERM set the 1-second run deadline; pg-boss's stop used it up
      setRunDeadline(Date.now() - 1);

      const shutdown = counter.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(0);

      await expect(shutdown).resolves.toBeUndefined();
      expect(db.execute).toHaveBeenCalledTimes(1);
      release();
    });
  });
});
