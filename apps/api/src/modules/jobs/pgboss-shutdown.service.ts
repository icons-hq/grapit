import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  PG_BOSS,
  closePgBossForShutdown,
  stopPgBossWorkersForShutdown,
  type PgBossContract,
} from './pgboss.provider.js';

/**
 * Runs when the process receives SIGTERM (main.ts enables Nest shutdown hooks)
 * or when a Nest context is closed. Nest calls the hooks in this order:
 * onModuleDestroy (recovery sweep drains), beforeApplicationShutdown, closing
 * the HTTP/WebSocket servers, onApplicationShutdown.
 *
 * - beforeApplicationShutdown: pg-boss stops gracefully while the application
 *   DB pool and Redis client are still open, so in-flight job handlers can
 *   finish and unfinished jobs are failed back for an immediate retry. The
 *   pg-boss pool stays open.
 * - onApplicationShutdown: only after the HTTP server closed, pg-boss is
 *   marked unavailable and its pool closes. Requests that were in flight at
 *   SIGTERM can still enqueue a refund retry or cancelled-seat release instead
 *   of ending in schedule_failed or JOB_ENQUEUE_FAILED.
 */
@Injectable()
export class PgBossShutdownService implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly pgBoss: PgBossContract) {}

  async beforeApplicationShutdown(): Promise<void> {
    await stopPgBossWorkersForShutdown(this.pgBoss);
  }

  async onApplicationShutdown(): Promise<void> {
    await closePgBossForShutdown(this.pgBoss);
  }
}
