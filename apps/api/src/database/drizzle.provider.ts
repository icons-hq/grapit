import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as schema from './schema/index.js';
import {
  parseOptionalPositiveIntegerEnv,
  parsePositiveIntegerEnv,
  resolveDatabaseApplicationName,
} from './pool-config.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDB = NodePgDatabase<typeof schema>;

const logger = new Logger('DatabasePool');

export function buildDatabasePoolConfig(
  config: Pick<ConfigService, 'get'>,
): PoolConfig {
  const poolConfig: PoolConfig = {
    connectionString: config.get<string>('DATABASE_URL'),
    max: parsePositiveIntegerEnv(config, 'DB_POOL_MAX', 10),
    idleTimeoutMillis: parsePositiveIntegerEnv(
      config,
      'DB_POOL_IDLE_TIMEOUT_MS',
      30_000,
    ),
    connectionTimeoutMillis: parsePositiveIntegerEnv(
      config,
      'DB_POOL_CONNECTION_TIMEOUT_MS',
      5_000,
    ),
    application_name: resolveDatabaseApplicationName(config),
  };

  // Session guards are opt-in. A transaction that legitimately awaits an
  // external call (for example a Toss cancel inside the legacy reservation
  // cancel transaction) must finish before these limits, so operators size
  // them from load evidence instead of the code imposing a silent default.
  const statementTimeout = parseOptionalPositiveIntegerEnv(
    config,
    'DB_STATEMENT_TIMEOUT_MS',
  );
  if (statementTimeout !== undefined) {
    poolConfig.statement_timeout = statementTimeout;
  }

  const idleInTransactionTimeout = parseOptionalPositiveIntegerEnv(
    config,
    'DB_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS',
  );
  if (idleInTransactionTimeout !== undefined) {
    poolConfig.idle_in_transaction_session_timeout = idleInTransactionTimeout;
  }

  return poolConfig;
}

/**
 * pg-pool emits `error` when an idle pooled client loses its server session
 * (Cloud SQL failover/maintenance, pg_terminate_backend, network reset). The
 * pool has already discarded that client, so the event only needs to be
 * observed; an EventEmitter `error` without a listener would crash the process.
 */
export function attachDatabasePoolErrorListener(
  pool: Pick<Pool, 'on'>,
  poolName: string,
): void {
  pool.on('error', (error: Error) => {
    logger.error(
      `PostgreSQL idle client error in ${poolName} pool; the client was discarded and will be replaced on demand`,
      error instanceof Error ? error.stack : String(error),
    );
  });
}

export const drizzleProvider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const pool = new Pool(buildDatabasePoolConfig(config));
    attachDatabasePoolErrorListener(pool, 'application');
    return drizzle(pool, { schema });
  },
};
