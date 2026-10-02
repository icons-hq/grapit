import { BeforeApplicationShutdown, Inject, Injectable } from '@nestjs/common';
import {
  PG_BOSS,
  stopPgBossForShutdown,
  type PgBossContract,
} from './pgboss.provider.js';

/**
 * Runs when the process receives SIGTERM (main.ts enables Nest shutdown hooks)
 * or when a Nest context is closed. It runs before the HTTP/WebSocket servers
 * are disposed and while the application DB pool and Redis client are still
 * open, so in-flight job handlers can finish and unfinished jobs are failed
 * back to pg-boss for an immediate retry.
 */
@Injectable()
export class PgBossShutdownService implements BeforeApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly pgBoss: PgBossContract) {}

  async beforeApplicationShutdown(): Promise<void> {
    await stopPgBossForShutdown(this.pgBoss);
  }
}
