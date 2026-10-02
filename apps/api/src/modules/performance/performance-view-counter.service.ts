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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write-behind counter for public performance detail views.
 *
 * Public detail reads only bump an in-process counter. A periodic flush folds
 * the accumulated deltas into `performances.view_count` with one batched
 * UPDATE per instance, so an opening-time refresh storm no longer serializes
 * on a per-request UPDATE of the same hot row or holds pool connections while
 * waiting for that row lock.
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
    // A malformed id would make the batched ::uuid cast fail on every retry.
    if (!UUID_PATTERN.test(performanceId)) return;
    this.pending.set(performanceId, (this.pending.get(performanceId) ?? 0) + 1);
  }

  pendingCount(performanceId: string): number {
    return this.pending.get(performanceId) ?? 0;
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
    // Sorted ids give every instance the same row-lock order.
    const entries = [...batch.entries()].sort(([a], [b]) => a.localeCompare(b));
    const total = entries.reduce((sum, [, delta]) => sum + delta, 0);
    const values = sql.join(
      entries.map(([id, delta]) => sql`(${id}::uuid, ${delta}::integer)`),
      sql`, `,
    );

    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT
            set_config('lock_timeout', ${`${FLUSH_LOCK_TIMEOUT_MS}ms`}, true),
            set_config('statement_timeout', ${`${FLUSH_STATEMENT_TIMEOUT_MS}ms`}, true)
        `);
        await tx.execute(sql`
          UPDATE performances AS p
          SET view_count = p.view_count + v.delta
          FROM (VALUES ${values}) AS v(id, delta)
          WHERE p.id = v.id
        `);
      });
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
