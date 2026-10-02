import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE, type DrizzleDB } from '../../database/drizzle.provider.js';

export const PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS = 10_000;
/** A flush never waits long behind an admin edit holding the row lock. */
const FLUSH_LOCK_TIMEOUT_MS = 1_000;
const FLUSH_STATEMENT_TIMEOUT_MS = 3_000;
/** Canonical lowercase UUID; the only id shape inlined into the flush SQL. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Builds the whole flush as one simple-protocol message. Without bind
 * parameters PostgreSQL runs the statements as one implicit transaction:
 *
 * - The server runs every statement and commits before it answers. No client
 *   round trip happens while row locks are held, so a client that stalls
 *   mid-flush (Cloud Run CPU throttling, GC, event loop lag) cannot leave the
 *   session idle in transaction on a hot performances row.
 * - A failing statement (lock or statement timeout) rolls the whole message
 *   back and leaves the pooled connection clean. There is no explicit BEGIN
 *   that could stay open in an aborted state.
 * - `SET LOCAL` lasts only until that implicit transaction ends.
 * - The ordered `FOR NO KEY UPDATE` pass takes the row locks in id order, so
 *   flushes from several instances wait on each other instead of deadlocking.
 *
 * Values are inlined because the simple protocol has no parameters. Only
 * canonical lowercase UUIDs and positive safe integers are accepted.
 */
export function buildViewCountFlushStatement(
  entries: ReadonlyArray<readonly [id: string, delta: number]>,
): string {
  if (entries.length === 0) {
    throw new Error('view count flush needs at least one entry');
  }
  for (const [id, delta] of entries) {
    if (!UUID_PATTERN.test(id) || !Number.isSafeInteger(delta) || delta <= 0) {
      throw new Error('invalid performance view count entry');
    }
  }
  const ids = entries.map(([id]) => `'${id}'::uuid`).join(', ');
  const values = entries
    .map(([id, delta]) => `('${id}'::uuid, ${delta})`)
    .join(', ');
  return [
    `SET LOCAL lock_timeout = '${FLUSH_LOCK_TIMEOUT_MS}ms'`,
    `SET LOCAL statement_timeout = '${FLUSH_STATEMENT_TIMEOUT_MS}ms'`,
    `SELECT count(*) FROM (SELECT id FROM performances WHERE id IN (${ids}) ORDER BY id FOR NO KEY UPDATE) AS locked`,
    `UPDATE performances AS p SET view_count = p.view_count + v.delta FROM (VALUES ${values}) AS v(id, delta) WHERE p.id = v.id`,
  ].join(';\n') + ';';
}

/**
 * Write-behind counter for public performance detail views.
 *
 * Public detail reads only bump an in-process counter. A periodic flush folds
 * the accumulated deltas into `performances.view_count` with one batched
 * UPDATE per instance, so an opening-time refresh storm no longer serializes
 * on a per-request UPDATE of the same hot row or holds pool connections while
 * waiting for that row lock.
 *
 * The flush timer runs in every API instance, independent of
 * BACKGROUND_PROCESSING_ENABLED. Under Cloud Run CPU throttling it can fire
 * late (when the next request wakes the instance). The single-message flush
 * keeps such a stall from holding a row lock.
 *
 * Trade-off: deltas that are not flushed yet are lost if the process dies
 * without a graceful shutdown (bounded by one flush interval per instance).
 * view_count only drives popularity ordering, so this is acceptable.
 */
@Injectable()
export class PerformanceViewCounter
  implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(PerformanceViewCounter.name);
  private pending = new Map<string, number>();
  private activeFlush: Promise<number> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, PERFORMANCE_VIEW_COUNT_FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopAndFlush();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopAndFlush();
  }

  /** Synchronous and I/O free: safe on the hot public read path. */
  record(performanceId: string): void {
    // One spelling per row: UPDATE ... FROM applies only one of several
    // VALUES rows that match the same performance.
    const id = performanceId.toLowerCase();
    // Anything else would make the batched flush fail on every retry.
    if (!UUID_PATTERN.test(id)) return;
    this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
  }

  pendingCount(performanceId: string): number {
    return this.pending.get(performanceId.toLowerCase()) ?? 0;
  }

  /**
   * Applies the buffered deltas. Concurrent callers share one in-flight
   * flush. On failure the deltas are merged back for the next attempt.
   * Returns the number of views written.
   */
  async flush(): Promise<number> {
    if (this.activeFlush) return this.activeFlush;
    if (this.pending.size === 0) return 0;

    const batch = this.pending;
    this.pending = new Map();
    const flush = this.writeBatch(batch);
    this.activeFlush = flush;
    try {
      return await flush;
    } finally {
      this.activeFlush = null;
    }
  }

  private async stopAndFlush(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Views recorded while an earlier flush was in flight need a second pass.
    if (this.activeFlush) await this.activeFlush;
    await this.flush();
  }

  private async writeBatch(batch: Map<string, number>): Promise<number> {
    // Sorting only keeps the statement text deterministic. The SQL ORDER BY
    // decides the row-lock order.
    const entries = [...batch.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0);
    const total = entries.reduce((sum, [, delta]) => sum + delta, 0);

    try {
      await this.db.execute(sql.raw(buildViewCountFlushStatement(entries)));
      return total;
    } catch (error) {
      for (const [id, delta] of entries) {
        this.pending.set(id, (this.pending.get(id) ?? 0) + delta);
      }
      this.logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          performances: entries.length,
          views: total,
        },
        'performance view count flush failed — deltas kept for the next flush',
      );
      return 0;
    }
  }
}
