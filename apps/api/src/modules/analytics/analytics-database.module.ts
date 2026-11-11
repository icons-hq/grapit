import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../database/schema/index.js';
import { attachDatabasePoolErrorListener, releaseClientOnFailedTransactionBegin } from '../../database/drizzle.provider.js';

export const ANALYTICS_DB = Symbol('ANALYTICS_DB');
export const ANALYTICS_POOL = Symbol('ANALYTICS_POOL');
@Injectable()
class AnalyticsPoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(ANALYTICS_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() { await this.pool.end(); }
}
@Module({
  providers: [
    { provide: ANALYTICS_POOL, inject: [ConfigService], useFactory: (config: ConfigService) => {
      const pool = new Pool({ connectionString: config.get<string>('DATABASE_URL'), max: 1, connectionTimeoutMillis: 300,
        idleTimeoutMillis: 10_000, statement_timeout: 1500, lock_timeout: 100, application_name: 'grabit-analytics' });
      attachDatabasePoolErrorListener(pool, 'analytics'); releaseClientOnFailedTransactionBegin(pool); return pool;
    } },
    { provide: ANALYTICS_DB, inject: [ANALYTICS_POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) }, AnalyticsPoolShutdown,
  ], exports: [ANALYTICS_DB, ANALYTICS_POOL],
})
export class AnalyticsDatabaseModule {}
